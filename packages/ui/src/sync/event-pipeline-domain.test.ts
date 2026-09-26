import { expect, test } from 'bun:test';
import type { DomainEvent } from '@/lib/opencode/events';
import type { SyncSource } from './source';
import { createEventPipeline } from './event-pipeline';

test('default flush timers preserve browser timer receivers', async () => {
  const schedule = globalThis.setTimeout;
  const cancel = globalThis.clearTimeout;
  Object.defineProperty(globalThis, 'setTimeout', { configurable: true, writable: true, value: function (this: typeof globalThis | undefined, ...args: Parameters<typeof setTimeout>) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return schedule(...args);
  } });
  Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, writable: true, value: function (this: typeof globalThis | undefined, ...args: Parameters<typeof clearTimeout>) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return cancel(...args);
  } });
  const delta: DomainEvent = { type: 'part-delta', sessionID: 'ses_timer', messageID: 'msg_timer', partID: 'msg_timer:text:0', delta: 'visible', directory: '/repo', eventID: 'evt_timer' };
  const source = {
    generation: 'oc2',
    events: async function* (signal: AbortSignal) {
      yield { generation: 'oc2' as const, value: delta };
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  } satisfies Pick<SyncSource, 'generation' | 'events'>;
  let deliver!: (events: readonly DomainEvent[]) => void;
  const received = new Promise<readonly DomainEvent[]>((resolve) => { deliver = resolve; });
  const timeout = schedule(() => deliver([]), 1000);
  const pipeline = createEventPipeline({ source, transport: 'sse', flushFrameMs: 0,
    onDomainEvents: (_directory, events) => deliver(events) });
  try {
    expect(await received).toEqual([delta]);
  } finally {
    pipeline.cleanup();
    cancel(timeout);
    Object.defineProperty(globalThis, 'setTimeout', { configurable: true, writable: true, value: schedule });
    Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, writable: true, value: cancel });
  }
});

test('OC1 routes an unknown session using its event envelope directory', async () => {
  const source = {
    generation: 'oc1',
    events: async function* (signal: AbortSignal) {
      yield { generation: 'oc1' as const, value: { directory: '/new-project', payload: {
        id: 'todo-unindexed', type: 'todo.updated' as const, properties: { sessionID: 'unindexed-session', todos: [] },
      } } };
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  } satisfies Pick<SyncSource, 'generation' | 'events'>;
  let deliver!: (directory: string) => void;
  const received = new Promise<string>((resolve) => { deliver = resolve; });
  const pipeline = createEventPipeline({ source, transport: 'sse', flushFrameMs: 0,
    onEvents: (directory) => deliver(directory) });
  try {
    expect(await Promise.race([received, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out')), 1000))])).toBe('/new-project');
  } finally {
    pipeline.cleanup();
  }
});

test('OC2 SSE events stay typed and duplicate event IDs are delivered once', async () => {
  const delta: DomainEvent = { type: 'part-delta', sessionID: 'ses_1', messageID: 'msg_1', partID: 'msg_1:text:0', delta: 'ha', directory: '/repo', eventID: 'evt_1' };
  const source = {
    generation: 'oc2',
    events: async function* (signal: AbortSignal) {
      yield { generation: 'oc2' as const, value: delta };
      yield { generation: 'oc2' as const, value: delta };
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  } satisfies Pick<SyncSource, 'generation' | 'events'>;
  let legacy = 0;
  let delivered!: (events: readonly DomainEvent[]) => void;
  const received = new Promise<readonly DomainEvent[]>((resolve) => { delivered = resolve; });
  const pipeline = createEventPipeline({ source, transport: 'sse', flushFrameMs: 0,
    onEvents: () => { legacy += 1; }, onDomainEvents: (_directory, events) => delivered(events) });
  try {
    const events = await Promise.race([received, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out')), 1000))]);
    expect(events).toEqual([delta]);
    expect(legacy).toBe(0);
  } finally {
    pipeline.cleanup();
  }
});
