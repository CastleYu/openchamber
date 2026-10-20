import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { AGENT_FAMILY } from '../agent/constants.js';
import { supportsLegacyStream } from './legacy-contract.js';

const FIELD = Object.freeze({ TYPE: 'type', KEY: 'key', REFRESH: 'refresh', ACCESS: 'access', EXPIRES: 'expires', ACCOUNT: 'accountId', ENTERPRISE: 'enterpriseUrl', TOKEN: 'token', XDG_DATA: 'XDG_DATA_HOME', USERPROFILE: 'USERPROFILE', AUTH: 'auth.json', OPENCODE: 'opencode', LOCAL: '.local', SHARE: 'share' });
const AUTH_TYPE = Object.freeze({ API: 'api', OAUTH: 'oauth', WELLKNOWN: 'wellknown' });
const STATUS = Object.freeze({ UNSUPPORTED: 501, CHANGED: 409, READ: 500 });
const string = z.string();
const credentialSchema = z.discriminatedUnion(FIELD.TYPE, [
  z.object({ [FIELD.TYPE]: z.literal(AUTH_TYPE.API), [FIELD.KEY]: string }),
  z.object({ [FIELD.TYPE]: z.literal(AUTH_TYPE.OAUTH), [FIELD.REFRESH]: string, [FIELD.ACCESS]: string, [FIELD.EXPIRES]: z.number(), [FIELD.ACCOUNT]: string.optional(), [FIELD.ENTERPRISE]: string.optional() }),
  z.object({ [FIELD.TYPE]: z.literal(AUTH_TYPE.WELLKNOWN), [FIELD.KEY]: string, [FIELD.TOKEN]: string }),
]);
const credentialsSchema = z.record(string, credentialSchema);
const nativeSchema = z.object({ id: z.symbol(), env: z.record(string, string.optional()), cwd: string });

function failure(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
function unsupported() { return failure(STATUS.UNSUPPORTED, 'Native legacy credentials are unavailable'); }
function changed() { return failure(STATUS.CHANGED, 'OpenCode credential owner changed'); }
function readFailure() { return failure(STATUS.READ, 'Unable to read OpenCode credentials'); }
function native(input) {
  const parsed = nativeSchema.safeParse(input.getNativeConfigContext());
  return parsed.success ? { id: parsed.data.id, env: { ...parsed.data.env }, cwd: parsed.data.cwd } : null;
}
function sameNative(left, right) {
  return Boolean(left && right && left.id === right.id && left.cwd === right.cwd);
}
function capture(input) {
  const owner = native(input);
  const runtime = input.getRuntime();
  const backend = input.getBackendSelection?.();
  if (!owner || !path.isAbsolute(owner.cwd) || !supportsLegacyStream(runtime)
    || (input.getBackendSelection && (!backend || backend.family !== AGENT_FAMILY.OPENCODE))) throw unsupported();
  return {
    owner,
    generation: runtime.generation,
    profile: runtime.profile,
    version: runtime.version,
    endpoint: runtime.endpoint,
    epoch: runtime.epoch,
    family: backend?.family,
    revision: backend?.revision,
  };
}
function check(input, snapshot) {
  const owner = native(input);
  const runtime = input.getRuntime();
  const backend = input.getBackendSelection?.();
  if (!sameNative(owner, snapshot.owner) || !supportsLegacyStream(runtime)
    || runtime.generation !== snapshot.generation || runtime.profile !== snapshot.profile
    || runtime.version !== snapshot.version || runtime.endpoint !== snapshot.endpoint || runtime.epoch !== snapshot.epoch
    || (input.getBackendSelection && (!backend || backend.family !== snapshot.family || backend.revision !== snapshot.revision))) throw changed();
}
function authPath(owner) {
  if (process.platform !== 'win32') throw unsupported();
  const xdg = owner.env[FIELD.XDG_DATA];
  let dataHome;
  if (xdg) dataHome = path.resolve(owner.cwd, xdg);
  else {
    const home = owner.env[FIELD.USERPROFILE];
    if (!home || !path.isAbsolute(home)) throw unsupported();
    dataHome = path.join(home, FIELD.LOCAL, FIELD.SHARE);
  }
  return path.join(dataHome, FIELD.OPENCODE, FIELD.AUTH);
}

function createLegacyCredentials({ getRuntime, getNativeConfigContext, getBackendSelection, readFile = fs.readFile }) {
  const input = { getRuntime, getNativeConfigContext, getBackendSelection };
  return {
    async read() {
      const snapshot = capture(input);
      const file = authPath(snapshot.owner);
      let content;
      try {
        content = await readFile(file, 'utf8');
      } catch (error) {
        check(input, snapshot);
        if (error?.code === 'ENOENT') return {};
        throw readFailure();
      }
      check(input, snapshot);
      try {
        const parsed = credentialsSchema.safeParse(JSON.parse(content));
        if (!parsed.success) throw readFailure();
        return parsed.data;
      } catch {
        throw readFailure();
      }
    },
  };
}

export { createLegacyCredentials };
