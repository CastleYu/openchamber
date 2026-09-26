import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeObjective = vi.hoisted(() => vi.fn(async () => undefined));
const readObjectiveForFork = vi.hoisted(() => vi.fn(async () => 'Inherited objective'));
const removeObjectiveForFork = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../session-goal/objectives.js', async (importOriginal) => ({
  ...await importOriginal(), writeObjective, readObjectiveForFork, removeObjectiveForFork,
}));
const createWorktree = vi.fn(async () => ({ path: '/repo/worktree', name: 'side', branch: 'side' }));
vi.mock('../git/index.js', () => ({
  createWorktree: (...args) => createWorktree(...args),
  getWorktreeBootstrapStatus: async () => ({ status: 'ready' }),
  resolvePrimaryWorktreeRoot: async (directory) => ({ root: directory }),
}));

const { registerOpenChamberSessionRoutes } = await import('./routes.js');

const identity = (generation, epoch = 1) => ({ generation, endpoint: 'http://opencode.test', epoch });
const oc1Catalog = { generation: 'oc1', providers: [{ id: 'openai', models: [{ id: 'gpt-5.5', variants: { high: {} } }] }],
  agents: [{ name: 'build', mode: 'primary' }, { name: 'plan', mode: 'primary' }], config: {} };
const oc2Catalog = { generation: 'oc2', models: [{ providerID: 'openai', modelID: 'gpt-5.5', variants: [{ id: 'high' }] }],
  agents: [{ id: 'build', name: 'Build', mode: 'primary' }, { id: 'plan', name: 'Plan', mode: 'primary' }], config: [] };

const setup = (generation = 'oc1', overrides = {}) => {
  let runtime = identity(generation);
  let userSeq = 0;
  const kernelOperations = {
    captureIdentity: vi.fn(() => runtime),
    getSelectionCatalog: vi.fn(async () => ({ data: generation === 'oc1' ? oc1Catalog : oc2Catalog })),
    createSession: vi.fn(async ({ directory }) => ({ data: { id: 'ses_new', directory } })),
    forkSession: vi.fn(async ({ directory }) => ({ data: { id: 'ses_fork', directory, title: 'Fork' } })),
    removeSession: vi.fn(async () => ({ data: true })),
    getSession: vi.fn(async () => ({ data: { id: 'ses_source', metadata: {}, raw: { model: { providerID: 'openai', id: 'gpt-5.5', variant: 'high' }, agent: 'plan' } } })),
    listMessages: vi.fn(async () => ({ data: { items: userSeq
      ? [{ id: `msg_${userSeq}`, role: 'user', created: 100 + userSeq, raw: { info: { model: { providerID: 'openai', modelID: 'gpt-5.5' }, agent: 'build' } } }]
      : [], order: 'asc' } })),
    listCommands: vi.fn(async () => ({ data: [] })),
    sendPrompt: vi.fn(async () => {
      userSeq += 1;
      return { data: generation === 'oc2' ? { id: 'inbox_1' } : null, accepted: true };
    }),
    sendCommand: vi.fn(async () => ({ data: null, accepted: true })),
    updateSession: vi.fn(async ({ sessionID, time }) => ({ data: { id: sessionID, time } })),
  };
  const archiveStore = { archive: vi.fn(async (ids, archivedAt) => ({ archived: ids.map((id) => ({ id, archivedAt })), failedIds: [] })),
    unarchive: vi.fn(async (ids) => ({ restored: ids.map((id) => ({ id, archivedAt: null })), failedIds: [] })),
    getAll: vi.fn(async () => ({ ses_old: 1700 })) };
  const sessionMetadataStore = { get: vi.fn(async () => ({ openchamber: { goal: 'old' } })),
    setSessionMetadata: vi.fn(async () => ({ openchamber: { pins: ['a'] } })),
    listUnmigrated: vi.fn(async () => ({ ses_old: { openchamber: { goal: 'old' } } })) };
  const events = vi.fn();
  const app = express();
  registerOpenChamberSessionRoutes(app, {
    kernelOperations, archiveStore, sessionMetadataStore,
    readSettingsFromDiskMigrated: async () => ({ defaultModel: 'openai/gpt-5.5', defaultAgent: 'build',
      projects: [{ id: 'proj_1', path: '/repo/app', defaultAgent: 'plan' }] }),
    sanitizeProjects: (projects) => projects,
    validateDirectoryPath: async (directory) => ({ ok: Boolean(directory), directory, error: 'Invalid directory' }),
    buildOpenCodeUrl: (path) => `http://opencode.test${path}`,
    getOpenCodeAuthHeaders: () => ({}),
    waitForOpenCodeReady: async () => undefined,
    broadcastGlobalUiEvent: events,
    ...overrides,
  });
  return { app, kernelOperations, archiveStore, sessionMetadataStore, events,
    changeEpoch: () => { runtime = identity(generation, 2); } };
};

