import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLegacyMcpConfig } from './legacy-mcp-config.js';

const roots = [];
const descriptor = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'http://127.0.0.1:4096', epoch: 'epoch-a' };
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-mcp-owner-'));
  roots.push(root);
  const paths = { config: path.join(root, 'config'), home: path.join(root, 'home'), directory: path.join(root, 'project'), worktree: path.join(root, 'project') };
  const cwd = paths.directory;
  const env = { HOME: path.join(root, 'native-home') };
  await fs.mkdir(paths.config, { recursive: true });
  await fs.mkdir(paths.directory, { recursive: true });
  const owner = { id: Symbol('native'), env, cwd };
  const input = {
    getNativeConfigContext: () => owner,
    getRuntime: () => descriptor,
    operations: { getLegacyConfiguration: async () => ({ ...descriptor, data: { paths, mcp: {} } }) },
  };
  return { root, paths, owner, config: createLegacyMcpConfig(input) };
}
async function put(file, raw) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, raw, 'utf8'); }
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe('createLegacyMcpConfig', () => {
  it('creates and updates a JSONC entry while retaining comments and preserving raw placeholders', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    await put(file, '{\n  // keep this comment\n  "mcp": {\n    "base": { "type": "remote", "url": "https://example.test", "headers": { "Authorization": "{env:TOKEN}" } }\n  }\n}\n');
    state.owner.env.TOKEN = 'child-secret';
    await state.config.create('extra', { type: 'local', command: ['node'] }, undefined, 'user');
    const before = await fs.readFile(file, 'utf8');
    expect(before).toContain('// keep this comment');
    expect(before).toContain('{env:TOKEN}');
    const updated = await state.config.update('base', { type: 'remote', url: 'https://example.test', headers: { Authorization: '{env:TOKEN}' }, timeout: 1000 });
    expect(updated).toEqual({ saved: true });
    expect((await state.config.get('base')).readOnly).toBe(false);
  });

  it('writes project definitions and reports a lower definition revealed on delete', async () => {
    const state = await fixture();
    await put(path.join(state.paths.config, 'opencode.jsonc'), '{"mcp":{"x":{"type":"local","command":["user"]}}}');
    await put(path.join(state.paths.directory, '.opencode', 'opencode.json'), '{"mcp":{"x":{"command":["project"]}}}');
    const removed = await state.config.remove('x');
    expect(removed).toEqual({ revealed: true });
    await state.config.create('project-only', { type: 'local', command: ['node'] }, state.paths.directory, 'project');
    expect(await fs.readFile(path.join(state.paths.directory, '.opencode', 'opencode.json'), 'utf8')).toContain('project-only');
  });

  it('rejects invalid names, scopes and strict MCP entries', async () => {
    const state = await fixture();
    await expect(state.config.create('Bad Name', { type: 'local', command: ['node'] }, undefined, 'user')).rejects.toMatchObject({ statusCode: 400 });
    await expect(state.config.create('valid', { type: 'local', command: ['node'] }, undefined, 'custom')).rejects.toMatchObject({ statusCode: 400 });
    await expect(state.config.create('valid', { type: 'local', command: ['node'], token: 'secret' }, undefined, 'user')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses inline definitions and preserves them without writing', async () => {
    const state = await fixture();
    state.owner.env.OPENCODE_CONFIG_CONTENT = '{"mcp":{"inline":{"enabled":false}}}';
    const before = await state.config.get('inline');
    expect(before.readOnly).toBe(true);
    await expect(state.config.update('inline', { enabled: true })).rejects.toMatchObject({ statusCode: 501 });
  });

  it('rejects a nested patch when inherited fields would reappear', async () => {
    const state = await fixture();
    await put(path.join(state.paths.config, 'opencode.jsonc'), '{"mcp":{"x":{"type":"remote","url":"https://example.test","headers":{"A":"a","B":"b"}}}}');
    await put(path.join(state.paths.directory, '.opencode', 'opencode.json'), '{"mcp":{"x":{"headers":{"A":"override"}}}}');
    await expect(state.config.update('x', { headers: null })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('does not copy inherited relative file references into a project override', async () => {
    const state = await fixture();
    await put(path.join(state.paths.config, 'secret.txt'), 'user-secret');
    await put(path.join(state.paths.config, 'opencode.jsonc'), '{"mcp":{"x":{"type":"remote","url":"https://example.test","headers":{"Authorization":"{file:secret.txt}"}}}}');
    const projectFile = path.join(state.paths.directory, '.opencode', 'opencode.json');
    await put(projectFile, '{"mcp":{"x":{"timeout":1000}}}');
    const form = await state.config.get('x', state.paths.directory);
    await state.config.update('x', form, state.paths.directory);
    const projectRaw = await fs.readFile(projectFile, 'utf8');
    expect(projectRaw).not.toContain('{file:secret.txt}');
    expect(projectRaw).toContain('1000');
  });

  it('rejects project creation when project config is disabled', async () => {
    const state = await fixture();
    state.owner.env.OPENCODE_DISABLE_PROJECT_CONFIG = '1';
    await expect(state.config.create('x', { type: 'local', command: ['node'] }, state.paths.directory, 'project'))
      .rejects.toMatchObject({ statusCode: 501 });
  });

  it('detects a new empty target created externally during preflight', async () => {
    const state = await fixture();
    const target = path.join(state.paths.config, 'opencode.jsonc');
    let calls = 0;
    const input = {
      getNativeConfigContext: () => state.owner,
      getRuntime: () => descriptor,
      operations: { getLegacyConfiguration: async () => {
        calls += 1;
        if (calls === 2) await put(target, '');
        return { ...descriptor, data: { paths: state.paths, mcp: {} } };
      } },
    };
    await expect(createLegacyMcpConfig(input).create('x', { type: 'local', command: ['node'] }, undefined, 'user'))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await fs.readFile(target, 'utf8')).toBe('');
  });

  it('does not write when the native owner retires during SDK work', async () => {
    const state = await fixture();
    const initial = state.owner.id;
    const original = state.config;
    let calls = 0;
    const context = { ...state.owner };
    const input = {
      getNativeConfigContext: () => context,
      getRuntime: () => descriptor,
      operations: { getLegacyConfiguration: async () => { calls += 1; if (calls === 1) context.id = Symbol('retired'); return { ...descriptor, data: { paths: state.paths, mcp: {} } }; } },
    };
    expect(initial).not.toBeUndefined();
    void original;
    await expect(createLegacyMcpConfig(input).create('x', { type: 'local', command: ['node'] }, undefined, 'user')).rejects.toMatchObject({ statusCode: 409 });
    await expect(fs.access(path.join(state.paths.config, 'opencode.jsonc'))).rejects.toThrow();
  });

  it.each([{ family: 'cagent', revision: 5 }, { family: 'opencode', revision: 5 }])('does not write when backend changes during SDK work: %o', async (nextBackend) => {
    const state = await fixture();
    let backend = { family: 'opencode', revision: 4 };
    const input = {
      getNativeConfigContext: () => state.owner,
      getRuntime: () => descriptor,
      getBackendSelection: () => backend,
      operations: { getLegacyConfiguration: async () => {
        backend = nextBackend;
        return { ...descriptor, data: { paths: state.paths, mcp: {} } };
      } },
    };
    await expect(createLegacyMcpConfig(input).create('x', { type: 'local', command: ['node'] }, undefined, 'user'))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(fs.access(path.join(state.paths.config, 'opencode.jsonc'))).rejects.toThrow();
  });
});

describe('Legacy expanded-only readonly fallback', () => {
  it('keeps expanded entries visible when raw environment injection is not JSONC', async () => {
    const state = await fixture();
    const file = path.join(state.paths.config, 'opencode.jsonc');
    const raw = '{"mcp":{env:MCP_ENTRIES}}';
    state.owner.env.MCP_ENTRIES = JSON.stringify({ first: { type: 'local', command: ['fixture'] }, second: { enabled: false } });
    await put(file, raw);
    expect(await state.config.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'first', type: 'local', readOnly: true }),
      expect.objectContaining({ name: 'second', enabled: false, readOnly: true }),
    ]));
    expect(await state.config.get('first')).toMatchObject({ name: 'first', readOnly: true });
    await expect(state.config.update('first', { enabled: false })).rejects.toThrow();
    await expect(state.config.remove('first')).rejects.toMatchObject({ statusCode: 501 });
    expect(await fs.readFile(file, 'utf8')).toBe(raw);
  });
  it('does not turn expanded parse failures into a successful readonly list', async () => {
    const state = await fixture();
    state.owner.env.OPENCODE_CONFIG_CONTENT = '{"mcp":{env:MISSING}}';
    await expect(state.config.list()).rejects.toThrow();
  });
});
