import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { ChildStoreManager } from '@/sync/child-store';
import { opencodeClient } from '@/lib/opencode/client';
import { subscribeRuntimeEndpointChanged, switchRuntimeEndpoint } from '@/lib/runtime-switch';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import type { SessionPage } from '@/lib/opencode/client';
import { setSyncRefs, subscribeToInitialScopedDirectoryLoad } from '@/sync/sync-refs';
import {
  GLOBAL_SESSIONS_BACKSTOP_INTERVAL_MS,
  GLOBAL_SESSIONS_IDLE_LOAD_TIMEOUT_MS,
  GLOBAL_SESSIONS_REFRESH_COOLDOWN_MS,
  GLOBAL_SESSIONS_REFRESH_INTERVAL_MS,
  type GlobalSessionsPollingRuntime,
  scheduleBrowserIdleWork,
  shouldLoadInitialGlobalSnapshot,
  startGlobalSessionsPolling,
  subscribeToBrowserRecoverySignals,
  useGlobalSessionsPolling,
} from './useGlobalSessionsPolling';

const timers = () => {
  let nextId = 0;
  const pending = new Map<number, { callback: () => void; delay: number }>();
  return { pending, schedule: (callback: () => void, delay: number) => { const id = ++nextId; pending.set(id, { callback, delay }); return id; }, clear: (id: number) => { pending.delete(id); }, fire: async () => { const entry = pending.entries().next().value; if (!entry) throw new Error('No scheduled refresh'); pending.delete(entry[0]); entry[1].callback(); await new Promise<void>((resolve) => queueMicrotask(resolve)); }, delay: () => [...pending.values()][0]?.delay };
};

const browserWindow = new Window();
Object.assign(globalThis, { window: browserWindow, document: browserWindow.document });

