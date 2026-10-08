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
