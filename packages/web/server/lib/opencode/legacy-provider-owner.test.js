import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLegacyProviderConfig } from './legacy-provider-config.js';
import { createLegacyCredentials } from './legacy-credentials.js';
import { createLegacyCredentialOperations } from './legacy-credential-operations.js';
import { readLegacyConfigLayers } from './legacy-config-layers.js';

const descriptor = Object.freeze({ generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'http://legacy.test:4096', epoch: 4 });
const roots = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-provider-owner-e2e-'));
  roots.push(root);
  const paths = {
    config: path.join(root, 'native-home', '.config', 'opencode'),
    home: path.join(root, 'native-home'),
    directory: path.join(root, 'project'),
    worktree: path.join(root, 'project'),
  };
  await fs.mkdir(paths.config, { recursive: true });
  await fs.mkdir(paths.directory, { recursive: true });
  const owner = { id: Symbol('native-process'), env: { USERPROFILE: paths.home }, cwd: paths.directory };
  const backend = { family: 'opencode', revision: 9 };
  const listeners = new Set();
  const requests = [];
  const removals = [];
  const input = {
    getNativeConfigContext: () => owner,
    getRuntime: () => descriptor,
    getBackendSelection: () => backend,
    getHeaders: () => ({ authorization: 'Bearer controlled-test' }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    fetchImpl: async request => {
      requests.push(request);
      if (request.method === 'DELETE') {
        const auth = path.join(paths.home, '.local', 'share', 'opencode', 'auth.json');
        const entries = JSON.parse(await fs.readFile(auth, 'utf8'));
        delete entries.acme;
        await fs.writeFile(auth, JSON.stringify(entries), 'utf8');
      }
      return new Response(JSON.stringify(true), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    operations: {},
  };
  const credentials = createLegacyCredentials(input);
  const credentialOperations = createLegacyCredentialOperations(input);
  input.credentials = credentials;
  input.operations = {
    async getLegacyConfiguration() {
      const { layers } = await readLegacyConfigLayers({ paths, env: owner.env, cwd: owner.cwd, nativeHome: owner.env.USERPROFILE });
      return { ...descriptor, data: {
        paths,
        providerIds: [...new Set(layers.flatMap(layer => Object.keys(layer.config.provider ?? {})))],
        hasPlugins: false,
        providerEnv: { acme: [] },
      } };
    },
    async compareLegacyProvider({ value, baseline }) { return { ...descriptor, data: { matchesPersisted: true, matchesBaseline: baseline !== undefined, present: value !== undefined } }; },
    removeLegacyCredential: request => { removals.push(request); return credentialOperations.remove(request); },
  };
  return { root, paths, owner, backend, listeners, requests, removals, credentials, api: createLegacyProviderConfig(input) };
}

async function put(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

function authPath(state) {
  return path.join(state.paths.home, '.local', 'share', 'opencode', 'auth.json');
}

afterEach(async () => Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))));

