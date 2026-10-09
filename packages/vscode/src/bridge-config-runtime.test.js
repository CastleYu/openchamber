import * as fsNative from 'fs';
import './opencodeConfigTestHome';
import { OPENCODE_CONFIG_DIR, OPENCODE_CONFIG_DIR_V2 } from './opencodeConfigPaths';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { AGENT_ERROR } from '../../web/server/lib/agent/constants.js';
import { installSkillsFromRepository } from './skillsCatalog.ts';
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

mock.module('vscode', () => ({
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: () => undefined }),
  },
}));

const { handleConfigBridgeMessage } = await import('./bridge-config-runtime.ts');

const tempRoots = [];
const originalOpencodeConfig = process.env.OPENCODE_CONFIG;

const createCtx = (workingDirectory, restartImpl = async () => undefined, generation = 'oc1') => {
  const restart = mock(restartImpl);
  return {
    restart,
    manager: {
      getWorkingDirectory: () => workingDirectory,
      getKernelRuntime: () => ({ generation, endpoint: 'http://oc.test', epoch: 1 }),
      refreshKernelRuntime: async () => ({ generation, endpoint: 'http://oc.test', epoch: 1 }),
      restart,
    },
  };
};

const deps = {
  readSettings: () => ({}),
  persistSettings: async (changes) => changes,
  readMagicPromptOverrides: () => ({ version: 1, overrides: {} }),
  saveMagicPromptOverride: async () => ({ version: 1, overrides: {} }),
  resetMagicPromptOverride: async () => ({ version: 1, overrides: {} }),
  resetAllMagicPromptOverrides: async () => ({ version: 1, overrides: {} }),
  fetchOpenCodeSkillsFromApi: async () => null,
  clientReloadDelayMs: 800,
};