beforeEach(() => {
  createWorktree.mockClear();
  writeObjective.mockReset(); writeObjective.mockResolvedValue(undefined);
  readObjectiveForFork.mockReset(); readObjectiveForFork.mockResolvedValue('Inherited objective');
  removeObjectiveForFork.mockReset(); removeObjectiveForFork.mockResolvedValue(undefined);
});

describe('OpenChamber session HTTP contracts', () => {
  it.each(['oc1', 'oc2'])('creates and dispatches with %s selection and the captured runtime', async (generation) => {
    const { app, kernelOperations } = setup(generation);
    const response = await request(app).post('/api/openchamber/sessions').send({ directory: '/repo/app',
      prompt: 'Run this' }).expect(200);
    expect(response.body).toMatchObject({ sessionId: 'ses_new', directory: '/repo/app',
      model: { providerID: 'openai', modelID: 'gpt-5.5' }, agent: 'plan', promptDispatched: true });
    expect(kernelOperations.createSession).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/repo/app', expectedIdentity: identity(generation),
    }));
    const send = kernelOperations.sendPrompt.mock.calls[0][0].request;
    expect(send).toMatchObject(identity(generation));
    if (generation === 'oc1') expect(send.body.parts).toContainEqual({ type: 'text', text: 'Run this' });
    else expect(send).toMatchObject({ body: { text: 'Run this' },
      model: { providerID: 'openai', id: 'gpt-5.5' }, agent: 'plan' });
  });

  it('keeps OC1 archive response and per-session partial failures', async () => {
    const { app, kernelOperations } = setup();
    kernelOperations.updateSession.mockImplementation(async ({ sessionID }) => {
      if (sessionID === 'ses_bad') throw new Error('write failed');
      return { data: { id: sessionID, time: { archived: 1700 } } };
    });
    const response = await request(app).post('/api/openchamber/sessions/archive')
      .send({ directory: '/repo/app', ids: ['ses_a', 'ses_bad', 'ses_c'], archivedAt: 1700 }).expect(200);
    expect(response.body).toMatchObject({ directory: '/repo/app', failedIds: ['ses_bad'] });
    expect(response.body.archived.map((item) => item.id)).toEqual(['ses_a', 'ses_c']);
    expect(kernelOperations.updateSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'ses_a', directory: '/repo/app', time: { archived: 1700 }, expectedIdentity: identity('oc1'),
    }));
  });

  it('uses OC2 local archive and unarchive response shapes', async () => {
    const { app, archiveStore, events } = setup('oc2');
    const archived = await request(app).post('/api/openchamber/sessions/archive')
      .send({ ids: ['ses_a'], archivedAt: 1700 }).expect(200);
    expect(archived.body).toEqual({ archived: [{ id: 'ses_a', archivedAt: 1700 }], failedIds: [] });
    const restored = await request(app).post('/api/openchamber/sessions/unarchive')
      .send({ ids: ['ses_a'] }).expect(200);
    expect(restored.body).toEqual({ restored: [{ id: 'ses_a', archivedAt: null }], failedIds: [] });
    expect(archiveStore.archive).toHaveBeenCalledWith(['ses_a'], 1700, expect.any(Function));
    expect(events).toHaveBeenCalledWith({ type: 'openchamber:session-archived',
      properties: { sessionID: 'ses_a', archivedAt: null } });
  });

  it('keeps OC2 metadata route payload and full-state response', async () => {
    const { app, sessionMetadataStore, events } = setup('oc2');
    const read = await request(app).get('/api/openchamber/sessions/ses_a/metadata?directory=%2Frepo%2Fapp').expect(200);
    expect(read.body).toEqual({ metadata: { openchamber: { goal: 'old' } } });
    const written = await request(app).post('/api/openchamber/sessions/ses_a/metadata')
      .send({ directory: '/repo/app', patch: { openchamber: { goal: null, pins: ['a'] } } }).expect(200);
    expect(written.body).toEqual({ metadata: { openchamber: { pins: ['a'] } } });
    expect(sessionMetadataStore.setSessionMetadata).toHaveBeenCalledWith('ses_a',
      { openchamber: { goal: null, pins: ['a'] } }, { directory: '/repo/app' });
    expect(events).toHaveBeenCalledWith({ type: 'openchamber:session-metadata',
      properties: { sessionID: 'ses_a', metadata: written.body.metadata } });
  });

  it('keeps new OC2 routes unavailable on OC1', async () => {
    const { app, archiveStore, sessionMetadataStore } = setup('oc1');
    await request(app).post('/api/openchamber/sessions/unarchive').send({ ids: ['ses_a'] }).expect(404);
    await request(app).post('/api/openchamber/sessions/ses_a/metadata').send({ patch: { a: 1 } }).expect(404);
    expect(archiveStore.unarchive).not.toHaveBeenCalled();
    expect(sessionMetadataStore.setSessionMetadata).not.toHaveBeenCalled();
  });

  it('rejects stale OC2 archive before persisting after deferred work', async () => {
    const { app, archiveStore, changeEpoch } = setup('oc2');
    archiveStore.archive.mockImplementation(async (_ids, _at, guard) => { changeEpoch(); guard(); });
    await request(app).post('/api/openchamber/sessions/archive').send({ ids: ['ses_a'] }).expect(409);
  });

  it('rejects invalid selection before creating a worktree or session', async () => {
    const { app, kernelOperations } = setup('oc2');
    await request(app).post('/api/openchamber/sessions').send({ directory: '/repo/app',
      prompt: 'Run', agent: 'missing', worktree: { name: 'side' } }).expect(400);
    expect(createWorktree).not.toHaveBeenCalled();
    expect(kernelOperations.createSession).not.toHaveBeenCalled();
  });

  it('resolves an OC2 Auto default before goal or prompt mutation', async () => {
    const seen = [];
    const resolvePromptBody = vi.fn(async (body) => {
      seen.push(structuredClone(body.model));
      body.model = { providerID: 'openai', modelID: 'gpt-5.5' };
      body.variant = 'high';
    });
    const { app, kernelOperations } = setup('oc2', {
      readSettingsFromDiskMigrated: async () => ({ defaultModel: 'openchamber/auto',
        projects: [{ id: 'proj_1', path: '/repo/app' }] }),
      resolvePromptBody,
    });
    const response = await request(app).post('/api/openchamber/sessions')
      .send({ directory: '/repo/app', prompt: 'Run' }).expect(200);
    expect(seen).toEqual([{ providerID: 'openchamber', modelID: 'auto' }]);
    expect(resolvePromptBody).toHaveBeenCalledWith(expect.any(Object),
      { sessionId: 'ses_new', directory: '/repo/app' });
    expect(kernelOperations.sendPrompt.mock.calls[0][0].request.model).toEqual({
      id: 'gpt-5.5', providerID: 'openai', variant: 'high',
    });
    expect(response.body.model).toEqual({ providerID: 'openai', modelID: 'gpt-5.5' });
  });

  it('forks with before-message selection and reports the fork on prompt failure', async () => {
    const { app, kernelOperations } = setup('oc2');
    kernelOperations.sendPrompt.mockRejectedValueOnce(new Error('dispatch failed'));
    const response = await request(app).post('/api/openchamber/sessions/ses_source/fork')
      .send({ directory: '/repo/app', messageId: 'msg_before', prompt: 'Try again', model: 'openai/gpt-5.5' })
      .expect(500);
    expect(kernelOperations.forkSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'ses_source', messageID: 'msg_before', expectedIdentity: identity('oc2'),
    }));
    expect(response.body).toMatchObject({ partial: true, partialAction: 'fork-created',
      sessionId: 'ses_fork', directory: '/repo/app' });
  });

  it('repairs an OC2 fork goal before dispatching the prompt', async () => {
    const { app, kernelOperations } = setup('oc2');
    const order = [];
    kernelOperations.forkSession.mockResolvedValue({ data: { id: 'ses_fork', directory: '/repo/app', metadata: { openchamber: {
      btwSessionID: 'ses_btw', goal: { id: 'goal_1', status: 'active', objectiveFile: true },
    } } } });
    kernelOperations.getSession.mockResolvedValue({ data: { id: 'ses_fork', metadata: { openchamber: { goal: { id: 'goal_1' } } } } });
    writeObjective.mockImplementation(async () => { order.push('objective'); });
    kernelOperations.updateSession.mockImplementation(async ({ sessionID }) => {
      order.push('metadata'); return { data: { id: sessionID } };
    });
    kernelOperations.sendPrompt.mockImplementation(async () => {
      order.push('prompt'); return { data: { id: 'inbox_1' }, accepted: true };
    });
    await request(app).post('/api/openchamber/sessions/ses_source/fork')
      .send({ directory: '/repo/app', prompt: 'Try again', model: 'openai/gpt-5.5' }).expect(200);
    expect(readObjectiveForFork).toHaveBeenCalledWith('ses_source');
    expect(writeObjective).toHaveBeenCalledWith('ses_fork', 'Inherited objective');
    expect(kernelOperations.updateSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'ses_fork', expectedIdentity: identity('oc2'),
      metadata: { openchamber: { btwSessionID: null, goal: { status: 'paused', statusReason: 'paused in fork' } } },
    }));
    expect(order).toEqual(['objective', 'metadata', 'prompt']);
  });

  it('removes a new OC2 fork when inheritance fails before dispatch', async () => {
    const { app, kernelOperations } = setup('oc2');
    kernelOperations.forkSession.mockResolvedValue({ data: { id: 'ses_fork', directory: '/repo/app', metadata: { openchamber: {
      btwSessionID: 'ses_btw', goal: { id: 'goal_1', status: 'active' },
    } } } });
    kernelOperations.updateSession.mockRejectedValueOnce(new Error('metadata repair failed'));
    const response = await request(app).post('/api/openchamber/sessions/ses_source/fork')
      .send({ directory: '/repo/app', prompt: 'Try again', model: 'openai/gpt-5.5' }).expect(500);
    expect(response.body.error).toContain('metadata repair failed');
    expect(response.body.partial).toBeUndefined();
    expect(kernelOperations.removeSession).toHaveBeenCalledExactlyOnceWith({
      sessionID: 'ses_fork', directory: '/repo/app', expectedIdentity: identity('oc2'),
    });
    expect(kernelOperations.sendPrompt).not.toHaveBeenCalled();
  });

  it.each(['false', 'error'])('reports a partial fork when inheritance rollback returns %s', async (failure) => {
    const { app, kernelOperations } = setup('oc2');
    kernelOperations.forkSession.mockResolvedValue({ data: { id: 'ses_fork', directory: '/repo/app', metadata: { openchamber: {
      btwSessionID: 'ses_btw',
    } } } });
    kernelOperations.updateSession.mockRejectedValueOnce(new Error('metadata repair failed'));
    if (failure === 'false') kernelOperations.removeSession.mockResolvedValue({ data: false });
    else kernelOperations.removeSession.mockRejectedValue(new Error('delete failed'));
    const response = await request(app).post('/api/openchamber/sessions/ses_source/fork')
      .send({ directory: '/repo/app', prompt: 'Try again', model: 'openai/gpt-5.5' }).expect(500);
    expect(response.body).toMatchObject({ partial: true, partialAction: 'fork-created', sessionId: 'ses_fork' });
    expect(response.body.error).toContain('could not be removed');
    expect(kernelOperations.sendPrompt).not.toHaveBeenCalled();
  });

  it('preserves the OC1 fork path without reading OC2 objective files', async () => {
    const { app } = setup('oc1');
    await request(app).post('/api/openchamber/sessions/ses_source/fork')
      .send({ directory: '/repo/app', prompt: 'Try again', model: 'openai/gpt-5.5' }).expect(200);
    expect(readObjectiveForFork).not.toHaveBeenCalled();
  });

  it('stops an OC2 fork after a runtime switch during objective read', async () => {
    const { app, kernelOperations, changeEpoch } = setup('oc2');
    kernelOperations.forkSession.mockResolvedValue({ data: { id: 'ses_fork', directory: '/repo/app', metadata: { openchamber: {
      goal: { id: 'goal_1', status: 'active', objectiveFile: true },
    } } } });
    readObjectiveForFork.mockImplementation(async () => { changeEpoch(); return 'Inherited objective'; });
    const response = await request(app).post('/api/openchamber/sessions/ses_source/fork')
      .send({ directory: '/repo/app', prompt: 'Try again', model: 'openai/gpt-5.5' }).expect(409);
    expect(response.body).toMatchObject({ partial: true, partialAction: 'fork-created', sessionId: 'ses_fork' });
    expect(writeObjective).not.toHaveBeenCalled();
    expect(kernelOperations.updateSession).not.toHaveBeenCalled();
    expect(kernelOperations.removeSession).not.toHaveBeenCalled();
    expect(kernelOperations.sendPrompt).not.toHaveBeenCalled();
  });

  it('stops a real goal setup after a late runtime switch before writing session metadata', async () => {
    const { app, kernelOperations, changeEpoch } = setup('oc2');
    writeObjective.mockImplementationOnce(async () => { changeEpoch(); });
    const response = await request(app).post('/api/openchamber/sessions').send({
      directory: '/repo/app', prompt: 'Finish this task', model: 'openai/gpt-5.5', goal: true,
    }).expect(500);
    expect(response.body.error).toContain('runtime changed');
    expect(kernelOperations.updateSession).not.toHaveBeenCalled();
    expect(kernelOperations.sendPrompt).not.toHaveBeenCalled();
  });
});
