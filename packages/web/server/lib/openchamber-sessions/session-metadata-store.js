/**
 * OpenChamber per-session metadata, held by OpenCode.
 *
 * Goal mode, session assist, obligatory context re-injection and pinned
 * notes/plans keep their per-session state in the session's `metadata`, under
 * the `openchamber` namespace. OpenCode 2.0.15 added `PATCH /api/session/{id}`
 * with `metadata`, so the OpenCode record is the single authority and every
 * client reading `session.metadata` sees the same thing.
 *
 * OpenCode replaces the whole object on PATCH. Writers send a JSON Merge
 * Patch (RFC 7386) to kernelOperations, which owns the read, merge, and
 * per-session serialization. This store only tracks earlier OC2 metadata files.
 *
 * Before 2.0.15 the state lived in `sessions-metadata.json` under the data dir.
 * Entries still in that file are the newest pre-migration metadata their sessions have: they
 * are served as a proxy overlay until a session is first read or written.
 * A pushed entry leaves the
 * file; an empty file is renamed to `sessions-metadata.json.migrated` and kept
 * so nothing is lost if a migration turns out wrong.
 */

import fsDefault from 'node:fs';
import pathDefault from 'node:path';
import { z } from 'zod';


const LEGACY_FILE_NAME = 'sessions-metadata.json';

const asNonEmptyString = (value) => {
  return z.string().trim().min(1).safeParse(value).data ?? null;
};

const isPlainObject = (value) => z.object({}).passthrough().safeParse(value).success;

/**
 * RFC 7386 merge. Returns a new object; `null` in the patch removes the key,
 * and a non-object patch value replaces whatever was there.
 */
export const mergeMetadataPatch = (current, patch) => {
  const base = isPlainObject(current) ? { ...current } : {};
  if (!isPlainObject(patch)) return base;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key];
      continue;
    }
    base[key] = isPlainObject(value) ? mergeMetadataPatch(base[key], value) : value;
  }
  return base;
};

const isSessionNotFound = (error) => error?._tag === 'SessionNotFoundError';

/**
 * Reads and writes one session's metadata through kernelOperations. `read` resolves `null`
 * when OpenCode does not know the session; any other failure throws, because
 * "could not ask" must not become "empty".
 */
export const createOpenCodeSessionMetadata = ({
  kernelOperations,
}) => {
  const requireOc2 = () => {
    const identity = kernelOperations.captureIdentity();
    if (identity.generation !== 'oc2') throw new Error('OC2 session metadata is unavailable on OC1');
    return identity;
  };
  return {
    captureIdentity: requireOc2,
    read: async (sessionID, { directory = '' } = {}) => {
      requireOc2();
      let session;
      try {
        session = (await kernelOperations.getSession({ sessionID, directory })).data;
      } catch (error) {
        if (isSessionNotFound(error)) return null;
        throw error;
      }
      return isPlainObject(session?.metadata) ? session.metadata : {};
    },
    // updateSession is the one merge/serialization owner for autonomous and UI writers.
    write: (sessionID, patch, { directory = '', expectedIdentity } = {}) =>
      kernelOperations.updateSession({ sessionID, directory, metadata: patch,
        expectedIdentity: expectedIdentity ?? requireOc2() }),
    writeLegacy: (sessionID, metadata, { directory = '', expectedIdentity } = {}) =>
      kernelOperations.updateSession({ sessionID, directory, metadata, replaceMetadata: true,
        expectedIdentity: expectedIdentity ?? requireOc2() }),
  };
};

/**
 * @param {object} options
 * @param {string} options.dataDir OpenChamber data directory; holds the legacy file.
 * @param {{ read: Function, write: Function, writeLegacy: Function }} options.openCode See {@link createOpenCodeSessionMetadata}.
 * @param {typeof fsDefault.promises} [options.fsPromises]
 * @param {typeof pathDefault} [options.path]
 * @param {() => number} [options.now]
 */
