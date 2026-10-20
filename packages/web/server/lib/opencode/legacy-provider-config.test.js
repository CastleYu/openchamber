import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLegacyProviderConfig } from './legacy-provider-config.js';
import { readLegacyConfigLayers } from './legacy-config-layers.js';

const roots = [];
const descriptor = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'http://127.0.0.1:4096', epoch: 'epoch-a' };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-provider-owner-'));
  roots.push(root);
  const paths = { config: path.join(root, 'config'), home: path.join(root, 'home'), directory: path.join(root, 'project'), worktree: path.join(root, 'project') };
  await Promise.all([fs.mkdir(paths.config, { recursive: true }), fs.mkdir(paths.directory, { recursive: true })]);
  const owner = { id: Symbol('native'), env: { USERPROFILE: path.join(root, 'native-home') }, cwd: paths.directory };
  const backend = { family: 'opencode', revision: 1 };
  const calls = [];
  const input = {
    getNativeConfigContext: () => owner,
    getRuntime: () => descriptor,
    getBackendSelection: () => backend,
    operations: {
      getLegacyConfiguration: async () => {
        const { layers } = await readLegacyConfigLayers({ paths, env: owner.env, cwd: owner.cwd, nativeHome: owner.env.USERPROFILE });
        return { ...descriptor, data: { paths, mcp: {},
          providerIds: [...new Set(layers.flatMap(layer => Object.keys(layer.config.provider ?? {})))],
          hasPlugins: false, providerEnv: { acme: [] },
        } };
      },
      compareLegacyProvider: async ({ value, baseline }) => ({ ...descriptor, data: { matchesPersisted: true, matchesBaseline: baseline !== undefined, present: value !== undefined } }),
      removeLegacyCredential: async (request) => { calls.push(request); return true; },
    },
    credentials: { read: async () => ({}) },
  };
  return { root, paths, owner, backend, calls, input, api: createLegacyProviderConfig(input) };
}

async function put(file, raw) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, raw, 'utf8');
}

