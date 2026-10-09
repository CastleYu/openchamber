import { describe, expect, it, vi } from 'vitest';
import { AGENT_ERROR, AGENT_FAMILY } from '../agent/constants.js';
import { createOpenCodeLifecycleRuntime } from './lifecycle.js';

const selection = (family, revision) => ({ family, revision });

const createRuntime = (overrides = {}) => {
  let backend = selection(AGENT_FAMILY.OPENCODE, 1);
  const state = {
    openCodeWorkingDirectory: '/tmp/project', openCodeProcess: null, openCodePort: 45678,
    openCodeBaseUrl: null, currentRestartPromise: null, isRestartingOpenCode: false,
    openCodeApiPrefix: '', openCodeApiPrefixDetected: false, openCodeApiDetectionTimer: null,
    lastOpenCodeError: null, lastOpenCodeHealthFailure: null, lastManagedOpenCodeProcess: null,
    lastOpenCodeRestartDiagnostics: null, isOpenCodeReady: false, openCodeNotReadySince: 0,
    isExternalOpenCode: false, isShuttingDown: false, healthCheckInterval: null,
    expressApp: null, useWslForOpencode: false, resolvedWslBinary: null,
    resolvedWslOpencodePath: null, resolvedWslDistro: null,
  };
  const deps = {
    state,
    env: {
      ENV_CONFIGURED_OPENCODE_PORT: 45678, ENV_CONFIGURED_OPENCODE_HOST: null,
      ENV_EFFECTIVE_PORT: 3001, ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1',
      ENV_SKIP_OPENCODE_START: false,
    },
    getBackendSelection: () => backend,
    syncToHmrState: vi.fn(), syncFromHmrState: vi.fn(),
    getOpenCodeAuthHeaders: vi.fn(() => ({})),
    buildOpenCodeUrl: vi.fn((route) => `http://127.0.0.1:45678${route}`),
    waitForReady: vi.fn(async () => true), normalizeApiPrefix: vi.fn(() => ''),
    applyOpencodeBinaryFromSettings: vi.fn(async () => null),
    ensureOpencodeCliEnv: vi.fn(() => 'opencode'),
    ensureLocalOpenCodeServerPassword: vi.fn(async () => 'password'),
    resolveManagedOpenCodeLaunchSpec: vi.fn((binary) => ({ binary, args: [], wrapperType: null })),
    setOpenCodePort: vi.fn((port) => { state.openCodePort = port; }),
    setDetectedOpenCodeApiPrefix: vi.fn(), setupProxy: vi.fn(),
    ensureOpenCodeApiPrefix: vi.fn(), clearResolvedOpenCodeBinary: vi.fn(),
    buildAugmentedPath: vi.fn(() => '/bin'), buildManagedOpenCodePath: vi.fn(() => '/bin'),
    getManagedOpenCodeShellEnvSnapshot: vi.fn(() => ({})),
    getManagedOpenCodeEnv: vi.fn(async () => ({})),
    probeManagedOpenCodeGeneration: vi.fn(async () => ({ generation: 'oc1', version: '1' })),
    reapManagedOrphanedProcesses: vi.fn(async () => ({ reaped: 0 })),
    registerManagedOpenCodeProcess: vi.fn(async () => {}),
    unregisterManagedOpenCodeProcess: vi.fn(async () => {}),
    terminateWindowsTree: vi.fn(async () => {}),
    getWarmupDirectories: vi.fn(async () => []),
    getActiveSessionCount: vi.fn(() => 0),
    ...overrides,
  };
  return {
    runtime: createOpenCodeLifecycleRuntime(deps), state, deps,
    select: (family, revision) => { backend = selection(family, revision); },
  };
};