afterEach(() => {
  if (originalOpencodeConfig === undefined) {
    delete process.env.OPENCODE_CONFIG;
  } else {
    process.env.OPENCODE_CONFIG = originalOpencodeConfig;
  }

  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

describe('VS Code config bridge plugin parity', () => {
  test('OC2 plugin list includes declaring config paths and discovered package directories', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-plugins-v2-'));
    tempRoots.push(root);
    const configPath = path.join(root, 'custom', 'opencode.json');
    const projectPath = path.join(root, '.opencode', 'opencode.json');
    process.env.OPENCODE_CONFIG = configPath;
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ plugins: ['user-plugin@2'] }));
    fs.writeFileSync(projectPath, JSON.stringify({ plugins: ['./plugins/local'] }));
    const editable = path.join(root, '.opencode', 'plugins', 'notify.ts');
    const packageDir = path.join(root, '.opencode', 'plugins', 'local');
    const legacy = path.join(root, '.opencode', 'plugin', 'old.ts');
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(editable, 'export default {}');
    fs.writeFileSync(legacy, 'export default {}');

    const listed = await handleConfigBridgeMessage({
      id: 'list-v2', type: 'api:config/plugins', payload: { method: 'GET', target: 'list', directory: root },
    }, createCtx(root, undefined, 'oc2'), deps);
    expect(listed?.success).toBe(true);
    expect(listed?.data?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ spec: 'user-plugin@2', sourcePath: configPath }),
      expect.objectContaining({ spec: './plugins/local', sourcePath: projectPath }),
    ]));
    expect(listed?.data?.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: 'notify.ts', kind: 'file', absolutePath: editable }),
      expect.objectContaining({ fileName: 'local', kind: 'package', absolutePath: packageDir }),
      expect.objectContaining({ fileName: 'old.ts', kind: 'package', absolutePath: legacy }),
    ]));
  });

  test.each(['api:config/agents', 'api:config/commands', 'api:config/mcp', 'api:config/plugins',
    'api:config/snippets', 'api:config/skills', 'api:config/skills/files', 'api:behavior/agents-md:save',
    'api:config/skills:catalog', 'api:config/skills:scan', 'api:config/skills:install'])
  ('refuses Legacy %s before local config or repository work', async (type) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-legacy-'));
    tempRoots.push(root);
    const ctx = createCtx(root);
    ctx.manager.getKernelRuntime = () => ({ generation: 'oc1', profile: 'legacy-1.2.27', endpoint: 'http://oc.test', epoch: 1 });
    const result = await handleConfigBridgeMessage({ id: 'legacy', type,
      payload: { method: 'POST', name: 'reviewer', source: 'invalid', content: 'Legacy must not write', body: { scope: 'project' } },
    }, ctx, deps);
    expect(result).toMatchObject({ success: false, error: 'Legacy OpenCode configuration is not yet verified in VS Code' });
    expect(fs.readdirSync(root)).toEqual([]);
    expect(ctx.restart).not.toHaveBeenCalled();
  });

  test('refuses config discovery after endpoint retirement', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-retired-'));
    tempRoots.push(root);
    const ctx = createCtx(root, undefined, 'unknown');
    let selected = { generation: 'unknown', endpoint: 'http://old.test', epoch: 1 };
    ctx.manager.getKernelRuntime = () => selected;
    ctx.manager.refreshKernelRuntime = async () => {
      selected = { generation: 'oc1', endpoint: 'http://new.test', epoch: 2 };
      return selected;
    };
    const result = await handleConfigBridgeMessage({ id: 'retired', type: 'api:config/agents',
      payload: { method: 'POST', name: 'reviewer', body: { scope: 'project', description: 'Review' } },
    }, ctx, deps);
    expect(result).toMatchObject({ success: false, error: 'OpenCode runtime changed during config discovery' });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  test('accepts discovery that resolves the same endpoint and advances its epoch', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-discovery-'));
    tempRoots.push(root);
    const ctx = createCtx(root, undefined, 'unknown');
    let selected = { generation: 'unknown', endpoint: 'http://oc.test', epoch: 1 };
    ctx.manager.getKernelRuntime = () => selected;
    ctx.manager.refreshKernelRuntime = async () => {
      selected = { generation: 'oc2', profile: 'oc2', endpoint: 'http://oc.test', epoch: 2 };
      return selected;
    };
    const result = await handleConfigBridgeMessage({ id: 'discovery', type: 'api:config/agents',
      payload: { method: 'POST', name: 'reviewer', directory: root, body: { scope: 'project', description: 'Review' } },
    }, ctx, deps);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(root, '.opencode', 'agents', 'reviewer.md'), 'utf8')).toContain('Review');
  });

  test('refuses unknown generation before changing a config file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-unknown-'));
    tempRoots.push(root);
    const ctx = createCtx(root, undefined, 'unknown');
    const configPath = path.join(root, '.opencode', 'opencode.json');
    const result = await handleConfigBridgeMessage({ id: 'unknown', type: 'api:config/agents',
      payload: { method: 'POST', name: 'reviewer', body: { scope: 'project', description: 'Review' } } }, ctx, deps);
    expect(result).toMatchObject({ success: false, error: 'OpenCode kernel is not ready' });
    expect(fs.existsSync(configPath)).toBe(false);
  });

  test('writes an OC2 agent under agents while preserving OC1 module behavior', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-v2-config-'));
    tempRoots.push(root);
    const ctx = createCtx(root, undefined, 'oc2');
    const configPath = path.join(root, '.opencode', 'opencode.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ agent: { reviewer: { description: 'Old' } } }));
    const result = await handleConfigBridgeMessage({ id: 'v2', type: 'api:config/agents',
      payload: { method: 'PATCH', name: 'reviewer', directory: root, body: { description: 'New' } } }, ctx, deps);
    expect(result?.success).toBe(true);
    expect(readJson(configPath).agents.reviewer.description).toBe('New');
    expect(readJson(configPath).agent?.reviewer).toBeUndefined();
  });

  test('returns ordered OC2 global and agent permission rules through the bridge', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-v2-permissions-'));
    tempRoots.push(root);
    const ctx = createCtx(root, undefined, 'oc2');
    const configPath = path.join(root, '.opencode', 'opencode.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      permissions: [{ action: 'shell', resource: '*', effect: 'ask' }],
      agents: { reviewer: { permissions: [{ action: 'shell', resource: 'git status', effect: 'allow' }] } },
    }));
    const result = await handleConfigBridgeMessage({ id: 'rules', type: 'api:config/agents',
      payload: { method: 'GET', name: 'reviewer', resource: 'permissions', directory: root } }, ctx, deps);
    expect(result?.success).toBe(true);
    expect(result?.data.effective).toEqual([
      { action: 'shell', resource: '*', effect: 'ask', source: 'global' },
      { action: 'shell', resource: 'git status', effect: 'allow', source: 'agent' },
    ]);
  });
  test('explicit config reload restarts OpenCode', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-reload-'));
    tempRoots.push(root);
    const ctx = createCtx(root);

    const reloaded = await handleConfigBridgeMessage({
      id: 'reload',
      type: 'api:config/reload',
    }, ctx, deps);

    expect(reloaded).toEqual({
      id: 'reload',
      type: 'api:config/reload',
      success: true,
      data: { restarted: true },
    });
    expect(ctx.restart).toHaveBeenCalledTimes(1);
  });

  test('removes agent fields when update payload sends null', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-agent-null-'));
    tempRoots.push(root);
    const ctx = createCtx(root);
    const configDir = path.join(root, '.opencode');
    const configPath = path.join(configDir, 'opencode.json');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      agent: {
        build: {
          variant: 'fast',
          temperature: 0.3,
          top_p: 0.8,
          mode: 'subagent',
        },
      },
    }, null, 2), 'utf8');

    const updated = await handleConfigBridgeMessage({
      id: 'update-agent-null-fields',
      type: 'api:config/agents',
      payload: {
        method: 'PATCH',
        name: 'build',
        directory: root,
        body: { variant: null, temperature: null, top_p: null },
      },
    }, ctx, deps);

    expect(updated?.success).toBe(true);
    expect(readJson(configPath).agent.build).toEqual({ mode: 'subagent' });
  });

  test('creates, lists, updates, and deletes project plugin entries', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-plugins-'));
    tempRoots.push(root);
    const ctx = createCtx(root);

    const created = await handleConfigBridgeMessage({
      id: 'create',
      type: 'api:config/plugins',
      payload: {
        method: 'POST',
        target: 'entry',
        directory: root,
        body: { scope: 'project', spec: 'plugin-a', options: { enabled: true } },
      },
    }, ctx, deps);

    expect(created?.success).toBe(true);
    expect(created?.data).toMatchObject({
      success: true,
      requiresReload: false,
      requiresRestart: true,
      restartDeferred: true,
      message: 'Plugin entry changed. Restart OpenCode to apply.',
    });
    expect(ctx.restart).not.toHaveBeenCalled();

    const listed = await handleConfigBridgeMessage({
      id: 'list',
      type: 'api:config/plugins',
      payload: { method: 'GET', target: 'list', directory: root },
    }, ctx, deps);
    const entries = listed?.data?.entries || [];
    const entry = entries.find((candidate) => candidate.spec === 'plugin-a');
    expect(entry?.scope).toBe('project');

    const updated = await handleConfigBridgeMessage({
      id: 'update',
      type: 'api:config/plugins',
      payload: {
        method: 'PATCH',
        target: 'entry',
        directory: root,
        pluginId: entry?.id,
        body: { spec: 'plugin-b' },
      },
    }, ctx, deps);
    expect(updated?.success).toBe(true);

    const config = JSON.parse(fs.readFileSync(path.join(root, '.opencode', 'opencode.json'), 'utf8'));
    expect(config.plugin).toEqual([['plugin-b', { enabled: true }]]);

    const relisted = await handleConfigBridgeMessage({
      id: 'relist',
      type: 'api:config/plugins',
      payload: { method: 'GET', target: 'list', directory: root },
    }, ctx, deps);
    const updatedEntry = (relisted?.data?.entries || []).find((candidate) => candidate.spec === 'plugin-b');

    const deleted = await handleConfigBridgeMessage({
      id: 'delete',
      type: 'api:config/plugins',
      payload: { method: 'DELETE', target: 'entry', directory: root, pluginId: updatedEntry?.id },
    }, ctx, deps);
    expect(deleted?.success).toBe(true);
  });

  test('creates and reads project plugin files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-plugin-files-'));
    tempRoots.push(root);
    const ctx = createCtx(root);

    const created = await handleConfigBridgeMessage({
      id: 'create-file',
      type: 'api:config/plugins',
      payload: {
        method: 'POST',
        target: 'file',
        directory: root,
        body: { scope: 'project', fileName: 'demo-plugin.ts', content: 'export default {}' },
      },
    }, ctx, deps);
    expect(created?.success).toBe(true);

    const listed = await handleConfigBridgeMessage({
      id: 'list',
      type: 'api:config/plugins',
      payload: { method: 'GET', target: 'list', directory: root },
    }, ctx, deps);
    const files = listed?.data?.files || [];
    const file = files.find((candidate) => candidate.fileName === 'demo-plugin.ts');
    expect(file?.scope).toBe('project');

    const read = await handleConfigBridgeMessage({
      id: 'read-file',
      type: 'api:config/plugins',
      payload: { method: 'GET', target: 'file', directory: root, pluginId: file?.id },
    }, ctx, deps);
    expect(read?.data).toEqual({ fileName: 'demo-plugin.ts', scope: 'project', content: 'export default {}' });
  });

  test('updates and deletes user plugin entries from OPENCODE_CONFIG source', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-custom-config-'));
    tempRoots.push(root);
    const configDir = path.join(root, 'custom-config');
    const configPath = path.join(configDir, 'opencode.json');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ plugin: ['custom-plugin'] }, null, 2), 'utf8');
    process.env.OPENCODE_CONFIG = configPath;
    const ctx = createCtx(root);

    const listed = await handleConfigBridgeMessage({
      id: 'list-custom',
      type: 'api:config/plugins',
      payload: { method: 'GET', target: 'list', directory: root },
    }, ctx, deps);
    const entry = (listed?.data?.entries || []).find((candidate) => candidate.spec === 'custom-plugin');
    expect(entry?.scope).toBe('user');

    const updated = await handleConfigBridgeMessage({
      id: 'update-custom',
      type: 'api:config/plugins',
      payload: {
        method: 'PATCH',
        target: 'entry',
        directory: root,
        pluginId: entry?.id,
        body: { spec: 'custom-plugin-next' },
      },
    }, ctx, deps);
    expect(updated?.success).toBe(true);
    expect(readJson(configPath).plugin).toEqual(['custom-plugin-next']);

    const relisted = await handleConfigBridgeMessage({
      id: 'relist-custom',
      type: 'api:config/plugins',
      payload: { method: 'GET', target: 'list', directory: root },
    }, ctx, deps);
    const updatedEntry = (relisted?.data?.entries || []).find((candidate) => candidate.spec === 'custom-plugin-next');

    const deleted = await handleConfigBridgeMessage({
      id: 'delete-custom',
      type: 'api:config/plugins',
      payload: { method: 'DELETE', target: 'entry', directory: root, pluginId: updatedEntry?.id },
    }, ctx, deps);
    expect(deleted?.success).toBe(true);
    expect(readJson(configPath).plugin).toBeUndefined();
  });

  test('writes user plugin files next to OPENCODE_CONFIG', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-custom-files-'));
    tempRoots.push(root);
    const configDir = path.join(root, 'custom-config');
    const configPath = path.join(configDir, 'opencode.json');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, '{}', 'utf8');
    process.env.OPENCODE_CONFIG = configPath;
    const ctx = createCtx(root);

    const created = await handleConfigBridgeMessage({
      id: 'create-custom-file',
      type: 'api:config/plugins',
      payload: {
        method: 'POST',
        target: 'file',
        directory: root,
        body: { scope: 'user', fileName: 'demo-plugin.ts', content: 'export default {}' },
      },
    }, ctx, deps);

    expect(created?.success).toBe(true);
    expect(fs.readFileSync(path.join(configDir, 'plugins', 'demo-plugin.ts'), 'utf8')).toBe('export default {}');
  });

  test('creates MCP config with deferred restart when restart would fail', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-mcp-deferred-'));
    tempRoots.push(root);
    const ctx = createCtx(root, async () => {
      throw new Error('restart failed');
    });

    const created = await handleConfigBridgeMessage({
      id: 'create-mcp-deferred',
      type: 'api:config/mcp',
      payload: {
        method: 'POST',
        name: 'mcp-deferred',
        directory: root,
        body: { scope: 'project', type: 'local', command: ['node', 'server.js'] },
      },
    }, ctx, deps);

    expect(created?.success).toBe(true);
    expect(created?.data).toMatchObject({
      success: true,
      requiresReload: false,
      requiresRestart: true,
      restartDeferred: true,
      message: 'MCP server "mcp-deferred" created. Restart OpenCode to apply.',
    });
    expect(ctx.restart).not.toHaveBeenCalled();
    expect(readJson(path.join(root, '.opencode', 'opencode.json')).mcp['mcp-deferred']).toMatchObject({
      type: 'local',
      command: ['node', 'server.js'],
    });
  });
});