const setVisibilityState = (state: 'visible' | 'hidden') => {
  Object.defineProperty(browserWindow.document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
};

const OLD_BLIND_REFRESH_INTERVAL_MS = 45_000;

type PendingInterval = {
  delay: number;
  callback: () => void;
  nextRunAt: number;
};

type PollingHarness = {
  runtime: GlobalSessionsPollingRuntime;
  withoutInitialLoad: () => GlobalSessionsPollingRuntime;
  advanceClock: (durationMs: number) => void;
  emitRecoverySignal: () => void;
  initialLoads: () => number;
  refreshes: () => number;
  scheduledDelays: () => number[];
  liveIntervals: () => number;
  liveSignalListeners: () => number;
};

type WaitForInitialScopedLoad = NonNullable<GlobalSessionsPollingRuntime['waitForInitialScopedLoad']>;

type ScopedLoadGate = {
  waitForInitialScopedLoad: WaitForInitialScopedLoad;
  settle: () => void;
  liveWaiters: () => number;
};

const createScopedLoadGate = (): ScopedLoadGate => {
  const waiters = new Set<() => void>();
  return {
    waitForInitialScopedLoad: (onSettled) => {
      waiters.add(onSettled);
      return () => {
        waiters.delete(onSettled);
      };
    },
    settle: () => {
      for (const waiter of [...waiters]) waiter();
    },
    liveWaiters: () => waiters.size,
  };
};

type ScheduleIdleWork = NonNullable<GlobalSessionsPollingRuntime['scheduleIdleWork']>;

type IdleHarness = {
  scheduleIdleWork: ScheduleIdleWork;
  runIdleWork: () => void;
  pendingIdleWork: () => number;
  idleCancels: () => number;
  requestedTimeouts: () => number[];
};

const createIdleHarness = (): IdleHarness => {
  const pending = new Map<number, () => void>();
  const requestedTimeouts: number[] = [];
  let nextHandle = 1;
  let idleCancels = 0;

  return {
    scheduleIdleWork: (callback, timeoutMs) => {
      const handle = nextHandle;
      nextHandle += 1;
      requestedTimeouts.push(timeoutMs);
      pending.set(handle, callback);
      return () => {
        if (pending.delete(handle)) idleCancels += 1;
      };
    },
    runIdleWork: () => {
      for (const [handle, callback] of [...pending]) {
        pending.delete(handle);
        callback();
      }
    },
    pendingIdleWork: () => pending.size,
    idleCancels: () => idleCancels,
    requestedTimeouts: () => [...requestedTimeouts],
  };
};

const createPollingHarness = (
  waitForInitialScopedLoad?: WaitForInitialScopedLoad,
  scheduleIdleWork?: ScheduleIdleWork,
): PollingHarness => {
  let currentTime = 0;
  let nextIntervalId = 1;
  let initialLoads = 0;
  let refreshes = 0;
  const intervals = new Map<number, PendingInterval>();
  const scheduledDelays: number[] = [];
  const signalListeners = new Set<() => void>();

  const runtime: GlobalSessionsPollingRuntime = {
    initialLoad: () => {
      initialLoads += 1;
    },
    waitForInitialScopedLoad,
    scheduleIdleWork,
    refresh: () => {
      refreshes += 1;
    },
    now: () => currentTime,
    scheduleInterval: (callback, delay) => {
      const intervalId = nextIntervalId;
      nextIntervalId += 1;
      scheduledDelays.push(delay);
      intervals.set(intervalId, { delay, callback, nextRunAt: currentTime + delay });
      return intervalId;
    },
    clearScheduledInterval: (intervalId) => {
      intervals.delete(intervalId);
    },
    subscribeToRecoverySignals: (onSignal) => {
      signalListeners.add(onSignal);
      return () => {
        signalListeners.delete(onSignal);
      };
    },
  };

  const nextDueInterval = (until: number): PendingInterval | null => {
    let due: PendingInterval | null = null;
    for (const interval of intervals.values()) {
      if (interval.nextRunAt > until) continue;
      if (!due || interval.nextRunAt < due.nextRunAt) due = interval;
    }
    return due;
  };

  const advanceClock = (durationMs: number) => {
    const target = currentTime + durationMs;
    for (let due = nextDueInterval(target); due; due = nextDueInterval(target)) {
      currentTime = due.nextRunAt;
      due.nextRunAt += due.delay;
      due.callback();
    }
    currentTime = target;
  };

  const emitRecoverySignal = () => {
    for (const listener of [...signalListeners]) listener();
  };

  return {
    runtime,
    withoutInitialLoad: () => ({ ...runtime, initialLoad: undefined }),
    advanceClock,
    emitRecoverySignal,
    initialLoads: () => initialLoads,
    refreshes: () => refreshes,
    scheduledDelays: () => [...scheduledDelays],
    liveIntervals: () => intervals.size,
    liveSignalListeners: () => signalListeners.size,
  };
};

describe('global sessions polling lifecycle', () => {
  test('loads the global list once and schedules only the coarse backstop', () => {
    const harness = createPollingHarness();

    startGlobalSessionsPolling(harness.runtime);

    expect(harness.initialLoads()).toBe(1);
    expect(harness.refreshes()).toBe(0);
    expect(harness.scheduledDelays()).toEqual([GLOBAL_SESSIONS_BACKSTOP_INTERVAL_MS]);
    expect(harness.liveSignalListeners()).toBe(1);
  });

  test('does not refresh on the old blind cadence when no recovery signal arrives', () => {
    const harness = createPollingHarness();

    startGlobalSessionsPolling(harness.runtime);
    harness.advanceClock(OLD_BLIND_REFRESH_INTERVAL_MS * 5);

    expect(harness.refreshes()).toBe(0);
  });

  test('refreshes when a recovery signal arrives after the cooldown', () => {
    const harness = createPollingHarness();

    startGlobalSessionsPolling(harness.runtime);
    harness.advanceClock(GLOBAL_SESSIONS_REFRESH_COOLDOWN_MS);
    harness.emitRecoverySignal();

    expect(harness.refreshes()).toBe(1);
  });

  test('collapses duplicate recovery signals inside the cooldown into one refresh', () => {
    const harness = createPollingHarness();

    startGlobalSessionsPolling(harness.runtime);
    harness.advanceClock(GLOBAL_SESSIONS_REFRESH_COOLDOWN_MS);
    harness.emitRecoverySignal();
    harness.advanceClock(1_000);
    harness.emitRecoverySignal();
    harness.advanceClock(1_000);
    harness.emitRecoverySignal();

    expect(harness.refreshes()).toBe(1);
  });

  test('refreshes again for a recovery signal after the cooldown elapses', () => {
    const harness = createPollingHarness();

    startGlobalSessionsPolling(harness.runtime);
    harness.advanceClock(GLOBAL_SESSIONS_REFRESH_COOLDOWN_MS);
    harness.emitRecoverySignal();
    harness.advanceClock(GLOBAL_SESSIONS_REFRESH_COOLDOWN_MS);
    harness.emitRecoverySignal();

    expect(harness.refreshes()).toBe(2);
  });

  test('backfills through the backstop interval when no recovery signal arrives', () => {
    const harness = createPollingHarness();

    startGlobalSessionsPolling(harness.runtime);
    harness.advanceClock(GLOBAL_SESSIONS_BACKSTOP_INTERVAL_MS);

    expect(harness.refreshes()).toBe(1);
  });

  test('holds the first unscoped load until scoped startup settles', () => {
    const gate = createScopedLoadGate();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad);

    startGlobalSessionsPolling(harness.runtime);
    expect(harness.initialLoads()).toBe(0);

    gate.settle();

    expect(harness.initialLoads()).toBe(1);
  });

  test('loads once however often the scoped gate settles', () => {
    const gate = createScopedLoadGate();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad);

    startGlobalSessionsPolling(harness.runtime);
    gate.settle();
    gate.settle();

    expect(harness.initialLoads()).toBe(1);
  });

  test('anchors the refresh cooldown to the deferred load, not to start', () => {
    const gate = createScopedLoadGate();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad);

    startGlobalSessionsPolling(harness.runtime);
    harness.advanceClock(GLOBAL_SESSIONS_REFRESH_COOLDOWN_MS);
    gate.settle();
    harness.emitRecoverySignal();

    expect(harness.initialLoads()).toBe(1);
    expect(harness.refreshes()).toBe(0);

    harness.advanceClock(GLOBAL_SESSIONS_REFRESH_COOLDOWN_MS);
    harness.emitRecoverySignal();

    expect(harness.refreshes()).toBe(1);
  });

  test('drops a pending scoped wait on disposal and never loads afterwards', () => {
    const gate = createScopedLoadGate();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad);

    const dispose = startGlobalSessionsPolling(harness.runtime);
    dispose();

    expect(gate.liveWaiters()).toBe(0);

    gate.settle();

    expect(harness.initialLoads()).toBe(0);
  });

  test('still schedules recovery and the backstop while the first load waits', () => {
    const gate = createScopedLoadGate();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad);

    startGlobalSessionsPolling(harness.runtime);

    expect(harness.scheduledDelays()).toEqual([GLOBAL_SESSIONS_BACKSTOP_INTERVAL_MS]);
    expect(harness.liveSignalListeners()).toBe(1);
    expect(harness.initialLoads()).toBe(0);
  });

  test('does not run the full snapshot until idle work runs', () => {
    const gate = createScopedLoadGate();
    const idle = createIdleHarness();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad, idle.scheduleIdleWork);

    startGlobalSessionsPolling(harness.runtime);
    gate.settle();

    expect(harness.initialLoads()).toBe(0);
    expect(idle.pendingIdleWork()).toBe(1);

    idle.runIdleWork();

    expect(harness.initialLoads()).toBe(1);
  });

  test('schedules no idle work while the scoped bootstrap is still running', () => {
    const gate = createScopedLoadGate();
    const idle = createIdleHarness();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad, idle.scheduleIdleWork);

    startGlobalSessionsPolling(harness.runtime);

    expect(idle.requestedTimeouts()).toEqual([]);
    expect(idle.pendingIdleWork()).toBe(0);
    expect(harness.initialLoads()).toBe(0);
  });

  test('waits for idle even when no directory is scoped', () => {
    const idle = createIdleHarness();
    const harness = createPollingHarness(undefined, idle.scheduleIdleWork);

    startGlobalSessionsPolling(harness.runtime);

    expect(harness.initialLoads()).toBe(0);
    expect(idle.pendingIdleWork()).toBe(1);

    idle.runIdleWork();

    expect(harness.initialLoads()).toBe(1);
  });

  test('forwards the idle timeout ceiling and requests idle work once', () => {
    const gate = createScopedLoadGate();
    const idle = createIdleHarness();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad, idle.scheduleIdleWork);

    startGlobalSessionsPolling(harness.runtime);
    gate.settle();
    gate.settle();
    gate.settle();

    expect(idle.requestedTimeouts()).toEqual([GLOBAL_SESSIONS_IDLE_LOAD_TIMEOUT_MS]);

    idle.runIdleWork();

    expect(harness.initialLoads()).toBe(1);
  });

  test('cancels pending idle work on disposal and never loads afterwards', () => {
    const gate = createScopedLoadGate();
    const idle = createIdleHarness();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad, idle.scheduleIdleWork);

    const dispose = startGlobalSessionsPolling(harness.runtime);
    gate.settle();
    dispose();

    expect(idle.idleCancels()).toBe(1);
    expect(idle.pendingIdleWork()).toBe(0);

    idle.runIdleWork();

    expect(harness.initialLoads()).toBe(0);
  });

  test('anchors the refresh cooldown to the idle load, not to the scoped gate', () => {
    const gate = createScopedLoadGate();
    const idle = createIdleHarness();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad, idle.scheduleIdleWork);

    startGlobalSessionsPolling(harness.runtime);
    gate.settle();
    harness.advanceClock(GLOBAL_SESSIONS_REFRESH_COOLDOWN_MS);
    idle.runIdleWork();
    harness.emitRecoverySignal();

    expect(harness.initialLoads()).toBe(1);
    expect(harness.refreshes()).toBe(0);
  });

  test('a demand-only surface neither waits on the scoped gate nor queues idle work', () => {
    const gate = createScopedLoadGate();
    const idle = createIdleHarness();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad, idle.scheduleIdleWork);

    startGlobalSessionsPolling(harness.withoutInitialLoad());

    expect(gate.liveWaiters()).toBe(0);
    expect(idle.requestedTimeouts()).toEqual([]);
    expect(idle.pendingIdleWork()).toBe(0);
    expect(harness.initialLoads()).toBe(0);
  });

  test('a demand-only surface still arms recovery signals and the backstop', () => {
    const gate = createScopedLoadGate();
    const idle = createIdleHarness();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad, idle.scheduleIdleWork);

    startGlobalSessionsPolling(harness.withoutInitialLoad());

    expect(harness.scheduledDelays()).toEqual([GLOBAL_SESSIONS_BACKSTOP_INTERVAL_MS]);
    expect(harness.liveSignalListeners()).toBe(1);

    harness.advanceClock(GLOBAL_SESSIONS_BACKSTOP_INTERVAL_MS);

    expect(harness.refreshes()).toBe(1);
    expect(harness.initialLoads()).toBe(0);
  });

  test('a demand-only surface never loads even after the scoped gate settles and idle drains', () => {
    const gate = createScopedLoadGate();
    const idle = createIdleHarness();
    const harness = createPollingHarness(gate.waitForInitialScopedLoad, idle.scheduleIdleWork);

    startGlobalSessionsPolling(harness.withoutInitialLoad());
    gate.settle();
    idle.runIdleWork();

    expect(harness.initialLoads()).toBe(0);
  });

  test('stops listening and clears the backstop on disposal', () => {
    const harness = createPollingHarness();

    const dispose = startGlobalSessionsPolling(harness.runtime);
    harness.advanceClock(GLOBAL_SESSIONS_BACKSTOP_INTERVAL_MS);
    dispose();

    expect(harness.liveIntervals()).toBe(0);
    expect(harness.liveSignalListeners()).toBe(0);

    harness.advanceClock(GLOBAL_SESSIONS_BACKSTOP_INTERVAL_MS * 3);
    harness.emitRecoverySignal();

    expect(harness.refreshes()).toBe(1);
  });
});