describe('OpenCode lifecycle backend family guard', () => {
  it('rejects direct OpenCode operations under CAgent before invoking dependencies', async () => {
    const { runtime, deps, select } = createRuntime();
    select(AGENT_FAMILY.CAGENT, 2);

    for (const operation of [
      () => runtime.startOpenCode(),
      () => runtime.restartOpenCode(),
      () => runtime.waitForOpenCodeReady(),
      () => runtime.waitForAgentPresence('build'),
      () => runtime.refreshOpenCodeAfterConfigChange('test'),
    ]) {
      await expect(operation()).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    }

    for (const dependency of [
      deps.syncToHmrState, deps.syncFromHmrState, deps.getOpenCodeAuthHeaders,
      deps.waitForReady, deps.applyOpencodeBinaryFromSettings, deps.ensureOpencodeCliEnv,
      deps.ensureLocalOpenCodeServerPassword, deps.clearResolvedOpenCodeBinary,
      deps.probeManagedOpenCodeGeneration, deps.reapManagedOrphanedProcesses,
    ]) {
      expect(dependency).not.toHaveBeenCalled();
    }
  });

  it('does not run bootstrap or health work while CAgent is selected', async () => {
    const { runtime, deps, state, select } = createRuntime();
    select(AGENT_FAMILY.CAGENT, 2);

    await runtime.bootstrapOpenCodeAtStartup();
    await runtime.triggerHealthCheck();
    runtime.startHealthMonitoring(10_000);

    expect(deps.reapManagedOrphanedProcesses).not.toHaveBeenCalled();
    expect(deps.syncFromHmrState).not.toHaveBeenCalled();
    expect(deps.applyOpencodeBinaryFromSettings).not.toHaveBeenCalled();
    expect(deps.ensureLocalOpenCodeServerPassword).not.toHaveBeenCalled();
    expect(state.healthCheckInterval).toBeNull();
  });

  it('abandons bootstrap after an asynchronous reaper crosses the family boundary', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const { runtime, deps, select } = createRuntime({
      reapManagedOrphanedProcesses: vi.fn(async () => { await pending; return { reaped: 0 }; }),
    });
    const bootstrap = runtime.bootstrapOpenCodeAtStartup();
    select(AGENT_FAMILY.CAGENT, 2);
    release();
    await bootstrap;

    expect(deps.syncFromHmrState).not.toHaveBeenCalled();
    expect(deps.applyOpencodeBinaryFromSettings).not.toHaveBeenCalled();
    expect(deps.ensureLocalOpenCodeServerPassword).not.toHaveBeenCalled();
  });

  it('stops startup before credentials or process creation when selection changes during settings apply', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const { runtime, deps, select } = createRuntime({
      applyOpencodeBinaryFromSettings: vi.fn(async () => pending),
    });
    const startup = runtime.startOpenCode();
    await vi.waitFor(() => expect(deps.applyOpencodeBinaryFromSettings).toHaveBeenCalledOnce());
    select(AGENT_FAMILY.CAGENT, 2);
    release();

    await expect(startup).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    expect(deps.ensureLocalOpenCodeServerPassword).not.toHaveBeenCalled();
    expect(deps.ensureOpencodeCliEnv).not.toHaveBeenCalled();
    expect(deps.probeManagedOpenCodeGeneration).not.toHaveBeenCalled();
  });

  it('does not write readiness state after a kernel refresh crosses the family boundary', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const kernelRuntime = { refresh: vi.fn(async () => pending) };
    const { runtime, state, select } = createRuntime({ kernelRuntime });
    state.isOpenCodeReady = false;
    state.lastOpenCodeError = 'prior';
    const readiness = runtime.waitForOpenCodeReady();
    select(AGENT_FAMILY.CAGENT, 2);
    release({ generation: 'oc1' });

    await expect(readiness).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    expect(state.isOpenCodeReady).toBe(false);
    expect(state.lastOpenCodeError).toBe('prior');
  });
});

