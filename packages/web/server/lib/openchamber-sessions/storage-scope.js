import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const OWNER_FILE = 'sessions-storage-owner.json';

/** The root files belong to exactly one OC2 storage scope. */
export const createSessionStorageScopes = ({ dataDir, fsPromises = fs, pathModule = path }) => {
  const ownerPath = pathModule.join(dataDir, OWNER_FILE);
  let ownerPromise;
  const owner = async () => {
    if (!ownerPromise) {
      ownerPromise = (async () => {
        try {
          const parsed = JSON.parse(await fsPromises.readFile(ownerPath, 'utf8'));
          if (!parsed || parsed.version !== 1 || !parsed.scope) throw new Error('Invalid session storage owner');
          return parsed.scope;
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
          return null;
        }
      })().catch((error) => { ownerPromise = null; throw error; });
    }
    return ownerPromise;
  };

  let claiming = Promise.resolve();
  const claim = (scope) => {
    const work = async () => {
      const existing = await owner();
      if (existing) return existing;
      await fsPromises.mkdir(dataDir, { recursive: true });
      try {
        await fsPromises.writeFile(ownerPath, JSON.stringify({ version: 1, scope }), { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        ownerPromise = null;
        return owner();
      }
      ownerPromise = Promise.resolve(scope);
      return scope;
    };
    const next = claiming.then(work, work);
    claiming = next.then(() => undefined, () => undefined);
    return next;
  };

  const directory = async (scope) => {
    if (!scope) throw new Error('OC2 storage scope is required');
    const first = await claim(scope);
    if (first === scope) return dataDir;
    const digest = createHash('sha256').update(scope).digest('hex');
    return pathModule.join(dataDir, 'session-scopes', digest);
  };
  return { directory, ownerPath };
};
