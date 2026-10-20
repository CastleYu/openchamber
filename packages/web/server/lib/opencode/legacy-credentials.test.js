import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_FAMILY } from '../agent/constants.js';
import { createLegacyCredentials } from './legacy-credentials.js';

const RUNTIME = Object.freeze({ generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'http://127.0.0.1:4096', epoch: 1 });
const roots = [];
const credential = Object.freeze({ api: { type: 'api', key: 'key' }, oauth: { type: 'oauth', refresh: 'refresh', access: 'access', expires: 123, accountId: 'acct', enterpriseUrl: 'https://example.test' }, wellknown: { type: 'wellknown', key: 'key', token: 'token' } });
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function fixture({ env = {}, runtime = { ...RUNTIME }, native = true, backend = { family: AGENT_FAMILY.OPENCODE, revision: 1 } } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-legacy-auth-'));
  roots.push(root);
  const context = { id: Symbol('native'), env: { ...env }, cwd: root };
  const state = { runtime, context: native ? context : null, backend };
  const owner = createLegacyCredentials({ getRuntime: () => state.runtime, getNativeConfigContext: () => state.context, getBackendSelection: () => state.backend });
  return { owner, state, root, context };
}
async function seed(root, env, value) {
  const home = env.XDG_DATA_HOME ? path.resolve(root, env.XDG_DATA_HOME) : path.join(env.USERPROFILE, '.local', 'share');
  const file = path.join(home, 'opencode', 'auth.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value, 'utf8');
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('createLegacyCredentials', () => {
  it('reads all three credential types and preserves known fields', async () => {
    const { owner, root, context } = await fixture();
    context.env = { USERPROFILE: root };
    await seed(root, context.env, JSON.stringify(credential));
    expect(await owner.read()).toEqual(credential);
  });

  it('uses nonempty XDG_DATA_HOME resolved from the native cwd', async () => {
    const env = { XDG_DATA_HOME: 'data-home' };
    const { owner, root } = await fixture({ env });
    await seed(root, env, JSON.stringify({ api: credential.api }));
    expect(await owner.read()).toEqual({ api: credential.api });
  });

  it('returns empty only when the selected auth file is missing', async () => {
    const { owner, root, context } = await fixture();
    context.env = { USERPROFILE: root };
    await expect(owner.read()).resolves.toEqual({});
  });

  it.each(['', '{', '[]', '{"p":{"type":"api"}}'])('rejects blank, malformed, root, or credential schema data', async (content) => {
    const { owner, root, context } = await fixture();
    context.env = { USERPROFILE: root };
    await seed(root, context.env, content);
    await expect(owner.read()).rejects.toMatchObject({ statusCode: 500, message: 'Unable to read OpenCode credentials' });
  });

  it.each([
    ['no native context', { native: false }],
    ['wrong profile', { runtime: { ...RUNTIME, profile: 'oc1' } }],
    ['wrong version', { runtime: { ...RUNTIME, version: '1.2.28' } }],
    ['Cagent family', { backend: { family: 'cagent', revision: 1 } }],
  ])('refuses %s', async (_label, options) => {
    const { owner } = await fixture(options);
    await expect(owner.read()).rejects.toMatchObject({ statusCode: 501 });
  });

  it('refuses missing or nonabsolute USERPROFILE when XDG_DATA_HOME is empty', async () => {
    for (const env of [{}, { USERPROFILE: 'relative' }, { USERPROFILE: '' }]) {
      const { owner } = await fixture({ env });
      await expect(owner.read()).rejects.toMatchObject({ statusCode: 501 });
    }
  });

  it('rejects relative native cwd', async () => {
    const { owner, context } = await fixture();
    context.cwd = 'relative';
    await expect(owner.read()).rejects.toMatchObject({ statusCode: 501 });
  });

  it('rejects non-ENOENT read errors without exposing the underlying error', async () => {
    const { state, context } = await fixture();
    context.env = { USERPROFILE: 'C:\\Users\\isolated' };
    const owner = createLegacyCredentials({ getRuntime: () => state.runtime, getNativeConfigContext: () => context, getBackendSelection: () => state.backend, readFile: async () => { throw new Error('secret path token'); } });
    await expect(owner.read()).rejects.toMatchObject({ statusCode: 500, message: 'Unable to read OpenCode credentials' });
  });

  it.each(['runtime', 'native symbol', 'backend revision'])('rejects an owner change during async file read: %s', async (change) => {
    const { state, context } = await fixture({ env: { USERPROFILE: 'C:\\Users\\isolated' } });
    const pending = deferred();
    const owner = createLegacyCredentials({ getRuntime: () => state.runtime, getNativeConfigContext: () => state.context, getBackendSelection: () => state.backend, readFile: () => pending.promise });
    const read = owner.read();
    if (change === 'runtime') state.runtime = { ...state.runtime, epoch: 2 };
    if (change === 'native symbol') state.context = { ...context, id: Symbol('replaced') };
    if (change === 'backend revision') state.backend = { ...state.backend, revision: 2 };
    pending.resolve(JSON.stringify(credential));
    await expect(read).rejects.toMatchObject({ statusCode: 409 });
  });

  it('checks retirement even when the asynchronous read fails', async () => {
    const { state } = await fixture({ env: { USERPROFILE: 'C:\\Users\\isolated' } });
    const pending = deferred();
    const owner = createLegacyCredentials({ getRuntime: () => state.runtime, getNativeConfigContext: () => state.context, getBackendSelection: () => state.backend, readFile: () => pending.promise });
    const read = owner.read();
    state.runtime = { ...state.runtime, endpoint: 'http://127.0.0.1:4097' };
    pending.reject(Object.assign(new Error('io failed'), { code: 'EACCES' }));
    await expect(read).rejects.toMatchObject({ statusCode: 409 });
  });

  it('supports a native VS Code owner without a backend selector', async () => {
    const { root, context, state } = await fixture();
    context.env = { USERPROFILE: root };
    await seed(root, context.env, JSON.stringify({ api: credential.api }));
    const owner = createLegacyCredentials({ getRuntime: () => state.runtime, getNativeConfigContext: () => context });
    await expect(owner.read()).resolves.toEqual({ api: credential.api });
  });
});
