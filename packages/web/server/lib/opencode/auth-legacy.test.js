import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLegacyCredentials } from './legacy-credentials.js';
import { configureOpenCodeCredentials, readOpenCodeCredentials, getProviderAuth, readAuthFile, writeAuthFile, getOpenCodeCredentialGeneration } from './auth.js';

const runtime = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'http://127.0.0.1:4096', epoch: 1 };
let root;
afterEach(async () => {
  configureOpenCodeCredentials(() => ({ generation: 'oc1' }), null);
  if (root) { await fs.rm(root, { recursive: true, force: true }); root = null; }
});
describe.skipIf(process.platform !== 'win32')('shared Legacy credential composition', () => {
  it('reads the selected native file for actual public consumers and retains local-write guards', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-auth-composition-'));
    const context = { id: Symbol('native'), env: { XDG_DATA_HOME: root }, cwd: root };
    const owner = createLegacyCredentials({ getRuntime: () => runtime, getNativeConfigContext: () => context });
    configureOpenCodeCredentials(() => runtime, null, owner);
    await expect(readOpenCodeCredentials()).resolves.toEqual({});
    const file = path.join(root, 'opencode', 'auth.json');
    await fs.mkdir(path.dirname(file));
    const entry = { type: 'oauth', refresh: 'fixture-r', access: 'fixture-a', expires: 123 };
    await fs.writeFile(file, JSON.stringify({ provider: entry }));
    await expect(readOpenCodeCredentials()).resolves.toEqual({ provider: entry });
    await expect(getProviderAuth('provider')).resolves.toEqual(entry);
    await expect(getProviderAuth('absent')).resolves.toBeNull();
    await expect(getProviderAuth('toString')).resolves.toBeNull();
    expect(() => readAuthFile()).toThrow('Legacy credential access');
    expect(() => writeAuthFile({})).toThrow('Legacy credential access');
    expect(() => getOpenCodeCredentialGeneration()).toThrow('Legacy credential access');
  });
});
describe('shared Legacy reader retirement', () => {
  it.each(['all', 'provider'])('rejects a replaced %s reader even when runtime identity stays equal', async kind => {
    let finish;
    const first = { read: () => new Promise(resolve => { finish = resolve; }) };
    configureOpenCodeCredentials(() => runtime, null, first);
    const pending = kind === 'all' ? readOpenCodeCredentials() : getProviderAuth('provider');
    configureOpenCodeCredentials(() => runtime, null, { read: async () => ({}) });
    finish({ provider: { type: 'api', key: 'old' } });
    await expect(pending).rejects.toMatchObject({ statusCode: 409 });
  });
  it.each(['profile', 'version', 'endpoint', 'epoch'])('retires a late failure after %s changes', async field => {
    let selected = { ...runtime };
    let fail;
    configureOpenCodeCredentials(() => selected, null, { read: () => new Promise((resolve, reject) => { fail = reject; }) });
    const pending = readOpenCodeCredentials();
    selected = { ...selected, [field]: 'changed' };
    fail(new Error('unrelated read failure'));
    await expect(pending).rejects.toMatchObject({ statusCode: 409 });
  });
  it('does not admit a different Legacy version through an installed reader', async () => {
    let calls = 0;
    configureOpenCodeCredentials(() => ({ ...runtime, version: '1.2.28' }), null, { read: async () => { calls++; return {}; } });
    await expect(readOpenCodeCredentials()).rejects.toMatchObject({ statusCode: 501 });
    expect(calls).toBe(0);
  });
});
