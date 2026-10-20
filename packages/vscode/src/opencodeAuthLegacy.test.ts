import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureOpenCodeCredentialSource, readOpenCodeCredentials, getOpenCodeProviderAuth } from './opencodeAuth';
import { configureOpenCodeCredentials } from '../../web/server/lib/opencode/auth.js';
import type { OpenCodeGenerationDescriptor } from '../../web/server/lib/opencode/compatibility.js';

let root: string | null = null;
afterEach(async () => {
  configureOpenCodeCredentials(() => ({ generation: 'oc1' }), null);
  if (root) { await fs.rm(root, { recursive: true, force: true }); root = null; }
});
describe('VS Code Legacy native credential composition', { skip: process.platform !== 'win32' }, () => {
  it('uses manager native context, revokes it on retirement, and refuses external fallback', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-auth-'));
    const runtime: OpenCodeGenerationDescriptor = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'http://127.0.0.1:4096', epoch: 1 };
    let context: { id: symbol; env: NodeJS.ProcessEnv; cwd: string } | null = { id: Symbol('native'), env: { XDG_DATA_HOME: root }, cwd: root };
    const manager = {
      getApiUrl: () => runtime.endpoint,
      getKernelRuntime: () => runtime,
      getNativeConfigContext: () => context,
      getOpenCodeAuthHeaders: () => ({}),
      getManagedLaunchEnvironment: () => context?.env ?? null,
    };
    configureOpenCodeCredentialSource(manager);
    const file = path.join(root, 'opencode', 'auth.json');
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(file, JSON.stringify({ provider: { type: 'api', key: 'fixture-only' } }));
    assert.deepEqual(await readOpenCodeCredentials(), { provider: { type: 'api', key: 'fixture-only' } });
    assert.deepEqual(await getOpenCodeProviderAuth('provider'), { type: 'api', key: 'fixture-only' });
    context = null;
    await assert.rejects(readOpenCodeCredentials(), { statusCode: 501 });
    await assert.rejects(getOpenCodeProviderAuth('provider'), { statusCode: 501 });
  });
});
