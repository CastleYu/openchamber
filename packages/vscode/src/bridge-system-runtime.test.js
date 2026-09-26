import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createServer } from 'node:http';

const executeCommand = mock(async () => undefined);
const updateWorkspaceFolders = mock(async (start, deleteCount, ...foldersToAdd) => {
  for (const folder of foldersToAdd) {
    currentWorkspaceFolders = [...currentWorkspaceFolders, { name: folder.uri.fsPath.split('/').pop(), uri: folder.uri }];
  }
  return true;
});
let currentWorkspaceFolders = [];

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

mock.module('vscode', () => ({
  commands: { executeCommand },
  workspace: {
    get workspaceFolders() {
      return currentWorkspaceFolders;
    },
    updateWorkspaceFolders,
  },
  Uri: {
    file: (fsPath) => ({ scheme: 'file', fsPath }),
  },
  Position,
  Range,
}));

mock.module('./opencodeConfig', () => ({
  removeProviderConfig: mock(),
  getProviderSources: mock(),
  upsertProviderConfig: mock(),
}));
const v2Upsert = mock(() => ({ providerId: 'custom', path: '/tmp/config', config: { name: 'Custom' } }));
const v2Remove = mock(() => true);
mock.module('./opencodeConfigV2', () => ({
  getProviderSources: mock(() => ({ auth: { exists: false } })),
  getStoredProviderConfig: mock(() => ({ name: 'Custom' })),
  upsertProviderConfig: v2Upsert,
  removeProviderConfig: v2Remove,
}));
mock.module('./opencodeAuthV2', () => ({ getProviderAuth: mock(() => ({ type: 'api', key: 'test' })) }));
mock.module('./opencodeAuth', () => ({
  getProviderAuth: mock(),
  removeProviderAuth: mock(),
}));
mock.module('./quotaProviders', () => ({
  fetchQuotaForProvider: mock(),
  listConfiguredQuotaProviders: mock(),
}));
mock.module('./opencodeGoQuota', () => ({ fetchOpenCodeGoUsage: mock() }));
mock.module('./quotaCredentials', () => ({
  credentialStatus: mock(),
  deleteCredential: mock(),
  importCursorCredential: mock(),
  normalizeCredential: mock(),
  readCredential: mock(),
  validateCredential: mock(),
  writeCredential: mock(),
}));
mock.module('./sessionActivityWatcher', () => ({ getSessionActivitySnapshot: mock() }));

const { handleSystemBridgeMessage } = await import('./bridge-system-runtime.ts');

const deps = {
  resolveUserPath: (value) => value,
  fetchModelsMetadata: async () => ({}),
  updateCheckUrl: 'https://example.com/update-check',
  clientReloadDelayMs: 800,
};

const managerFor = (generation) => ({
  getKernelRuntime: () => ({ generation, endpoint: 'http://oc.test', epoch: 1 }),
  refreshKernelRuntime: async () => ({ generation, endpoint: 'http://oc.test', epoch: 1 }),
  getWorkingDirectory: () => '/repo',
  restart: mock(async () => undefined),
});