describe('browser recovery signals', () => {
  const dispatchOnWindow = (type: string) => {
    browserWindow.dispatchEvent(new browserWindow.Event(type));
  };

  const dispatchVisibilityChange = (state: 'visible' | 'hidden') => {
    setVisibilityState(state);
    browserWindow.document.dispatchEvent(new browserWindow.Event('visibilitychange'));
  };

  test('signals when the document becomes visible, on focus, pageshow, and system resume', () => {
    let signals = 0;
    setVisibilityState('visible');

    const unsubscribe = subscribeToBrowserRecoverySignals(() => {
      signals += 1;
    });

    dispatchVisibilityChange('visible');
    dispatchOnWindow('focus');
    dispatchOnWindow('pageshow');
    dispatchOnWindow('openchamber:system-resume');

    expect(signals).toBe(4);

    unsubscribe();
  });

  test('does not signal when the document becomes hidden', () => {
    let signals = 0;

    const unsubscribe = subscribeToBrowserRecoverySignals(() => {
      signals += 1;
    });

    dispatchVisibilityChange('hidden');

    expect(signals).toBe(0);

    unsubscribe();
  });

  test('removes every listener on unsubscribe', () => {
    let signals = 0;

    const unsubscribe = subscribeToBrowserRecoverySignals(() => {
      signals += 1;
    });
    unsubscribe();

    dispatchVisibilityChange('visible');
    dispatchOnWindow('focus');
    dispatchOnWindow('pageshow');
    dispatchOnWindow('openchamber:system-resume');

    expect(signals).toBe(0);
  });
});