async function missing(file) {
  await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe('createLegacyProviderConfig', () => {
  it('reports ordered sources and auth presence without exposing credential values', async () => {
    const state = await fixture();
    const global = path.join(state.paths.config, 'opencode.jsonc');
    const project = path.join(state.paths.directory, '.opencode', 'opencode.json');
    await put(global, '{\n  // keep comment\n  "provider": { "acme": { "options": { "key": "{env:API_KEY}" } } }\n}\n');
    await put(project, '{"provider":{"acme":{"enabled":true}}}');
    state.owner.env.API_KEY = 'private-value';
    state.input.credentials.read = async () => ({ acme: { key: 'credential-secret' } });
    const result = await state.api.sources('acme', state.paths.directory);
    expect(result).toEqual({ providerId: 'acme', layers: [
      expect.objectContaining({ path: global, scope: 'user', origin: 'global', order: 0, writable: true }),
      expect.objectContaining({ path: project, scope: 'project', origin: 'dot-directory', order: 1, writable: true }),
    ], auth: { exists: true }, complete: true, residuals: [], application: { configuration: 'matches-persisted' } });
    expect(JSON.stringify(result)).not.toContain('private-value');
    expect(JSON.stringify(result)).not.toContain('credential-secret');
  });

  it('deletes all writable definitions, keeps JSONC comments/placeholders, and removes auth once', async () => {
    const state = await fixture();
    const global = path.join(state.paths.config, 'opencode.jsonc');
    const project = path.join(state.paths.directory, '.opencode', 'opencode.json');
    const globalRaw = '{\n  // retain this note\n  "provider": { "acme": { "enabled": true }, "other": { "options": { "key": "{env:API_KEY}" } } }\n}\n';
    await put(global, globalRaw);
    await put(project, '{"provider":{"acme":{"enabled":true}}}');
    state.owner.env.OPENCODE_CONFIG = global;
    state.owner.env.API_KEY = 'private-value';
    state.input.credentials.read = async () => ({ acme: { token: 'credential-secret' } });
    const result = await state.api.disconnect('acme', state.paths.directory);
    expect(result).toMatchObject({ persisted: true, requiresRestart: true, removed: [global, project], credential: 'removed' });
    expect(await fs.readFile(global, 'utf8')).toContain('// retain this note');
    expect(await fs.readFile(global, 'utf8')).toContain('{env:API_KEY}');
    expect(await fs.readFile(global, 'utf8')).not.toContain('private-value');
    expect(await fs.readFile(global, 'utf8')).toContain('"other"');
    expect(await fs.readFile(project, 'utf8')).toMatch(/"provider"\s*:\s*\{\s*\}/);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({ providerID: 'acme', directory: state.paths.directory, expectedIdentity: descriptor });
    expect(JSON.stringify(state.calls)).not.toContain('credential-secret');
  });

  it('recognizes a persisted provider as pending restart only while raw layers and the SDK baseline still match', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    const raw = '{"provider":{"acme":{"enabled":true}}}';
    const baseline = { enabled: true };
    await put(file, raw);
    let cached = baseline;
    state.input.operations.compareLegacyProvider = async ({ value, baseline: expected }) => ({ ...descriptor, data: {
      matchesPersisted: JSON.stringify(cached) === JSON.stringify(value),
      matchesBaseline: expected !== undefined && JSON.stringify(cached) === JSON.stringify(expected.value),
      present: cached !== undefined,
    } });

    const disconnected = await state.api.disconnect('acme', state.paths.directory);
    expect(disconnected.application).toEqual({ configuration: 'pending-restart' });
    const pending = await state.api.sources('acme', state.paths.directory);
    expect(pending).toMatchObject({ application: { configuration: 'pending-restart' }, complete: true, residuals: [] });

    await fs.appendFile(file, '\n// external edit\n');
    const changed = await state.api.sources('acme', state.paths.directory);
    expect(changed).toMatchObject({ application: { configuration: 'unknown' }, complete: false, residuals: ['effective-config'] });

    await fs.writeFile(file, raw, 'utf8');
    await state.api.disconnect('acme', state.paths.directory);
    cached = { enabled: false };
    const mismatch = await state.api.sources('acme', state.paths.directory);
    expect(mismatch).toMatchObject({ application: { configuration: 'unknown' }, complete: false, residuals: ['effective-config'] });
  });

  it('rejects a concurrent disconnect before either operation can overlap writes', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    await put(file, '{"provider":{"acme":{"enabled":true}}}');
    let enter;
    let resume;
    const entered = new Promise(resolve => { enter = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    state.input.operations.compareLegacyProvider = async ({ value }) => {
      enter();
      await gate;
      return { ...descriptor, data: { matchesPersisted: value !== undefined, matchesBaseline: false, present: value !== undefined } };
    };

    const first = state.api.disconnect('acme', state.paths.directory);
    await entered;
    await expect(state.api.disconnect('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 409 });
    expect(await fs.readFile(file, 'utf8')).toContain('acme');
    resume();
    await expect(first).resolves.toMatchObject({ persisted: true });
    expect(await fs.readFile(file, 'utf8')).not.toContain('acme');
  });

  it('blocks unknown native credential deletion across project directories', async () => {
    const state = await fixture();
    const otherDirectory = path.join(state.root, 'other-project');
    await fs.mkdir(otherDirectory);
    await put(path.join(otherDirectory, 'opencode.json'), '{"provider":{"acme":{"enabled":true}}}');
    state.input.credentials.read = async () => ({ acme: { token: 'secret' } });
    state.input.operations.removeLegacyCredential = async () => { throw new Error('credential outcome unavailable'); };

    await expect(state.api.disconnect('acme', otherDirectory)).rejects.toMatchObject({ outcome: { credential: 'unknown' } });
    await expect(state.api.disconnect('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 409,
      outcome: { credential: 'unknown', partial: true } });
    expect(state.calls).toHaveLength(0);
  });

  it('serializes credential deletion across project directories for one native owner', async () => {
    const state = await fixture();
    const otherDirectory = path.join(state.root, 'other-project');
    await fs.mkdir(otherDirectory);
    await put(path.join(state.paths.config, 'opencode.json'), '{"provider":{"acme":{"enabled":true}}}');
    await put(path.join(otherDirectory, 'opencode.json'), '{"provider":{"acme":{"enabled":true}}}');
    state.input.credentials.read = async () => ({ acme: { token: 'secret' } });
    let enter;
    let resume;
    const entered = new Promise(resolve => { enter = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    state.input.operations.removeLegacyCredential = async () => { enter(); await gate; return true; };

    const first = state.api.disconnect('acme', otherDirectory);
    await entered;
    await expect(state.api.disconnect('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 409 });
    resume();
    await expect(first).resolves.toMatchObject({ persisted: true });
    expect(state.calls).toHaveLength(0);
  });

  it('clears deferred evidence when the same SDK response shows persisted configuration applied', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    await put(file, '{"provider":{"acme":{"enabled":true}}}');
    let cached = { enabled: true };
    state.input.operations.compareLegacyProvider = async ({ value, baseline }) => ({ ...descriptor, data: {
      matchesPersisted: JSON.stringify(cached) === JSON.stringify(value),
      matchesBaseline: baseline !== undefined && JSON.stringify(cached) === JSON.stringify(baseline.value), present: cached !== undefined,
    } });
    await state.api.disconnect('acme', state.paths.directory);
    expect((await state.api.sources('acme', state.paths.directory)).application.configuration).toBe('pending-restart');
    cached = undefined;
    expect((await state.api.sources('acme', state.paths.directory)).application.configuration).toBe('matches-persisted');
    expect((await state.api.sources('acme', state.paths.directory)).residuals).toEqual([]);
  });

  it('refuses read-only inline, managed, and expanded-only definitions before writes or auth removal', async () => {
    const state = await fixture();
    const managed = path.join(state.root, 'managed', 'opencode.json');
    state.owner.env.OPENCODE_CONFIG_CONTENT = '{"provider":{"acme":{"inline":true}}}';
    state.owner.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = path.dirname(managed);
    state.owner.env.API_PROVIDER = '{"acme":{"expanded":true}}';
    const expanded = path.join(state.paths.config, 'opencode.jsonc');
    await put(expanded, '{"provider":{env:API_PROVIDER}}');
    await put(managed, '{"provider":{"acme":{"managed":true}}}');
    state.input.credentials.read = async () => ({ acme: { token: 'secret' } });
    await expect(state.api.disconnect('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 501 });
    expect(await fs.readFile(expanded, 'utf8')).toBe('{"provider":{env:API_PROVIDER}}');
    expect(await fs.readFile(managed, 'utf8')).toBe('{"provider":{"acme":{"managed":true}}}');
    expect(state.calls).toHaveLength(0);
  });

  it('rejects invalid names and unsupported native, generation, version, and backend contexts', async () => {
    const state = await fixture();
    await expect(state.api.sources('', state.paths.directory)).rejects.toMatchObject({ statusCode: 400 });
    state.input.getNativeConfigContext = () => ({ id: Symbol('other'), env: {}, cwd: state.paths.directory });
    await expect(state.api.sources('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 501 });
    state.input.getNativeConfigContext = () => state.owner;
    state.input.getRuntime = () => ({ ...descriptor, profile: 'stable', version: '1.2.28' });
    await expect(state.api.sources('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 501 });
    state.input.getRuntime = () => descriptor;
    state.input.getNativeConfigContext = () => ({ id: Symbol('other'), env: {}, cwd: state.paths.directory });
    await expect(state.api.sources('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 501 });
    state.input.getNativeConfigContext = () => state.owner;
    state.backend.family = 'cagent';
    await expect(state.api.sources('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 501 });
  });

  it('preserves configuration and credentials when credential inspection fails', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    const raw = '{"provider":{"acme":{"enabled":true}}}';
    await put(file, raw);
    state.input.credentials.read = async () => { throw new Error('credential store unavailable'); };
    await expect(state.api.disconnect('acme', state.paths.directory)).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe(raw);
    expect(state.calls).toHaveLength(0);
  });

  it.each(['success', 'error'])('retires a read after native owner and runtime epoch change during %s', async (mode) => {
    const state = await fixture();
    const original = state.input.operations.getLegacyConfiguration;
    state.input.operations.getLegacyConfiguration = async (...args) => {
      state.owner.id = Symbol('retired');
      state.input.getRuntime = () => ({ ...descriptor, epoch: 'epoch-b' });
      if (mode === 'error') throw new Error('late operation error');
      return original(...args);
    };
    await expect(state.api.sources('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('returns an explicit partial outcome when credential removal fails after config deletion', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    await put(file, '{"provider":{"acme":{"enabled":true}}}');
    state.input.credentials.read = async () => ({ acme: { token: 'secret' } });
    let attempts = 0;
    state.input.operations.removeLegacyCredential = async () => { attempts += 1; throw new Error('credential removal failed'); };
    await expect(state.api.disconnect('acme', state.paths.directory)).rejects.toMatchObject({
      statusCode: 500,
      outcome: { persisted: false, removed: [file], remaining: [], credential: 'unknown' },
    });
    await expect(state.api.disconnect('acme', state.paths.directory)).rejects.toMatchObject({ statusCode: 409,
      outcome: { persisted: false, partial: true, removed: [file], remaining: [], credential: 'unknown', requiresRestart: true },
    });
    expect(attempts).toBe(1);
    expect(state.calls).toHaveLength(0);
    expect(await fs.readFile(file, 'utf8')).toMatch(/"provider"\s*:\s*\{\s*\}/);
  });

  it('reports unknown credential state if ownership changes during credential removal', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    await put(file, '{"provider":{"acme":{"enabled":true}}}');
    state.input.credentials.read = async () => ({ acme: { token: 'secret' } });
    state.input.operations.removeLegacyCredential = async () => { state.backend.revision += 1; return true; };
    await expect(state.api.disconnect('acme', state.paths.directory)).rejects.toMatchObject({
      statusCode: 409,
      outcome: { persisted: false, removed: [file], remaining: [], credential: 'unknown' },
    });
    expect(await fs.readFile(file, 'utf8')).toMatch(/"provider"\s*:\s*\{\s*\}/);
  });
  it.each(['environment', 'remote-config', 'plugins', 'effective-config', 'effective-values'])('refuses residual %s before any config or credential write', async residual => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    const raw = '{"provider":{"acme":{"enabled":true}}}';
    await put(file, raw);
    if (residual === 'effective-values') state.input.operations.compareLegacyProvider = async () => ({ ...descriptor, data: { matchesPersisted: false, matchesBaseline: false, present: true } });
    const original = state.input.operations.getLegacyConfiguration;
    if (residual === 'effective-config') state.input.operations.compareLegacyProvider = async () => ({ ...descriptor,
      data: { matchesPersisted: false, matchesBaseline: false, present: false } });
    state.input.operations.getLegacyConfiguration = async input => {
      const result = await original(input);
      if (residual === 'environment') result.data.providerEnv.acme = ['PRIVATE_API_KEY'];
      if (residual === 'plugins') result.data.hasPlugins = true;
      return result;
    };
    state.owner.env.PRIVATE_API_KEY = 'never-return-this';
    state.input.credentials.read = async () => residual === 'remote-config'
      ? { organization: { type: 'wellknown', key: 'organization', token: 'never-return-this' } }
      : { acme: { type: 'api', key: 'never-return-this' } };
    const sources = await state.api.sources('acme');
    expect(sources.complete).toBe(false);
    expect(sources.residuals).toContain(residual === 'effective-values' ? 'effective-config' : residual);
    expect(JSON.stringify(sources)).not.toContain('never-return-this');
    await expect(state.api.disconnect('acme')).rejects.toMatchObject({ statusCode: 501 });
    expect(await fs.readFile(file, 'utf8')).toBe(raw);
    expect(state.calls).toHaveLength(0);
  });

  it('reports the first committed file when a second file changes externally', async () => {
    const state = await fixture();
    const first = path.join(state.paths.config, 'opencode.jsonc');
    const second = path.join(state.paths.directory, 'opencode.json');
    await put(first, '{"provider":{"acme":{"enabled":true}}}');
    await put(second, '{"provider":{"acme":{"enabled":true}}}');
    let changed = false;
    state.input.getRuntime = () => {
      if (!changed && !fsSync.readFileSync(first, 'utf8').includes('acme')) {
        changed = true;
        fsSync.appendFileSync(second, '\n// external change\n');
      }
      return descriptor;
    };
    await expect(state.api.disconnect('acme')).rejects.toMatchObject({ statusCode: 409,
      outcome: { partial: true, requiresRestart: true, removed: [first], remaining: [second], credential: 'absent' },
    });
    expect(await fs.readFile(second, 'utf8')).toContain('acme');
    expect(state.calls).toHaveLength(0);
    expect((await fs.readdir(state.paths.config)).some(name => name.startsWith('.legacy-provider-'))).toBe(false);
  });

  it('preserves files and credentials on cancellation before dispatch', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    const raw = '{"provider":{"acme":{"enabled":true}}}';
    await put(file, raw);
    await expect(state.api.disconnect('acme', undefined, AbortSignal.abort())).rejects.toBeDefined();
    expect(await fs.readFile(file, 'utf8')).toBe(raw);
    expect(state.calls).toHaveLength(0);
  });

  it('rejects an unconfirmed official credential deletion result', async () => {
    const state = await fixture();
    state.input.credentials.read = async () => ({ acme: { type: 'api', key: 'secret' } });
    state.input.operations.removeLegacyCredential = async () => false;
    await expect(state.api.disconnect('acme')).rejects.toMatchObject({ statusCode: 500,
      outcome: { partial: true, requiresRestart: true, credential: 'unknown' },
    });
  });

  it('retains the original baseline on repeated no-op disconnect and clears it when SDK catches up', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    await put(file, '{"provider":{"acme":{"enabled":true}}}');
    let cached = { enabled: true };
    state.input.operations.compareLegacyProvider = async ({ value, baseline }) => ({ ...descriptor, data: {
      matchesPersisted: JSON.stringify(cached) === JSON.stringify(value),
      matchesBaseline: baseline !== undefined && JSON.stringify(cached) === JSON.stringify(baseline.value),
      present: cached !== undefined,
    } });
    await state.api.disconnect('acme');
    await expect(state.api.disconnect('acme')).resolves.toMatchObject({ removed: [], application: { configuration: 'pending-restart' } });
    await expect(state.api.sources('acme')).resolves.toMatchObject({ complete: true, application: { configuration: 'pending-restart' } });
    cached = undefined;
    await expect(state.api.sources('acme')).resolves.toMatchObject({ complete: true, application: { configuration: 'matches-persisted' } });
  });

  it('records a fresh commit even when an overlapping old source read clears prior evidence', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    const raw = '{"provider":{"acme":{"enabled":true}}}';
    await put(file, raw);
    let cached = { enabled: true };
    let holdRead = false;
    let readEntered;
    let resumeRead;
    const readStarted = new Promise(resolve => { readEntered = resolve; });
    const reading = new Promise(resolve => { resumeRead = resolve; });
    state.input.operations.compareLegacyProvider = async ({ value, baseline }) => {
      const data = { matchesPersisted: JSON.stringify(value) === JSON.stringify(cached), matchesBaseline: baseline !== undefined && JSON.stringify(baseline.value) === JSON.stringify(cached), present: cached !== undefined };
      if (holdRead) { holdRead = false; readEntered(); await reading; }
      return { ...descriptor, data };
    };
    await state.api.disconnect('acme');
    state.input.credentials.read = async () => ({ acme: { type: 'api', key: 'synthetic' } });
    let deleteEntered;
    let resumeDelete;
    const deleteStarted = new Promise(resolve => { deleteEntered = resolve; });
    const deleting = new Promise(resolve => { resumeDelete = resolve; });
    state.input.operations.removeLegacyCredential = async () => { deleteEntered(); await deleting; return true; };
    cached = undefined;
    holdRead = true;
    const oldRead = state.api.sources('acme');
    await readStarted;
    await put(file, raw);
    cached = { enabled: true };
    const disconnect = state.api.disconnect('acme');
    await deleteStarted;
    resumeRead();
    await oldRead;
    resumeDelete();
    await disconnect;
    await expect(state.api.sources('acme')).resolves.toMatchObject({ complete: true, application: { configuration: 'pending-restart' } });
  });

  it('keeps an unknown credential outcome while another provider completes independently', async () => {
    const state = await fixture();
    state.input.credentials.read = async () => ({ acme: { type: 'api', key: 'a' }, beta: { type: 'api', key: 'b' } });
    let entered;
    let resume;
    const started = new Promise(resolve => { entered = resolve; });
    const pending = new Promise(resolve => { resume = resolve; });
    state.input.operations.removeLegacyCredential = async request => {
      state.calls.push(request);
      if (request.providerID === 'acme') { entered(); await pending; throw Object.assign(new Error('lost'), { statusCode: 502 }); }
      return true;
    };
    const first = state.api.disconnect('acme');
    await started;
    await expect(state.api.disconnect('beta')).resolves.toMatchObject({ persisted: true, application: { configuration: 'matches-persisted' } });
    resume();
    await expect(first).rejects.toMatchObject({ outcome: { credential: 'unknown' } });
    await expect(state.api.disconnect('acme', path.join(state.root, 'other'))).rejects.toMatchObject({ statusCode: 409 });
    expect(state.calls.map(call => call.providerID)).toEqual(['acme', 'beta']);
  });

  it('does not retain deferred attribution when owner retirement is detected without notification', async () => {
    const state = await fixture();
    await put(path.join(state.paths.config, 'opencode.jsonc'), '{"provider":{"acme":{"enabled":true}}}');
    state.input.operations.compareLegacyProvider = async ({ value, baseline }) => ({ ...descriptor,
      data: { matchesPersisted: value !== undefined, matchesBaseline: baseline?.value?.enabled === true, present: true } });
    state.input.credentials.read = async () => ({ acme: { type: 'api', key: 'synthetic' } });
    state.input.operations.removeLegacyCredential = async () => { state.backend.revision += 1; return true; };
    await expect(state.api.disconnect('acme')).rejects.toMatchObject({ statusCode: 409 });
    state.backend.revision = 1;
    await expect(state.api.sources('acme')).resolves.toMatchObject({ complete: false, application: { configuration: 'unknown' } });
  });

  it('keeps unknown credential protection across runtime-only retirement and clears it for a fresh native owner', async () => {
    const state = await fixture();
    state.input.credentials.read = async () => ({ acme: { type: 'api', key: 'synthetic' } });
    state.input.operations.removeLegacyCredential = async request => {
      state.calls.push(request);
      state.backend.revision += 1;
      state.api.clear(false);
      throw Object.assign(new Error('lost after retirement'), { statusCode: 502 });
    };
    await expect(state.api.disconnect('acme')).rejects.toMatchObject({ outcome: { credential: 'unknown' } });
    await expect(state.api.disconnect('acme')).rejects.toMatchObject({ statusCode: 409, outcome: { credential: 'unknown' } });
    expect(state.calls).toHaveLength(1);
    state.owner.id = Symbol('fresh native');
    state.api.clear(true);
    state.input.operations.removeLegacyCredential = async request => { state.calls.push(request); return true; };
    await expect(state.api.disconnect('acme')).resolves.toMatchObject({ persisted: true });
    expect(state.calls).toHaveLength(2);
  });

});