describe('explicit external OpenCode ownership', () => {
  it('preserves failed external intent and recovers only by re-probing', async () => {
    vi.useFakeTimers();
    const endpoint = 'http://external.example:4095';
    const kernelRuntime = { refresh: vi.fn(async () => ({ generation: 'unreachable' })), invalidate: vi.fn() };
    const { runtime, state, deps } = createRuntime({
      env: { ENV_CONFIGURED_OPENCODE_HOST: { origin: endpoint, port: 4095 }, ENV_EFFECTIVE_PORT: 4095 },
      kernelRuntime,
    });
    try {
      const bootstrap = runtime.bootstrapOpenCodeAtStartup();
      await vi.advanceTimersByTimeAsync(21000);
      await bootstrap;
      expect(state.isExternalOpenCode).toBe(true);
      expect(state.openCodeBaseUrl).toBe(endpoint);
      expect(state.openCodePort).toBe(4095);
      expect(state.isOpenCodeReady).toBe(false);
      expect(state.lastOpenCodeError).toContain('unreachable');
      expect(state.openCodeProcess).toBeNull();
      kernelRuntime.refresh.mockResolvedValue({ generation: 'oc2' });
      await runtime.restartOpenCode();
      expect(deps.waitForReady).toHaveBeenCalledWith(endpoint, 3000);
      expect(state.isOpenCodeReady).toBe(true);
      expect(state.lastOpenCodeError).toBeNull();
      for (const dependency of [deps.applyOpencodeBinaryFromSettings, deps.ensureOpencodeCliEnv,
        deps.ensureLocalOpenCodeServerPassword, deps.getManagedOpenCodeEnv, deps.registerManagedOpenCodeProcess]) {
        expect(dependency).not.toHaveBeenCalled();
      }
    } finally { vi.useRealTimers(); }
  });

  it('keeps skip-start without an endpoint in setup failure', async () => {
    const { runtime, state, deps } = createRuntime({ env: { ENV_SKIP_OPENCODE_START: true } });
    await runtime.bootstrapOpenCodeAtStartup();
    expect(state.isExternalOpenCode).toBe(true);
    expect(state.openCodePort).toBeNull();
    expect(state.isOpenCodeReady).toBe(false);
    expect(state.lastOpenCodeError).toBe('External OpenCode requires an explicit host or port');
    expect(deps.applyOpencodeBinaryFromSettings).not.toHaveBeenCalled();
    expect(deps.registerManagedOpenCodeProcess).not.toHaveBeenCalled();
    await expect(runtime.restartOpenCode()).rejects.toThrow('External OpenCode requires an explicit host or port');
    expect(deps.waitForReady).not.toHaveBeenCalled();
  });

  it.each([
    { ENV_CONFIGURED_OPENCODE_HOST: { origin: 'http://external.example:4095', port: 4095 } },
    { ENV_SKIP_OPENCODE_START: true },
  ])('refuses direct managed start for explicit external configuration %j', async (env) => {
    const { runtime, deps, select } = createRuntime({ env });
    await expect(runtime.startOpenCode()).rejects.toThrow('External OpenCode cannot be started');
    expect(deps.applyOpencodeBinaryFromSettings).not.toHaveBeenCalled();
    select(AGENT_FAMILY.CAGENT, 2);
    await expect(runtime.startOpenCode()).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
  });

  it('refuses direct start when external ownership was established earlier', async () => {
    const { runtime, state, deps } = createRuntime();
    state.isExternalOpenCode = true;
    await expect(runtime.startOpenCode()).rejects.toThrow('External OpenCode cannot be started');
    expect(deps.applyOpencodeBinaryFromSettings).not.toHaveBeenCalled();
  });
});

describe('confirmed cold connection authority', () => {
  it('stays unconfigured with no record, despite legacy endpoint and binary candidates', async () => {
    const { runtime, state, deps } = createRuntime({ getConnection: async () => { throw new Error('Confirm an OpenCode connection before starting'); } });
    await runtime.bootstrapOpenCodeAtStartup();
    expect(state.openCodePort).toBeNull();
    expect(state.lastOpenCodeError).toMatch('Confirm an OpenCode connection');
    expect(deps.syncFromHmrState).not.toHaveBeenCalled();
    expect(deps.applyOpencodeBinaryFromSettings).not.toHaveBeenCalled();
    expect(deps.ensureLocalOpenCodeServerPassword).not.toHaveBeenCalled();
    expect(runtime.isConnectionTransitioning()).toBe(false);
  });
  it('uses only the confirmed external endpoint, including its base path and default port', async () => {
    const kernelRuntime = { refresh: vi.fn(async () => ({ generation: 'oc2' })) };
    const { runtime, state, deps } = createRuntime({ getConnection: async () => ({ mode: 'external', endpoint: 'https://example.test/base' }), kernelRuntime });
    await runtime.bootstrapOpenCodeAtStartup();
    expect(state.openCodeBaseUrl).toBe('https://example.test/base');
    expect(state.openCodePort).toBe(443); expect(state.isExternalOpenCode).toBe(true);
    expect(state.isOpenCodeReady).toBe(true);
    expect(deps.ensureOpencodeCliEnv).not.toHaveBeenCalled();
    await expect(runtime.startOpenCode()).rejects.toThrow('External OpenCode');
  });
  it('rejects a second owned launch before resolving or spawning', async () => {
    const getConnection = vi.fn();
    const { runtime, state } = createRuntime({ getConnection });
    state.openCodeProcess = { pid: 123 };
    await expect(runtime.startOpenCode()).rejects.toMatchObject({ status: 409 });
    expect(getConnection).not.toHaveBeenCalled();
  });
});

describe('confirmed record transition retirement', () => {
  it('retires a pending resolution before credentials or native spawn', async () => {
    let release;
    let revision = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const { runtime, deps } = createRuntime({
      getBackendSelection: () => ({ family: AGENT_FAMILY.OPENCODE, revision: 1, connectionRevision: revision }),
      getConnection: async () => pending,
    });
    const starting = runtime.startOpenCode();
    expect(runtime.isConnectionTransitioning()).toBe(true);
    revision += 1; release({ mode: 'configured', binary: '/fixture/opencode' });
    await expect(starting).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    expect(deps.ensureLocalOpenCodeServerPassword).not.toHaveBeenCalled();
    expect(deps.probeManagedOpenCodeGeneration).not.toHaveBeenCalled();
    expect(runtime.isConnectionTransitioning()).toBe(false);
  });
});