describe('polling composed with the real scoped-startup gate', () => {
  const DIRECTORY = '/workspace';
  const managers: ChildStoreManager[] = [];

  const scopeDirectory = (directory: string): ChildStoreManager => {
    const manager = new ChildStoreManager();
    managers.push(manager);
    // SAFETY: setSyncRefs stores the SDK for other readers and never calls it here.
    setSyncRefs({} as never, manager, directory);
    return manager;
  };

  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const nextTask = () => new Promise<void>((resolve) => {
    browserWindow.setTimeout(resolve, 0);
  });

  const withoutRequestIdleCallback = () => {
    Object.defineProperty(browserWindow, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  };

  afterEach(() => {
    for (const manager of managers.splice(0)) manager.disposeAll();
    // SAFETY: same unused SDK slot; clears the scoped directory between tests.
    setSyncRefs({} as never, new ChildStoreManager(), '');
  });

  test('arms global authority only after the scoped bootstrap finishes and idle arrives', async () => {
    withoutRequestIdleCallback();
    const manager = scopeDirectory(DIRECTORY);
    let finishBootstrap!: () => void;
    const bootstrapping = new Promise<void>((resolve) => {
      finishBootstrap = resolve;
    });
    manager.configure({ onBootstrap: () => bootstrapping });
    manager.requestBootstrap({ directory: DIRECTORY, priority: 'selected', reason: 'current-directory' });

    const harness = createPollingHarness(subscribeToInitialScopedDirectoryLoad, scheduleBrowserIdleWork);
    startGlobalSessionsPolling(harness.runtime);
    expect(harness.initialLoads()).toBe(0);

    finishBootstrap();
    await flushMicrotasks();
    expect(harness.initialLoads()).toBe(0);

    await nextTask();

    expect(harness.initialLoads()).toBe(1);
  });

  test('still defers to idle when no directory is scoped', async () => {
    withoutRequestIdleCallback();
    scopeDirectory('');

    const harness = createPollingHarness(subscribeToInitialScopedDirectoryLoad, scheduleBrowserIdleWork);
    startGlobalSessionsPolling(harness.runtime);
    expect(harness.initialLoads()).toBe(0);

    await nextTask();

    expect(harness.initialLoads()).toBe(1);
  });

  test('never loads when disposed before idle arrives', async () => {
    withoutRequestIdleCallback();
    scopeDirectory('');

    const harness = createPollingHarness(subscribeToInitialScopedDirectoryLoad, scheduleBrowserIdleWork);
    const dispose = startGlobalSessionsPolling(harness.runtime);
    dispose();

    await nextTask();

    expect(harness.initialLoads()).toBe(0);
  });
});

describe('browser idle scheduler', () => {
  type FakeIdleRequest = (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;

  const defineWindowIdleApi = (request: FakeIdleRequest | undefined, cancel: ((handle: number) => void) | undefined) => {
    Object.defineProperty(browserWindow, 'requestIdleCallback', { configurable: true, writable: true, value: request });
    Object.defineProperty(browserWindow, 'cancelIdleCallback', { configurable: true, writable: true, value: cancel });
  };

  const nextTask = () => new Promise<void>((resolve) => {
    browserWindow.setTimeout(resolve, 0);
  });

  afterEach(() => {
    defineWindowIdleApi(undefined, undefined);
  });

  test('requests idle time with the forwarded timeout', () => {
    let capturedTimeout: number | undefined;
    let capturedCallback: IdleRequestCallback | undefined;
    defineWindowIdleApi((callback, options) => {
      capturedCallback = callback;
      capturedTimeout = options?.timeout;
      return 7;
    }, undefined);
    let runs = 0;

    scheduleBrowserIdleWork(() => {
      runs += 1;
    }, GLOBAL_SESSIONS_IDLE_LOAD_TIMEOUT_MS);

    expect(capturedTimeout).toBe(GLOBAL_SESSIONS_IDLE_LOAD_TIMEOUT_MS);
    expect(runs).toBe(0);

    capturedCallback?.({ didTimeout: true, timeRemaining: () => 0 });

    expect(runs).toBe(1);
  });

  test('cancels the idle request through cancelIdleCallback', () => {
    const cancelledHandles: number[] = [];
    defineWindowIdleApi(() => 42, (handle) => {
      cancelledHandles.push(handle);
    });

    const cancel = scheduleBrowserIdleWork(() => {}, GLOBAL_SESSIONS_IDLE_LOAD_TIMEOUT_MS);
    cancel();

    expect(cancelledHandles).toEqual([42]);
  });

  test('falls back to the next task when requestIdleCallback is unavailable', async () => {
    defineWindowIdleApi(undefined, undefined);
    let runs = 0;

    scheduleBrowserIdleWork(() => {
      runs += 1;
    }, GLOBAL_SESSIONS_IDLE_LOAD_TIMEOUT_MS);
    expect(runs).toBe(0);

    await nextTask();

    expect(runs).toBe(1);
  });

  test('cancels the next-task fallback', async () => {
    defineWindowIdleApi(undefined, undefined);
    let runs = 0;

    const cancel = scheduleBrowserIdleWork(() => {
      runs += 1;
    }, GLOBAL_SESSIONS_IDLE_LOAD_TIMEOUT_MS);
    cancel();

    await nextTask();

    expect(runs).toBe(0);
  });
});

describe('initial global snapshot surface policy', () => {
  const setElectronRuntime = (runtime: string | undefined) => {
    Object.defineProperty(browserWindow, '__OPENCHAMBER_ELECTRON__', {
      configurable: true,
      writable: true,
      value: runtime === undefined ? undefined : { runtime },
    });
  };

  afterEach(() => {
    setElectronRuntime(undefined);
  });

  test('Desktop declines the automatic snapshot', () => {
    setElectronRuntime('electron');

    expect(shouldLoadInitialGlobalSnapshot()).toBe(false);
  });

  test('Web keeps the automatic snapshot', () => {
    setElectronRuntime(undefined);

    expect(shouldLoadInitialGlobalSnapshot()).toBe(true);
  });

  test('a VS Code webview keeps the automatic snapshot', () => {
    // The extension host never injects the Electron shell descriptor, so the
    // webview is not a desktop shell even though VS Code itself runs on Electron.
    setElectronRuntime(undefined);

    expect(shouldLoadInitialGlobalSnapshot()).toBe(true);
  });

  test('a non-electron shell descriptor keeps the automatic snapshot', () => {
    setElectronRuntime('capacitor');

    expect(shouldLoadInitialGlobalSnapshot()).toBe(true);
  });
});

test('the mounted poller recovers real store failure and starts a fresh load on runtime switch', async () => {
  const dom = new Window({ url: 'http://sessions.test' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, localStorage: dom.localStorage,
    Element: dom.Element, HTMLElement: dom.HTMLElement, Node: dom.Node,
    CustomEvent: dom.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
  const home = spyOn(opencodeClient, 'getFilesystemHomeInfo')
    .mockRejectedValueOnce(new Error('startup unavailable'))
    .mockResolvedValue({ home: '/home/user', chatsRoot: '/chats' });
  const host = spyOn(opencodeClient, 'getHostSessionStatusSnapshot').mockResolvedValue(null);
  const session = (id: string): SessionPage => ({ sessions: [{
    id, projectID: 'project', directory: '/project', title: id,
    time: { created: 1, updated: 2 },
    cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }], cursor: {} });
  const list = spyOn(opencodeClient, 'listSessionsPage').mockResolvedValue(session('restored'));
  const clock = timers();
  // happy-dom returns Node timer handles; retain that contract while controlling time.
  const originalTimeout = dom.setTimeout.bind(dom);
  const originalClear = dom.clearTimeout.bind(dom);
  const handles = new Map<ReturnType<typeof dom.setTimeout>, number>();
  const timeout = spyOn(dom, 'setTimeout').mockImplementation((callback, delay) => {
    const handle = originalTimeout(() => undefined, 0);
    originalClear(handle);
    handles.set(handle, clock.schedule(() => callback(), delay ?? 0));
    return handle;
  });
  const clear = spyOn(dom, 'clearTimeout').mockImplementation((handle) => {
    const id = handle === undefined ? undefined : handles.get(handle);
    if (id !== undefined) clock.clear(id);
  });
  // The app resets the store before the poller's endpoint listener runs.
  const reset = subscribeRuntimeEndpointChanged(() => useGlobalSessionsStore.getState().resetForRuntimeSwitch());
  switchRuntimeEndpoint({ apiBaseUrl: 'http://sessions.test', runtimeKey: 'startup-a' });
  const root = createRoot(document.createElement('div'));
  const Harness = ({ enabled }: { enabled: boolean }) => { useGlobalSessionsPolling(enabled); return null; };
  let resolveOldPage: (page: SessionPage) => void = () => undefined;
  try {
    await act(async () => root.render(React.createElement(Harness, { enabled: false })));
    expect(home.mock.calls.length).toBe(0);
    await act(async () => root.render(React.createElement(Harness, { enabled: true })));
    expect(useGlobalSessionsStore.getState().status).toBe('error');
    expect(useGlobalSessionsStore.getState().hasLoaded).toBe(false);
    expect(clock.delay()).toBe(1_000);
    await act(async () => clock.fire());
    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(['restored']);
    expect(useGlobalSessionsStore.getState().status).toBe('ready');
    expect(clock.delay()).toBe(GLOBAL_SESSIONS_REFRESH_INTERVAL_MS);
    expect(list.mock.calls.every(([options]) => options?.global === true)).toBe(true);

    const oldPage = new Promise<SessionPage>((resolve) => { resolveOldPage = resolve; });
    list.mockImplementationOnce(() => oldPage);
    await act(async () => clock.fire());
    expect(useGlobalSessionsStore.getState().status).toBe('loading');
    expect(useGlobalSessionsStore.getState().hasLoaded).toBe(true);
    expect(clock.pending.size).toBe(0);
    list.mockResolvedValue(session('new-runtime'));
    await act(async () => switchRuntimeEndpoint({ apiBaseUrl: 'http://sessions.test', runtimeKey: 'startup-b' }));
    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(['new-runtime']);
    expect(clock.pending.size).toBe(1);
    const seedsBeforeOldCompletion = host.mock.calls.length;
    await act(async () => resolveOldPage(session('stale')));
    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(['new-runtime']);
    expect(host.mock.calls.length).toBe(seedsBeforeOldCompletion);
    expect(clock.pending.size).toBe(1);
    // The app may reset stores when the endpoint changes but runtime identity stays the same.
    list.mockResolvedValue(session('reconnected'));
    await act(async () => switchRuntimeEndpoint({ apiBaseUrl: 'http://reconnected.test', runtimeKey: 'startup-b' }));
    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(['reconnected']);
    expect(clock.pending.size).toBe(1);
    await act(async () => root.render(React.createElement(Harness, { enabled: false })));
    expect(clock.pending.size).toBe(0);
  } finally {
    resolveOldPage({ sessions: [], cursor: {} });
    await act(async () => root.unmount());
    reset();
    for (const spy of [fetch, home, host, list, timeout, clear]) spy.mockRestore();
    await dom.happyDOM.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
