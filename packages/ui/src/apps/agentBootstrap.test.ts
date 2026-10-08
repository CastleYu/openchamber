import { describe, expect, test } from 'bun:test';
import { AGENT_ERROR } from '../../../web/server/lib/agent/constants.js';
import { AgentClient, type AgentClientPorts } from '@/lib/agent/client';
import { AgentBootstrap } from './agentBootstrap';

const response = (family: string, revision = 1) => new Response(JSON.stringify({ family, revision }));
const deferred = () => {
  let release: (value: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => { release = resolve; });
  return { promise, release: (value: Response) => release(value) };
};
class Harness {
  key = 'A';
  retired: (() => void) | null = null;
  changed: (() => void) | null = null;
  calls = 0;
  unsubscribed = 0;
  answer: () => Promise<Response> = async () => response('cagent');
  client = new AgentClient({
    getRuntimeKey: () => this.key,
    subscribe: (listener) => { this.retired = listener; return () => { this.unsubscribed += 1; }; },
    fetch: async () => { this.calls += 1; return this.answer(); },
  } satisfies AgentClientPorts);
  owner = new AgentBootstrap(this.client, (listener) => {
    this.changed = listener;
    return () => { this.changed = null; this.unsubscribed += 1; };
  });
}

describe('authoritative app family bootstrap', () => {
  test('selects either family after exactly one descriptor read', async () => {
    for (const family of ['opencode', 'cagent']) {
      const h = new Harness();
      expect(h.owner.getSnapshot()).toEqual({ state: 'loading' });
      h.answer = async () => response(family, 4);
      await h.owner.refresh();
      expect(h.owner.getSnapshot()).toEqual({
        state: 'selected', value: { scope: { runtimeKey: 'A', revision: 0 }, selection: { family, revision: 4 } },
      });
      expect(h.calls).toBe(1);
      h.owner.dispose();
    }
  });
  test('malformed and unavailable authority produce failure instead of OpenCode', async () => {
    const h = new Harness();
    h.answer = async () => response('unknown');
    await h.owner.refresh();
    expect(h.owner.getSnapshot()).toEqual({ state: 'failed', error: AGENT_ERROR.INVALID_RESPONSE });
    h.answer = async () => new Response(JSON.stringify({ error: AGENT_ERROR.UNAVAILABLE }), { status: 503 });
    await h.owner.refresh();
    expect(h.owner.getSnapshot()).toEqual({ state: 'failed', error: AGENT_ERROR.UNAVAILABLE });
    h.answer = async () => response('cagent');
    await h.owner.refresh();
    expect(h.owner.getSnapshot().state).toBe('selected');
    h.owner.dispose();
  });
  test('newer retries win over delayed reads', async () => {
    const h = new Harness();
    const delayed = deferred();
    h.answer = () => delayed.promise;
    const earlier = h.owner.refresh();
    h.answer = async () => response('cagent', 3);
    await h.owner.refresh();
    const selected = h.owner.getSnapshot();
    delayed.release(response('opencode'));
    await earlier;
    expect(h.owner.getSnapshot()).toBe(selected);
    h.owner.dispose();
  });
  test('retirement clears selection synchronously and changed waits for the new endpoint', async () => {
    const h = new Harness();
    await h.owner.refresh();
    h.retired?.();
    expect(h.owner.getSnapshot()).toEqual({ state: 'failed', error: AGENT_ERROR.CHANGED });
    h.key = 'B';
    const read = deferred();
    h.answer = () => read.promise;
    h.changed?.();
    expect(h.owner.getSnapshot()).toEqual({ state: 'loading' });
    h.key = 'A';
    h.retired?.();
    read.release(response('opencode'));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.owner.getSnapshot()).toEqual({ state: 'failed', error: AGENT_ERROR.CHANGED });
    h.owner.dispose();
  });
  test('host retirement without a URL event gives a retryable failure', async () => {
    const h = new Harness();
    h.answer = async () => new Response(JSON.stringify({ error: AGENT_ERROR.CHANGED }), { status: 409 });
    await h.owner.refresh();
    expect(h.owner.getSnapshot()).toEqual({ state: 'failed', error: AGENT_ERROR.CHANGED });
    h.owner.dispose();
  });
  test('dispose unsubscribes once and rejects late updates or new reads', async () => {
    const h = new Harness();
    const delayed = deferred();
    h.answer = () => delayed.promise;
    const read = h.owner.refresh();
    h.owner.dispose();
    h.owner.dispose();
    delayed.release(response('opencode'));
    await read;
    await h.owner.refresh();
    expect(h.owner.getSnapshot()).toEqual({ state: 'loading' });
    expect(h.calls).toBe(1);
    expect(h.unsubscribed).toBe(2);
  });
});
