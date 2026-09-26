import type { ContextPartMetadata } from '@/lib/messages/contextParts';
import { createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk/v2";
import { isPermissionNotFoundError, type FormAnswer, type OpenCodeClient, type PermissionRequest as V2PermissionRequest, type SessionRevert as V2SessionRevert } from '@opencode/client';
import type { PermissionV2Request, PermissionV2Effect, PermissionV2Source } from "@opencode-ai/sdk/v2/client";
import { z } from "zod";
import { OpencodeRequestError, toUpstreamErrorDetail, upstreamErrorPayloadSchema } from "./upstreamError";
import { OPEN_CODE_GENERATION, OpenCodeRuntimeBinding, OpenCodeRuntimeChangedError, OpenCodeRuntimeError, type OpenCodeRuntime } from './runtime';
import { V1SessionOperations } from './v1/sessions';
import { projectLegacyMessage, projectLegacyPart, projectLegacySession } from './v1/projection';
import type { Message as DomainMessage, Metadata, ModelRef, Part as DomainPart, Project as DomainProject, Session as DomainSession, Vcs as DomainVcs } from './model';
import { V2SessionOperations } from './v2/sessions';
import { V2CatalogOperations } from './v2/catalog';
import type { BootstrapPath, McpCatalog, PendingInput, PendingPermission, ProviderCatalog, TaggedConfig } from './operations';
import { createV2RuntimeClient } from './v2/client';
import { createOpenCodeFetch, createTimeoutSignal } from './transport';
import { createV1SyncSource, createV2SyncSource, type SyncSource } from '@/sync/source';
import type { FilesAPI } from "../api/types";
import { getDesktopHomeDirectory } from "../desktop";
import type {
  Provider,
  Config,
  Agent,
  TextPartInput,
  FilePartInput,
} from "@opencode-ai/sdk/v2";
import { isAmbiguousTransportFailure, markAmbiguousTransportFailure } from "@/lib/relay/transport-error";
import { FilesystemError, parseFilesystemErrorReason } from "@/lib/api/files-errors";
import type { PermissionRequest } from "@/types/permission";
import type { QuestionRequest } from "@/types/question";

/**
 * Tagged result of `OpencodeService.fetchPermission()`. The caller can
 * distinguish a server-confirmed "no longer pending" permission (HTTP
 * 404) from a fetch failure (network error, malformed response, or a
 * pre-v1.17.12 server without the V2 endpoint).
 */
export type FetchPermissionResult =
  | { state: "ok"; permission: PermissionV2Request | V2PermissionRequest }
  | { state: "resolved" }
  | { state: "unknown" };
import { getRuntimeUrlResolver } from "@/lib/runtime-url";
import { runtimeFetch } from "@/lib/runtime-fetch";
import { getRuntimeKey } from "@/lib/runtime-switch";
import { normalizePath } from "@/lib/pathNormalization";
import { hostSessionStatusSnapshotSchema, sessionStatusSnapshotSchema, type HostSessionStatusSnapshot } from "./session-status";
import { getRegisteredRuntimeAPIs } from "@/contexts/runtimeAPIRegistry";
import { markStartupTrace } from "@/lib/startupTrace";
import {
  assertProviderCircuitClosed,
  recordProviderSuccess,
  recordProviderError,
} from "./provider-tracker";

// Use relative path by default (works with both dev and nginx proxy server)
// Can be overridden with VITE_OPENCODE_URL for absolute URLs in special deployments
const DEFAULT_BASE_URL = import.meta.env.VITE_OPENCODE_URL || "/api";
const CONFIG_CACHE_TTL_MS = 10_000;
const OPENCODE_HEALTH_TIMEOUT_MS = 4_000;

/**
 * Render an SDK error payload into a short string for Error messages.
 * The SDK returns `{data, error}` shape without throwing on non-2xx; methods
 * that need to signal failure (so callers can preserve state instead of
 * conflating failure with an empty success) wrap the error with this helper.
 */
function formatSdkError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
type SdkResult<T> = {
  data?: T;
  error?: unknown;
  response?: { status?: number };
};

type DirectoryAvailability = "available" | "missing" | "unknown";
type SessionArchivePayload = { ids: string[]; directory?: string; archivedAt?: number };
const directoryProbeErrorSchema = z.object({ reason: z.string().optional(), isDirectory: z.boolean().optional() });


function unwrapSdkData<T>(result: SdkResult<T>, operation: string): T {
  if (result.error) {
    const status = result.response?.status;
    throw new OpencodeRequestError(
      `${operation} failed${status ? ` (${status})` : ""}: ${formatSdkError(result.error)}`,
      toUpstreamErrorDetail(upstreamErrorPayloadSchema.safeParse(result.error).data, status),
    );
  }
  if (result.data === undefined || result.data === null) {
    throw new Error(`${operation} failed: empty response`);
  }
  return result.data;
}

function unwrapSdkOptional<T>(result: SdkResult<T>, operation: string): T | undefined {
  if (result.error) {
    const status = result.response?.status;
    throw new OpencodeRequestError(
      `${operation} failed${status ? ` (${status})` : ""}: ${formatSdkError(result.error)}`,
      toUpstreamErrorDetail(upstreamErrorPayloadSchema.safeParse(result.error).data, status),
    );
  }
  return result.data;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;
const ID_RANDOM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_RANDOM_LENGTH = 14;

let lastIdTimestamp = 0;
let idCounter = 0;

const randomBase62 = (length: number): string => {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += ID_RANDOM_CHARS[bytes[index] % ID_RANDOM_CHARS.length];
  }
  return result;
};

const ascendingId = (prefix: "msg"): string => {
  const timestamp = Date.now();
  if (timestamp !== lastIdTimestamp) {
    lastIdTimestamp = timestamp;
    idCounter = 0;
  }
  idCounter += 1;

  const sortable = BigInt(timestamp) * BigInt(0x1000) + BigInt(idCounter);
  const timeBytes = new Uint8Array(6);
  for (let index = 0; index < 6; index += 1) {
    timeBytes[index] = Number((sortable >> BigInt(40 - 8 * index)) & BigInt(0xff));
  }
  const hex = Array.from(timeBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}${randomBase62(ID_RANDOM_LENGTH)}`;
};

const ensureAbsoluteBaseUrl = (candidate: string): string => {
  const normalized = typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : "/api";

  if (ABSOLUTE_URL_PATTERN.test(normalized)) {
    return normalized;
  }

  if (typeof window === "undefined") {
    return normalized;
  }

  const baseReference = window.location?.href || window.location?.origin;
  if (!baseReference) {
    return normalized;
  }

  try {
    return new URL(normalized, baseReference).toString();
  } catch (error) {
    console.warn("Failed to normalize OpenCode base URL:", error);
    return normalized;
  }
};

const resolveRuntimeBaseUrl = (): string | null => {
  try {
    return getRuntimeUrlResolver().api('/api');
  } catch {
    return null;
  }
};

type RuntimeOpencodeClientConfig = {
  baseUrl: string;
  directory?: string;
  assertProtocol?: () => void;
  /** Read-request timeout in ms. Overridable so tests can use short value. */
  requestTimeoutMs?: number;
};

export const createRuntimeOpencodeClient = (config: RuntimeOpencodeClientConfig): OpencodeClient => {
  const { assertProtocol, requestTimeoutMs, ...sdkConfig } = config;
  return createOpencodeClient({
    ...sdkConfig,
    fetch: createOpenCodeFetch({ assertProtocol, requestTimeoutMs }),
  });
};

interface App {
  version?: string;
  [key: string]: unknown;
}

type FilesystemEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink?: boolean;
};

export type ProjectFileSearchHit = {
  name: string;
  path: string;
  relativePath: string;
  extension?: string;
};

type AgentPartInputLite = {
  type: 'agent';
  name: string;
  source?: {
    value: string;
    start: number;
    end: number;
  };
};

type FileInputLite = {
  id?: string;
  type: 'file';
  mime: string;
  filename?: string;
  url: string;
};

type DirectorySwitchResult = {
  success: boolean;
  restarted: boolean;
  path: string;
  agents?: Agent[];
  providers?: Provider[];
  models?: unknown[];
};

const normalizeFsPath = (path: string): string => path.replace(/\\/g, "/");
const FS_LIST_CACHE_TTL_MS = 400;

const getDesktopFilesApi = (): FilesAPI | null => {
  const apis = getRegisteredRuntimeAPIs();
  if (apis && apis.runtime?.isDesktop && apis.files) {
    return apis.files;
  }
  return null;
};

// /api/fs/home parsing boundary. Older servers answer without chatsRoot;
// only a valid home response may use the legacy chats-root fallback.
const fsAbsolutePathSchema = z.string().trim().regex(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/);
const fsHomeResponseSchema = z.object({
  home: fsAbsolutePathSchema,
  chatsRoot: fsAbsolutePathSchema.optional(),
  canonicalChatsRoot: fsAbsolutePathSchema.optional(),
  canonicalLegacyChatsRoot: fsAbsolutePathSchema.optional(),
});

const runtimeDescriptorSchema = z.object({
  generation: z.enum(OPEN_CODE_GENERATION),
  endpoint: z.string().min(1).nullable(),
  epoch: z.union([z.string().min(1), z.number().finite()]),
  version: z.string().nullable(),
});

class OpencodeService {
  private readonly runtimeBinding = new OpenCodeRuntimeBinding();
  private connectionRevision = 0;
  private discovery: Promise<OpenCodeRuntime> | null = null;
  private readonly runtimeListeners = new Set<() => void>();
  private syncSource: SyncSource | null = null;
  private client: OpencodeClient;
  private sessions: V1SessionOperations;
  private v2Client: OpenCodeClient;
  private readonly v2Sessions: V2SessionOperations;
  private readonly v2Catalog: V2CatalogOperations;
  private baseUrl: string;
  private scopedClients: Map<string, OpencodeClient> = new Map();
  private v2ScopedClients: Map<string, OpenCodeClient> = new Map();
  private currentDirectory: string | undefined = undefined;
  private directoryContextQueue: Promise<void> = Promise.resolve();
  private listDirectoryInFlight: Map<string, Promise<FilesystemEntry[]>> = new Map();
  private configProvidersInFlight: Map<string, Promise<{ providers: Provider[]; default: { [key: string]: string } }>> = new Map();
  private listAgentsInFlight: Map<string, Promise<Agent[]>> = new Map();
  private configInFlight: Map<string, Promise<Config>> = new Map();
  private configCache: Map<string, { config: Config; expiresAt: number }> = new Map();
  private configCacheGeneration = 0;
  private listDirectoryCache: Map<string, { entries: FilesystemEntry[]; expiresAt: number }> = new Map();

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    const runtimeBase = resolveRuntimeBaseUrl();
    const requestedBaseUrl = runtimeBase || baseUrl;
    this.baseUrl = ensureAbsoluteBaseUrl(requestedBaseUrl);
    this.client = createRuntimeOpencodeClient({ baseUrl: this.baseUrl, assertProtocol: () => this.runtimeBinding.assert('oc1', 'SDK request') });
    this.sessions = new V1SessionOperations(this.client);
    this.v2Client = createV2RuntimeClient({ baseUrl: this.baseUrl, assertProtocol: () => this.runtimeBinding.assert('oc2', 'SDK request') });
    this.v2Sessions = new V2SessionOperations((directory) => this.v2ClientFor(directory), this.runtimeBinding);
    this.v2Catalog = new V2CatalogOperations((directory) => this.v2ClientFor(directory), this.runtimeBinding);
  }

  private assertRuntimeUnchanged(runtimeKey?: string): void {
    if (runtimeKey && runtimeKey !== getRuntimeKey()) {
      throw new Error('Message was not sent because the runtime changed.');
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** Called only after the server/host has selected an endpoint and epoch. */
  bindRuntime(runtime: OpenCodeRuntime): void {
    const current = this.runtimeBinding.get();
    if (current?.endpoint === runtime.endpoint
      && current.epoch === runtime.epoch
      && current.generation === runtime.generation
      && current.version === runtime.version) return;
    this.runtimeBinding.set(runtime);
    this.reconnectToRuntimeBaseUrl(true);
  }

  getBoundRuntime(): OpenCodeRuntime | null {
    return this.runtimeBinding.get();
  }

  subscribeRuntime(listener: () => void): () => void {
    this.runtimeListeners.add(listener);
    return () => { this.runtimeListeners.delete(listener); };
  }

  private notifyRuntime(): void {
    for (const listener of this.runtimeListeners) listener();
  }

  /** The owning server selects the kernel; the browser never guesses its protocol. */
  discoverRuntime(): Promise<OpenCodeRuntime> {
    if (this.discovery) return this.discovery;
    const revision = this.connectionRevision;
    const runtimeKey = getRuntimeKey();
    const timeout = createTimeoutSignal(OPENCODE_HEALTH_TIMEOUT_MS);
    const request = (async () => {
      try {
        const response = await runtimeFetch('/api/opencode/runtime', { signal: timeout.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`OpenCode runtime discovery failed (${response.status})`);
        const runtime = runtimeDescriptorSchema.parse(await response.json());
        if (revision !== this.connectionRevision || runtimeKey !== getRuntimeKey()) {
          throw new OpenCodeRuntimeChangedError();
        }
        if (runtime.endpoint && (runtime.generation === OPEN_CODE_GENERATION.OC1 || runtime.generation === OPEN_CODE_GENERATION.OC2)) {
          this.bindRuntime(runtime);
        } else {
          this.runtimeBinding.clear();
          this.syncSource = null;
          this.notifyRuntime();
        }
        return runtime;
      } catch (error) {
        if (revision === this.connectionRevision && runtimeKey === getRuntimeKey()) {
          this.runtimeBinding.clear();
          this.syncSource = null;
          this.notifyRuntime();
        }
        throw error;
      } finally {
        timeout.cleanup();
      }
    })();
    this.discovery = request;
    void request.finally(() => {
      if (this.discovery === request) this.discovery = null;
    }).catch(() => {});
    return request;
  }

  private isV2(): boolean {
    return this.runtimeBinding.get()?.generation === 'oc2';
  }

  private scope(directory?: string | null, signal?: AbortSignal) {
    return { directory: directory === null ? null : this.normalizeCandidatePath(directory) ?? this.currentDirectory, signal };
  }

  /** Stable for one selected connection; bootstrap must bind before requesting it. */
  getSyncSource(): SyncSource {
    if (this.syncSource) return this.syncSource;
    const runtime = this.runtimeBinding.get();
    const bootstrap = {
      listSyncSessions: (directory: string, input: { archived: boolean; roots?: boolean; pageSize: number; signal?: AbortSignal }) => this.listSyncSessions(directory, input),
      getBootstrapPath: (directory?: string | null, signal?: AbortSignal) => this.getBootstrapPath(directory, signal),
      getCurrentProject: (directory?: string | null, signal?: AbortSignal) => this.getCurrentProject(directory, signal),
      getVcs: (directory?: string | null, signal?: AbortSignal) => this.getVcs(directory, signal),
      getLspStatus: (directory?: string | null, signal?: AbortSignal) => this.getLspStatus(directory, signal),
      getTaggedConfig: (directory?: string | null, signal?: AbortSignal) => this.getTaggedConfig(directory, signal),
      getProviderCatalog: (directory?: string | null, signal?: AbortSignal) => this.getProviderCatalog(directory, signal),
      listTaggedAgents: (directory?: string | null) => this.listTaggedAgents(directory),
    };
    if (runtime?.generation === 'oc1') {
      this.syncSource = createV1SyncSource(this.client, this.runtimeBinding, bootstrap);
    } else if (runtime?.generation === 'oc2') {
      const client = this.v2Client;
      const baseUrl = this.baseUrl;
      this.syncSource = createV2SyncSource({
        sessions: this.v2Sessions,
        status: async (_directory, signal) => {
          const active = await client.session.active({ signal });
          return Object.fromEntries(Object.keys(active).map((id) => [id, { type: 'busy' as const }]));
        },
        permissions: async (directory, signal) => {
          const result = await client.permission.request.list({ location: directory ? { directory } : undefined }, { signal });
          return result.data.map((value) => ({ generation: 'oc2' as const, value }));
        },
        forms: async (directory, signal) => {
          const result = await client.form.list({ location: directory ? { directory } : undefined }, { signal });
          return result.data.map((value) => ({ generation: 'oc2' as const, kind: 'form' as const, value }));
        },
        events: (signal, lastEventID) => {
          const events = lastEventID ? createV2RuntimeClient({
            baseUrl, lastEventID,
            assertProtocol: () => this.runtimeBinding.assert('oc2', 'event stream'),
          }) : client;
          return events.event.subscribe({ signal });
        },
      }, this.runtimeBinding, bootstrap);
    } else {
      throw new OpenCodeRuntimeError(runtime?.generation ?? 'unknown', 'sync bootstrap');
    }
    return this.syncSource;
  }

  reconnectToRuntimeBaseUrl(preserveBinding = false): void {
    this.connectionRevision += 1;
    this.discovery = null;
    this.syncSource = null;
    if (!preserveBinding) this.runtimeBinding.clear();
    const runtimeBase = resolveRuntimeBaseUrl();
    const nextBaseUrl = ensureAbsoluteBaseUrl(runtimeBase || DEFAULT_BASE_URL);
    // An explicit reconnect can change the instance or transport behind the
    // same URL. Its SDK client and in-flight directory requests are obsolete.
    this.baseUrl = nextBaseUrl;
    this.client = createRuntimeOpencodeClient({ baseUrl: this.baseUrl, assertProtocol: () => this.runtimeBinding.assert('oc1', 'SDK request') });
    this.sessions = new V1SessionOperations(this.client);
    this.v2Client = createV2RuntimeClient({ baseUrl: this.baseUrl, assertProtocol: () => this.runtimeBinding.assert('oc2', 'SDK request') });
    this.scopedClients.clear();
    this.v2ScopedClients.clear();
    this.listDirectoryInFlight.clear();
    this.configProvidersInFlight.clear();
    this.listAgentsInFlight.clear();
    this.clearConfigCache();
    this.listDirectoryCache.clear();
    this.notifyRuntime();
  }

  /** Expose the raw SDK client for direct use (e.g., SyncProvider) */
  getSdkClient(): OpencodeClient {
    return this.client;
  }

  /** Internal OC2 protocol source; consumers must project before store ingress. */
  getV2Sessions(): V2SessionOperations {
    const runtime = this.runtimeBinding.get();
    if (runtime?.generation !== 'oc2') throw new OpenCodeRuntimeError(runtime?.generation ?? 'unknown', 'OC2 sessions');
    return this.v2Sessions;
  }

  private v2ClientFor(directory?: string | null): OpenCodeClient {
    const normalized = this.normalizeCandidatePath(directory);
    if (!normalized) return this.v2Client;
    const existing = this.v2ScopedClients.get(normalized);
    if (existing) return existing;
    const scoped = createV2RuntimeClient({
      baseUrl: this.baseUrl,
      directory: normalized,
      assertProtocol: () => this.runtimeBinding.assert('oc2', 'scoped SDK request'),
    });
    this.v2ScopedClients.set(normalized, scoped);
    return scoped;
  }

  /** Get a scoped SDK client for a specific directory */
  getScopedSdkClient(directory: string): OpencodeClient {
    return this.getScopedApiClient(directory);
  }

  /**
   * Returns an SDK client scoped to a project directory.
   * Needed for worktree APIs where backend ignores per-call directory.
   */
  getScopedApiClient(directory: string): OpencodeClient {
    const normalized = this.normalizeCandidatePath(directory) ?? directory;
    const key = normalized || '';
    const existing = this.scopedClients.get(key);
    if (existing) {
      return existing;
    }
    const scoped = createRuntimeOpencodeClient({
      baseUrl: this.baseUrl,
      directory: normalized,
      assertProtocol: () => this.runtimeBinding.assert('oc1', 'scoped SDK request'),
    });
    this.scopedClients.set(key, scoped);
    return scoped;
  }

  private normalizeCandidatePath(path?: string | null): string | null {
    return normalizePath(path);
  }

  private deriveHomeDirectory(path: string): { homeDirectory: string; username?: string } {
    const windowsMatch = path.match(/^([A-Za-z]:)(?:\/|$)/);
    if (windowsMatch) {
      const drive = windowsMatch[1];
      const remainder = path.slice(drive.length + (path.charAt(drive.length) === '/' ? 1 : 0));
      const segments = remainder.split('/').filter(Boolean);

      if (segments.length >= 2) {
        const homeDirectory = `${drive}/${segments[0]}/${segments[1]}`;
        return { homeDirectory, username: segments[1] };
      }

      if (segments.length === 1) {
        const homeDirectory = `${drive}/${segments[0]}`;
        return { homeDirectory, username: segments[0] };
      }

      return { homeDirectory: `${drive}/`, username: undefined };
    }

    const absolute = path.startsWith('/');
    const segments = path.split('/').filter(Boolean);

    if (segments.length >= 2 && (segments[0] === 'Users' || segments[0] === 'home')) {
      const homeDirectory = `${absolute ? '/' : ''}${segments[0]}/${segments[1]}`;
      return { homeDirectory, username: segments[1] };
    }

    if (absolute) {
      if (segments.length === 0) {
        return { homeDirectory: '/', username: undefined };
      }
      const homeDirectory = `/${segments.join('/')}`;
      return { homeDirectory, username: segments[segments.length - 1] };
    }

    if (segments.length > 0) {
      const homeDirectory = `/${segments.join('/')}`;
      return { homeDirectory, username: segments[segments.length - 1] };
    }

    return { homeDirectory: '/', username: undefined };
  }

  // Set the current working directory for all API calls
  setDirectory(directory: string | undefined) {
    const normalized = this.normalizeCandidatePath(directory) ?? directory;
    if (this.currentDirectory !== normalized) {
      markStartupTrace('opencodeClient:setDirectory', {
        previous: this.currentDirectory ?? null,
        next: normalized ?? null,
      });
    }
    this.currentDirectory = normalized;
  }

  getDirectory(): string | undefined {
    return this.currentDirectory;
  }

  async withDirectory<T>(directory: string | undefined | null, fn: () => Promise<T>): Promise<T> {
    const runWithContext = async (): Promise<T> => {
      if (directory === undefined || directory === null) {
        return fn();
      }

      const previousDirectory = this.currentDirectory;
      const scopedDirectory = this.normalizeCandidatePath(directory) ?? directory;
      this.currentDirectory = scopedDirectory;
      try {
        return await fn();
      } finally {
        if (this.currentDirectory === scopedDirectory) {
          this.currentDirectory = previousDirectory;
        }
      }
    };

    const queuedRun = this.directoryContextQueue.then(runWithContext, runWithContext);
    this.directoryContextQueue = queuedRun.then(
      () => undefined,
      () => undefined,
    );

    return queuedRun;
  }

  // Get the raw API client for direct access
  getApiClient(): OpencodeClient {
    return this.client;
  }

  // Get system information including home directory
  async getSystemInfo(): Promise<{ homeDirectory: string; username?: string }> {
    const candidates = new Set<string>();
    const addCandidate = (value?: string | null) => {
      const normalized = this.normalizeCandidatePath(value);
      if (normalized) {
        candidates.add(normalized);
      }
    };

    try {
      const response = await this.client.path.get(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined
      );
      const info = response.data;
      if (info) {
        addCandidate(info.directory);
        addCandidate(info.worktree);
        addCandidate(info.state);
      }
    } catch (error) {
      console.debug('Failed to load path info:', error);
    }

    if (!candidates.size) {
      try {
        const project = await this.client.project.current(
          this.currentDirectory ? { directory: this.currentDirectory } : undefined
        );
        addCandidate(project.data?.worktree);
      } catch (error) {
        console.debug('Failed to load project info:', error);
      }
    }

    if (!candidates.size) {
      try {
        const sessions = await this.listSessions();
        sessions.forEach((session) => addCandidate(session.directory));
      } catch (error) {
        console.debug('Failed to inspect sessions for system info:', error);
      }
    }

    addCandidate(this.currentDirectory);

    if (typeof window !== 'undefined') {
      try {
        addCandidate(window.localStorage.getItem('lastDirectory'));
        addCandidate(window.localStorage.getItem('homeDirectory'));
      } catch {
        // Access to storage failed (e.g. privacy mode)
      }
    }

    if (!candidates.size && typeof process !== 'undefined' && typeof process.cwd === 'function') {
      addCandidate(process.cwd());
    }

    if (!candidates.size) {
      return { homeDirectory: '/', username: undefined };
    }

    const [primary] = Array.from(candidates);
    return this.deriveHomeDirectory(primary);
  }

  /**
   * Best-effort probe whether a directory is accessible to OpenCode.
   * This is intentionally NOT the same as local filesystem access in the UI runtime.
   */
  async probeDirectory(directory: string): Promise<boolean> {
    return (await this.getDirectoryAvailability(directory)) === "available";
  }

  /**
    * Distinguishes a confirmed-missing directory from an unavailable probe.
    * Offline, permission, and other transport failures stay `unknown` so callers
    * do not treat a temporary outage as proof the path was deleted.
    *
    * The probe is OpenChamber's own `/api/fs/directory-stat`, which asks the
    * server to stat the path without listing its contents. OpenCode's `/path`
    * cannot answer this question: it echoes the requested directory and resolves
    * its project through Git discovery that swallows errors, so a deleted worktree
    * still comes back as a valid location. A runtime without that route (VS Code)
    * answers `unknown`.
    */
  async getDirectoryAvailability(directory: string): Promise<DirectoryAvailability> {
    const normalized = this.normalizeCandidatePath(directory);
    if (!normalized) {
      return "unknown";
    }
    try {
      const response = await runtimeFetch("/api/fs/directory-stat", { query: { path: normalized } });
      const body = directoryProbeErrorSchema.safeParse(await response.json().catch(() => null)).data;
      if (response.ok && body?.isDirectory === true) return "available";
      const reason = parseFilesystemErrorReason(body?.reason);
      return reason === "not-found" || reason === "not-directory" ? "missing" : "unknown";
    } catch {
      return "unknown";
    }
  }

  // Session Management
  async listSessions(): Promise<DomainSession[]> {
    if (this.isV2()) return this.listSyncSessions(this.currentDirectory, { archived: true, pageSize: 100 });
    return this.runtimeBinding.run('oc1', 'session.list', () => this.sessions.list({ directory: this.currentDirectory }));
  }

  async shareSession(id: string, directory?: string | null): Promise<DomainSession> {
    return this.runtimeBinding.run('oc1', 'session.share', async () => {
      const result = await this.client.session.share({ sessionID: id, directory: this.scope(directory).directory ?? undefined });
      return projectLegacySession(unwrapSdkData(result, 'session.share'));
    });
  }

  async unshareSession(id: string, directory?: string | null): Promise<DomainSession> {
    return this.runtimeBinding.run('oc1', 'session.unshare', async () => {
      const result = await this.client.session.unshare({ sessionID: id, directory: this.scope(directory).directory ?? undefined });
      const session = projectLegacySession(unwrapSdkData(result, 'session.unshare'));
      delete session.share;
      return session;
    });
  }

  async createSession(params?: { id?: string; parentID?: string; title?: string; metadata?: Metadata; agent?: string; model?: ModelRef }, directory?: string | null): Promise<DomainSession> {
    if (this.isV2()) return this.v2Sessions.create(params, this.scope(directory));
    if (params?.id !== undefined || params?.agent !== undefined || params?.model !== undefined) {
      throw new OpenCodeRuntimeError('oc1', 'OC2 session creation options');
    }
    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    return this.runtimeBinding.run('oc1', 'session.create', () => this.sessions.create(params, { directory: requestDirectory }));
  }

  async getSession(id: string, directory?: string | null): Promise<DomainSession> {
    if (this.isV2()) return this.v2Sessions.get(id, this.scope(directory));
    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    return this.runtimeBinding.run('oc1', 'session.get', () => this.sessions.get(id, { directory: requestDirectory }));
  }

  async deleteSession(id: string, directory?: string | null): Promise<boolean> {
    if (this.isV2()) return this.v2Sessions.remove(id, this.scope(directory));
    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    return this.runtimeBinding.run('oc1', 'session.delete', () => this.sessions.remove(id, { directory: requestDirectory }));
  }

  async updateSession(
    id: string,
    patch: { title?: string; metadata?: Metadata; time?: { archived?: number | null } },
    directory?: string | null,
  ): Promise<DomainSession> {
    if (this.isV2()) {
      const requestDirectory = this.scope(directory).directory;
      if (patch.metadata !== undefined) {
        const response = await runtimeFetch(`/api/openchamber/sessions/${encodeURIComponent(id)}/metadata`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: patch.metadata, directory: requestDirectory }),
        });
        if (!response.ok) throw new Error(`session metadata update failed (${response.status})`);
        z.object({ metadata: z.record(z.string(), z.json()) }).parse(await response.json());
      }
      if (patch.title !== undefined) {
        await this.v2Sessions.update(id, { title: patch.title }, this.scope(directory));
      }
      const archivedAt = patch.time?.archived;
      if (archivedAt !== undefined && archivedAt !== null) {
        const route = archivedAt > 0 ? '/api/openchamber/sessions/archive' : '/api/openchamber/sessions/unarchive';
        const payload: SessionArchivePayload = { ids: [id] };
        if (requestDirectory) payload.directory = requestDirectory;
        if (archivedAt > 0) payload.archivedAt = archivedAt;
        const response = await runtimeFetch(route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`session archive failed (${response.status})`);
      }
      return this.v2Sessions.get(id, this.scope(directory));
    }
    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    return this.runtimeBinding.run('oc1', 'session.update', () => this.sessions.update(id, patch, { directory: requestDirectory }));
  }

  async getSessionMessages(id: string, limit?: number, directory?: string | null): Promise<{ info: DomainMessage; parts: DomainPart[] }[]> {
    if (this.isV2()) return (await this.v2Sessions.messages(id, { limit }, this.scope(directory))).items;
    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    return this.runtimeBinding.run('oc1', 'session.messages', () => this.sessions.messages(id, limit, { directory: requestDirectory }));
  }

  /** One protocol-native page; cursor is an opaque string at this boundary. */
  async listSessionsPage(options: {
    global?: boolean; directory?: string | null; archived?: boolean; roots?: boolean;
    limit?: number; cursor?: string; order?: 'asc' | 'desc'; search?: string; parentID?: string | null; signal?: AbortSignal;
  } = {}): Promise<{ sessions: DomainSession[]; cursor: { next?: string } }> {
    const directory = options.global ? null : this.normalizeCandidatePath(options.directory) ?? this.currentDirectory;
    if (this.isV2()) {
      const page = await this.v2Sessions.listPage({
        limit: options.limit, cursor: options.cursor, order: options.order, search: options.search,
        parentID: options.roots === true ? null : options.parentID,
      }, { directory, signal: options.signal });
      return { sessions: page.sessions, cursor: { next: page.cursor.next } };
    }
    if (options.search !== undefined || options.order !== undefined || options.parentID !== undefined) {
      throw new OpenCodeRuntimeError('oc1', 'filtered session listing');
    }
    const numericCursor = options.cursor === undefined ? undefined : Number(options.cursor);
    if (options.cursor !== undefined && !Number.isFinite(numericCursor)) throw new Error('Invalid OC1 session cursor');
    const request: Parameters<OpencodeClient['experimental']['session']['list']>[0] = {
      archived: options.archived ?? false, limit: options.limit ?? 100,
    };
    if (directory) request.directory = directory;
    if (options.roots !== undefined) request.roots = options.roots;
    if (numericCursor !== undefined) request.cursor = numericCursor;
    const result = await this.runtimeBinding.run('oc1', 'experimental.session.list', () =>
      this.client.experimental.session.list(request, { signal: options.signal }));
    const rows = unwrapSdkData(result, 'experimental.session.list');
    if (!Array.isArray(rows)) throw new Error('experimental.session.list returned invalid data');
    const sessions = rows.map(projectLegacySession);
    const limit = options.limit ?? 100;
    if (rows.length < limit) return { sessions, cursor: {} };
    const header = result.response?.headers?.get('x-next-cursor');
    const parsed = header ? Number(header) : undefined;
    const next = parsed !== undefined && Number.isFinite(parsed) ? parsed : rows[rows.length - 1]?.time.updated;
    return { sessions, cursor: next !== undefined && (numericCursor === undefined || next < numericCursor) ? { next: String(next) } : {} };
  }

  /** Complete paged snapshot for sync; a failed page rejects the whole load. */
  async listSyncSessions(
    directory: string | null | undefined,
    options: { archived: boolean; roots?: boolean; pageSize: number; signal?: AbortSignal },
  ): Promise<DomainSession[]> {
    const all: DomainSession[] = [];
    const seen = new Set<string>();
    const target = this.normalizeCandidatePath(directory);
    if (this.isV2()) {
      let cursor: string | undefined;
      while (true) {
        const page = await this.v2Sessions.listPage({
          limit: options.pageSize,
          parentID: options.roots === true ? null : undefined,
          cursor,
        }, { directory: target, signal: options.signal });
        let added = 0;
        for (const session of page.sessions) {
          if (seen.has(session.id)) continue;
          seen.add(session.id);
          added += 1;
          if (options.archived || !session.time.archived) all.push(session);
        }
        const next = page.cursor.next;
        if (!next || next === cursor || added === 0) break;
        cursor = next;
      }
      return all;
    }
    let cursor: number | undefined;
    while (true) {
      const request: Parameters<OpencodeClient['experimental']['session']['list']>[0] = {
        archived: options.archived, limit: options.pageSize,
      };
      if (target) request.directory = target;
      if (options.roots !== undefined) request.roots = options.roots;
      if (cursor !== undefined) request.cursor = cursor;
      const result = await this.runtimeBinding.run('oc1', 'experimental.session.list', () =>
        this.client.experimental.session.list(request, { signal: options.signal }));
      const rows = unwrapSdkData(result, 'experimental.session.list');
      if (!Array.isArray(rows)) throw new Error('experimental.session.list returned invalid data');
      let added = 0;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        added += 1;
        const session = projectLegacySession(row);
        all.push(session);
      }
      if (rows.length < options.pageSize || added === 0) break;
      const header = result.response?.headers?.get('x-next-cursor');
      const parsed = header ? Number(header) : undefined;
      const next = parsed !== undefined && Number.isFinite(parsed) ? parsed : rows[rows.length - 1]?.time.updated;
      if (next === undefined || (cursor !== undefined && next >= cursor)) break;
      cursor = next;
    }
    return all;
  }

  async getSessionMessage(id: string, messageID: string, directory?: string | null) {
    if (this.isV2()) return this.v2Sessions.message(id, messageID, this.scope(directory));
    return this.runtimeBinding.run('oc1', 'session.message', async () => {
      const requestDirectory = this.scope(directory).directory;
      const client = requestDirectory ? this.getScopedApiClient(requestDirectory) : this.client;
      const result = unwrapSdkData(await client.session.message({ sessionID: id, messageID }), 'session.message');
      return { info: projectLegacyMessage(result.info), parts: result.parts.map(projectLegacyPart) };
    });
  }

  async renameSession(id: string, title: string, directory?: string | null): Promise<void> {
    if (this.isV2()) {
      await this.v2Sessions.update(id, { title }, this.scope(directory));
      return;
    }
    await this.updateSession(id, { title }, directory);
  }

  async moveSession(id: string, toDirectory: string, options?: { delivery?: 'steer' | 'queue' }): Promise<void> {
    if (!this.isV2()) throw new OpenCodeRuntimeError(this.runtimeBinding.get()?.generation ?? 'unknown', 'session.move');
    await this.runtimeBinding.run('oc2', 'session.move', () => this.v2Client.session.move({
      sessionID: id, directory: toDirectory, delivery: options?.delivery,
    }));
  }

  async switchSessionModel(id: string, model: ModelRef, directory?: string | null): Promise<void> {
    if (!this.isV2()) throw new OpenCodeRuntimeError(this.runtimeBinding.get()?.generation ?? 'unknown', 'session.switchModel');
    await this.runtimeBinding.run('oc2', 'session.switchModel', () => this.v2ClientFor(directory).session.switchModel({ sessionID: id, model }));
  }

  async switchSessionAgent(id: string, agent: string, directory?: string | null): Promise<void> {
    if (!this.isV2()) throw new OpenCodeRuntimeError(this.runtimeBinding.get()?.generation ?? 'unknown', 'session.switchAgent');
    await this.runtimeBinding.run('oc2', 'session.switchAgent', () => this.v2ClientFor(directory).session.switchAgent({ sessionID: id, agent }));
  }

  async getSessionInbox(id: string, directory?: string | null) {
    return this.runtimeBinding.run('oc2', 'session.inbox.list', () =>
      this.v2ClientFor(directory).session.inbox.list({ sessionID: id }));
  }

  async cancelSessionInbox(id: string, inboxID: string, directory?: string | null): Promise<void> {
    await this.runtimeBinding.run('oc2', 'session.inbox.cancel', () =>
      this.v2ClientFor(directory).session.inbox.cancel({ sessionID: id, inboxID }));
  }

  async generateSessionText(id: string, prompt: string, directory?: string | null): Promise<string> {
    return (await this.runtimeBinding.run('oc2', 'session.generate', () =>
      this.v2ClientFor(directory).session.generate({ sessionID: id, prompt }))).text;
  }

  async getSessionTurnDiff(id: string, options?: { from?: string; to?: string; context?: number; directory?: string | null }) {
    return this.runtimeBinding.run('oc2', 'session.diff', () =>
      this.v2ClientFor(options?.directory).session.diff({ sessionID: id, from: options?.from, to: options?.to, context: options?.context }));
  }

  async generateText(prompt: string, options?: { model?: ModelRef; directory?: string | null }): Promise<string> {
    return (await this.runtimeBinding.run('oc2', 'generate.text', () =>
      this.v2ClientFor(options?.directory).generate.text({ prompt, model: options?.model }))).text;
  }

  async getBootstrapPath(directory?: string | null, signal?: AbortSignal): Promise<BootstrapPath> {
    if (this.isV2()) {
      const location = await this.v2Catalog.location(this.scope(directory, signal));
      return { directory: location.directory, projectID: location.project.id, worktree: location.project.canonical };
    }
    return this.runtimeBinding.run('oc1', 'path.get', async () => {
      const result = await this.getScopedApiClient(this.scope(directory).directory ?? '').path.get(undefined, { signal });
      return unwrapSdkData(result, 'path.get');
    });
  }

  async getLocation(directory?: string | null, signal?: AbortSignal) {
    if (this.isV2()) return this.v2Catalog.location(this.scope(directory, signal));
    throw new OpenCodeRuntimeError('oc1', 'location.get');
  }

  async listProjects(): Promise<DomainProject[]> {
    if (this.isV2()) return this.v2Catalog.projects();
    return this.runtimeBinding.run('oc1', 'project.list', async () => unwrapSdkData(await this.client.project.list(), 'project.list'));
  }

  async getCurrentProject(directory?: string | null, signal?: AbortSignal): Promise<DomainProject> {
    if (this.isV2()) {
      const location = await this.v2Catalog.location(this.scope(directory, signal));
      const projects = await this.v2Catalog.projects(this.scope(directory, signal));
      const project = projects.find((item) => item.id === location.project.id);
      if (!project) throw new Error(`Current project ${location.project.id} was not found in project.list`);
      return project;
    }
    return this.runtimeBinding.run('oc1', 'project.current', async () =>
      unwrapSdkData(await this.getScopedApiClient(this.scope(directory).directory ?? '').project.current(undefined, { signal }), 'project.current'));
  }

  async getVcs(directory?: string | null, signal?: AbortSignal): Promise<DomainVcs> {
    if (this.isV2()) return this.v2Catalog.vcs(this.scope(directory, signal));
    return this.runtimeBinding.run('oc1', 'vcs.get', async () => {
      const value = unwrapSdkData(await this.getScopedApiClient(this.scope(directory).directory ?? '').vcs.get(undefined, { signal }), 'vcs.get');
      return { branch: value.branch, defaultBranch: value.default_branch };
    });
  }

  async getLspStatus(directory?: string | null, signal?: AbortSignal) {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'LSP status');
    return this.runtimeBinding.run('oc1', 'lsp.status', async () =>
      unwrapSdkData(await this.getScopedApiClient(this.scope(directory).directory ?? '').lsp.status(undefined, { signal }), 'lsp.status'));
  }

  async getTaggedConfig(directory?: string | null, signal?: AbortSignal): Promise<TaggedConfig> {
    if (this.isV2()) return { generation: 'oc2', value: await this.v2Catalog.config(this.scope(directory, signal)) };
    if (directory === null) {
      const value = await this.runtimeBinding.run('oc1', 'global.config.get', async () =>
        unwrapSdkData(await this.client.config.get(undefined, { signal }), 'global.config.get'));
      return { generation: 'oc1', value };
    }
    return { generation: 'oc1', value: await this.getConfig(directory) };
  }

  async getConfigSources(directory?: string | null, signal?: AbortSignal) {
    return this.runtimeBinding.run('oc2', 'config.get sources', () =>
      this.v2ClientFor(directory).config.get(undefined, { signal }));
  }

  async getProviderCatalog(directory?: string | null, signal?: AbortSignal): Promise<ProviderCatalog> {
    if (this.isV2()) return this.v2Catalog.catalog(this.scope(directory, signal));
    const value = await this.getProvidersForConfig(directory);
    return { generation: 'oc1', ...value };
  }

  async getSessionTodos(sessionId: string): Promise<Array<{ id: string; content: string; status: string; priority: string }>> {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'session.todo');
    try {
      const response = await this.client.session.todo({
        sessionID: sessionId,
        ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      });
      if (response.error) {
        return [];
      }

      const data = response.data;
      if (!data || !Array.isArray(data)) {
        return [];
      }

      return data as Array<{ id: string; content: string; status: string; priority: string }>;
    } catch {
      return [];
    }
  }

  /**
   * Check if MIME type needs normalization to text/plain.
   * Some text MIME types (like text/markdown) aren't supported by AI providers.
   */
  private shouldNormalizeToTextPlain(mime: string): boolean {
    if (!mime) return false;
    
    const lowerMime = mime.toLowerCase();
    
    // All text/* types except text/plain need normalization
    if (lowerMime.startsWith('text/') && lowerMime !== 'text/plain') {
      return true;
    }
    
    // Common application types that are actually text
    const textBasedTypes = [
      'application/json',
      'application/xml',
      'application/javascript',
      'application/typescript',
      'application/x-yaml',
      'application/yaml',
      'application/toml',
      'application/x-sh',
      'application/x-shellscript',
      'application/octet-stream',
      'image/svg+xml',
    ];
    
    return textBasedTypes.includes(lowerMime);
  }

  /**
   * Check if MIME type is HEIC/HEIF (iPhone photo format).
   */
  private isHeicMime(mime: string): boolean {
    if (!mime) return false;
    const lowerMime = mime.toLowerCase();
    return lowerMime === 'image/heic' || lowerMime === 'image/heif';
  }

  /**
   * Convert HEIC image to JPEG.
   * Returns the original file if conversion fails.
   */
  private async convertHeicToJpeg(file: { mime: string; filename?: string; url: string }): Promise<{ mime: string; filename?: string; url: string }> {
    try {
      // Dynamic import to avoid loading heic2any unless needed
      const heic2any = (await import('heic2any')).default;
      
      // Extract base64 data from data URL
      const commaIndex = file.url.indexOf(',');
      if (commaIndex === -1) return file;
      
      const base64Data = file.url.substring(commaIndex + 1);
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const heicBlob = new Blob([bytes], { type: file.mime });
      
      // Convert to JPEG
      const jpegBlob = await heic2any({
        blob: heicBlob,
        toType: 'image/jpeg',
        quality: 0.9,
      }) as Blob;
      
      // Convert back to data URL
      const jpegDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(jpegBlob);
      });
      
      // Update filename extension
      let newFilename = file.filename;
      if (newFilename) {
        newFilename = newFilename.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
      }
      
      return {
        mime: 'image/jpeg',
        filename: newFilename,
        url: jpegDataUrl
      };
    } catch (error) {
      console.warn('Failed to convert HEIC to JPEG:', error);
      return file;
    }
  }

  /**
   * Normalize file part for sending to AI providers.
   * - Converts unsupported text MIME types to text/plain
   * - Converts HEIC/HEIF images to JPEG
   */
  private async normalizeFilePart(file: { mime: string; filename?: string; url: string }): Promise<{ mime: string; filename?: string; url: string }> {
    // Handle HEIC conversion
    if (this.isHeicMime(file.mime)) {
      return this.convertHeicToJpeg(file);
    }

    // Handle text MIME normalization
    if (!this.shouldNormalizeToTextPlain(file.mime)) {
      return file;
    }

    let normalizedUrl = file.url;
    
    // Update MIME type in data URL if present
    // Format: data:<mime>;base64,<content> or data:<mime>,<content>
    if (file.url.startsWith('data:')) {
      const commaIndex = file.url.indexOf(',');
      if (commaIndex !== -1) {
        const meta = file.url.substring(5, commaIndex); // after "data:"
        const content = file.url.substring(commaIndex); // includes comma
        
        // Replace the MIME type in meta, preserving ;base64 if present
        const newMeta = meta.replace(/^[^;,]+/, 'text/plain');
        normalizedUrl = `data:${newMeta}${content}`;
      }
    }

    return {
      mime: 'text/plain',
      filename: file.filename,
      url: normalizedUrl
    };
  }

  private async toNormalizedFilePartInput(file: FileInputLite): Promise<FilePartInput> {
    const normalized = await this.normalizeFilePart(file);
    return {
      ...(file.id ? { id: file.id } : {}),
      type: 'file',
      mime: normalized.mime,
      filename: normalized.filename,
      url: normalized.url,
    };
  }

  private async v2Files(files?: Array<FileInputLite>) {
    return Promise.all((files ?? []).map(async (file) => {
      const normalized = await this.normalizeFilePart(file);
      return { uri: normalized.url, name: normalized.filename };
    }));
  }

  private async v2Selection(sessionID: string, providerID: string, modelID: string, variant?: string, agent?: string, directory?: string | null) {
    const client = this.v2ClientFor(directory);
    await this.runtimeBinding.run('oc2', 'session.switchModel', () => client.session.switchModel({
      sessionID, model: { providerID, id: modelID, variant },
    }));
    if (agent) await this.runtimeBinding.run('oc2', 'session.switchAgent', () => client.session.switchAgent({ sessionID, agent }));
  }

  private async v2Synthetic(sessionID: string, text: string, directory?: string | null, metadata?: ContextPartMetadata, delivery?: 'steer') {
    if (!text.trim()) return;
    await this.runtimeBinding.run('oc2', 'session.synthetic', () => this.v2ClientFor(directory).session.synthetic({
      sessionID, text, metadata: metadata ? z.record(z.string(), z.json()).parse(metadata) : undefined,
      delivery, resume: false,
    }));
  }

  async sendMessage(params: {
    runtimeKey?: string;
    id: string;
    providerID: string;
    modelID: string;
    text: string;
    prefaceText?: string;
    prefaceTextSynthetic?: boolean;
    agent?: string;
    variant?: string;
    files?: Array<FileInputLite>;
    /** Additional text/file parts to include (for batch sending queued messages) */
    additionalParts?: Array<{
      text: string;
      synthetic?: boolean;
      metadata?: ContextPartMetadata;
      files?: Array<FileInputLite>;
    }>;
    messageId?: string;
    agentMentions?: Array<{ name: string; source?: { value: string; start: number; end: number } }>;
    delivery?: 'steer';
    format?: {
      type: 'json_schema';
      schema: Record<string, unknown>;
      retryCount?: number;
    };
    directory?: string | null;
  }): Promise<string> {
    this.assertRuntimeUnchanged(params.runtimeKey);

    if (this.isV2()) {
      if (params.format) throw new OpenCodeRuntimeError('oc2', 'prompt JSON schema');
      const directory = this.normalizeCandidatePath(params.directory ?? null) ?? this.currentDirectory;
      const messageId = params.messageId ?? ascendingId('msg');
      const files = [
        ...await this.v2Files(params.files),
        ...((await Promise.all((params.additionalParts ?? []).map((item) => this.v2Files(item.files)))).flat()),
      ];
      const textParts = [params.prefaceTextSynthetic === false ? params.prefaceText : undefined, params.text,
        ...(params.additionalParts ?? []).filter((item) => !item.synthetic).map((item) => item.text)].filter((text): text is string => !!text?.trim());
      const text = textParts.join('\n\n');
      if (!text && files.length === 0 && !params.prefaceText?.trim() && !(params.additionalParts ?? []).some((item) => item.text.trim())) {
        throw new Error('Message must have at least one part (text or file)');
      }
      assertProviderCircuitClosed(params.providerID);
      try {
        this.assertRuntimeUnchanged(params.runtimeKey);
        await this.v2Selection(params.id, params.providerID, params.modelID, params.variant, params.agent, directory);
        if (params.prefaceTextSynthetic !== false) await this.v2Synthetic(params.id, params.prefaceText ?? '', directory, undefined, params.delivery);
        for (const item of params.additionalParts ?? []) {
          if (item.synthetic) await this.v2Synthetic(params.id, item.text, directory, item.metadata, params.delivery);
        }
        this.assertRuntimeUnchanged(params.runtimeKey);
        await this.v2Sessions.prompt({
          sessionID: params.id, id: messageId, text, files: files.length ? files : undefined,
          agents: params.agentMentions?.filter((item) => !!item.name).map((item) => ({
            name: item.name,
            mention: item.source ? { start: item.source.start, end: item.source.end, text: item.source.value } : undefined,
          })),
          delivery: params.delivery,
        }, this.scope(directory));
        recordProviderSuccess(params.providerID);
        return messageId;
      } catch (error) {
        recordProviderError(params.providerID);
        throw error;
      }
    }

    // Use the optimistic/client-generated ID as the real user message ID so SSE
    // can reconcile the echoed server message in-place.
    const messageId = params.messageId ?? ascendingId("msg");

    // Build parts array using SDK types (TextPartInput | FilePartInput) plus lightweight agent parts
    const parts: Array<TextPartInput | FilePartInput | AgentPartInputLite> = [];

    if (params.prefaceText && params.prefaceText.trim()) {
      parts.push({
        type: 'text',
        text: params.prefaceText,
        synthetic: params.prefaceTextSynthetic !== false,
      });
    }

    // Add text part if there's content
    if (params.text && params.text.trim()) {
      const textPart: TextPartInput = {
        type: 'text',
        text: params.text
      };
      parts.push(textPart);
    }

    // Add file parts if provided (normalizing MIME types for compatibility)
    if (params.files && params.files.length > 0) {
      for (const file of params.files) {
        const filePart = await this.toNormalizedFilePartInput(file);
        parts.push(filePart);
      }
    }

    // Add additional parts (for batch/queued messages)
    if (params.additionalParts && params.additionalParts.length > 0) {
      for (const additional of params.additionalParts) {
        if (additional.text && additional.text.trim()) {
          const additionalTextPart: TextPartInput = { type: 'text', text: additional.text };
          if (additional.synthetic) additionalTextPart.synthetic = true;
          if (additional.metadata) additionalTextPart.metadata = additional.metadata;
          parts.push(additionalTextPart);
        }
        if (additional.files && additional.files.length > 0) {
          for (const file of additional.files) {
            const filePart = await this.toNormalizedFilePartInput(file);
            parts.push(filePart);
          }
        }
      }
    }

    if (params.agentMentions && params.agentMentions.length > 0) {
      for (const mention of params.agentMentions) {
        if (!mention?.name) continue;
        parts.push({
          type: 'agent',
          name: mention.name,
          ...(mention.source ? { source: mention.source } : {}),
        });
      }
    }

    // Ensure we have at least one part
    if (parts.length === 0) {
      throw new Error('Message must have at least one part (text or file)');
    }

    const requestDirectory = this.normalizeCandidatePath(params.directory ?? null) ?? this.currentDirectory;

    if (params.format) {
      console.info('[git-generation][browser] send structured message', {
        sessionId: params.id,
        providerID: params.providerID,
        modelID: params.modelID,
        agent: params.agent,
        variant: params.variant,
        directory: requestDirectory,
        baseUrl: this.baseUrl,
        formatType: params.format.type,
      });
    }

    assertProviderCircuitClosed(params.providerID);
    this.assertRuntimeUnchanged(params.runtimeKey);

    let response: Response;

    try {
      const result = await this.client.session.promptAsync({
        sessionID: params.id,
        ...(requestDirectory ? { directory: requestDirectory } : {}),
        model: {
          providerID: params.providerID,
          modelID: params.modelID,
        },
        agent: params.agent,
        variant: params.variant,
        messageID: messageId,
        ...(params.delivery ? { delivery: params.delivery } : {}),
        ...(params.format ? { format: params.format } : {}),
        parts,
      });
      if (result.response instanceof Response) {
        response = result.response;
      } else if (result.error) {
        const status = (result as SdkResult<unknown>).response?.status;
        if (!status) {
          // The SDK caught a thrown fetch error (network/tunnel transport
          // failure) — there is no HTTP response to report. Never fabricate a
          // status: surface it as a transport error so callers treat it like
          // any other network failure instead of a server 500.
          // Preserve the transport's "dispatched, outcome unknown" tag through
          // the wrap: without it the caller cannot tell a lost response from a
          // send that never reached the server, and re-sends a running prompt.
          const transportError = new Error(`Message send transport failure: ${formatSdkError(result.error)}`);
          throw isAmbiguousTransportFailure(result.error)
            ? markAmbiguousTransportFailure(transportError)
            : transportError;
        }
        response = new Response(JSON.stringify(result.error), { status });
      } else {
        response = new Response(JSON.stringify(result.data ?? true), { status: 200 });
      }
    } catch (error) {
      // Do not retry prompt_async after a transport failure: through a remote
      // tunnel the POST may already be running server-side even though the
      // client lost the response.
      recordProviderError(params.providerID);
      throw error;
    }

    if (response.ok) {
      recordProviderSuccess(params.providerID);
      return messageId;
    }

    let detail = '';
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    const suffix = detail && detail.trim().length > 0 ? `: ${detail.trim()}` : '';
    const error = new Error(`Failed to send message (${response.status})${suffix}`) as Error & { status?: number };
    error.status = response.status;
    recordProviderError(params.providerID, response.status);
    throw error;
  }

  async sendCommand(params: {
    runtimeKey?: string;
    id: string;
    providerID: string;
    modelID: string;
    command: string;
    arguments?: string;
    agent?: string;
    variant?: string;
    files?: Array<FileInputLite>;
    messageId?: string;
    directory?: string | null;
  }): Promise<string | undefined> {
    this.assertRuntimeUnchanged(params.runtimeKey);

    if (this.isV2()) {
      const directory = this.normalizeCandidatePath(params.directory ?? null) ?? this.currentDirectory;
      const files = await this.v2Files(params.files);
      await this.v2Selection(params.id, params.providerID, params.modelID, params.variant, params.agent, directory);
      this.assertRuntimeUnchanged(params.runtimeKey);
      await this.v2Sessions.command({ sessionID: params.id, name: params.command, text: params.arguments ?? '', files: files.length ? files : undefined }, this.scope(directory));
      return undefined;
    }

    const tempMessageId = params.messageId ?? ascendingId("msg");

    const parts: FilePartInput[] = [];
    if (params.files && params.files.length > 0) {
      for (const file of params.files) {
        parts.push(await this.toNormalizedFilePartInput(file));
      }
    }

    const requestDirectory = this.normalizeCandidatePath(params.directory ?? null) ?? this.currentDirectory;
    this.assertRuntimeUnchanged(params.runtimeKey);

    const response = await this.client.session.command({
      sessionID: params.id,
      ...(requestDirectory ? { directory: requestDirectory } : {}),
      command: params.command,
      arguments: params.arguments ?? '',
      model: `${params.providerID}/${params.modelID}`,
      agent: params.agent,
      variant: params.variant,
      ...(parts.length > 0 ? { parts } : {}),
      messageID: tempMessageId,
    });

    unwrapSdkOptional(response, 'session.command');
    return tempMessageId;
  }

  async abortSession(id: string, directory?: string | null): Promise<boolean> {
    if (this.isV2()) return (await this.v2Sessions.interrupt(id, this.scope(directory))).interrupted;
    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    const response = await this.client.session.abort(
      {
        sessionID: id,
        ...(requestDirectory ? { directory: requestDirectory } : {})
      },
      { throwOnError: true }
    );
    return Boolean(response.data);
  }

  async shellSession(params: {
    runtimeKey?: string;
    sessionId: string;
    command: string;
    agent: string;
    model: { providerID: string; modelID: string };
    messageId?: string;
    directory?: string | null;
  }): Promise<{ info: DomainMessage; parts: DomainPart[] } | undefined> {
    this.assertRuntimeUnchanged(params.runtimeKey);
    if (this.isV2()) {
      const directory = this.normalizeCandidatePath(params.directory ?? null) ?? this.currentDirectory;
      await this.v2Selection(params.sessionId, params.model.providerID, params.model.modelID, undefined, params.agent, directory);
      this.assertRuntimeUnchanged(params.runtimeKey);
      await this.runtimeBinding.run('oc2', 'session.shell', () => this.v2ClientFor(directory).session.shell({
        sessionID: params.sessionId, id: params.messageId, command: params.command,
      }));
      return undefined;
    }
    const requestDirectory = this.normalizeCandidatePath(params.directory ?? null) ?? this.currentDirectory;
    const response = await this.client.session.shell({
      sessionID: params.sessionId,
      ...(requestDirectory ? { directory: requestDirectory } : {}),
      messageID: params.messageId,
      agent: params.agent,
      model: params.model,
      command: params.command,
    });
    const result = unwrapSdkData(response, 'session.shell');
    return { info: projectLegacyMessage(result.info), parts: result.parts.map(projectLegacyPart) };
  }

  async revertSession(sessionId: string, messageId: string, partId?: string, directory?: string | null): Promise<DomainSession> {
    if (this.isV2()) {
      if (partId) throw new OpenCodeRuntimeError('oc2', 'part-level revert');
      await this.v2Sessions.stageRevert({ sessionID: sessionId, messageID: messageId }, this.scope(directory));
      await this.v2Sessions.commitRevert(sessionId, this.scope(directory));
      return this.v2Sessions.get(sessionId, this.scope(directory));
    }
    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    const response = await this.client.session.revert({
      sessionID: sessionId,
      ...(requestDirectory ? { directory: requestDirectory } : {}),
      messageID: messageId,
      partID: partId,
    });
    return projectLegacySession(unwrapSdkData(response, 'session.revert'));
  }

  async summarizeSession(sessionId: string, providerId: string, modelId: string, directory?: string | null): Promise<boolean> {
    if (this.isV2()) {
      await this.v2Selection(sessionId, providerId, modelId, undefined, undefined, directory);
      await this.v2Sessions.compact({ sessionID: sessionId }, this.scope(directory));
      return true;
    }
    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    const response = await this.client.session.summarize({
      sessionID: sessionId,
      ...(requestDirectory ? { directory: requestDirectory } : {}),
      providerID: providerId,
      modelID: modelId,
    });
    return unwrapSdkOptional(response, 'session.summarize') === true;
  }

  async unrevertSession(sessionId: string, directory?: string | null): Promise<DomainSession> {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'legacy unrevert after commit');
    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    const response = await this.client.session.unrevert({
      sessionID: sessionId,
      ...(requestDirectory ? { directory: requestDirectory } : {})
    });
    return projectLegacySession(unwrapSdkData(response, 'session.unrevert'));
  }

  async forkSession(sessionId: string, messageId?: string, directory?: string | null): Promise<DomainSession> {
    if (this.isV2()) return this.v2Sessions.fork(sessionId, messageId, this.scope(directory));
    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    const response = await this.client.session.fork({
      sessionID: sessionId,
      ...(requestDirectory ? { directory: requestDirectory } : {}),
      messageID: messageId,
    });
    return projectLegacySession(unwrapSdkData(response, 'session.fork'));
  }

  stageRevert(sessionId: string, messageId: string, options?: { files?: boolean; directory?: string | null }): Promise<V2SessionRevert> {
    if (!this.isV2()) throw new OpenCodeRuntimeError(this.runtimeBinding.get()?.generation ?? 'unknown', 'staged revert');
    return this.v2Sessions.stageRevert({ sessionID: sessionId, messageID: messageId, files: options?.files }, this.scope(options?.directory));
  }

  commitRevert(sessionId: string, directory?: string | null): Promise<void> {
    if (!this.isV2()) throw new OpenCodeRuntimeError(this.runtimeBinding.get()?.generation ?? 'unknown', 'revert commit');
    return this.v2Sessions.commitRevert(sessionId, this.scope(directory));
  }

  clearRevert(sessionId: string, directory?: string | null): Promise<void> {
    if (!this.isV2()) throw new OpenCodeRuntimeError(this.runtimeBinding.get()?.generation ?? 'unknown', 'revert clear');
    return this.v2Sessions.clearRevert(sessionId, this.scope(directory));
  }

  async getSessionStatus(): Promise<
    Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }>
  > {
    return (await this.getSessionStatusForDirectory(this.currentDirectory ?? null)) ?? {};
  }

  /**
   * Returns the upstream `/session/status` map, or `null` if the fetch failed.
   *
   * `null` vs `{}` matters for reconnect resync: the server omits idle sessions
   * from the response, so an empty `{}` means "everything is idle" and a candidate
   * missing from the response is authoritatively idle. A network/HTTP failure must
   * not be conflated with that — return `null` so the caller can preserve state.
   */
  async getSessionStatusForDirectory(
    directory: string | null | undefined
  ): Promise<Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }> | null> {
    if (this.isV2()) {
      try {
        const active = await this.runtimeBinding.run('oc2', 'session.active', () => this.v2Client.session.active());
        return Object.fromEntries(Object.keys(active).map((id) => [id, { type: 'busy' as const }]));
      } catch {
        return null;
      }
    }
    try {
      const trimmedDirectory = this.normalizeCandidatePath(directory);
      const result = await this.client.session.status(trimmedDirectory ? { directory: trimmedDirectory } : undefined);
      if (result.error) {
        return null;
      }
      const parsed = sessionStatusSnapshotSchema.safeParse(result.data);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async getGlobalSessionStatus(): Promise<
    Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }>
  > {
    return (await this.getSessionStatusForDirectory(null)) ?? {};
  }

  /**
   * Cross-project busy/retry/idle map kept by the OpenChamber host from the
   * single upstream event stream. One request that creates no OpenCode
   * instance, unlike `/session/status?directory=`. `null` means the fetch
   * failed; callers must preserve their current state.
   */
  async getHostSessionStatusSnapshot(): Promise<HostSessionStatusSnapshot | null> {
    try {
      const response = await runtimeFetch('/api/sessions/status', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return null;
      }
      const parsed = hostSessionStatusSnapshotSchema.safeParse(await response.json().catch(() => null));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Get session activity from web server's in-memory tracking.
   * This is more reliable than getGlobalSessionStatus on visibility restore
   * because the web server tracks activity even when UI is not listening to SSE.
   */
  async getWebServerSessionActivity(): Promise<
    Record<string, { type: string }> | null
  > {
    try {
      const response = await runtimeFetch('/api/session-activity', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') {
        return null;
      }

      return data as Record<string, { type: string }>;
    } catch {
      return null;
    }
  }

  // Tools
  async listToolIds(options?: { directory?: string | null }): Promise<string[]> {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'tool.ids');
    try {
      const directory = typeof options?.directory === 'string'
        ? options.directory.trim()
        : (this.currentDirectory ? this.currentDirectory.trim() : '');

      const result = await this.client.tool.ids(directory ? { directory } : undefined);
      const tools = (result.data || []) as unknown as string[];
      return tools.filter((tool) => typeof tool === 'string' && tool !== 'invalid');
    } catch {
      return [];
    }
  }

  // Permissions
  async replyToPermission(
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    options?: { message?: string; directory?: string | null; sessionID?: string }
  ): Promise<boolean> {
    if (this.isV2()) {
      let sessionID = options?.sessionID;
      if (!sessionID) {
        const pending = await this.listTaggedPermissions({ directories: [options?.directory] });
        const request = pending.find((item) => item.generation === 'oc2' && item.value.id === requestId);
        if (request?.generation === 'oc2') sessionID = request.value.sessionID;
      }
      if (!sessionID) throw new Error(`Permission ${requestId} is no longer pending`);
      await this.runtimeBinding.run('oc2', 'permission.reply', () => this.v2ClientFor(options?.directory).permission.reply({
        sessionID, requestID: requestId, decision: reply, message: options?.message,
      }));
      return true;
    }
    const requestDirectory = this.normalizeCandidatePath(options?.directory ?? null) ?? this.currentDirectory;
    const response = await this.runtimeBinding.run('oc1', 'permission.reply', () => this.client.permission.reply({
      requestID: requestId,
      ...(requestDirectory ? { directory: requestDirectory } : {}),
      reply,
      ...(options?.message ? { message: options.message } : {}),
    }));
    return unwrapSdkOptional(response, 'permission.reply') === true;
  }

  /**
   * Programmatically evaluate and (when approval is required) create a
   * permission request for a session via the V2 endpoint introduced in
   * OpenCode SDK v1.17.12. Wraps `session.permission.create`.
   *
   * Returns `{ id, effect }` on success, or `null` on any failure
   * (network error, 4xx/5xx response, malformed payload, or pre-v1.17.12
   * server without the V2 endpoint). Callers driving authoritative state
   * must treat `null` as "unknown — do not act" rather than "permission
   * allowed."
   *
   * Thin wrapper for future programmatic permission creation. The V1
   * `permission.list` / `permission.reply` flow used by the auto-accept
   * path is unchanged.
   */
  async createPermission(
    sessionID: string,
    action: string,
    resources: string[],
    options?: {
      id?: string;
      save?: string[];
      metadata?: ContextPartMetadata;
      source?: PermissionV2Source;
      agent?: string;
    }
  ): Promise<{ id: string; effect: PermissionV2Effect } | null> {
    if (this.isV2()) {
      try {
        return await this.runtimeBinding.run('oc2', 'permission.create', () => this.v2Client.permission.create({
          sessionID, action, resources, id: options?.id, save: options?.save,
          metadata: options?.metadata ? z.record(z.string(), z.json()).parse(options.metadata) : undefined,
          source: options?.source?.type === 'tool' ? { type: 'tool', messageID: options.source.messageID, id: options.source.callID } : undefined,
          agent: options?.agent,
        }));
      } catch {
        return null;
      }
    }
    try {
      const response = await this.client.v2.session.permission.create({
        sessionID,
        action,
        resources,
        ...(options?.id ? { id: options.id } : {}),
        ...(options?.save ? { save: options.save } : {}),
        ...(options?.metadata ? { metadata: options.metadata } : {}),
        ...(options?.source ? { source: options.source } : {}),
        ...(options?.agent ? { agent: options.agent } : {}),
      });
      // Discriminated union narrowing on `error` (see fetchPermission).
      if (response.error !== undefined) return null;
      const payload = response.data?.data;
      if (payload === undefined) return null;
      return { id: payload.id, effect: payload.effect };
    } catch {
      return null;
    }
  }

  /**
   * Fetch a pending permission request owned by a session via the V2
   * endpoint introduced in OpenCode SDK v1.17.12. Wraps
   * `session.permission.get`.
   *
   * Returns the state of the V2 permission authority. Its HTTP 404 result
   * does not prove that a request from `permission.list` has settled:
   * list-derived reconciliation must use that list's own reply path.
   * Fetch failures remain distinct from the V2 resolved result.
   */
  async fetchPermission(
    sessionID: string,
    requestID: string,
    directory?: string,
  ): Promise<FetchPermissionResult> {
    if (this.isV2()) {
      try {
        const permission = await this.runtimeBinding.run('oc2', 'permission.get', () =>
          this.v2ClientFor(directory).permission.get({ sessionID, requestID }));
        return { state: 'ok', permission };
      } catch (error) {
        if (isPermissionNotFoundError(error)) return { state: 'resolved' };
        if (error instanceof Error && 'status' in error && error.status === 404) return { state: 'resolved' };
        return { state: 'unknown' };
      }
    }
    try {
      // The V2 endpoint does not accept a directory parameter. Callers that
      // reconcile a known project must therefore select its scoped SDK client.
      const client = directory ? this.getScopedSdkClient(directory) : this.client;
      const response = await client.v2.session.permission.get({
        sessionID,
        requestID,
      });
      // The SDK returns a discriminated union on `error`/`data` (HeyApi
      // `RequestResult` with `ThrowOnError = false`). The error branch
      // collapses `data` to `undefined`; the data branch returns the
      // 200-response payload as `{ data: PermissionV2Request }`. Narrow
      // via `error` first, then unwrap the inner `data` field.
      if (response.error === undefined) {
        const payload = response.data?.data;
        if (payload !== undefined) {
          return { state: "ok", permission: payload };
        }
      }
      // On the error branch the server has answered but the request was
      // not found. V2SessionPermissionGetErrors maps 404 to
      // `PermissionNotFoundError`, so the only server-confirmed
      // "no longer pending" signal we have is HTTP 404.
      if (response.response?.status === 404) {
        return { state: "resolved" };
      }
      return { state: "unknown" };
    } catch {
      // Network failure, pre-v1.17.12 server, or runtimeFetch throwing.
      // Treat as "unknown" — caller must decide what to do (auto-accept
      // fails closed, but the permission stays in the resync output so
      // the user can still act on it).
      return { state: "unknown" };
    }
  }

  /**
   * Throws on fetch/SDK failure. Callers that drive authoritative state from
   * the result (e.g. reconnect resync) must let the throw propagate so they
   * can preserve existing state instead of conflating "fetch failed" with
   * "server returned no pending permissions".
   */
  async listPendingPermissions(options?: { directories?: Array<string | null | undefined> }): Promise<PermissionRequest[]> {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'legacy permission list');
    const fetches: Array<Promise<PermissionRequest[]>> = [];

    const fetchForDirectory = async (directory?: string | null): Promise<PermissionRequest[]> => {
      const trimmed = typeof directory === 'string' ? directory.trim() : '';
      const result = await this.client.permission.list(trimmed ? { directory: trimmed } : undefined);
      if (result.error) {
        throw new Error(`permission.list failed: ${formatSdkError(result.error)}`);
      }
      return (result.data || []) as unknown as PermissionRequest[];
    };

    // Try unscoped first (server may return global pending items).
    fetches.push(fetchForDirectory(null));

    const uniqueDirectories = new Set<string>();
    for (const entry of options?.directories ?? []) {
      const normalized = this.normalizeCandidatePath(entry ?? null);
      if (normalized) {
        uniqueDirectories.add(normalized);
      }
    }

    for (const directory of uniqueDirectories) {
      fetches.push(fetchForDirectory(directory));
    }

    const results = await Promise.all(fetches);
    const merged: PermissionRequest[] = [];
    const seenIds = new Set<string>();

    for (const list of results) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = (item as { id?: unknown }).id;
        if (typeof id !== 'string' || id.length === 0) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        merged.push(item);
      }
    }

    return merged;
  }

  async listTaggedPermissions(options?: { directories?: Array<string | null | undefined> }): Promise<PendingPermission[]> {
    if (!this.isV2()) return (await this.listPendingPermissions(options)).map((value) => ({ generation: 'oc1', value }));
    const directories = [null, ...new Set((options?.directories ?? []).map((value) => this.normalizeCandidatePath(value)).filter((value): value is string => !!value))];
    const lists = await Promise.all(directories.map(async (directory) =>
      (await this.runtimeBinding.run('oc2', 'permission.request.list', () =>
        this.v2ClientFor(directory).permission.request.list())).data));
    const seen = new Set<string>();
    return lists.flat().filter((value) => {
      if (seen.has(value.id)) return false;
      seen.add(value.id);
      return true;
    }).map((value) => ({ generation: 'oc2', value }));
  }

  // Questions ("ask" tool)
  async replyToQuestion(requestId: string, answers: string[] | string[][], directory?: string | null): Promise<boolean> {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'legacy question reply');
    const normalizedAnswers: string[][] = (() => {
      if (!Array.isArray(answers) || answers.length === 0) {
        return [];
      }
      if (Array.isArray(answers[0])) {
        return answers as string[][];
      }
      return [answers as string[]];
    })();

    const requestDirectory = this.normalizeCandidatePath(directory) ?? this.currentDirectory;
    const response = await this.client.question.reply({
      requestID: requestId,
      ...(requestDirectory ? { directory: requestDirectory } : {}),
      answers: normalizedAnswers,
    });
    return unwrapSdkOptional(response, 'question.reply') === true;
  }

  async rejectQuestion(requestId: string, directory?: string | null): Promise<boolean> {
    return this.runtimeBinding.run('oc1', 'question.reject', async () => {
      const result = await this.client.question.reject({
        requestID: requestId,
        directory: this.scope(directory).directory ?? undefined,
      });
      return unwrapSdkOptional(result, 'question.reject') === true;
    });
  }

  /**
   * Throws on fetch/SDK failure. See {@link listPendingPermissions} for
   * rationale — resync paths preserve state on throw via outer try/catch
   * instead of conflating failure with an empty server response.
   */
  async listPendingQuestions(options?: { directories?: Array<string | null | undefined> }): Promise<QuestionRequest[]> {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'legacy question list');
    const fetches: Array<Promise<QuestionRequest[]>> = [];

    const fetchForDirectory = async (directory?: string | null): Promise<QuestionRequest[]> => {
      const trimmed = typeof directory === 'string' ? directory.trim() : '';
      const result = await this.client.question.list(trimmed ? { directory: trimmed } : undefined);
      if (result.error) {
        throw new Error(`question.list failed: ${formatSdkError(result.error)}`);
      }
      return (result.data || []) as unknown as QuestionRequest[];
    };

    // Try unscoped first (server may return global pending items).
    fetches.push(fetchForDirectory(null));

    const uniqueDirectories = new Set<string>();
    for (const entry of options?.directories ?? []) {
      const normalized = this.normalizeCandidatePath(entry ?? null);
      if (normalized) {
        uniqueDirectories.add(normalized);
      }
    }

    for (const directory of uniqueDirectories) {
      fetches.push(fetchForDirectory(directory));
    }

    const results = await Promise.all(fetches);
    const merged: QuestionRequest[] = [];
    const seenIds = new Set<string>();

    for (const list of results) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = (item as { id?: unknown }).id;
        if (typeof id !== 'string' || id.length === 0) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        merged.push(item);
      }
    }

    return merged;
  }

  async listTaggedInputs(options?: { directories?: Array<string | null | undefined> }): Promise<PendingInput[]> {
    if (!this.isV2()) return (await this.listPendingQuestions(options)).map((value) => ({ generation: 'oc1', kind: 'question', value }));
    const directories = [null, ...new Set((options?.directories ?? []).map((value) => this.normalizeCandidatePath(value)).filter((value): value is string => !!value))];
    const lists = await Promise.all(directories.map(async (directory) =>
      (await this.runtimeBinding.run('oc2', 'form.list', () => this.v2ClientFor(directory).form.list())).data));
    const seen = new Set<string>();
    return lists.flat().filter((value) => {
      if (seen.has(value.id)) return false;
      seen.add(value.id);
      return true;
    }).map((value) => ({ generation: 'oc2', kind: 'form', value }));
  }

  async replyToForm(sessionID: string, formID: string, answer: FormAnswer, directory?: string | null): Promise<boolean> {
    await this.runtimeBinding.run('oc2', 'session.form.reply', () =>
      this.v2ClientFor(directory).session.form.reply({ sessionID, formID, answer }));
    return true;
  }

  async cancelForm(sessionID: string, formID: string, directory?: string | null): Promise<boolean> {
    await this.runtimeBinding.run('oc2', 'session.form.cancel', () =>
      this.v2ClientFor(directory).session.form.cancel({ sessionID, formID }));
    return true;
  }

  async getForm(sessionID: string, formID: string, directory?: string | null) {
    return this.runtimeBinding.run('oc2', 'session.form.get', () =>
      this.v2ClientFor(directory).session.form.get({ sessionID, formID }));
  }

  // Configuration
  clearConfigCache(): void {
    this.configCacheGeneration += 1;
    this.configInFlight.clear();
    this.configCache.clear();
  }

  async getConfig(directory?: string | null): Promise<Config> {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'legacy config.get; use getTaggedConfig');
    const effectiveDirectory = this.normalizeCandidatePath(directory) ?? directory ?? this.currentDirectory ?? undefined;
    const key = effectiveDirectory ?? '';
    const cached = this.configCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      markStartupTrace('opencodeClient.getConfig:cacheHit', { directory: effectiveDirectory ?? null });
      return cached.config;
    }

    const existing = this.configInFlight.get(key);
    if (existing) {
      markStartupTrace('opencodeClient.getConfig:deduped', { directory: effectiveDirectory ?? null });
      return existing;
    }

    const generation = this.configCacheGeneration;
    const request = (async () => {
      markStartupTrace('opencodeClient.getConfig:start', { directory: effectiveDirectory ?? null });
      const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const scopedClient = effectiveDirectory ? this.getScopedApiClient(effectiveDirectory) : this.client;
      const response = await scopedClient.config.get();
      if (!response.data) throw new Error('Failed to get config');
      const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
      markStartupTrace('opencodeClient.getConfig:end', {
        directory: effectiveDirectory ?? null,
        durationMs: Math.round(ended - started),
      });
      if (generation === this.configCacheGeneration) {
        this.configCache.set(key, { config: response.data, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
      }
      return response.data;
    })();

    this.configInFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (this.configInFlight.get(key) === request) {
        this.configInFlight.delete(key);
      }
    }
  }

  async updateConfig(config: Record<string, unknown>): Promise<Config> {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'legacy config.update');
    // IMPORTANT: Do NOT pass directory parameter for config updates
    // The config should be global, not directory-specific
    const response = await this.client.config.update({ config: config as Config });
    const data = unwrapSdkData(response, 'global.config.update');
    this.clearConfigCache();
    return data;
  }

  /**
   * Update config with a partial modification function.
   * This handles the GET-modify-PATCH pattern required by the upstream API.
   *
   * NOTE: This method is deprecated for agent configuration.
   * Use backend endpoints at /api/config/agents/* instead, which write directly to files.
   *
   * @param modifier Function that receives current config and returns modified config
   * @returns Updated config from server
   */
  async updateConfigPartial(modifier: (config: Config) => Config): Promise<Config> {
    const currentConfig = await this.getConfig();
    const updatedConfig = modifier(currentConfig);
    const result = await this.updateConfig(updatedConfig);
    return result;
  }

  async getProviders(): Promise<{
    providers: Provider[];
    default: { [key: string]: string };
  }> {
    return this.getProvidersForConfig(this.currentDirectory);
  }

  async getProvidersForConfig(directory?: string | null): Promise<{
    providers: Provider[];
    default: { [key: string]: string };
  }> {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'legacy config.providers; use getProviderCatalog');
    const effectiveDirectory = this.normalizeCandidatePath(directory) ?? directory ?? this.currentDirectory ?? undefined;
    const key = effectiveDirectory ?? '';

    const existing = this.configProvidersInFlight.get(key);
    if (existing) {
      return existing;
    }

    const request = (async () => {
      const response = await this.client.config.providers(
        effectiveDirectory ? { directory: effectiveDirectory } : undefined,
      );
      return unwrapSdkData(response, 'config.providers');
    })();

    this.configProvidersInFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (this.configProvidersInFlight.get(key) === request) this.configProvidersInFlight.delete(key);
    }
  }

  // App Management - using config endpoint since /app doesn't exist in this version
  async getApp(): Promise<App> {
    if (this.isV2()) return this.runtimeBinding.run('oc2', 'server.info', () => this.v2Client.server.info());
    // Return basic app info from config
    const config = await this.getConfig();
    return {
      version: "0.0.3", // from the OpenAPI spec
      config
    };
  }

  async initApp(): Promise<boolean> {
    try {
      // Just check if we can connect since there's no init endpoint
      return await this.checkHealth();
    } catch {
      return false;
    }
  }

  // Agent Management
  /**
   * Throws on fetch/SDK failure so caller-side retry loops (see
   * useAgentsStore) can observe failure and retry; silently returning an
   * empty list would defeat retries and clear the cached agent list.
   */
  async listAgents(directory?: string | null): Promise<Agent[]> {
    if (this.isV2()) throw new OpenCodeRuntimeError('oc2', 'legacy agent list');
    // Pass the directory explicitly so we don't depend on (and serialize behind)
    // withDirectory's shared context queue. Concurrent callers for the same
    // directory (e.g. config store + agents store at startup) share one request.
    const effectiveDirectory = this.normalizeCandidatePath(directory) ?? directory ?? this.currentDirectory ?? undefined;
    const key = effectiveDirectory ?? '';

    const existing = this.listAgentsInFlight.get(key);
    if (existing) {
      return existing;
    }

    const request = (async () => {
      const params = effectiveDirectory ? { directory: effectiveDirectory } : undefined;
      const response = await this.client.app.agents(params);
      if (!response.error && Array.isArray(response.data) && response.data.length > 0) {
        return response.data;
      }

      // SDK gap / endpoint drift: current OpenCode exposes the authoritative
      // agent list at /agent, while app.agents can be empty on some runtimes.
      const fallbackResponse = await runtimeFetch('/api/agent', {
        ...(effectiveDirectory ? { query: { directory: effectiveDirectory } } : {}),
      });
      if (!fallbackResponse.ok) {
        if (response.error) {
          throw new Error(`app.agents failed${response.response?.status ? ` (${response.response.status})` : ''}: ${formatSdkError(response.error)}`);
        }
        throw new Error(`agent.list failed (${fallbackResponse.status})`);
      }

      const fallbackData = await fallbackResponse.json().catch(() => null) as unknown;
      if (!Array.isArray(fallbackData)) {
        throw new Error('agent.list failed: invalid response');
      }
      return fallbackData as Agent[];
    })();

    this.listAgentsInFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (this.listAgentsInFlight.get(key) === request) this.listAgentsInFlight.delete(key);
    }
  }

  async listTaggedAgents(directory?: string | null) {
    if (this.isV2()) return { generation: 'oc2' as const, value: await this.v2Catalog.agents(this.scope(directory)) };
    return { generation: 'oc1' as const, value: await this.listAgents(directory) };
  }

  // SSE infrastructure removed — EventPipeline in sync/event-pipeline.ts handles
  // all SSE event ingestion via the SDK's global.event() async iterator.

  // Command Management
  async listCommandsWithDetails(directory?: string | null, signal?: AbortSignal): Promise<Array<{ name: string; description?: string; agent?: string; model?: string; source?: string; template?: string }>> {
    if (this.isV2()) return this.v2Catalog.commands(this.scope(directory, signal));
    const requestDirectory = this.normalizeCandidatePath(directory ?? null) ?? this.currentDirectory;
    const response = await this.client.command.list(
      requestDirectory ? { directory: requestDirectory } : undefined,
      { signal },
    );
    const commands = unwrapSdkData(response, 'command.list');
    // Return full command details including template
    return (commands || []).map((cmd: Record<string, unknown>) => ({
      name: cmd.name as string,
      description: cmd.description as string | undefined,
      agent: cmd.agent as string | undefined,
      model: cmd.model as string | undefined,
      source: cmd.source as string | undefined,
      template: cmd.template as string | undefined,
    }));
  }

  async listCommands(directory?: string | null, signal?: AbortSignal) {
    if (this.isV2()) return this.v2Catalog.commands(this.scope(directory, signal));
    return this.listCommandsWithDetails(directory, signal);
  }

  async listSkills(directory?: string | null) {
    if (this.isV2()) return this.v2Catalog.skills(this.scope(directory));
    return this.runtimeBinding.run('oc1', 'app.skills', async () =>
      unwrapSdkData(await this.getScopedApiClient(this.scope(directory).directory ?? '').app.skills(), 'app.skills'));
  }

  async listMcpServers(directory?: string | null) {
    if (this.isV2()) return this.v2Catalog.mcp(this.scope(directory));
    return this.runtimeBinding.run('oc1', 'mcp.status', async () =>
      unwrapSdkData(await this.getScopedApiClient(this.scope(directory).directory ?? '').mcp.status(), 'mcp.status'));
  }

  async getMcpCatalog(directory?: string | null): Promise<McpCatalog> {
    if (this.isV2()) return { generation: 'oc2', value: await this.v2Catalog.mcp(this.scope(directory)) };
    const value = await this.runtimeBinding.run('oc1', 'mcp.status', async () =>
      unwrapSdkData(await this.getScopedApiClient(this.scope(directory).directory ?? '').mcp.status(), 'mcp.status'));
    return { generation: 'oc1', value };
  }

  async connectMcpServer(server: string, directory?: string | null): Promise<void> {
    if (this.isV2()) return this.v2Catalog.connectMcp(server, this.scope(directory));
    await this.runtimeBinding.run('oc1', 'mcp.connect', async () =>
      unwrapSdkOptional(await this.getScopedApiClient(this.scope(directory).directory ?? '').mcp.connect({ name: server }), 'mcp.connect'));
  }

  async disconnectMcpServer(server: string, directory?: string | null): Promise<void> {
    if (this.isV2()) return this.v2Catalog.disconnectMcp(server, this.scope(directory));
    await this.runtimeBinding.run('oc1', 'mcp.disconnect', async () =>
      unwrapSdkOptional(await this.getScopedApiClient(this.scope(directory).directory ?? '').mcp.disconnect({ name: server }), 'mcp.disconnect'));
  }

  async listMcpResources(directory?: string | null) {
    return this.runtimeBinding.run('oc2', 'mcp.resource.catalog', () =>
      this.v2ClientFor(directory).mcp.resource.catalog());
  }

  async listIntegrations(directory?: string | null) {
    return this.runtimeBinding.run('oc2', 'integration.list', () =>
      this.v2ClientFor(directory).integration.list());
  }

  async connectIntegrationKey(input: Parameters<OpenCodeClient['integration']['connect']['key']>[0], directory?: string | null): Promise<void> {
    await this.runtimeBinding.run('oc2', 'integration.connect.key', () =>
      this.v2ClientFor(directory).integration.connect.key(input));
  }

  async startIntegrationOAuth(input: Parameters<OpenCodeClient['integration']['oauth']['connect']>[0], directory?: string | null) {
    return this.runtimeBinding.run('oc2', 'integration.oauth.connect', () =>
      this.v2ClientFor(directory).integration.oauth.connect(input));
  }

  async getIntegrationOAuthStatus(input: Parameters<OpenCodeClient['integration']['oauth']['status']>[0], directory?: string | null) {
    return this.runtimeBinding.run('oc2', 'integration.oauth.status', () =>
      this.v2ClientFor(directory).integration.oauth.status(input));
  }

  async completeIntegrationOAuth(input: Parameters<OpenCodeClient['integration']['oauth']['complete']>[0], directory?: string | null): Promise<void> {
    await this.runtimeBinding.run('oc2', 'integration.oauth.complete', () =>
      this.v2ClientFor(directory).integration.oauth.complete(input));
  }

  async cancelIntegrationOAuth(input: Parameters<OpenCodeClient['integration']['oauth']['cancel']>[0], directory?: string | null): Promise<void> {
    await this.runtimeBinding.run('oc2', 'integration.oauth.cancel', () =>
      this.v2ClientFor(directory).integration.oauth.cancel(input));
  }

  async removeCredential(credentialID: string, directory?: string | null): Promise<void> {
    await this.runtimeBinding.run('oc2', 'credential.remove', () =>
      this.v2ClientFor(directory).credential.remove({ credentialID }));
  }

  // Lightweight readiness check. Full diagnostics still live at /health.
  async checkHealth(): Promise<boolean> {
    try {
      const runtime = await this.discoverRuntime();
      return Boolean(runtime.endpoint) && (runtime.generation === OPEN_CODE_GENERATION.OC1 || runtime.generation === OPEN_CODE_GENERATION.OC2);
    } catch {
      return false;
    }
  }

  // File System Operations
  async createDirectory(
    dirPath: string,
    options?: { allowOutsideWorkspace?: boolean; asProject?: boolean }
  ): Promise<{ success: boolean; path: string }> {
    const desktopFiles = getDesktopFilesApi();
    if (desktopFiles?.createDirectory) {
      try {
        return await desktopFiles.createDirectory(dirPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message || 'Failed to create directory');
      }
    }

    if (options?.asProject) {
      const response = await runtimeFetch(`${this.baseUrl}/opencode/directory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: dirPath, create: true }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to create project directory' }));
        throw new Error(error.error || 'Failed to create project directory');
      }

      const result = await response.json();
      return { success: true, path: result.path };
    }

    const payload = {
      path: dirPath,
      ...(options?.allowOutsideWorkspace ? { allowOutsideWorkspace: true } : {}),
    };

    const response = await runtimeFetch(`${this.baseUrl}/fs/mkdir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create directory' }));
      throw new Error(error.error || 'Failed to create directory');
    }

    const result = await response.json();
    return result;
  }

  async cloneRepository(input: { remoteUrl: string; destinationPath: string; gitIdentityId?: string | null }): Promise<{ success: boolean; path: string; output?: string }> {
    const response = await runtimeFetch(`${this.baseUrl}/fs/clone`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to clone repository' }));
      throw new Error(error.error || 'Failed to clone repository');
    }

    return await response.json();
  }

  async listLocalDirectory(directoryPath: string | null | undefined, options?: { respectGitignore?: boolean }): Promise<FilesystemEntry[]> {
    const normalizedDirectoryPath = typeof directoryPath === 'string' ? normalizeFsPath(directoryPath.trim()) : '';
    const cacheKey = `${normalizedDirectoryPath}|${options?.respectGitignore ? '1' : '0'}`;
    const now = Date.now();
    const cached = this.listDirectoryCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.entries;
    }

    const inFlight = this.listDirectoryInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      const desktopFiles = getDesktopFilesApi();
      try {
        if (desktopFiles) {
          const result = await desktopFiles.listDirectory(directoryPath || '', options);
          if (!result || !Array.isArray(result.entries)) {
            throw new FilesystemError('Directory listing returned an invalid response', {
              reason: 'invalid-response',
            });
          }
          const entries = result.entries.map<FilesystemEntry>((entry) => ({
            name: entry.name,
            path: normalizeFsPath(entry.path),
            isDirectory: !!entry.isDirectory,
            isFile: !entry.isDirectory,
            isSymbolicLink: false,
          }));
          this.listDirectoryCache.set(cacheKey, {
            entries,
            expiresAt: Date.now() + FS_LIST_CACHE_TTL_MS,
          });
          return entries;
        }

        const params = new URLSearchParams();
        if (directoryPath && directoryPath.trim().length > 0) {
          params.set('path', directoryPath);
        }
        if (options?.respectGitignore) {
          params.set('respectGitignore', 'true');
        }
        const query = params.toString();
        const response = await runtimeFetch(`${this.baseUrl}/fs/list${query ? `?${query}` : ''}`);
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          const message = typeof error.error === 'string' ? error.error : 'Failed to list directory';
          throw new FilesystemError(message, {
            reason: parseFilesystemErrorReason((error as { reason?: unknown }).reason),
            status: response.status,
          });
        }

        const result = await response.json();
        if (!result || !Array.isArray(result.entries)) {
          throw new FilesystemError('Directory listing returned an invalid response', {
            reason: 'invalid-response',
          });
        }

        const entries = result.entries as FilesystemEntry[];
        this.listDirectoryCache.set(cacheKey, {
          entries,
          expiresAt: Date.now() + FS_LIST_CACHE_TTL_MS,
        });
        return entries;
      } catch (error) {
        console.error('Failed to list directory contents:', error);
        throw error;
      }
    })();

    const trackedTask = task.finally(() => {
      if (this.listDirectoryInFlight.get(cacheKey) === trackedTask) {
        this.listDirectoryInFlight.delete(cacheKey);
      }
    });
    this.listDirectoryInFlight.set(cacheKey, trackedTask);
    return trackedTask;
  }

  async searchFiles(
    query: string,
    options?: {
      directory?: string | null;
      limit?: number;
      includeHidden?: boolean;
      respectGitignore?: boolean;
      dirs?: boolean;
      type?: 'file' | 'directory';
    }
  ): Promise<ProjectFileSearchHit[]> {
    const directory = typeof options?.directory === 'string' && options.directory.trim().length > 0
      ? options.directory.trim()
      : this.currentDirectory;
    const normalizedDirectory = directory ? normalizeFsPath(directory) : null;

    try {
      const limit = options?.limit !== undefined && Number.isFinite(options.limit) ? options.limit : undefined;
      let paths: string[];
      if (this.isV2()) {
        const result = await this.runtimeBinding.run('oc2', 'file.find', () => this.v2ClientFor(directory).file.find({
          query, limit, type: options?.type ?? (options?.dirs === false ? 'file' : undefined),
          location: directory ? { directory } : undefined,
        }));
        paths = z.array(z.object({ path: z.string().min(1), type: z.enum(['file', 'directory']) }))
          .parse(result.data).map((item) => item.path);
      } else {
        const scopedClient = directory ? this.getScopedApiClient(directory) : this.client;
        const response = await scopedClient.find.files({
          query, limit, dirs: options?.dirs === false || options?.type === 'file' ? 'false' : 'true', type: options?.type,
        });
        paths = z.array(z.string()).parse(unwrapSdkData(response, 'find.files'));
      }
      return paths.map<ProjectFileSearchHit>((item) => {
        const normalizedRelativePath = normalizeFsPath(item);
        const name = normalizedRelativePath.split('/').filter(Boolean).pop() || normalizedRelativePath;
        const normalizedPath = normalizedDirectory
          ? normalizeFsPath(`${normalizedDirectory}/${normalizedRelativePath}`)
          : normalizeFsPath(normalizedRelativePath);

        return {
          name,
          path: normalizedPath,
          relativePath: normalizedRelativePath,
          extension: name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined,
        };
      });
    } catch (error) {
      console.error('Failed to search files:', error);
      throw error;
    }
  }

  async getFilesystemHome(): Promise<string | null> {
    // The injected desktop home describes the LOCAL machine. It is only a
    // valid answer while the active runtime is the local one — after an
    // in-place switch to a remote host the home must come from that host's
    // /api/fs/home, not from the local Electron global.
    const runtimeKey = getRuntimeKey();
    if (!runtimeKey || runtimeKey === 'local') {
      const desktopHome = await getDesktopHomeDirectory();
      if (desktopHome) {
        return desktopHome;
      }
    }

    try {
      const response = await runtimeFetch(`${this.baseUrl}/fs/home`, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message =
          typeof error.error === 'string' && error.error.length > 0
            ? error.error
            : 'Failed to resolve home directory';
        throw new Error(message);
      }

      const payload = await response.json();
      if (payload && typeof payload.home === 'string' && payload.home.length > 0) {
        return payload.home;
      }
      return null;
    } catch (error) {
      console.warn('Failed to resolve filesystem home directory:', error);
      return null;
    }
  }

  // Both roots must describe the same server response, including on desktop.
  // Failure is distinct from an older server omitting chatsRoot.
  async getFilesystemHomeInfo(): Promise<z.infer<typeof fsHomeResponseSchema>> {
    const response = await runtimeFetch(`${this.baseUrl}/fs/home`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to resolve the chats root (${response.status})`);
    }
    return fsHomeResponseSchema.parse(await response.json());
  }

  async setOpenCodeWorkingDirectory(directoryPath: string | null | undefined): Promise<DirectorySwitchResult | null> {
    if (!directoryPath || typeof directoryPath !== 'string' || !directoryPath.trim()) {
      console.warn('[OpencodeClient] setOpenCodeWorkingDirectory: invalid path', directoryPath);
      return null;
    }

    const url = `${this.baseUrl}/opencode/directory`;
    console.log('[OpencodeClient] POST', url, 'with path:', directoryPath);

    try {
      const response = await runtimeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: directoryPath })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const error = payload ?? {};
        const message =
          typeof error.error === 'string' && error.error.length > 0
            ? error.error
            : 'Failed to update OpenCode working directory';
        throw new Error(message);
      }

      if (payload && typeof payload === 'object') {
        return payload as DirectorySwitchResult;
      }

      return {
        success: true,
        restarted: false,
        path: directoryPath
      };
    } catch (error) {
      console.warn('Failed to update OpenCode working directory:', error);
      throw error;
    }
  }
}

// Exported singleton instance
export const opencodeClient = new OpencodeService();

// Exported types
