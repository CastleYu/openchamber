import { describe, expect, test } from 'bun:test';

import type { UsageStats } from '@/lib/opencode/session-stats';
import { opencodeClient } from '@/lib/opencode/client';

import { createUsageStatsStore, getUsageStatsRuntimeKey, usageStatsKey, useUsageStatsStore, type UsageStatsRequest } from './usageStatsStore';

const report = (prompts: number): UsageStats => ({
  range: { from: 0, to: 1 },
  sessions: 1,
  subagents: 0,
  prompts,
  steps: prompts,
  tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  cost: 0,
  activeDays: 1,
  streak: 1,
  activity: [],
  models: [],
});

type Pending = { request: UsageStatsRequest; resolve: (stats: UsageStats) => void; reject: (error: Error) => void };

function setup() {
  const pending: Pending[] = [];
  let runtime = 'runtime-a';
  const store = createUsageStatsStore(
    (request) => new Promise<UsageStats>((resolve, reject) => pending.push({ request, resolve, reject })),
    () => runtime,
    () => 1000,
  );
  return { store, pending, setRuntime: (next: string) => { runtime = next; } };
}

const A: UsageStatsRequest = { range: '7d', projectDirectory: null };
const B: UsageStatsRequest = { range: '30d', projectDirectory: '/code/app' };
const entry = (ctx: ReturnType<typeof setup>, request: UsageStatsRequest, runtime = 'runtime-a') =>
  ctx.store.getState().entries[usageStatsKey(runtime, request)];

describe('usage stats cache', () => {
  test('keys by runtime, range and project', () => {
    expect(usageStatsKey('r', A)).not.toBe(usageStatsKey('r', { ...A, range: '30d' }));
    expect(usageStatsKey('r', A)).not.toBe(usageStatsKey('r', { ...A, projectDirectory: '/x' }));
    expect(usageStatsKey('r', A)).not.toBe(usageStatsKey('s', A));
  });

  test('fetches a key once and serves it from cache until forced', async () => {
    const ctx = setup();
    const first = ctx.store.getState().load(A);
    ctx.pending[0].resolve(report(3));
    await first;
    expect(entry(ctx, A)).toEqual({ stats: report(3), fetchedAt: 1000, loading: false, error: null });

    await ctx.store.getState().load(A);
    expect(ctx.pending).toHaveLength(1);

    void ctx.store.getState().load(A, { force: true });
    expect(ctx.pending).toHaveLength(2);
    expect(entry(ctx, A)?.stats).toEqual(report(3));
    expect(entry(ctx, A)?.loading).toBe(true);
  });

  test('a failed refresh keeps the cached report', async () => {
    const ctx = setup();
    const first = ctx.store.getState().load(A);
    ctx.pending[0].resolve(report(3));
    await first;
    const refresh = ctx.store.getState().load(A, { force: true });
    ctx.pending[1].reject(new Error('offline'));
    await refresh;
    expect(entry(ctx, A)).toEqual({ stats: report(3), fetchedAt: 1000, loading: false, error: 'offline' });
  });

  test('a read that finishes after switching filters lands on its own key only', async () => {
    const ctx = setup();
    const a = ctx.store.getState().load(A);
    const b = ctx.store.getState().load(B);
    ctx.pending[1].resolve(report(2));
    await b;
    ctx.pending[0].resolve(report(9));
    await a;
    expect(entry(ctx, A)?.stats).toEqual(report(9));
    expect(entry(ctx, B)?.stats).toEqual(report(2));
  });

  test('a runtime switch clears the cache and drops reads in flight', async () => {
    const ctx = setup();
    const a = ctx.store.getState().load(A);
    ctx.store.getState().reset();
    ctx.setRuntime('runtime-b');
    ctx.pending[0].resolve(report(9));
    await a;
    expect(ctx.store.getState().entries).toEqual({});
  });

  test('a changed connection key does not reuse the old error or accept a late read', async () => {
    const ctx = setup();
    const old = ctx.store.getState().load(A);
    ctx.setRuntime('runtime-b');
    const next = ctx.store.getState().load(A);
    expect(ctx.pending).toHaveLength(2);
    ctx.pending[0].reject(new Error('old connection failed'));
    await old;
    expect(entry(ctx, A)?.error).toBeNull();
    ctx.pending[1].resolve(report(5));
    await next;
    expect(entry(ctx, A, 'runtime-b')?.stats).toEqual(report(5));
  });

  test('an old connection error cannot suppress the first read on a new connection', async () => {
    const ctx = setup();
    const failed = ctx.store.getState().load(A);
    ctx.pending[0].reject(new Error('offline'));
    await failed;
    expect(entry(ctx, A)?.error).toBe('offline');
    ctx.setRuntime('runtime-b');
    const fresh = ctx.store.getState().load(A);
    expect(ctx.pending).toHaveLength(2);
    ctx.pending[1].resolve(report(4));
    await fresh;
    expect(entry(ctx, A, 'runtime-b')?.stats).toEqual(report(4));
  });

  test('rebinding OpenCode within one backend clears cached reports and errors', () => {
    const first = { generation: 'oc2' as const, endpoint: 'http://127.0.0.1:4101', epoch: 1, version: '2.0.16' };
    const second = { ...first, endpoint: 'http://127.0.0.1:4102', epoch: 2 };
    const third = { ...second, epoch: 3 };
    try {
      opencodeClient.bindRuntime(first);
      const firstKey = getUsageStatsRuntimeKey();
      useUsageStatsStore.setState({ entries: {
        [usageStatsKey(firstKey, A)]: { stats: report(3), fetchedAt: 1000, loading: false, error: 'offline' },
      } });
      opencodeClient.bindRuntime(second);
      expect(getUsageStatsRuntimeKey()).not.toBe(firstKey);
      expect(useUsageStatsStore.getState().entries).toEqual({});
      const secondKey = getUsageStatsRuntimeKey();
      useUsageStatsStore.setState({ entries: {
        [usageStatsKey(secondKey, A)]: { stats: null, fetchedAt: null, loading: false, error: 'old epoch' },
      } });
      opencodeClient.bindRuntime(third);
      expect(getUsageStatsRuntimeKey()).not.toBe(secondKey);
      expect(useUsageStatsStore.getState().entries).toEqual({});
    } finally {
      opencodeClient.reconnectToRuntimeBaseUrl();
      useUsageStatsStore.getState().reset();
    }
  });
});
