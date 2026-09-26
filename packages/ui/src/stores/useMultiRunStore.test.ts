import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Session } from '@/lib/opencode/model';
import type { OpenCodeRuntime } from '@/lib/opencode/runtime';

const upsertedSessions: Session[] = [];
const registeredDirectories: Array<{ sessionID: string; directory: string }> = [];
const ensureChildCalls: Array<{ directory: string; bootstrap?: boolean }> = [];
const worktreeMetadataCalls: Array<{ sessionId: string; path: string }> = [];
const worktreeCreateCalls: Array<{ project: { id?: string; path: string }; args: Record<string, unknown>; options: unknown }> = [];
const worktreeBootstrapWaitCalls: string[] = [];
const operationOrder: string[] = [];
const dispatchedSessionIds: string[] = [];
const deletedSessionIds: string[] = [];
let createdCount = 0;
let rejectNextMembership = false;
let onCreate = () => {};
let onUpdate = () => {};
let isGitRepository = false;
let waitForWorktreeSetup = false;
const createWorktreeWithDefaultsMock = mock((project: { id?: string; path: string }, args: Record<string, unknown>, options: unknown) => {
  worktreeCreateCalls.push({ project, args, options });
  return Promise.resolve({
    source: 'sdk',
    name: 'fix-thing',
    path: '/repo-worktrees/fix-thing',
    projectDirectory: '/repo',
    branch: 'fix-thing',
    label: 'fix-thing',
    worktreeRoot: '/repo-worktrees/fix-thing',
    worktreeStatus: 'pending',
    headState: 'branch',
    worktreeSource: 'created-for-session',
  });
});
const childState = {
  session: [] as Session[],
  sessionTotal: 0,
  limit: 5,
};
let storedSession: Session;
let binding: OpenCodeRuntime = { generation: 'oc1', endpoint: 'http://multirun.test', epoch: 'first', version: '1.18.32' };
const api = {
  getBoundRuntime: () => binding,
  async createSession(input: { title?: string; metadata?: Session['metadata']; model?: Session['model']; agent?: string } = {}, directory = '/repo') {
    operationOrder.push(`createSession:${directory}`);
    createdCount += 1;
    storedSession = { id: createdCount === 1 ? 'ses_multirun' : `ses_multirun_${createdCount}`, slug: 'multirun', projectID: 'p', version: '1',
      title: input.title ?? '', directory, metadata: input.metadata, model: input.model, agent: input.agent, time: { created: 1, updated: 1 } };
    onCreate();
    return storedSession;
  },
  async getSession() { return storedSession; },
  async updateSession(_id: string, patch: { metadata?: Session['metadata'] }) {
    if (rejectNextMembership) {
      rejectNextMembership = false;
      throw new Error('membership write failed');
    }
    storedSession = { ...storedSession, metadata: patch.metadata };
    onUpdate();
    return storedSession;
  },
  async deleteSession(id: string) {
    deletedSessionIds.push(id);
    return true;
  },
};

mock.module('@/sync/session-ui-store', () => ({
  routeMessage: async ({ sessionId }: { sessionId: string }) => { dispatchedSessionIds.push(sessionId); },
  useSessionUIStore: {
    getState: () => ({
      markSessionAsOpenChamberCreated: mock(() => undefined),
      setWorktreeMetadata: (sessionId: string, metadata: { path: string }) => {
        worktreeMetadataCalls.push({ sessionId, path: metadata.path });
      },
    }),
  },
}));

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: api,
}));

mock.module('@/lib/gitApi', () => ({
  checkIsGitRepository: mock(() => Promise.resolve(isGitRepository)),
}));

mock.module('@/lib/worktrees/worktreeCreate', () => ({
  createWorktreeWithDefaults: createWorktreeWithDefaultsMock,
  resolveRootTrackingRemote: mock(() => Promise.resolve(null)),
}));

mock.module('@/lib/worktrees/worktreeBootstrap', () => ({
  waitForWorktreeBootstrap: (directory: string) => {
    worktreeBootstrapWaitCalls.push(directory);
    operationOrder.push(`wait:${directory}`);
    return Promise.resolve();
  },
}));

mock.module('@/lib/worktrees/worktreeStatus', () => ({
  getRootBranch: mock(() => Promise.resolve('main')),
}));

mock.module('@/lib/openchamberConfig', () => ({
  getWorktreeSetupWaitEnabled: mock(() => Promise.resolve(waitForWorktreeSetup)),
  saveWorktreeSetupCommands: mock(() => Promise.resolve()),
}));