describe('confirmed target serialized replacement', () => {
  const target = { mode: 'external', endpoint: 'https://replacement.test/base' };
  const kernel = () => ({ invalidate: vi.fn(), refresh: vi.fn(async () => ({ generation: 'oc2' })) });
  it('validates first, joins duplicate restart, retires the old endpoint and waits for owned exit', async () => {
    let release;
    const closed = new Promise(resolve => { release = resolve; });
    const getConnection = vi.fn(async () => target);
    const kernelRuntime = kernel();
    const onOpenCodeRestarted = vi.fn();
    const { runtime, state, deps } = createRuntime({ getConnection, kernelRuntime, onOpenCodeRestarted });
    state.isOpenCodeReady = true;
    const old = { close: vi.fn(async () => closed) };
    state.openCodeProcess = old;
    const first = runtime.restartOpenCode('fixture');
    await vi.waitFor(() => expect(old.close).toHaveBeenCalledOnce());
    const duplicate = runtime.restartOpenCode('fixture');
    expect(getConnection).toHaveBeenCalledOnce();
    expect(state.openCodePort).toBeNull(); expect(state.isOpenCodeReady).toBe(false);
    expect(state.openCodeProcess).toBe(old);
    expect(kernelRuntime.refresh).not.toHaveBeenCalled();
    await expect(runtime.startOpenCode()).rejects.toMatchObject({ status: 409 });
    await expect(runtime.bootstrapOpenCodeAtStartup()).rejects.toMatchObject({ status: 409 });
    release(); await Promise.all([first, duplicate]);
    expect(state.openCodeProcess).toBeNull(); expect(state.openCodeBaseUrl).toBe(target.endpoint);
    expect(state.isExternalOpenCode).toBe(true); expect(state.isOpenCodeReady).toBe(true);
    expect(state.openCodePort).toBe(443); expect(onOpenCodeRestarted).toHaveBeenCalledOnce();
    expect(deps.ensureOpencodeCliEnv).not.toHaveBeenCalled(); expect(runtime.isConnectionTransitioning()).toBe(false);
  });
  it('leaves a live connection intact after validation failure', async () => {
    const kernelRuntime = kernel();
    const { runtime, state } = createRuntime({ getConnection: async () => { throw new Error('Target unavailable'); }, kernelRuntime });
    const old = { close: vi.fn() }; state.openCodeProcess = old; state.isOpenCodeReady = true;
    await expect(runtime.restartOpenCode()).rejects.toThrow('Target unavailable');
    expect(old.close).not.toHaveBeenCalled(); expect(kernelRuntime.invalidate).not.toHaveBeenCalled();
    expect(state.openCodePort).toBe(45678); expect(state.isOpenCodeReady).toBe(true);
    expect(state.lastOpenCodeError).toBeNull(); expect(state.currentRestartPromise).toBeNull();
  });
  it('blocks replacement when owned cleanup fails and permits explicit retry only after successful cleanup', async () => {
    const kernelRuntime = kernel();
    let fail = true;
    const old = { close: vi.fn(async () => { if (fail) throw new Error('Still owned'); }) };
    const { runtime, state } = createRuntime({ getConnection: async () => target, kernelRuntime });
    state.openCodeProcess = old; state.isOpenCodeReady = true;
    await expect(runtime.restartOpenCode()).rejects.toThrow('Still owned');
    expect(state.openCodeProcess).toBe(old); expect(state.isOpenCodeReady).toBe(false);
    expect(state.openCodePort).toBeNull(); expect(kernelRuntime.refresh).not.toHaveBeenCalled();
    fail = false; await runtime.restartOpenCode();
    expect(old.close).toHaveBeenCalledTimes(2); expect(state.isOpenCodeReady).toBe(true);
    expect(state.openCodeProcess).toBeNull();
  });
  it('retires a changed connection revision before touching the old owner', async () => {
    let release; let revision = 1;
    const pending = new Promise(resolve => { release = resolve; });
    const kernelRuntime = kernel();
    const { runtime, state } = createRuntime({ getConnection: async () => pending, kernelRuntime,
      getBackendSelection: () => ({ family: AGENT_FAMILY.OPENCODE, revision: 1, connectionRevision: revision }) });
    const old = { close: vi.fn() }; state.openCodeProcess = old; state.isOpenCodeReady = true;
    const switching = runtime.restartOpenCode(); revision += 1; release(target);
    await expect(switching).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    expect(old.close).not.toHaveBeenCalled(); expect(state.isOpenCodeReady).toBe(true);
    expect(kernelRuntime.invalidate).not.toHaveBeenCalled();
  });
  it('stops after old exit when shutdown or family retirement occurs during cleanup', async () => {
    for (const shutdown of [true, false]) {
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      const kernelRuntime = kernel();
      const { runtime, state, select } = createRuntime({ getConnection: async () => target, kernelRuntime });
      const old = { close: vi.fn(async () => pending) }; state.openCodeProcess = old;
      const switching = runtime.restartOpenCode();
      await vi.waitFor(() => expect(old.close).toHaveBeenCalledOnce());
      if (shutdown) state.isShuttingDown = true; else select(AGENT_FAMILY.CAGENT, 2);
      release(); await expect(switching).rejects.toThrow();
      expect(kernelRuntime.refresh).not.toHaveBeenCalled(); expect(state.openCodeProcess).toBeNull();
      expect(state.isOpenCodeReady).toBe(false); expect(runtime.isConnectionTransitioning()).toBe(false);
    }
  });
  it('uses saved external identity rather than stale port or environment and never closes an external process', async () => {
    const kernelRuntime = kernel(); const getConnection = vi.fn(async () => target);
    const { runtime, state, deps } = createRuntime({ getConnection, kernelRuntime });
    state.isExternalOpenCode = true; state.isOpenCodeReady = true;
    state.openCodeBaseUrl = 'http://stale.test';
    await runtime.restartOpenCode();
    expect(state.openCodeBaseUrl).toBe(target.endpoint); expect(state.openCodePort).toBe(443);
    expect(deps.waitForReady).not.toHaveBeenCalled(); expect(deps.ensureLocalOpenCodeServerPassword).not.toHaveBeenCalled();
    expect(getConnection).toHaveBeenCalledOnce();
  });
});


