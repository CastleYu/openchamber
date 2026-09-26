import { beforeEach, describe, expect, it, mock } from 'bun:test';

const gitService = {
  getGitRangeFiles: mock(),
  getGitRangeDiff: mock(),
};

const sdkClient = {
  v2: {
    model: {
      list: mock(),
    },
  },
  session: {
    create: mock(),
    promptAsync: mock(),
    messages: mock(),
    delete: mock(),
  },
};

const createOpencodeClient = mock(() => sdkClient);
const v2Client = { model: { list: mock() }, generate: { text: mock() } };
const makeV2Client = mock(() => v2Client);
const rawFetch = mock(async () => {
  throw new Error('raw fetch should not be used');
});

mock.module('./gitService', () => gitService);
mock.module('@opencode-ai/sdk/v2', () => ({ createOpencodeClient }));
mock.module('@opencode/client', () => ({ OpenCode: { make: makeV2Client } }));

const manager = (generation = 'oc1') => {
  const descriptor = { generation, endpoint: 'http://opencode.test', epoch: 1 };
  return {
    getStatus: () => 'connected',
    getApiUrl: () => 'http://opencode.test',
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer test' }),
    getKernelRuntime: () => descriptor,
    refreshKernelRuntime: async () => descriptor,
    onStatusChange: () => ({ dispose() {} }),
  };
};

const { handleSpecialGitBridgeMessage } = await import('./bridge-git-special-runtime');

describe('bridge git special runtime', () => {
  beforeEach(() => {
    gitService.getGitRangeFiles.mockReset();
    gitService.getGitRangeDiff.mockReset();
    sdkClient.v2.model.list.mockReset();
    sdkClient.session.create.mockReset();
    sdkClient.session.promptAsync.mockReset();
    sdkClient.session.messages.mockReset();
    sdkClient.session.delete.mockReset();
    createOpencodeClient.mockReset();
    v2Client.model.list.mockReset();
    v2Client.generate.text.mockReset();
    makeV2Client.mockReset();
    rawFetch.mockClear();

    globalThis.fetch = rawFetch;
    createOpencodeClient.mockImplementation(() => sdkClient);
    makeV2Client.mockImplementation(() => v2Client);
    gitService.getGitRangeFiles.mockImplementation(async () => ['src/a.ts']);
    gitService.getGitRangeDiff.mockImplementation(async () => ({ diff: 'diff --git a/src/a.ts b/src/a.ts\n+new line' }));
    sdkClient.v2.model.list.mockImplementation(async () => ({
      data: { data: [{ providerID: 'anthropic', id: 'claude-sonnet-4-5' }] },
      error: undefined,
    }));
    sdkClient.session.create.mockImplementation(async () => ({
      data: { id: 'ses_1' },
      error: undefined,
    }));
    sdkClient.session.promptAsync.mockImplementation(async () => ({ data: true, error: undefined }));
    sdkClient.session.messages.mockImplementation(async () => ({
      data: [{
        info: { role: 'assistant', finish: 'stop' },
        parts: [{ type: 'text', text: '{"title":"PR title","body":"PR body"}' }],
      }],
      error: undefined,
    }));
    sdkClient.session.delete.mockImplementation(async () => ({ data: true, error: undefined }));
    v2Client.model.list.mockImplementation(async () => ({ data: [{ providerID: 'anthropic', id: 'claude-sonnet-4-5' }] }));
    v2Client.generate.text.mockImplementation(async () => ({ text: '{"title":"PR title","body":"PR body"}' }));
  });

  it('generates PR descriptions through the OpenCode SDK session flow', async () => {
    const response = await handleSpecialGitBridgeMessage({
      id: '1',
      type: 'api:git/pr-description',
      payload: {
        directory: '/repo',
        base: 'main',
        head: 'feature',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4-5',
      },
    }, {
      manager: manager(),
    }, {
      readSettings: () => ({}),
      execGit: mock(),
    });

    expect(response).toEqual({
      id: '1',
      type: 'api:git/pr-description',
      success: true,
      data: { title: 'PR title', body: 'PR body' },
    });
    expect(rawFetch).not.toHaveBeenCalled();
    expect(createOpencodeClient).toHaveBeenCalledWith({
      baseUrl: 'http://opencode.test',
      headers: { Authorization: 'Bearer test' },
    });
    expect(sdkClient.v2.model.list).toHaveBeenCalled();
    expect(sdkClient.session.create).toHaveBeenCalledWith({
      directory: '/repo',
      title: 'Git Generation',
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(sdkClient.session.promptAsync).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'ses_1',
      directory: '/repo',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(sdkClient.session.messages).toHaveBeenCalledWith({
      sessionID: 'ses_1',
      directory: '/repo',
      limit: 10,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(sdkClient.session.delete).toHaveBeenCalledWith({ sessionID: 'ses_1' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('uses OpenCode 2 model and generate APIs without creating a session', async () => {
    const response = await handleSpecialGitBridgeMessage({
      id: '2', type: 'api:git/pr-description',
      payload: { directory: '/repo', base: 'main', head: 'feature', providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
    }, { manager: manager('oc2') }, { readSettings: () => ({}), execGit: mock() });
    expect(response?.success).toBe(true);
    expect(v2Client.model.list).toHaveBeenCalled();
    expect(v2Client.generate.text).toHaveBeenCalledWith(expect.objectContaining({ model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' } }), expect.anything());
    expect(sdkClient.session.create).not.toHaveBeenCalled();
  });

  it('does not generate when kernel generation remains unknown', async () => {
    const response = await handleSpecialGitBridgeMessage({
      id: '3', type: 'api:git/pr-description', payload: { directory: '/repo', base: 'main', head: 'feature' },
    }, { manager: manager('unknown') }, { readSettings: () => ({}), execGit: mock() });
    expect(response?.success).toBe(false);
    expect(sdkClient.session.create).not.toHaveBeenCalled();
    expect(v2Client.generate.text).not.toHaveBeenCalled();
  });

  it('discards a completed OC2 generation after the kernel changes', async () => {
    const selected = manager('oc2');
    let epoch = 1;
    selected.getKernelRuntime = () => ({ generation: 'oc2', endpoint: 'http://opencode.test', epoch });
    v2Client.generate.text.mockImplementation(async () => {
      epoch = 2;
      return { text: '{"title":"stale","body":"stale"}' };
    });
    const response = await handleSpecialGitBridgeMessage({
      id: '4', type: 'api:git/pr-description', payload: { directory: '/repo', base: 'main', head: 'feature' },
    }, { manager: selected }, { readSettings: () => ({}), execGit: mock() });
    expect(response?.success).toBe(false);
    expect(response?.error).toContain('connection changed');
  });

  it('does not delete an OC1 session through a replaced connection', async () => {
    const selected = manager('oc1');
    let epoch = 1;
    selected.getKernelRuntime = () => ({ generation: 'oc1', endpoint: 'http://opencode.test', epoch });
    sdkClient.session.promptAsync.mockImplementation(async () => {
      epoch = 2;
      return { data: true, error: undefined };
    });
    const response = await handleSpecialGitBridgeMessage({
      id: '5', type: 'api:git/pr-description', payload: { directory: '/repo', base: 'main', head: 'feature' },
    }, { manager: selected }, { readSettings: () => ({}), execGit: mock() });
    expect(response?.success).toBe(false);
    expect(sdkClient.session.delete).not.toHaveBeenCalled();
  });
});
