import type { OpencodeClient } from '@opencode-ai/sdk/v2/client';
import type { V2Event } from '@opencode/client';
import type { Agent as LegacyAgent, LspStatus } from '@opencode-ai/sdk/v2/client';
import type { DomainEvent } from '@/lib/opencode/events';
import { projectV2Event } from '@/lib/opencode/events';
import type { Agent, Message, Part, Project, Session, SessionStatus, Vcs } from '@/lib/opencode/model';
import type { BootstrapPath, PendingInput, PendingPermission, ProviderCatalog, TaggedConfig } from '@/lib/opencode/operations';
import { V1SessionOperations } from '@/lib/opencode/v1/sessions';
import { projectLegacyMessage, projectLegacyPart } from '@/lib/opencode/v1/projection';
import type { V2SessionOperations } from '@/lib/opencode/v2/sessions';
import { OpenCodeRuntimeChangedError, OpenCodeRuntimeError, type OpenCodeRuntimeBinding } from '@/lib/opencode/runtime';

export type SyncMessagePage = {
  /** Wire page order varies by generation; the loader sorts each page by message time. */
  items: Array<{ info: Message; parts: Part[] }>;
  cursor?: string;
};

type LegacyEnvelope = Awaited<ReturnType<OpencodeClient['global']['event']>>['stream'] extends AsyncIterable<infer T> ? T : never;
export type SyncEvent = { generation: 'oc1'; value: LegacyEnvelope } | { generation: 'oc2'; value: DomainEvent };
export type TaggedAgents = { generation: 'oc1'; value: LegacyAgent[] } | { generation: 'oc2'; value: Agent[] };

export type SyncBootstrapOperations = {
  listSyncSessions(directory: string, input: { archived: boolean; roots?: boolean; pageSize: number; signal?: AbortSignal }): Promise<Session[]>;
  getBootstrapPath(directory?: string | null, signal?: AbortSignal): Promise<BootstrapPath>;
  getCurrentProject(directory?: string | null, signal?: AbortSignal): Promise<Project>;
  getVcs(directory?: string | null, signal?: AbortSignal): Promise<Vcs>;
  /** OC2 explicitly rejects this optional enrichment; it must not become an empty success. */
  getLspStatus(directory?: string | null, signal?: AbortSignal): Promise<LspStatus[]>;
  getTaggedConfig(directory?: string | null, signal?: AbortSignal): Promise<TaggedConfig>;
  getProviderCatalog(directory?: string | null, signal?: AbortSignal): Promise<ProviderCatalog>;
  listTaggedAgents(directory?: string | null): Promise<TaggedAgents>;
};

/** Required by sync; no SDK client or generation-specific wire record reaches a store. */
export type SyncSource = {
  readonly generation: 'oc1' | 'oc2';
  readonly identity: object;
  readonly bootstrap: SyncBootstrapOperations;
  listSessions(directory: string, signal?: AbortSignal): Promise<Session[]>;
  getSession(id: string, directory: string, signal?: AbortSignal): Promise<Session>;
  messagePage(id: string, directory: string, limit: number, cursor?: string, signal?: AbortSignal): Promise<SyncMessagePage>;
  getMessage(id: string, messageID: string, directory: string, signal?: AbortSignal): Promise<{ info: Message; parts: Part[] }>;
  status(directory: string, signal?: AbortSignal): Promise<Record<string, SessionStatus>>;
  permissions(directory: string, signal?: AbortSignal): Promise<PendingPermission[]>;
  inputs(directory: string, signal?: AbortSignal): Promise<PendingInput[]>;
  events(signal: AbortSignal, lastEventID?: string): AsyncIterable<SyncEvent>;
};

function unwrap<T>(result: { data?: T; error?: unknown; response?: { status?: number } }, operation: string): T {
  if (result.error || result.data === undefined || result.data === null) {
    const error = new Error(`${operation} failed`);
    Object.assign(error, { status: result.response?.status });
    throw error;
  }
  return result.data;
}

type Runner = <T>(operation: string, fn: () => Promise<T>) => Promise<T>;

function bindBootstrap(operations: SyncBootstrapOperations, run: Runner): SyncBootstrapOperations {
  return {
    listSyncSessions: (directory, input) => run('sync.session.pages', () => operations.listSyncSessions(directory, input)),
    getBootstrapPath: (directory, signal) => run('sync.path', () => operations.getBootstrapPath(directory, signal)),
    getCurrentProject: (directory, signal) => run('sync.project', () => operations.getCurrentProject(directory, signal)),
    getVcs: (directory, signal) => run('sync.vcs', () => operations.getVcs(directory, signal)),
    getLspStatus: (directory, signal) => run('sync.lsp', () => operations.getLspStatus(directory, signal)),
    getTaggedConfig: (directory, signal) => run('sync.config', () => operations.getTaggedConfig(directory, signal)),
    getProviderCatalog: (directory, signal) => run('sync.providers', () => operations.getProviderCatalog(directory, signal)),
    listTaggedAgents: (directory) => run('sync.agents', () => operations.listTaggedAgents(directory)),
  };
}

