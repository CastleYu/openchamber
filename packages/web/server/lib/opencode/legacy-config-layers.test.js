import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getLegacyMcpSource, readLegacyConfigLayers } from './legacy-config-layers.js';

const roots = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-layers-'));
  roots.push(root);
  const paths = {
    config: path.join(root, 'cfg', 'opencode'),
    home: path.join(root, 'home'),
    directory: path.join(root, 'work', 'project', 'child'),
    worktree: path.join(root, 'work'),
  };
  await fs.mkdir(paths.directory, { recursive: true });
  await fs.mkdir(paths.config, { recursive: true });
  await fs.mkdir(paths.home, { recursive: true });
  return { paths, cwd: paths.directory, nativeHome: path.join(root, 'native-home'), env: {} };
}
async function write(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value), 'utf8');
}
async function writeText(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
}
afterEach(async () => Promise.all(roots.splice(0).map(async (root) => {
  const resolved = path.resolve(root);
  expect(path.dirname(resolved)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(resolved).startsWith('legacy-layers-')).toBe(true);
  expect((await fs.lstat(resolved)).isSymbolicLink()).toBe(false);
  await fs.rm(resolved, { recursive: true, force: true });
})));

describe('readLegacyConfigLayers', () => {
  it('merges three global formats, with opencode.jsonc winning', async () => {
    const input = await fixture();
    await write(path.join(input.paths.config, 'config.json'), { mcp: { base: { v: 1 }, same: { v: 1 } } });
    await write(path.join(input.paths.config, 'opencode.json'), { mcp: { same: { v: 2 } } });
    await write(path.join(input.paths.config, 'opencode.jsonc'), { mcp: { same: { v: 3 } } });
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.same).toEqual({ v: 3 });
    expect(result.layers.slice(0, 3).map(({ path: file }) => path.basename(file)))
      .toEqual(['config.json', 'opencode.json', 'opencode.jsonc']);
  });

  it('loads custom file before project formats and nearest .opencode directory', async () => {
    const input = await fixture();
    const outer = path.dirname(path.dirname(input.paths.directory));
    await write(path.join(input.cwd, 'custom.json'), { mcp: { winner: { v: 'custom' } } });
    input.env.OPENCODE_CONFIG = 'custom.json';
    await write(path.join(outer, 'opencode.jsonc'), { mcp: { winner: { v: 'outer' } } });
    await write(path.join(input.paths.directory, 'opencode.jsonc'), { mcp: { winner: { v: 'inner' } } });
    await write(path.join(outer, 'opencode.json'), { mcp: { json: { v: 'outer' } } });
    await write(path.join(input.paths.directory, 'opencode.json'), { mcp: { json: { v: 'inner' } } });
    await write(path.join(input.paths.directory, '.opencode', 'opencode.jsonc'), { mcp: { winner: { v: 'nearest-dir' } } });
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.winner.v).toBe('nearest-dir');
    expect(result.mergedMcp.json.v).toBe('inner');
    expect(getLegacyMcpSource(result.layers, 'winner').scope).toBe('project');
    expect(result.layers.map(({ order }, index) => order === index)).toEqual(result.layers.map(() => true));
    expect(result.layers.find(({ path: file }) => file === path.join(input.cwd, 'custom.json')))
      .toMatchObject({ origin: 'explicit-config', order: 0 });
    expect(result.layers.find(({ path: file }) => file === path.join(outer, 'opencode.jsonc')))
      .toMatchObject({ origin: 'project-root' });
    expect(result.layers.find(({ path: file }) => file === path.join(input.paths.directory, '.opencode', 'opencode.jsonc')))
      .toMatchObject({ origin: 'dot-directory' });
  });

  it('orders home, custom dir, inline and managed layers after project directories', async () => {
    const input = await fixture();
    const homeDir = path.join(input.paths.home, '.opencode');
    const customDir = path.join(input.cwd, 'custom-dir');
    const managedDir = path.join(input.cwd, 'managed');
    await write(path.join(homeDir, 'opencode.jsonc'), { mcp: { order: { v: 'home' } } });
    await write(path.join(customDir, 'opencode.json'), { mcp: { order: { v: 'customdir' } } });
    await write(path.join(managedDir, 'opencode.jsonc'), { mcp: { order: { v: 'managed' } } });
    input.env.OPENCODE_CONFIG_DIR = 'custom-dir';
    input.env.OPENCODE_CONFIG_CONTENT = '{"mcp":{"order":{"v":"inline"}}}';
    input.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = managedDir;
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.order.v).toBe('managed');
    expect(result.layers.at(-2)).toMatchObject({ path: null, scope: 'inline', writable: false });
    expect(result.layers.at(-1).scope).toBe('managed');
    expect(result.layers.at(-2).origin).toBe('inline');
    expect(result.layers.at(-1).origin).toBe('managed');
    expect(result.layers.find(({ path: file }) => file === path.join(homeDir, 'opencode.jsonc')).origin).toBe('dot-directory');
    expect(result.layers.find(({ path: file }) => file === path.join(customDir, 'opencode.json')).origin).toBe('explicit-config-dir');
  });

  it('skips project files when disabled and still reads global sources', async () => {
    const input = await fixture();
    input.env.OPENCODE_DISABLE_PROJECT_CONFIG = '1';
    await write(path.join(input.paths.directory, 'opencode.json'), { mcp: { project: { enabled: true } } });
    await write(path.join(input.paths.config, 'opencode.json'), { mcp: { global: { enabled: true } } });
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp).toEqual({ global: { enabled: true } });
  });

  it('expands child env and relative files without mutating placeholders in raw text', async () => {
    const input = await fixture();
    input.env.KEY = 'child-secret';
    await writeText(path.join(input.paths.config, 'secret.txt'), '  file-value\n');
    const raw = '{"mcp":{"x":{"token":"{env:KEY}","file":"{file:secret.txt}"}},"comment":"// {env:KEY}"}';
    await writeText(path.join(input.paths.config, 'opencode.jsonc'), raw);
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.x).toEqual({ token: 'child-secret', file: 'file-value' });
    expect(result.layers[0].raw).toContain('{env:KEY}');
    expect(result.layers[0].config.comment).toContain('child-secret');
  });

  it('retains raw global placeholders in // comment-only lines', async () => {
    const input = await fixture();
    const raw = '{\n// {env:KEY}\n"mcp":{"x":{"enabled":true}}\n}';
    await writeText(path.join(input.paths.config, 'opencode.jsonc'), raw);
    input.env.KEY = 'expanded';
    const result = await readLegacyConfigLayers(input);
    expect(result.layers[0].config.mcp.x).toEqual({ enabled: true });
    expect(result.layers[0].raw).toContain('// {env:KEY}');
  });

  it('returns useful default write paths when user files are missing', async () => {
    const input = await fixture();
    const result = await readLegacyConfigLayers(input);
    expect(result.userPath).toBe(path.join(input.paths.config, 'opencode.jsonc'));
  });

  it('rejects malformed JSONC and invalid config without disclosing values', async () => {
    const input = await fixture();
    await writeText(path.join(input.paths.config, 'opencode.jsonc'), '{"private":"very-secret"');
    await expect(readLegacyConfigLayers(input)).rejects.toMatchObject({ statusCode: 400, message: 'Invalid OpenCode configuration' });
  });

  it('does not fall back to host environment values', async () => {
    const input = await fixture();
    await writeText(path.join(input.paths.config, 'opencode.jsonc'), '{"mcp":{"x":{"token":"{env:LEGACY_LAYER_HOST_ONLY}"}}}');
    const prior = process.env.LEGACY_LAYER_HOST_ONLY;
    process.env.LEGACY_LAYER_HOST_ONLY = 'host-value';
    try {
      const result = await readLegacyConfigLayers(input);
      expect(result.mergedMcp.x.token).toBe('');
    } finally {
      if (prior === undefined) delete process.env.LEGACY_LAYER_HOST_ONLY;
      else process.env.LEGACY_LAYER_HOST_ONLY = prior;
    }
  });

  it('deep-merges same-name MCP objects while replacing arrays', async () => {
    const input = await fixture();
    await write(path.join(input.paths.config, 'opencode.jsonc'), { mcp: { shared: { headers: { first: 'one', nested: { keep: true } }, env: { FIRST: 'one' }, args: ['old'] } } });
    await write(path.join(input.paths.directory, 'opencode.jsonc'), { mcp: { shared: { headers: { second: 'two', nested: { add: true } }, env: { SECOND: 'two' }, args: ['new'] } } });
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.shared).toEqual({ headers: { first: 'one', second: 'two', nested: { keep: true, add: true } }, env: { FIRST: 'one', SECOND: 'two' }, args: ['new'] });
  });

  it('loads .opencode ancestor directories nearest first and outermost last', async () => {
    const input = await fixture();
    const project = path.dirname(input.paths.directory);
    await write(path.join(project, '.opencode', 'opencode.json'), { mcp: { source: { v: 'nearest' } } });
    await write(path.join(input.paths.worktree, '.opencode', 'opencode.json'), { mcp: { source: { v: 'outer' } } });
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.source.v).toBe('outer');
    const dirs = result.layers.filter(({ path: file }) => file?.endsWith(path.join('.opencode', 'opencode.json')));
    expect(dirs.map(({ path: file }) => file)).toEqual([path.join(project, '.opencode', 'opencode.json'), path.join(input.paths.worktree, '.opencode', 'opencode.json')]);
    expect(dirs.every(({ writable }) => writable)).toBe(true);
  });

  it('deduplicates identical project, home, and custom directory paths retaining scope and explicit origin', async () => {
    const input = await fixture();
    const shared = path.join(path.dirname(input.paths.directory), '.opencode');
    input.paths.home = path.dirname(shared);
    await write(path.join(shared, 'opencode.json'), { mcp: { source: { enabled: true } } });
    input.env.OPENCODE_CONFIG_DIR = shared;
    const result = await readLegacyConfigLayers(input);
    const matches = result.layers.filter(({ path: file }) => file === path.join(shared, 'opencode.json'));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ scope: 'project', writable: true, origin: 'explicit-config-dir' });
  });

  it('uses custom config filenames with surrounding spaces literally', async () => {
    const input = await fixture();
    await write(path.join(input.cwd, ' custom.json '), { mcp: { custom: { enabled: true } } });
    input.env.OPENCODE_CONFIG = ' custom.json ';
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.custom).toEqual({ enabled: true });
    expect(result.layers.some(({ path: file }) => file === path.join(input.cwd, ' custom.json '))).toBe(true);
  });

  it('anchors a relative managed config directory at the child cwd', async () => {
    const input = await fixture();
    await write(path.join(input.cwd, 'managed dir', 'opencode.json'), { mcp: { managed: { enabled: true } } });
    input.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = 'managed dir';
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.managed).toEqual({ enabled: true });
    expect(result.layers.at(-1).path).toBe(path.join(input.cwd, 'managed dir', 'opencode.json'));
  });

  it('accepts an empty config file as an empty object', async () => {
    const input = await fixture();
    await writeText(path.join(input.paths.config, 'opencode.jsonc'), '');
    const result = await readLegacyConfigLayers(input);
    expect(result.layers[0].config).toEqual({});
  });

  it('rejects whitespace-only config files safely', async () => {
    const input = await fixture();
    await writeText(path.join(input.paths.config, 'opencode.jsonc'), '   \n  ');
    await expect(readLegacyConfigLayers(input)).rejects.toMatchObject({ statusCode: 400, message: 'Invalid OpenCode configuration' });
  });

  it('rejects missing file substitutions without exposing path or secret text', async () => {
    const input = await fixture();
    await writeText(path.join(input.paths.config, 'opencode.jsonc'), '{"mcp":{"x":{"token":"secret-value","file":"{file:missing-secret-path}"}}}');
    await expect(readLegacyConfigLayers(input)).rejects.toMatchObject({ statusCode: 400, message: 'Invalid OpenCode configuration' });
  });

  it('does not recursively expand file tokens introduced by a replacement', async () => {
    const input = await fixture();
    await writeText(path.join(input.paths.config, 'token.txt'), '{file:second.txt}');
    await writeText(path.join(input.paths.config, 'second.txt'), 'should-not-expand');
    await writeText(path.join(input.paths.config, 'opencode.jsonc'), '{"mcp":{"x":{"token":"{file:token.txt}","second":"{file:second.txt}"}}}');
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.x).toEqual({ token: '{file:second.txt}', second: 'should-not-expand' });
  });

  it.skipIf(process.platform !== 'win32')('keeps mixed-separator ancestor traversal inside the worktree', async () => {
    const input = await fixture();
    const parent = path.dirname(input.paths.worktree);
    await write(path.join(parent, 'opencode.jsonc'), { mcp: { outside: { enabled: true } } });
    await write(path.join(input.paths.worktree, 'opencode.jsonc'), { mcp: { inside: { enabled: true } } });
    input.paths.directory = input.paths.directory.replaceAll('\\', '/');
    input.cwd = input.paths.directory;
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.inside).toEqual({ enabled: true });
    expect(result.mergedMcp.outside).toBeUndefined();
  });

  it('uses the native home for file references and preserves missing comment references', async () => {
    const input = await fixture();
    await writeText(path.join(input.nativeHome, 'token.txt'), 'native-value');
    await writeText(path.join(input.paths.home, 'token.txt'), 'test-home-value');
    await writeText(path.join(input.paths.config, 'opencode.jsonc'), '{\n// {file:missing-comment.txt}\n"mcp":{"x":{"token":"{file:~/token.txt}"}}}');
    const result = await readLegacyConfigLayers(input);
    expect(result.mergedMcp.x.token).toBe('native-value');
  });

  it('keeps JSONC prototype-key filtering and preserves ordinary constructor-named entries', async () => {
    const input = await fixture();
    await writeText(path.join(input.paths.config, 'opencode.jsonc'), '{"mcp":{"__proto__":{"enabled":false},"constructor":{"enabled":true}}}');
    const result = await readLegacyConfigLayers(input);
    expect(Object.hasOwn(result.mergedMcp, '__proto__')).toBe(false);
    expect(result.mergedMcp.constructor).toEqual({ enabled: true });
    expect(Object.getPrototypeOf(result.mergedMcp)).toBe(Object.prototype);
  });

});
