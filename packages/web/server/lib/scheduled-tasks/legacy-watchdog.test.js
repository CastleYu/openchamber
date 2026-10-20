import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { createProjectConfigRuntime } from '../projects/project-config.js';
import { createScheduledTasksRuntime } from './runtime.js';

const task = {
  id: 'watchdog-task',
  name: 'Watchdog task',
  enabled: false,
  schedule: { kind: 'daily', times: ['08:00'], timezone: 'UTC' },
  execution: { prompt: 'Do the work', providerID: 'openai', modelID: 'gpt-5' },
};

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const fixture = async ({ profile = 'legacy-1.2.27', overrides = {}, maxRunDurationMs = 60 } = {}) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oc-legacy-watchdog-'));
  const projectPath = path.join(root, 'project');
  await mkdir(path.join(projectPath, '.agents', 'loops'), { recursive: true });
  const projectConfigRuntime = createProjectConfigRuntime({
    fsPromises: await import('fs/promises'),
    path,
    projectsDirPath: path.join(root, 'config'),
    createTaskID: () => task.id,
  });
  await projectConfigRuntime.upsertScheduledTask('project', task);
  let identityProfile = profile;
  const createSession = vi.fn(async () => ({ data: { id: 'session-1' } }));
  const sendPrompt = vi.fn(async () => ({}));
  const knowledge = {
    resolvePendingForSession: vi.fn(async () => ({ text: '', signature: '' })),
    recordDelivered: vi.fn(async () => {}),
  };
  const runtime = createScheduledTasksRuntime({
    projectConfigRuntime,
    listProjects: async () => [{ id: 'project', path: projectPath }],
    kernelOperations: {
      captureIdentity: () => ({ generation: 'oc1', profile: identityProfile, endpoint: 'http://local', epoch: 1 }),
      createSession,
      sendPrompt,
      ...overrides.kernelOperations,
    },
    sessionKnowledgeRuntime: overrides.sessionKnowledgeRuntime ?? knowledge,
    setSessionAutoAccept: overrides.setSessionAutoAccept,
    waitForOpenCodeReady: async () => {},
    buildOpenCodeUrl: () => 'http://local',
    getOpenCodeAuthHeaders: () => ({}),
    maxRunDurationMs,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  return {
    root, runtime, projectConfigRuntime, createSession, sendPrompt, knowledge,
    retire: () => { identityProfile = 'legacy-1.2.28'; },
    cleanup: async () => { runtime.stop(); await rm(root, { recursive: true, force: true }); },
  };
};

afterEach(() => vi.useRealTimers());

describe('legacy scheduled task watchdog', () => {
  it('does not continue after a timed-out session creation resolves', async () => {
    const gate = deferred();
    const entered = deferred();
    const setSessionAutoAccept = vi.fn();
    const f = await fixture({ overrides: {
      kernelOperations: { createSession: vi.fn(() => { entered.resolve(); return gate.promise; }) },
      setSessionAutoAccept,
    } });
    await f.projectConfigRuntime.upsertScheduledTask('project', {
      ...task, execution: { ...task.execution, goalEnabled: true, permissionAutoAccept: true },
    });
    try {
      await f.runtime.start();
      const run = f.runtime.runNow('project', task.id);
      await entered.promise;
      const result = await run;
      expect(result).toMatchObject({ ok: false, status: 'error', error: 'Scheduled task timed out; remote outcome is unknown' });
      gate.resolve({ data: { id: 'session-late' } });
      await settle();
      expect(setSessionAutoAccept).not.toHaveBeenCalled();
      expect(f.knowledge.resolvePendingForSession).not.toHaveBeenCalled();
      expect(f.sendPrompt).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });

  it('does not send when knowledge resolution completes after timeout', async () => {
    const gate = deferred();
    const entered = deferred();
    const f = await fixture();
    f.knowledge.resolvePendingForSession.mockImplementation(() => { entered.resolve(); return gate.promise; });
    try {
      await f.runtime.start();
      const run = f.runtime.runNow('project', task.id);
      await entered.promise;
      expect(await run).toMatchObject({ ok: false, error: 'Scheduled task timed out; remote outcome is unknown' });
      gate.resolve({ text: 'standing knowledge', signature: 'sig' });
      await settle();
      expect(f.sendPrompt).not.toHaveBeenCalled();
      expect(f.knowledge.recordDelivered).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });

  it('does not record knowledge delivered when an accepted send resolves after timeout', async () => {
    const gate = deferred();
    const entered = deferred();
    const f = await fixture();
    f.knowledge.resolvePendingForSession.mockResolvedValue({ text: 'standing knowledge', signature: 'sig' });
    f.sendPrompt.mockImplementation(() => { entered.resolve(); return gate.promise; });
    try {
      await f.runtime.start();
      const run = f.runtime.runNow('project', task.id);
      await entered.promise;
      expect(await run).toMatchObject({ ok: false, error: 'Scheduled task timed out; remote outcome is unknown' });
      gate.resolve({});
      await settle();
      expect(f.knowledge.recordDelivered).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });

  it('does not send when the legacy identity retires during knowledge resolution', async () => {
    const gate = deferred();
    const entered = deferred();
    const f = await fixture();
    f.knowledge.resolvePendingForSession.mockImplementation(() => { entered.resolve(); return gate.promise; });
    try {
      await f.runtime.start();
      const run = f.runtime.runNow('project', task.id);
      await entered.promise;
      f.retire();
      gate.resolve({ text: 'standing knowledge', signature: 'sig' });
      expect(await run).toMatchObject({ ok: false, status: 'error' });
      await settle();
      expect(f.sendPrompt).not.toHaveBeenCalled();
      expect(f.knowledge.recordDelivered).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });

  it('keeps ordinary OC1 profile runs working', async () => {
    const f = await fixture({ profile: 'standard' });
    try {
      await f.runtime.start();
      expect(await f.runtime.runNow('project', task.id)).toMatchObject({ ok: true, status: 'success', sessionID: 'session-1' });
      expect(f.sendPrompt).toHaveBeenCalledOnce();
    } finally { await f.cleanup(); }
  });
});
