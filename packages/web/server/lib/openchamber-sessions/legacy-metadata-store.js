import crypto from 'node:crypto';
import fsDefault from 'node:fs';
import pathDefault from 'node:path';
import { z } from 'zod';

import { mergeMetadataPatch } from './session-metadata-store.js';

const STORE_DIR = 'legacy-session-metadata';

const required = (value, name) => {
  const parsed = z.string().trim().min(1).safeParse(value);
  if (!parsed.success) throw new Error(`${name} is required`);
  return parsed.data;
};

const isObject = (value) => z.object({}).passthrough().safeParse(value).success;
const clone = (value) => structuredClone(value);

export const createLegacyMetadataStore = ({
  dataDir,
  fsPromises = fsDefault.promises,
  pathModule = pathDefault,
}) => {
  const owners = new Map();

  const ownerFor = (scope) => {
    const key = required(scope, 'scope');
    let owner = owners.get(key);
    if (!owner) {
      const name = `${crypto.createHash('sha256').update(key).digest('hex')}.json`;
      owner = {
        file: pathModule.join(dataDir, STORE_DIR, name),
        data: null,
        chain: Promise.resolve(),
      };
      owners.set(key, owner);
    }
    return owner;
  };

  const run = (owner, work) => {
    const next = owner.chain.then(work, work);
    owner.chain = next.then(() => undefined, () => undefined);
    return next;
  };

  const load = async (owner) => {
    if (owner.data !== null) return owner.data;
    let raw;
    try {
      raw = await fsPromises.readFile(owner.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        owner.data = {};
        return owner.data;
      }
      throw new Error(`legacy session metadata is unavailable: ${error?.message ?? error}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`legacy session metadata is malformed: ${error?.message ?? error}`);
    }
    if (!isObject(parsed) || Object.values(parsed).some((value) => !isObject(value))) {
      throw new Error('legacy session metadata must contain metadata objects');
    }
    owner.data = parsed;
    return owner.data;
  };

  const read = (scope, sessionID) => {
    const owner = ownerFor(scope);
    const id = required(sessionID, 'sessionID');
    return run(owner, async () => {
      const data = await load(owner);
      return clone(data[id] ?? {});
    });
  };

  const patch = (scope, sessionID, metadata, { replace = false, check = () => {} } = {}) => {
    const owner = ownerFor(scope);
    const id = required(sessionID, 'sessionID');
    if (!isObject(metadata)) throw new Error('metadata must be an object');
    return run(owner, async () => {
      check();
      const data = await load(owner);
      check();
      const nextMetadata = replace ? clone(metadata) : mergeMetadataPatch(data[id] ?? {}, metadata);
      const next = { ...data, [id]: nextMetadata };
      if (replace && Object.keys(nextMetadata).length === 0) delete next[id];
      await fsPromises.mkdir(pathModule.dirname(owner.file), { recursive: true });
      check();
      const temp = `${owner.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        await fsPromises.writeFile(temp, JSON.stringify(next), { encoding: 'utf8', flag: 'wx' });
        check();
        await fsPromises.rename(temp, owner.file);
      } catch (error) {
        await fsPromises.rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      owner.data = next;
      return clone(nextMetadata);
    });
  };

  return { read, patch };
};
