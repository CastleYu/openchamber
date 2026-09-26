import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { createArchiveStore, type ArchiveEntries, type ArchiveStore } from '../../web/server/lib/openchamber-sessions/archive-store.js';
import { createSessionMetadataStore, type SessionMetadataStore } from '../../web/server/lib/openchamber-sessions/session-metadata-store.js';
import { createSessionStorageScopes } from '../../web/server/lib/openchamber-sessions/storage-scope.js';
import type { OpenCodeManager } from './opencode';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type SessionMetadata = { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type Identity = { generation: 'oc2'; endpoint: string; epoch: string | number };

export const parseJson = (text: string): JsonValue | null => {
  try {
    // SAFETY: JSON.parse produces only the members of JsonValue; callers
    // validate the object shape before granting authority to the data.
    return JSON.parse(text) as JsonValue;
  } catch { return null; }
};
const isObject = (value: JsonValue | null | undefined): value is JsonObject =>
  z.object({}).passthrough().safeParse(value).success;
export const asSessionId = (value: JsonValue | undefined): string | null => {
  const parsed = z.string().trim().min(1).safeParse(value);
  return parsed.success ? parsed.data : null;
};
export const asSessionIdList = (value: JsonValue | undefined): string[] =>
  Array.isArray(value) ? [...new Set(value.map(asSessionId).filter((id): id is string => id !== null))] : [];
export const asTimestamp = (value: JsonValue | undefined): number | null => {
  const parsed = z.number().int().positive().safeParse(value);
  return parsed.success && Number.isSafeInteger(parsed.data) ? parsed.data : null;
};
export const asSessionMetadata = (value: JsonValue | undefined): SessionMetadata | null => isObject(value) ? value : null;

export const mergeMetadataPatch = (current: SessionMetadata, patch: SessionMetadata) => {
  const next = { ...current };
  const pending = [{ target: next, source: patch }];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    for (const [key, value] of Object.entries(entry.source)) {
      if (value === null) {
        delete entry.target[key];
      } else if (isObject(value)) {
        const nested = isObject(entry.target[key]) ? { ...entry.target[key] } : {};
        entry.target[key] = nested;
        pending.push({ target: nested, source: value });
      } else {
        entry.target[key] = value;
      }
    }
  }
  return next;
};

export const getOpenChamberDataDir = (): string => process.platform === 'win32' && process.env.APPDATA
  ? path.join(process.env.APPDATA, 'openchamber') : path.join(os.homedir(), '.config', 'openchamber');

const changed = (): Error => Object.assign(new Error('OpenCode connection changed during session state operation'), { code: 'runtime-changed' });
const notFound = (error: Error): boolean => {
  return error.name === 'SessionNotFoundError' || '_tag' in error && error._tag === 'SessionNotFoundError';
};

type Stores = { archive: ArchiveStore; metadata: SessionMetadataStore };

/**
 * The web server and VS Code use the same archive, metadata-migration, and
 * scope stores. Only the OpenCode request adapter belongs to this module.
 */