mock.module('./useDirectoryStore', () => ({
  useDirectoryStore: {
    getState: () => ({ currentDirectory: '/repo' }),
  },
}));

mock.module('./useProjectsStore', () => ({
  useProjectsStore: {
    getState: () => ({
      activeProjectId: 'project-1',
      projects: [{ id: 'project-1', path: '/repo' }],
    }),
  },
}));

mock.module('./useSnippetsStore', () => ({
  useSnippetsStore: {
    getState: () => ({
      expandText: (value: string) => Promise.resolve(value),
    }),
  },
}));

mock.module('./useGlobalSessionsStore', () => ({
  useGlobalSessionsStore: {
    getState: () => ({
      upsertSession: (session: Session) => {
        upsertedSessions.push(session);
      },
    }),
  },
}));

mock.module('@/sync/sync-refs', () => ({
  getSyncSessionDirectory: () => null,
  registerSessionDirectory: (sessionID: string, directory: string) => {
    registeredDirectories.push({ sessionID, directory });
  },
  getSyncChildStores: () => ({
    ensureChild: (directory: string, options?: { bootstrap?: boolean }) => {
      ensureChildCalls.push({ directory, bootstrap: options?.bootstrap });
      return {
        setState: (updater: typeof childState | ((state: typeof childState) => Partial<typeof childState> | typeof childState)) => {
          const patch = typeof updater === 'function' ? updater(childState) : updater;
          if (patch !== childState) {
            Object.assign(childState, patch);
          }
        },
      };
    },
  }),
}));

const { useMultiRunStore } = await import('./useMultiRunStore');

