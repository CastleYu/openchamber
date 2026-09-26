import { afterEach, describe, expect, mock, test } from 'bun:test';
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