export const createSessionMetadataStore = ({
  dataDir,
  openCode,
  fsPromises = fsDefault.promises,
  path = pathDefault,
  now = Date.now,
}) => {
  const legacyPath = path.join(dataDir, LEGACY_FILE_NAME);

  /** sessionID → metadata from the legacy file that OpenCode does not hold yet. */
  const unmigrated = new Map();
  let legacyLoad = null;

  /**
   * One chain per session: read, merge and write cannot interleave with another
   * write to the same session. Different sessions proceed in parallel.
   */
  const sessionChains = new Map();
  const runForSession = (id, work) => {
    const previous = sessionChains.get(id) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(() => undefined, () => undefined);
    sessionChains.set(id, settled);
    void settled.then(() => {
      if (sessionChains.get(id) === settled) sessionChains.delete(id);
    });
    return next;
  };

  /** Legacy file rewrites, one at a time so an older snapshot never lands last. */
  let fileChain = Promise.resolve();
  const runFileWrite = (work) => {
    const next = fileChain.then(work, work);
    fileChain = next.then(() => undefined, () => undefined);
    return next;
  };

  const parseLegacy = (raw) => {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) throw new Error('session metadata file is not a JSON object');
    const result = new Map();
    for (const [sessionID, value] of Object.entries(parsed)) {
      const id = asNonEmptyString(sessionID);
      if (id && isPlainObject(value)) result.set(id, value);
    }
    return result;
  };

  /**
   * Resolves once the legacy file has been read. A read failure rejects and
   * lets the next call retry: writing while the file is unknown could push an
   * older record over one the file still holds, or the file's older record over
   * a newer write later on.
   */
  const loadLegacy = () => {
    if (!legacyLoad) {
      legacyLoad = (async () => {
        let raw;
        try {
          raw = await fsPromises.readFile(legacyPath, 'utf8');
        } catch (error) {
          if (error?.code === 'ENOENT') return;
          throw new Error(`session metadata is unavailable: ${error?.message ?? error}`);
        }
        try {
          for (const [id, metadata] of parseLegacy(raw)) unmigrated.set(id, metadata);
        } catch (error) {
          // Unreadable bytes are kept for the user; there is nothing to migrate.
          const backup = `${legacyPath}.corrupt-${now()}`;
          await fsPromises.rename(legacyPath, backup);
          console.warn(`[openchamber-sessions] legacy session metadata was unreadable and was moved to ${backup}: ${error?.message ?? error}`);
        }
      })().catch((error) => {
        legacyLoad = null;
        throw error;
      });
    }
    return legacyLoad;
  };

  /** Writes what is left to migrate, or retires the file once nothing is. */
  const persistLegacy = async () => {
    if (unmigrated.size === 0) {
      await fsPromises.rename(legacyPath, `${legacyPath}.migrated`).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      return;
    }
    const tmpPath = `${legacyPath}.${process.pid}.tmp`;
    await fsPromises.writeFile(tmpPath, JSON.stringify(Object.fromEntries(unmigrated)), 'utf8');
    await fsPromises.rename(tmpPath, legacyPath);
  };

  /** Retire one entry durably before any ordinary write to that session. */
  const forgetLegacy = async (id) => {
    await runFileWrite(async () => {
      if (!unmigrated.has(id)) return;
      const previous = unmigrated.get(id);
      unmigrated.delete(id);
      try {
        await persistLegacy();
      } catch (error) {
        unmigrated.set(id, previous);
        throw error;
      }
    });
  };

  const ensureMigrated = async (sessionID, { directory = '', expectedIdentity } = {}) => {
    const id = asNonEmptyString(sessionID);
    if (!id) throw new Error('a session id is required to migrate session metadata');
    await loadLegacy();
    if (!unmigrated.has(id)) return;
    await runForSession(id, async () => {
      if (!unmigrated.has(id)) return;
      const identity = expectedIdentity ?? openCode.captureIdentity?.();
      await openCode.writeLegacy(id, unmigrated.get(id), { directory, expectedIdentity: identity });
      await forgetLegacy(id);
    });
  };

  /**
   * The session's full metadata after preparing its legacy entry. Returns `{}`
   * when OpenCode does not know the session and throws on read or migration failure.
   */
  const get = async (sessionID, { directory = '' } = {}) => {
    const id = asNonEmptyString(sessionID);
    if (!id) return {};
    await ensureMigrated(id, { directory });
    return (await openCode.read(id, { directory })) ?? {};
  };

  /**
   * Sends a patch to the kernel writer and returns the full metadata afterwards.
   * A failed read stops the write so missing state never becomes an empty base.
   */
  const setSessionMetadata = async (sessionID, patch, { directory = '' } = {}) => {
    const id = asNonEmptyString(sessionID);
    if (!id) throw new Error('a session id is required to store session metadata');
    if (!isPlainObject(patch)) throw new Error('a session metadata patch must be an object');
    const expectedIdentity = openCode.captureIdentity?.();
    await ensureMigrated(id, { directory, expectedIdentity });
    if (await openCode.read(id, { directory }) === null) throw new Error(`session ${id} was not found`);
    await openCode.write(id, patch, { directory, expectedIdentity });
    const metadata = await openCode.read(id, { directory });
    if (metadata === null) throw new Error(`session ${id} was not found`);
    return metadata;
  };

  /**
   * Pushes every legacy entry to OpenCode. A session OpenCode no longer knows
   * has nothing to receive its metadata, so its entry is dropped. Any other
   * failure keeps the entry for the next sweep. Resolves the number of entries
   * still waiting.
   */
  const migrateLegacy = async () => {
    const expectedIdentity = openCode.captureIdentity?.();
    await loadLegacy();
    const pending = [...unmigrated.keys()];
    if (pending.length === 0) return 0;
    await Promise.all(pending.map(async (id) => {
      try {
        await ensureMigrated(id, { expectedIdentity });
      } catch (error) {
        if (!isSessionNotFound(error)) {
          console.warn(`[openchamber-sessions] could not migrate metadata for ${id}:`, error?.message ?? error);
          return;
        }
        await forgetLegacy(id);
      }
    }));
    return unmigrated.size;
  };

  /**
   * `{ [sessionID]: metadata }` for sessions whose metadata still lives in the
   * legacy file. The proxy lays these over OpenCode's records until they are
   * migrated; empty once migration is done.
   */
  const listUnmigrated = async () => {
    await loadLegacy();
    return Object.fromEntries(unmigrated);
  };

  return {
    get,
    ensureMigrated,
    setSessionMetadata,
    migrateLegacy,
    listUnmigrated,
    legacyPath,
  };
};