const savedEnv = new Map();
const stubEnv = (name, value) => {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  process.env[name] = value;
};
const restoreEnv = () => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
};

describe('skill installation commit boundary', () => {
  let root;
  let project;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-vscode-install-test-'));
    project = path.join(root, 'project');
    const repo = path.join(root, 'repo');
    const hooks = path.join(root, 'empty-hooks');
    fs.mkdirSync(hooks);
    fs.mkdirSync(repo);
    for (const name of ['alpha', 'beta']) {
      fs.mkdirSync(path.join(repo, name));
      fs.writeFileSync(path.join(repo, name, 'SKILL.md'), 'new ' + name);
    }
    const git = (args) => execFileSync('git', args, { cwd: repo, windowsHide: true, stdio: 'pipe' });
    git(['init', '--quiet']);
    git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
      '-c', 'core.hooksPath=' + hooks, 'commit', '--quiet', '-m', 'fixture']);
    // Rewrite only this fixture remote in child processes; never contact GitHub.
    stubEnv('GIT_CONFIG_COUNT', '2');
    stubEnv('GIT_CONFIG_KEY_0', 'url.' + pathToFileURL(repo).href + '.insteadOf');
    stubEnv('GIT_CONFIG_VALUE_0', 'https://github.com/openchamber-fixture/skills.git');
    stubEnv('GIT_CONFIG_KEY_1', 'protocol.file.allow');
    stubEnv('GIT_CONFIG_VALUE_1', 'always');
  });

  afterEach(() => {
    mock.restore();
    restoreEnv();
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  const target = (name) => path.join(project, '.opencode', 'skills', name);
  const seed = (name) => {
    fs.mkdirSync(target(name), { recursive: true });
    fs.writeFileSync(path.join(target(name), 'SKILL.md'), 'old ' + name);
  };
  const body = (name) => fs.readFileSync(path.join(target(name), 'SKILL.md'), 'utf8');
  const install = (options = {}) => installSkillsFromRepository({
    source: 'openchamber-fixture/skills', scope: 'project', targetSource: 'opencode',
    workingDirectory: project,
    selections: [{ skillDir: 'alpha' }], conflictPolicy: 'overwriteAll', ...options,
  });
  const expectClean = () => {
    expect(fs.readdirSync(path.dirname(path.dirname(target('alpha')))).filter(name => name.startsWith('.openchamber-skill-'))).toEqual([]);
  };

  test('installs new files and overwrites an existing skill after preparation', async () => {
    seed('alpha');
    const result = await install();
    expect(result).toMatchObject({ ok: true, installed: [{ skillName: 'alpha' }], skipped: [] });
    expect(body('alpha')).toBe('new alpha');
    expectClean();
  });

  test('rejects a changed mode after real copying without replacing the old skill', async () => {
    seed('alpha');
    let retired = false;
    const copy = fs.promises.copyFile;
    spyOn(fs.promises, 'copyFile').mockImplementation(async (...args) => {
      await copy(...args);
      expect(fs.readdirSync(path.dirname(target('alpha')))).toEqual(['alpha']);
      retired = true;
    });
    const result = await install({ isCurrent: () => !retired });
    expect(result).toMatchObject({ ok: false, installed: [], error: { kind: AGENT_ERROR.CHANGED } });
    expect(body('alpha')).toBe('old alpha');
    expectClean();
  });

  test('retains the original skill when copying fails', async () => {
    seed('alpha');
    spyOn(fs.promises, 'copyFile').mockRejectedValue(new Error('copy failure'));
    const result = await install();
    expect(result).toMatchObject({ ok: true, installed: [], skipped: [{ skillName: 'alpha', reason: 'copy failure' }] });
    expect(body('alpha')).toBe('old alpha');
    expectClean();
  });

  test('returns earlier committed skills when a later copy loses its owner', async () => {
    seed('beta');
    let retired = false;
    const copy = fs.promises.copyFile;
    spyOn(fs.promises, 'copyFile').mockImplementation(async (...args) => {
      await copy(...args);
      if (String(args[0]).includes(path.sep + 'beta' + path.sep)) retired = true;
    });
    const result = await install({ selections: [{ skillDir: 'alpha' }, { skillDir: 'beta' }],
      isCurrent: () => !retired });
    expect(result).toMatchObject({ ok: false, installed: [{ skillName: 'alpha' }], error: { kind: AGENT_ERROR.CHANGED } });
    expect(body('alpha')).toBe('new alpha');
    expect(body('beta')).toBe('old beta');
    expectClean();
  });

  test('rejects a retired request before clone or destination creation', async () => {
    const result = await install({ isCurrent: () => false });
    expect(result).toMatchObject({ ok: false, installed: [], error: { kind: AGENT_ERROR.CHANGED } });
    expect(fs.existsSync(project)).toBe(false);
  });

  test('leaves a newly appeared target untouched without an overwrite decision', async () => {
    const copy = fs.promises.copyFile;
    spyOn(fs.promises, 'copyFile').mockImplementation(async (...args) => {
      await copy(...args);
      seed('alpha');
    });
    const result = await install({ conflictPolicy: 'prompt' });
    expect(result).toMatchObject({ ok: true, installed: [], skipped: [{ reason: 'Skill target appeared during installation; retry with a conflict decision' }] });
    expect(body('alpha')).toBe('old alpha');
    expectClean();
  });

  test.each(['oc1', 'oc2'])('retains completed progress through the %s bridge', async generation => {
    seed('beta');
    let runtime = { generation, profile: generation, endpoint: 'http://oc.test', epoch: 1 };
    const copy = fs.promises.copyFile;
    spyOn(fs.promises, 'copyFile').mockImplementation(async (...args) => {
      await copy(...args);
      if (String(args[0]).includes(path.sep + 'beta' + path.sep)) runtime = { ...runtime, profile: 'retired' };
    });
    const ctx = createCtx(project, undefined, generation);
    ctx.manager.getKernelRuntime = () => runtime;
    const result = await handleConfigBridgeMessage({ id: 'install', type: 'api:config/skills:install', payload: {
      source: 'openchamber-fixture/skills', scope: 'project', selections: [{ skillDir: 'alpha' }, { skillDir: 'beta' }], conflictPolicy: 'overwriteAll',
    } }, ctx, deps);
    expect(result).toMatchObject({ success: true, data: { ok: false, installed: [{ skillName: 'alpha' }], error: { kind: AGENT_ERROR.CHANGED } } });
    expect(result.data.error.message).toContain('Installed before the change: alpha');
    expect(ctx.restart.mock.calls).toHaveLength(0);
    expect(body('alpha')).toBe('new alpha');
    expect(body('beta')).toBe('old beta');
    expectClean();
  });

  test.each(['oc1', 'oc2'])('rejects a retired %s repository scan result', async generation => {
    let runtime = { generation, profile: generation, endpoint: 'http://oc.test', epoch: 1 };
    const ctx = createCtx(project, undefined, generation);
    ctx.manager.getKernelRuntime = () => runtime;
    const pending = handleConfigBridgeMessage({ id: 'scan', type: 'api:config/skills:scan', payload: { source: 'openchamber-fixture/skills' } }, ctx, deps);
    runtime = { ...runtime, profile: 'retired' };
    await expect(pending).rejects.toThrow('OpenCode runtime changed during config operation');
    expect(fs.existsSync(project)).toBe(false);
  });

  test('keeps skipAll skills unchanged', async () => {
    seed('alpha');
    const result = await install({ conflictPolicy: 'skipAll' });
    expect(result).toMatchObject({ ok: true, installed: [], skipped: [{ skillName: 'alpha' }] });
    expect(body('alpha')).toBe('old alpha');
    expectClean();
  });

  test('restores the original when the final replacement fails', async () => {
    seed('alpha');
    const rename = fs.renameSync;
    spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (path.basename(from) === 'skill') throw new Error('replacement failure');
      return rename(from, to);
    });
    const result = await install();
    expect(result).toMatchObject({ ok: true, installed: [], skipped: [{ reason: 'replacement failure' }] });
    expect(body('alpha')).toBe('old alpha');
    expectClean();
  });

  test('keeps the original backup when restoration also fails', async () => {
    seed('alpha');
    const rename = fs.renameSync;
    spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (path.basename(from) === 'skill' || path.basename(from) === 'backup') throw new Error('rename failure');
      return rename(from, to);
    });
    const result = await install();
    expect(result.installed).toEqual([]);
    expect(result.skipped[0].reason).toContain('original files remain at');
    const scratch = fs.readdirSync(path.dirname(path.dirname(target('alpha')))).find(name => name.startsWith('.openchamber-skill-'));
    expect(fs.readFileSync(path.join(path.dirname(path.dirname(target('alpha'))), scratch, 'backup', 'SKILL.md'), 'utf8')).toBe('old alpha');
  });
});