export function createV1SyncSource(sdk: OpencodeClient, binding: OpenCodeRuntimeBinding, bootstrap: SyncBootstrapOperations): SyncSource {
  const runtime = binding.get();
  if (!runtime || runtime.generation !== 'oc1') throw new OpenCodeRuntimeError(runtime?.generation ?? 'unknown', 'sync source');
  const current = () => { if (binding.get() !== runtime) throw new OpenCodeRuntimeChangedError(); };
  const sessions = new V1SessionOperations(sdk);
  const run = async <T>(operation: string, fn: () => Promise<T>) => { current(); return binding.run('oc1', operation, fn); };
  return {
    generation: 'oc1', identity: sdk, bootstrap: bindBootstrap(bootstrap, run),
    listSessions: (directory, signal) => run('sync.session.list', () => sessions.list({ directory, signal })),
    getSession: (id, directory, signal) => run('sync.session.get', () => sessions.get(id, { directory, signal })),
    messagePage: (id, directory, limit, cursor, signal) => run('sync.message.page', async () => {
      const result = await sdk.session.messages({ sessionID: id, directory, limit, before: cursor }, { signal });
      const items = unwrap(result, 'session.messages').map(({ info, parts }) => ({
        info: projectLegacyMessage(info), parts: parts.map(projectLegacyPart),
      }));
      return { items, cursor: result.response?.headers?.get('x-next-cursor') ?? undefined };
    }),
    getMessage: (id, messageID, directory, signal) => run('sync.message.get', async () => {
      const value = unwrap(await sdk.session.message({ sessionID: id, messageID, directory }, { signal }), 'session.message');
      return { info: projectLegacyMessage(value.info), parts: value.parts.map(projectLegacyPart) };
    }),
    status: (directory, signal) => run('sync.status', async () => unwrap(await sdk.session.status({ directory }, { signal }), 'session.status')),
    permissions: (directory, signal) => run('sync.permission.list', async () =>
      unwrap(await sdk.permission.list({ directory }, { signal }), 'permission.list').map((value) => ({ generation: 'oc1' as const, value }))),
    inputs: (directory, signal) => run('sync.question.list', async () =>
      unwrap(await sdk.question.list({ directory }, { signal }), 'question.list').map((value) => ({ generation: 'oc1' as const, kind: 'question' as const, value }))),
    events: async function* (signal, lastEventID) {
      current();
      const options: Parameters<typeof sdk.global.event>[0] = { signal };
      if (lastEventID) options.headers = { 'Last-Event-ID': lastEventID };
      const stream = await sdk.global.event(options);
      for await (const envelope of stream.stream) {
        current();
        yield { generation: 'oc1', value: envelope };
      }
    },
  };
}

/** T06 supplies these exact OC2 operations from its bound client; absence is a compile error. */
export type V2SyncOperations = {
  sessions: V2SessionOperations;
  status(directory: string, signal?: AbortSignal): Promise<Record<string, SessionStatus>>;
  permissions(directory: string, signal?: AbortSignal): Promise<PendingPermission[]>;
  forms(directory: string, signal?: AbortSignal): Promise<PendingInput[]>;
  events(signal: AbortSignal, lastEventID?: string): AsyncIterable<V2Event>;
};

export function createV2SyncSource(operations: V2SyncOperations, binding: OpenCodeRuntimeBinding, bootstrap: SyncBootstrapOperations): SyncSource {
  const runtime = binding.get();
  if (!runtime || runtime.generation !== 'oc2') throw new OpenCodeRuntimeError(runtime?.generation ?? 'unknown', 'sync source');
  const current = () => { if (binding.get() !== runtime) throw new OpenCodeRuntimeChangedError(); };
  const run = async <T>(operation: string, fn: () => Promise<T>) => { current(); return binding.run('oc2', operation, fn); };
  const recent = new Set<string>();
  const eventOrder: string[] = [];
  return {
    generation: 'oc2', identity: operations, bootstrap: bindBootstrap(bootstrap, run),
    listSessions: (directory, signal) => run('sync.session.list', () => operations.sessions.list({ directory, signal })),
    getSession: (id, directory, signal) => run('sync.session.get', () => operations.sessions.get(id, { directory, signal })),
    messagePage: (id, directory, limit, cursor, signal) => run('sync.message.page', async () => {
      const page = await operations.sessions.messages(id, { limit, cursor, order: 'desc' }, { directory, signal });
      return { items: page.items, cursor: page.cursor.next };
    }),
    getMessage: (id, messageID, directory, signal) => run('sync.message.get', () =>
      operations.sessions.message(id, messageID, { directory, signal })),
    status: (directory, signal) => run('sync.status', () => operations.status(directory, signal)),
    permissions: (directory, signal) => run('sync.permission.list', () => operations.permissions(directory, signal)),
    inputs: (directory, signal) => run('sync.form.list', () => operations.forms(directory, signal)),
    events: async function* (signal, lastEventID) {
      current();
      for await (const wire of operations.events(signal, lastEventID)) {
        current();
        if (recent.has(wire.id)) continue;
        recent.add(wire.id);
        eventOrder.push(wire.id);
        if (eventOrder.length > 1024) {
          const expired = eventOrder.shift();
          if (expired) recent.delete(expired);
        }
        const event = projectV2Event(wire);
        if (event) {
          yield { generation: 'oc2', value: event };
        }
      }
    },
  };
}