type SessionManager = Pick<OpenCodeManager, 'getKernelRuntime' | 'getOpenCodeAuthHeaders'> & {
  getDebugInfo(): { mode: 'managed' | 'external' };
};
export const createSessionStateStore = ({ dataDir, manager }: { dataDir: string; manager: SessionManager }) => {
  const scopes = createSessionStorageScopes({ dataDir });
  const stores = new Map<string, Stores>();
  const writeChains = new Map<string, Promise<void>>();

  const capture = (): Identity => {
    const selected = manager.getKernelRuntime();
    if (selected.generation !== 'oc2' || !selected.endpoint) throw new Error('OC2 session state is unavailable');
    return { generation: 'oc2', endpoint: selected.endpoint, epoch: selected.epoch };
  };
  const check = (expected: Identity): void => {
    const current = manager.getKernelRuntime();
    if (current.generation !== expected.generation || current.endpoint !== expected.endpoint || current.epoch !== expected.epoch) {
      throw changed();
    }
  };
  const scope = (identity: Identity): string => manager.getDebugInfo().mode === 'external'
    ? `external:${identity.endpoint}` : 'managed';
  const client = async (directory?: string) => {
    const identity = capture();
    const headers = { ...manager.getOpenCodeAuthHeaders() };
    if (directory) headers['x-opencode-directory'] = encodeURIComponent(directory);
    const { OpenCode } = await import('@opencode/client');
    check(identity);
    return { identity, sdk: OpenCode.make({ baseUrl: identity.endpoint, headers }) };
  };

  const readUpstream = async (sessionID: string, directory = ''): Promise<SessionMetadata | null> => {
    const { identity, sdk } = await client(directory);
    try {
      const session = await sdk.session.get({ sessionID });
      check(identity);
      const metadata = parseJson(JSON.stringify(session.metadata ?? {}));
      if (!isObject(metadata)) throw new Error('OpenCode session metadata is malformed');
      return metadata;
    } catch (error) {
      check(identity);
      if (error instanceof Error && notFound(error)) return null;
      throw error;
    }
  };

  const writeUpstream = (sessionID: string, patch: SessionMetadata, directory = '', expected?: Identity, replace = false): Promise<void> => {
    const key = `${expected?.endpoint ?? capture().endpoint}\0${sessionID}`;
    const previous = writeChains.get(key) ?? Promise.resolve();
    const write = async () => {
      const identity = expected ?? capture();
      check(identity);
      const current = await readUpstream(sessionID, directory);
      check(identity);
      if (current === null) throw new Error(`session ${sessionID} was not found`);
      const metadata = replace ? patch : mergeMetadataPatch(current, patch);
      const { sdk } = await client(directory);
      check(identity);
      await sdk.session.update({ sessionID, metadata });
      check(identity);
    };
    const next = previous.then(write, write);
    const settled = next.then(() => undefined, () => undefined);
    writeChains.set(key, settled);
    void settled.then(() => { if (writeChains.get(key) === settled) writeChains.delete(key); });
    return next;
  };

  const storesFor = async (identity: Identity): Promise<Stores> => {
    check(identity);
    const name = scope(identity);
    let entry = stores.get(name);
    if (entry) return entry;
    const dir = await scopes.directory(name);
    check(identity);
    entry = stores.get(name);
    if (!entry) {
      const openCode = {
        captureIdentity: capture,
        read: (id: string, options?: { directory?: string }) => readUpstream(id, options?.directory),
        write: (id: string, patch: SessionMetadata, options?: { directory?: string; expectedIdentity?: Identity }) =>
          writeUpstream(id, patch, options?.directory, options?.expectedIdentity),
        writeLegacy: (id: string, metadata: SessionMetadata, options?: { directory?: string; expectedIdentity?: Identity }) =>
          writeUpstream(id, metadata, options?.directory, options?.expectedIdentity, true),
      };
      entry = { archive: createArchiveStore({ dataDir: dir }), metadata: createSessionMetadataStore({ dataDir: dir, openCode }) };
      stores.set(name, entry);
    }
    return entry;
  };

  const readArchived = async (): Promise<ArchiveEntries> => {
    const identity = capture();
    const result = await (await storesFor(identity)).archive.getAll();
    check(identity);
    return result;
  };
  const readMetadata = async (): Promise<Record<string, SessionMetadata>> => {
    const identity = capture();
    const result = await (await storesFor(identity)).metadata.listUnmigrated();
    check(identity);
    const parsed: Record<string, SessionMetadata> = {};
    for (const [id, value] of Object.entries(result)) {
      const metadata = asSessionMetadata(parseJson(JSON.stringify(value)) ?? undefined);
      if (!metadata) throw new Error(`Legacy metadata for ${id} is malformed`);
      parsed[id] = metadata;
    }
    return parsed;
  };
  const archive = async (ids: string[], archivedAt?: number | null) => {
    const identity = capture();
    const result = await (await storesFor(identity)).archive.archive(ids, archivedAt, () => check(identity));
    check(identity);
    return result;
  };
  const unarchive = async (ids: string[]) => {
    const identity = capture();
    const result = await (await storesFor(identity)).archive.unarchive(ids, () => check(identity));
    check(identity);
    return result;
  };
  const getMetadata = async (sessionID: string, directory = ''): Promise<SessionMetadata> => {
    const identity = capture();
    const store = (await storesFor(identity)).metadata;
    await store.ensureMigrated(sessionID, { directory, expectedIdentity: identity });
    check(identity);
    const result = await readUpstream(sessionID, directory);
    check(identity);
    if (result === null) throw new Error(`session ${sessionID} was not found`);
    return result;
  };
  const setMetadata = async (sessionID: string, patch: SessionMetadata, directory = ''): Promise<SessionMetadata> => {
    const identity = capture();
    const store = (await storesFor(identity)).metadata;
    await store.ensureMigrated(sessionID, { directory, expectedIdentity: identity });
    check(identity);
    await writeUpstream(sessionID, patch, directory, identity);
    check(identity);
    const result = await readUpstream(sessionID, directory);
    check(identity);
    if (result === null) throw new Error(`session ${sessionID} was not found`);
    return result;
  };
  return { capture, check, readArchived, readMetadata, archive, unarchive, getMetadata, setMetadata };
};

export type SessionStateStore = ReturnType<typeof createSessionStateStore>;

const overlayRecord = (value: JsonValue, archived: ArchiveEntries, metadata: Record<string, SessionMetadata>): JsonValue => {
  if (!isObject(value)) return value;
  const id = asSessionId(value.id);
  if (!id) return value;
  let result = value;
  if (Object.hasOwn(archived, id)) {
    const time = isObject(result.time) ? { ...result.time } : {};
    if (archived[id] === null) delete time.archived;
    else time.archived = archived[id];
    result = { ...result, time };
  }
  if (metadata[id]) {
    const current = isObject(result.metadata) ? result.metadata : {};
    result = { ...result, metadata: { ...current, ...metadata[id] } };
  }
  return result;
};

export const overlaySessionResponseBody = (body: JsonValue, archived: ArchiveEntries, metadata: Record<string, SessionMetadata>): JsonValue => {
  if (Array.isArray(body)) return body.map((item) => overlayRecord(item, archived, metadata));
  if (!isObject(body)) return body;
  if (Array.isArray(body.data)) return { ...body, data: body.data.map((item) => overlayRecord(item, archived, metadata)) };
  if (isObject(body.data)) return { ...body, data: overlayRecord(body.data, archived, metadata) };
  return overlayRecord(body, archived, metadata);
};
export const isSessionRecordPath = (pathname: string): boolean =>
  pathname === '/session' || pathname === '/api/session' || /^\/(?:api\/)?session\/[^/]+$/.test(pathname);