describe('useMultiRunStore', () => {
  beforeEach(() => {
    upsertedSessions.length = 0;
    registeredDirectories.length = 0;
    ensureChildCalls.length = 0;
    worktreeMetadataCalls.length = 0;
    worktreeCreateCalls.length = 0;
    worktreeBootstrapWaitCalls.length = 0;
    operationOrder.length = 0;
    dispatchedSessionIds.length = 0;
    deletedSessionIds.length = 0;
    createdCount = 0;
    rejectNextMembership = false;
    binding = { generation: 'oc1', endpoint: 'http://multirun.test', epoch: 'first', version: '1.18.32' };
    onCreate = () => {};
    onUpdate = () => {};
    isGitRepository = false;
    waitForWorktreeSetup = false;
    childState.session = [];
    childState.sessionTotal = 0;
    childState.limit = 5;
    useMultiRunStore.setState({ isLoading: false, error: null });
  });

  test('registers created sessions without waiting for a sidebar refresh', async () => {
    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'Fix thing',
      isolateRuns: false,
      groups: [{
        prompt: 'Fix it',
        models: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }],
      }],
    });

    expect(result?.sessionIds).toEqual(['ses_multirun']);
    expect(upsertedSessions.map((session) => session.id)).toEqual(['ses_multirun']);
    expect(registeredDirectories).toEqual([{ sessionID: 'ses_multirun', directory: '/repo' }]);
    expect(ensureChildCalls).toEqual([{ directory: '/repo', bootstrap: false }]);
    expect(childState.session.map((session) => session.id)).toEqual(['ses_multirun']);
  });

  test('OC2 pins model and agent on the created session before dispatch', async () => {
    binding = { generation: 'oc2', endpoint: 'http://multirun.test', epoch: 'second', version: '2.0.1' };
    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'OC2 run', isolateRuns: false, agent: 'build',
      groups: [{ prompt: 'Fix it', models: [{ providerID: 'anthropic', modelID: 'claude-sonnet', variant: 'high' }] }],
    });
    await Promise.resolve();
    expect(result?.sessionIds).toEqual(['ses_multirun']);
    expect(storedSession.model).toEqual({ providerID: 'anthropic', id: 'claude-sonnet', variant: 'high' });
    expect(storedSession.agent).toBe('build');
    expect(dispatchedSessionIds).toEqual(['ses_multirun']);
  });

  test('membership failure does not dispatch that session or discard a successful sibling', async () => {
    rejectNextMembership = true;
    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'same name', isolateRuns: false,
      groups: [{ prompt: 'question', models: [
        { providerID: 'openrouter', modelID: 'vendor/fail' },
        { providerID: 'openrouter', modelID: 'vendor/success' },
      ] }],
    });
    await Promise.resolve();
    expect(result?.sessionIds).toEqual(['ses_multirun_2']);
    expect(result?.failedCount).toBe(1);
    expect(deletedSessionIds).toEqual(['ses_multirun']);
    expect(dispatchedSessionIds).toEqual(['ses_multirun_2']);
    expect(upsertedSessions.map((session) => session.id)).toEqual(['ses_multirun_2']);
  });

  test('changing runtime while creating stops dispatch and registration', async () => {
    onCreate = () => {
      binding = { generation: 'oc2', endpoint: 'http://other-runtime.test', epoch: 'second', version: '2.0.1' };
      useMultiRunStore.getState().resetForRuntimeSwitch();
    };
    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'runtime', isolateRuns: false,
      groups: [{ prompt: 'question', models: [{ providerID: 'openrouter', modelID: 'vendor/model' }] }],
    });
    expect(result).toBeNull();
    expect(dispatchedSessionIds).toEqual([]);
    expect(upsertedSessions).toEqual([]);
    expect(deletedSessionIds).toEqual([]);
    expect(useMultiRunStore.getState().isLoading).toBe(false);
  });

  test('changing runtime after metadata write skips cleanup on the new runtime', async () => {
    onUpdate = () => {
      binding = { generation: 'oc2', endpoint: 'http://other-runtime.test', epoch: 'second', version: '2.0.1' };
      useMultiRunStore.getState().resetForRuntimeSwitch();
    };
    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'runtime', isolateRuns: false,
      groups: [{ prompt: 'question', models: [{ providerID: 'openrouter', modelID: 'vendor/model' }] }],
    });
    expect(result).toBeNull();
    expect(deletedSessionIds).toEqual([]);
    expect(dispatchedSessionIds).toEqual([]);
    expect(upsertedSessions).toEqual([]);
  });

  test('uses fast background worktree creation for isolated runs', async () => {
    isGitRepository = true;

    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'Fix thing',
      isolateRuns: true,
      groups: [{
        prompt: 'Fix it',
        models: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }],
      }],
    });

    expect(result?.sessionIds).toEqual(['ses_multirun']);
    expect(worktreeCreateCalls.length).toBe(1);
    expect(worktreeCreateCalls[0]?.project).toEqual({ id: 'project-1', path: '/repo' });
    expect(worktreeCreateCalls[0]?.args.returnAfterDirectoryCreated).toBe(true);
    expect(worktreeCreateCalls[0]?.options).toEqual({ resolvedRootTrackingRemote: null });
    expect(worktreeBootstrapWaitCalls).toEqual([]);
    expect(operationOrder).toEqual(['createSession:/repo-worktrees/fix-thing']);
    expect(registeredDirectories).toEqual([{ sessionID: 'ses_multirun', directory: '/repo-worktrees/fix-thing' }]);
    expect(worktreeMetadataCalls).toEqual([{ sessionId: 'ses_multirun', path: '/repo-worktrees/fix-thing' }]);
  });

  test('waits for isolated worktree bootstrap when setup wait is enabled', async () => {
    isGitRepository = true;
    waitForWorktreeSetup = true;

    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'Fix thing',
      isolateRuns: true,
      groups: [{
        prompt: 'Fix it',
        models: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }],
      }],
    });

    expect(result?.sessionIds).toEqual(['ses_multirun']);
    expect(worktreeBootstrapWaitCalls).toEqual(['/repo-worktrees/fix-thing']);
    expect(operationOrder).toEqual([
      'wait:/repo-worktrees/fix-thing',
      'createSession:/repo-worktrees/fix-thing',
    ]);
  });

  test('accepts more than 5 models per group without a "maximum 5 models" error', async () => {
    const models = Array.from({ length: 6 }, (_, i) => ({
      providerID: 'anthropic',
      modelID: `claude-sonnet-4-5-${i}`,
    }));

    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'Many models',
      isolateRuns: false,
      groups: [{ prompt: 'Fix it', models }],
    });

    expect(useMultiRunStore.getState().error).toBeNull();
    expect(result?.sessionIds).toHaveLength(6);
  });

  test('accepts more than 5 models on the isolated (per-worktree) dispatch path', async () => {
    isGitRepository = true;

    const models = Array.from({ length: 6 }, (_, i) => ({
      providerID: 'anthropic',
      modelID: `claude-sonnet-4-5-${i}`,
    }));

    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'Many models',
      isolateRuns: true,
      groups: [{ prompt: 'Fix it', models }],
    });

    expect(useMultiRunStore.getState().error).toBeNull();
    expect(result?.sessionIds).toHaveLength(6);
    expect(worktreeCreateCalls.length).toBe(6);
  });
});