describe('VS Code provider and session state generations', () => {
  test('keeps OC1 archive writes on native session PATCH routes', async () => {
    const requests = [];
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ path: new URL(req.url, 'http://fixture').pathname, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'ses_1', directory: '/repo', time: { created: 1, updated: 2 } }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const manager = {
      getKernelRuntime: () => ({ generation: 'oc1', endpoint, epoch: 1 }),
      getStatus: () => 'connected', getApiUrl: () => endpoint, getOpenCodeAuthHeaders: () => ({}),
      getWorkingDirectory: () => '/repo', onStatusChange: () => ({ dispose: () => {} }),
    };
    try {
      const archived = await handleSystemBridgeMessage({ id: 'archive', type: 'api:sessions/archive',
        payload: { ids: ['ses_1'], archivedAt: 42, directory: '/repo' } }, { manager }, deps);
      const restored = await handleSystemBridgeMessage({ id: 'unarchive', type: 'api:sessions/unarchive',
        payload: { ids: ['ses_1'], directory: '/repo' } }, { manager }, deps);
      expect(archived?.success).toBe(true);
      expect(restored?.success).toBe(true);
      expect(requests).toEqual([
        { path: '/session/ses_1', body: { time: { archived: 42 } } },
        { path: '/session/ses_1', body: { time: { archived: null } } },
      ]);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });

  test('merges OC1 metadata through native GET and PATCH', async () => {
    let metadata = { openchamber: { keep: 'yes', remove: 'x' } };
    const writes = [];
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (req.method === 'PATCH') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        metadata = body.metadata;
        writes.push({ path: new URL(req.url, 'http://fixture').pathname, body });
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'ses_1', directory: '/repo', metadata }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const manager = {
      getKernelRuntime: () => ({ generation: 'oc1', endpoint, epoch: 1 }),
      getApiUrl: () => endpoint, getOpenCodeAuthHeaders: () => ({}), getWorkingDirectory: () => '/repo',
    };
    try {
      const result = await handleSystemBridgeMessage({ id: 'metadata', type: 'api:sessions/metadata:set',
        payload: { sessionId: 'ses_1', patch: { openchamber: { remove: null, added: true } }, directory: '/repo' } }, { manager }, deps);
      expect(result).toMatchObject({ success: true, data: { metadata: { openchamber: { keep: 'yes', added: true } } } });
      expect(writes).toEqual([{ path: '/session/ses_1', body: { metadata: { openchamber: { keep: 'yes', added: true } } } }]);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
  test('rejects unknown generation before credential or config writes', async () => {
    const manager = managerFor('unknown');
    const result = await handleSystemBridgeMessage({ id: 'unknown', type: 'api:provider/auth:delete',
      payload: { providerId: 'custom', scope: 'all' } }, { manager }, deps);
    expect(result).toMatchObject({ success: false, error: 'OpenCode kernel is not ready' });
    expect(v2Remove).not.toHaveBeenCalled();
  });

  test('keeps OC2 credentials under OpenCode and writes provider config through v2', async () => {
    const manager = managerFor('oc2');
    const denied = await handleSystemBridgeMessage({ id: 'auth', type: 'api:provider/auth:delete',
      payload: { providerId: 'custom', scope: 'auth' } }, { manager }, deps);
    expect(denied).toMatchObject({ success: false });
    const saved = await handleSystemBridgeMessage({ id: 'provider', type: 'api:provider:upsert',
      payload: { providerId: 'custom', config: { name: 'Custom', npm: '@ai-sdk/openai-compatible' }, scope: 'project', directory: '/repo' } }, { manager }, deps);
    expect(saved).toMatchObject({ success: true, data: { requiresReload: false } });
    expect(v2Upsert).toHaveBeenCalled();
    expect(manager.restart).not.toHaveBeenCalled();
  });

  test('routes OC2 metadata to the scoped store', async () => {
    const manager = managerFor('oc2');
    const getMetadata = mock(async () => ({ openchamber: { goal: 'active' } }));
    const result = await handleSystemBridgeMessage({ id: 'metadata', type: 'api:sessions/metadata:get',
      payload: { sessionId: 'ses_1', directory: '/repo' } }, { manager }, { ...deps, sessionState: { getMetadata } });
    expect(result).toEqual({ id: 'metadata', type: 'api:sessions/metadata:get', success: true,
      data: { metadata: { openchamber: { goal: 'active' } } } });
    expect(getMetadata).toHaveBeenCalledWith('ses_1', '/repo');
  });
});

describe('VS Code system bridge editor:openFile', () => {
  beforeEach(() => {
    executeCommand.mockClear();
    updateWorkspaceFolders.mockClear();
    currentWorkspaceFolders = [];
  });

  test('uses vscode.open so VS Code can select the notebook editor', async () => {
    const response = await handleSystemBridgeMessage({
      id: 'open-notebook',
      type: 'editor:openFile',
      payload: { path: '/workspace/notebook.ipynb' },
    }, undefined, deps);

    expect(response).toEqual({ id: 'open-notebook', type: 'editor:openFile', success: true });
    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      { scheme: 'file', fsPath: '/workspace/notebook.ipynb' },
      {},
    );
  });

  test('preserves line and column selection for regular files', async () => {
    await handleSystemBridgeMessage({
      id: 'open-text',
      type: 'editor:openFile',
      payload: { path: '/workspace/source.ts', line: 4, column: 7 },
    }, undefined, deps);

    const position = new Position(3, 7);
    expect(executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      { scheme: 'file', fsPath: '/workspace/source.ts' },
      { selection: new Range(position, position) },
    );
  });
});

describe('VS Code system bridge api:workspace:addFolder', () => {
  beforeEach(() => {
    updateWorkspaceFolders.mockClear();
    currentWorkspaceFolders = [];
  });

  test('adds a folder to the workspace and returns the folder list', async () => {
    currentWorkspaceFolders = [{ name: 'project-one', uri: { fsPath: '/workspace/project-one' } }];

    const response = await handleSystemBridgeMessage({
      id: 'add-folder',
      type: 'api:workspace:addFolder',
      payload: { path: '/home/user/my-project' },
    }, undefined, deps);

    expect(response).toEqual({
      id: 'add-folder',
      type: 'api:workspace:addFolder',
      success: true,
      data: {
        workspaceFolders: [
          { name: 'my-project', path: '/home/user/my-project' },
          { name: 'project-one', path: '/workspace/project-one' },
        ],
      },
    });
    expect(updateWorkspaceFolders).toHaveBeenCalledWith(
      1,
      null,
      { uri: { scheme: 'file', fsPath: '/home/user/my-project' } },
    );
  });

  test('does not duplicate an already-open workspace folder', async () => {
    currentWorkspaceFolders = [{ name: 'project-one', uri: { fsPath: '/workspace/project-one' } }];

    const response = await handleSystemBridgeMessage({
      id: 'add-existing',
      type: 'api:workspace:addFolder',
      payload: { path: '/workspace/project-one' },
    }, undefined, deps);

    expect(response).toEqual({
      id: 'add-existing',
      type: 'api:workspace:addFolder',
      success: true,
      data: {
        workspaceFolders: [{ name: 'project-one', path: '/workspace/project-one' }],
      },
    });
    expect(updateWorkspaceFolders).not.toHaveBeenCalled();
  });

  test('returns an error when VS Code rejects the folder add', async () => {
    updateWorkspaceFolders.mockResolvedValue(false);

    const response = await handleSystemBridgeMessage({
      id: 'add-rejected',
      type: 'api:workspace:addFolder',
      payload: { path: '/home/user/other' },
    }, undefined, deps);

    expect(response).toEqual({
      id: 'add-rejected',
      type: 'api:workspace:addFolder',
      success: false,
      error: 'Failed to add workspace folder',
    });
  });

  test('dedupes an already-open folder with a lowercase Windows drive letter', async () => {
    // VS Code reports workspace folder paths with lowercase drive letters
    // (d:\...), while the bridge normalizes the incoming path to uppercase
    // (D:\...). The comparison must normalize both sides.
    currentWorkspaceFolders = [{ name: 'project-one', uri: { fsPath: 'd:\\work\\project-one' } }];

    const response = await handleSystemBridgeMessage({
      id: 'add-win-dedupe',
      type: 'api:workspace:addFolder',
      payload: { path: 'D:\\work\\project-one' },
    }, undefined, deps);

    expect(response).toEqual({
      id: 'add-win-dedupe',
      type: 'api:workspace:addFolder',
      success: true,
      data: {
        workspaceFolders: [{ name: 'project-one', path: 'D:\\work\\project-one' }],
      },
    });
    expect(updateWorkspaceFolders).not.toHaveBeenCalled();
  });

  test('rejects a missing path', async () => {
    const response = await handleSystemBridgeMessage({
      id: 'add-missing',
      type: 'api:workspace:addFolder',
      payload: {},
    }, undefined, deps);

    expect(response).toEqual({
      id: 'add-missing',
      type: 'api:workspace:addFolder',
      success: false,
      error: 'Directory path is required',
    });
    expect(updateWorkspaceFolders).not.toHaveBeenCalled();
  });
});