describe('confirmed restart queue-drain boundary', () => {
  const target = { mode: 'external', endpoint: 'https://replacement.test/base' };
  it('keeps the old owner live until queue drain completes and resumes after replacement', async () => {
    let release; const pending = new Promise(resolve => { release = resolve; });
    const resume = vi.fn();
    const kernelRuntime = { invalidate: vi.fn(), refresh: vi.fn(async () => ({ generation: 'oc2' })) };
    const pauseQueuedDispatch = vi.fn(async () => { await pending; return resume; });
    const { runtime, state } = createRuntime({ getConnection: async () => target, kernelRuntime, pauseQueuedDispatch });
    const old = { close: vi.fn() }; state.openCodeProcess = old; state.isOpenCodeReady = true;
    const restarting = runtime.restartOpenCode();
    await vi.waitFor(() => expect(pauseQueuedDispatch).toHaveBeenCalledOnce());
    expect(old.close).not.toHaveBeenCalled(); expect(state.isOpenCodeReady).toBe(true);
    expect(kernelRuntime.invalidate).not.toHaveBeenCalled();
    release(); await restarting;
    expect(old.close).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalledOnce();
    expect(state.isOpenCodeReady).toBe(true);
  });
  it('rejects drain failure before invalidating or closing the old owner', async () => {
    const kernelRuntime = { invalidate: vi.fn() };
    const { runtime, state } = createRuntime({ getConnection: async () => target, kernelRuntime,
      pauseQueuedDispatch: async () => { throw new Error('Queue has an unresolved send'); } });
    const old = { close: vi.fn() }; state.openCodeProcess = old; state.isOpenCodeReady = true;
    await expect(runtime.restartOpenCode()).rejects.toThrow('Queue has an unresolved send');
    expect(old.close).not.toHaveBeenCalled(); expect(kernelRuntime.invalidate).not.toHaveBeenCalled();
    expect(state.isOpenCodeReady).toBe(true); expect(state.openCodePort).toBe(45678);
    expect(state.currentRestartPromise).toBeNull();
  });
  it('releases the pause after owned-child cleanup failure', async () => {
    const resume = vi.fn();
    const { runtime, state } = createRuntime({ getConnection: async () => target, pauseQueuedDispatch: async () => resume });
    state.openCodeProcess = { close: vi.fn(async () => { throw new Error('Still owned'); }) };
    await expect(runtime.restartOpenCode()).rejects.toThrow('Still owned');
    expect(resume).toHaveBeenCalledOnce(); expect(state.isOpenCodeReady).toBe(false);
  });
});