describe('legacy provider owner integration', () => {
  it('reports real config and auth sources without exposing environment or credential values', async () => {
    const state = await fixture();
    const config = path.join(state.paths.config, 'opencode.jsonc');
    await put(config, '{"provider":{"acme":{"options":{"key":"{env:ACME_KEY}"}}}}');
    state.owner.env.ACME_KEY = 'private-environment-value';
    await put(authPath(state), JSON.stringify({ acme: { type: 'api', key: 'private-credential-value' } }));

    const result = await state.api.sources('acme', state.paths.directory);

    expect(result.layers).toEqual([expect.objectContaining({ path: config, scope: 'user', writable: true })]);
    expect(result.auth).toEqual({ exists: true });
    expect(JSON.stringify(result)).not.toContain('private-environment-value');
    expect(JSON.stringify(result)).not.toContain('private-credential-value');
    expect(state.requests).toHaveLength(0);
  });

  it('removes every writable config definition and dispatches one identity-bound SDK DELETE', async () => {
    const state = await fixture();
    const global = path.join(state.paths.config, 'opencode.jsonc');
    const project = path.join(state.paths.directory, '.opencode', 'opencode.json');
    await put(global, '{\n  // keep\n  "provider": { "acme": { "enabled": true }, "other": {} }\n}\n');
    await put(project, '{"provider":{"acme":{"enabled":true}}}');
    await put(authPath(state), JSON.stringify({ acme: { type: 'api', key: 'private-credential-value' } }));

    const result = await state.api.disconnect('acme', state.paths.directory);

    expect(result).toMatchObject({ persisted: true, requiresRestart: true, removed: [global, project], credential: 'removed' });
    expect(await fs.readFile(global, 'utf8')).toContain('// keep');
    expect(await fs.readFile(global, 'utf8')).toContain('"other"');
    expect(await fs.readFile(global, 'utf8')).not.toContain('"acme"');
    expect(await fs.readFile(project, 'utf8')).not.toContain('"acme"');
    expect(state.removals).toHaveLength(1);
    expect(state.removals[0]).toMatchObject({ providerID: 'acme', directory: state.paths.directory, expectedIdentity: descriptor });
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0].method).toBe('DELETE');
    expect(state.requests[0].url).toBe('http://legacy.test:4096/auth/acme');
    expect(state.removals).toHaveLength(1);
    expect(state.removals[0]).toMatchObject({ providerID: 'acme', directory: state.paths.directory, expectedIdentity: descriptor });
    expect(state.requests[0].headers.get('authorization')).toBe('Bearer controlled-test');
    expect(await fs.readFile(authPath(state), 'utf8')).toBe('{}');
  });

  it('retains config changes and reports unknown credentials when the accepted DELETE response is lost', async () => {
    const state = await fixture();
    const config = path.join(state.paths.config, 'opencode.jsonc');
    await put(config, '{"provider":{"acme":{"enabled":true}}}');
    await put(authPath(state), JSON.stringify({ acme: { type: 'api', key: 'private-credential-value' } }));
    state.requests.splice(0);
    const removals = [];
    const credentialOperations = createLegacyCredentialOperations({
      getRuntime: () => descriptor,
      getNativeConfigContext: () => state.owner,
      getBackendSelection: () => state.backend,
      getHeaders: () => ({ authorization: 'Bearer controlled-test' }),
      subscribe: listener => { state.listeners.add(listener); return () => state.listeners.delete(listener); },
      fetchImpl: async request => {
        state.requests.push(request);
        const entries = JSON.parse(await fs.readFile(authPath(state), 'utf8'));
        delete entries.acme;
        await fs.writeFile(authPath(state), JSON.stringify(entries), 'utf8');
        throw new Error('response lost after server accepted DELETE');
      },
    });
    const credentials = createLegacyCredentials({
      getRuntime: () => descriptor,
      getNativeConfigContext: () => state.owner,
      getBackendSelection: () => state.backend,
    });
    const api = createLegacyProviderConfig({
      getRuntime: () => descriptor,
      getNativeConfigContext: () => state.owner,
      getBackendSelection: () => state.backend,
      credentials,
      operations: {
        async getLegacyConfiguration() {
          const { layers } = await readLegacyConfigLayers({ paths: state.paths, env: state.owner.env, cwd: state.owner.cwd, nativeHome: state.owner.env.USERPROFILE });
          return { ...descriptor, data: { paths: state.paths, providerIds: layers.flatMap(layer => Object.keys(layer.config.provider ?? {})), hasPlugins: false, providerEnv: { acme: [] } } };
        },
        async compareLegacyProvider({ value, baseline }) { return { ...descriptor, data: { matchesPersisted: true, matchesBaseline: baseline !== undefined, present: value !== undefined } }; },
        removeLegacyCredential: request => { removals.push(request); return credentialOperations.remove(request); },
      },
    });

    await expect(api.disconnect('acme', state.paths.directory)).rejects.toMatchObject({
      statusCode: 502,
      outcome: { persisted: false, partial: true, removed: [config], credential: 'unknown', requiresRestart: true },
    });
    expect(await fs.readFile(config, 'utf8')).not.toContain('"acme"');
    expect(await fs.readFile(authPath(state), 'utf8')).toBe('{}');
    expect(removals).toHaveLength(1);
    expect(removals[0]).toMatchObject({ providerID: 'acme', directory: state.paths.directory, expectedIdentity: descriptor });
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0].method).toBe('DELETE');
  });

  it('blocks a retired native process before any file or SDK mutation', async () => {
    const state = await fixture();
    const config = path.join(state.paths.config, 'opencode.jsonc');
    const auth = authPath(state);
    const originalConfig = '{"provider":{"acme":{"enabled":true}}}';
    const originalAuth = JSON.stringify({ acme: { type: 'api', key: 'private-credential-value' } });
    await put(config, originalConfig);
    await put(auth, originalAuth);
    const api = createLegacyProviderConfig({
      getRuntime: () => descriptor,
      getNativeConfigContext: () => state.owner,
      getBackendSelection: () => state.backend,
      credentials: state.credentials,
      operations: {
        async getLegacyConfiguration() {
          const { layers } = await readLegacyConfigLayers({ paths: state.paths, env: state.owner.env, cwd: state.owner.cwd, nativeHome: state.owner.env.USERPROFILE });
          return { ...descriptor, data: { paths: state.paths, providerIds: layers.flatMap(layer => Object.keys(layer.config.provider ?? {})), hasPlugins: false, providerEnv: { acme: [] } } };
        },
        async compareLegacyProvider({ value, baseline }) {
          state.owner.id = Symbol('retired-process');
          for (const listener of [...state.listeners]) listener();
          return { ...descriptor, data: { matchesPersisted: true, matchesBaseline: baseline !== undefined, present: value !== undefined } };
        },
        removeLegacyCredential: request => state.requests.push(request),
      },
    });

    await expect(api.disconnect('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 409 });
    expect(await fs.readFile(config, 'utf8')).toBe(originalConfig);
    expect(await fs.readFile(auth, 'utf8')).toBe(originalAuth);
    expect(state.requests).toHaveLength(0);
  });

  it('refuses a non-OpenCode backend before reading or mutating native sources', async () => {
    const state = await fixture();
    const config = path.join(state.paths.config, 'opencode.jsonc');
    const original = '{"provider":{"acme":{"enabled":true}}}';
    await put(config, original);
    state.backend.family = 'cagent';

    await expect(state.api.disconnect('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 501 });
    expect(await fs.readFile(config, 'utf8')).toBe(original);
    expect(state.requests).toHaveLength(0);
  });
});