describe('VS Code asynchronous configuration owner', () => {
  afterEach(() => { mock.restore(); });

  for (const generation of ['oc1', 'oc2']) {
    const agentsPath = path.join(generation === 'oc1' ? OPENCODE_CONFIG_DIR : OPENCODE_CONFIG_DIR_V2, 'AGENTS.md');
    const setup = () => {
      // Module paths froze inside opencodeConfigTestHome, never the user's real home.
      expect(agentsPath.startsWith(process.env.XDG_CONFIG_HOME + path.sep)).toBe(true);
      fs.mkdirSync(path.dirname(agentsPath), { recursive: true });
      fs.writeFileSync(agentsPath, 'original instructions');
      let runtime = { generation, profile: generation, endpoint: 'http://oc.test', epoch: 1 };
      const ctx = createCtx(undefined, undefined, generation);
      ctx.manager.getKernelRuntime = () => runtime;
      return { ctx, retire: patch => { runtime = { ...runtime, ...patch }; } };
    };
    const save = ctx => handleConfigBridgeMessage({ id: 'save', type: 'api:behavior/agents-md:save', payload: { content: 'new instructions' } }, ctx, deps);
    const unchanged = () => {
      expect(fs.readFileSync(agentsPath, 'utf8')).toBe('original instructions');
      expect(fs.readdirSync(path.dirname(agentsPath)).filter(name => name.startsWith('.openchamber-agents-'))).toEqual([]);
    };

    test(generation + ' commits staged AGENTS.md and preserves response behavior', async () => {
      const { ctx } = setup();
      const result = await save(ctx);
      expect(result).toMatchObject({ success: true });
      expect(fs.readFileSync(agentsPath, 'utf8')).toBe('new instructions');
      expect(fs.readdirSync(path.dirname(agentsPath)).filter(name => name.startsWith('.openchamber-agents-'))).toEqual([]);
      expect(ctx.restart.mock.calls).toHaveLength(0);
    });

    test(generation + ' preserves AGENTS.md when its owner changes during mkdir', async () => {
      const { ctx, retire } = setup();
      const mkdir = fs.promises.mkdir;
      spyOn(fs.promises, 'mkdir').mockImplementation(async (...args) => { await mkdir(...args); retire({ profile: 'retired' }); });
      await expect(save(ctx)).rejects.toThrow('OpenCode runtime changed during config operation');
      unchanged();
    });

    test(generation + ' preserves AGENTS.md when its owner changes after staging', async () => {
      const { ctx, retire } = setup();
      const write = fs.promises.writeFile;
      spyOn(fs.promises, 'writeFile').mockImplementation(async (...args) => { await write(...args); retire({ epoch: 2 }); });
      await expect(save(ctx)).rejects.toThrow('OpenCode runtime changed during config operation');
      unchanged();
    });

    test(generation + ' preserves AGENTS.md after a preparation failure', async () => {
      const { ctx } = setup();
      spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('staging failure'));
      await expect(save(ctx)).rejects.toThrow('staging failure');
      unchanged();
    });

    test(generation + ' preserves AGENTS.md after a commit failure', async () => {
      const { ctx } = setup();
      spyOn(fsNative, 'renameSync').mockImplementation(() => { throw new Error('commit failure'); });
      await expect(save(ctx)).rejects.toThrow('commit failure');
      unchanged();
    });

    test(generation + ' rejects an old missing AGENTS.md response', async () => {
      const { ctx, retire } = setup();
      fs.unlinkSync(agentsPath);
      const read = fs.promises.readFile;
      spyOn(fs.promises, 'readFile').mockImplementation(async (...args) => { retire({ epoch: 2 }); return read(...args); });
      await expect(handleConfigBridgeMessage({ id: 'read', type: 'api:behavior/agents-md:get' }, ctx, deps)).rejects.toThrow('OpenCode runtime changed during config operation');
    });

    test.each(['GET', 'PUT', 'DELETE'])(generation + ' refuses supporting-file %s after discovery loses its owner', async method => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-vscode-support-owner-'));
      tempRoots.push(root);
      const dir = path.join(root, '.opencode', 'skills', 'reviewer');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: reviewer\ndescription: Fixture\n---\nReview');
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'original notes');
      const { ctx, retire } = setup();
      ctx.manager.getWorkingDirectory = () => root;
      const fetchSkills = async () => { retire({ profile: 'retired' }); return []; };
      await expect(handleConfigBridgeMessage({ id: 'file', type: 'api:config/skills/files', payload: { method, name: 'reviewer', filePath: 'notes.txt', content: 'replacement notes' } }, ctx, { ...deps, fetchOpenCodeSkillsFromApi: fetchSkills })).rejects.toThrow('OpenCode runtime changed during config operation');
      expect(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8')).toBe('original notes');
    });

    test.each(['PUT', 'DELETE'])(generation + ' retains normal supporting-file %s behavior', async method => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-vscode-support-normal-'));
      tempRoots.push(root);
      const dir = path.join(root, '.opencode', 'skills', 'reviewer');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: reviewer\ndescription: Fixture\n---\nReview');
      fs.writeFileSync(path.join(dir, 'notes.txt'), 'original notes');
      const { ctx } = setup();
      ctx.manager.getWorkingDirectory = () => root;
      const result = await handleConfigBridgeMessage({ id: 'file', type: 'api:config/skills/files', payload: { method, name: 'reviewer', filePath: 'notes.txt', content: 'replacement notes' } }, ctx, deps);
      expect(result).toMatchObject({ success: true });
      if (method === 'PUT') expect(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8')).toBe('replacement notes');
      else expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(false);
    });
  }
});
