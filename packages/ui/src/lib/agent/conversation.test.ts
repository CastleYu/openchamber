import { describe, expect, test } from 'bun:test';
import { AGENT_ATTEMPT, AGENT_ERROR, AGENT_FEATURE, AGENT_MESSAGE_STATE, AGENT_OPERATION, AGENT_PART, AGENT_ROLE, AGENT_ROUTE } from '../../../../web/server/lib/agent/constants.js';
import { AgentClient, AgentClientError, type AgentClientPorts, type AgentClientSnapshot } from './client';
import { AgentConversation } from './conversation';
import type { RuntimeFetchOptions } from '../runtime-fetch';
import type { AgentOperation, JsonValue } from '../../../../web/server/lib/agent/dispatcher.js';
import { AGENT_INPUT_SCHEMAS, agentDispatchRequestSchema } from '../../../../web/server/lib/agent/schemas.js';

const identity = Object.freeze({ family: 'cagent' as const, connectionID: 'conn-a', epoch: 3, adapterRevision: 'adapter-1', capabilityRevision: 'caps-1' });
const runtime = () => ({ identity, operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((operation) => [operation, { available: true }])) });
const features = () => ({ identity, features: Object.fromEntries(Object.values(AGENT_FEATURE).map((feature) => [feature, { available: true }])) });
const message = (id: string, sessionID = 's', text = id) => ({
  id, sessionID, role: AGENT_ROLE.USER,
  parts: [{ id: `${id}-part`, type: AGENT_PART.TEXT, text }], state: AGENT_MESSAGE_STATE.COMPLETE,
});
const response = (body: JsonValue, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const gate = <T,>() => {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => { release = resolve; });
  return { promise, release: (value: T) => release(value) };
};

class Harness {
  key = 'runtime-a';
  retire: (() => void) | undefined;
  calls: Array<{ path: string | URL | Request; init: RuntimeFetchOptions | undefined }> = [];
  dispatch: (operation: AgentOperation, input: JsonValue) => Promise<JsonValue> = async (operation): Promise<JsonValue> => (
    operation === AGENT_OPERATION.GET_SESSION ? { id: 's', workspaceID: 'w' } : {}
  );
  attempt: JsonValue | Promise<JsonValue> = null;
  failure?: typeof AGENT_ERROR[keyof typeof AGENT_ERROR];
  client = new AgentClient({
    getRuntimeKey: () => this.key,
    subscribe: (callback) => { this.retire = callback; return () => {}; },
    fetch: async (path, init) => {
      this.calls.push({ path, init });
      if (String(path) === AGENT_ROUTE.RUNTIME) return response(runtime());
      if (String(path) === AGENT_ROUTE.FEATURES) return response(features());
      if (String(path) === AGENT_ROUTE.ATTEMPT) {
        return response({ identity, attempt: await this.attempt });
      }
      if (this.failure) return response({ error: this.failure }, 409);
      const body = agentDispatchRequestSchema.parse(JSON.parse(String(init?.body)));
      return response({ identity, data: await this.dispatch(body.operation, body.input) });
    },
  } satisfies AgentClientPorts);
  conversation = new AgentConversation(this.client);
  async open(workspaceID = 'w', sessionID = 's'): Promise<AgentClientSnapshot> {
    const snapshot = await this.client.inspect();
    await this.conversation.open(snapshot, workspaceID, sessionID);
    return snapshot;
  }
}

const code = async (work: Promise<unknown>, expected: string) => {
  try { await work; throw new Error('expected AgentClientError'); }
  catch (error) {
    if (!(error instanceof AgentClientError)) throw error;
    expect(error.code).toBe(expected);
  }
};

describe('AgentConversation', () => {
  test('a changed host identity retires visible state even without endpoint navigation', async () => {
    const h = new Harness(); await h.open();
    h.dispatch = async () => ({ items: [message('old')] });
    await h.conversation.history();
    h.failure = AGENT_ERROR.CHANGED;
    await code(h.conversation.history(), AGENT_ERROR.CHANGED);
    expect(h.conversation.getSnapshot().state).toBe('unbound');
  });
  test('a send invalidates an older history load without leaving a loading state', async () => {
    const h = new Harness(); await h.open();
    const pending = gate<JsonValue>();
    h.dispatch = async (operation) => operation === AGENT_OPERATION.LIST_MESSAGES
      ? pending.promise : { state: 'accepted', requestID: 'r' };
    const read = h.conversation.history();
    await h.conversation.send('r', 'hello');
    pending.release({ items: [message('obsolete')] });
    await code(read, AGENT_ERROR.CHANGED);
    const state = h.conversation.getSnapshot();
    if (state.state !== 'bound') throw new Error('conversation did not bind');
    expect(state.history.state).toBe('empty');
    expect(state.history.items).toEqual([]);
    expect(state.write).toEqual({ state: 'accepted', requestID: 'r' });
  });

  test('retiring an entered write preserves uncertainty when its conversation reopens', async () => {
    const h = new Harness(); await h.open();
    const entered = gate<void>(); const pending = gate<JsonValue>();
    h.dispatch = async () => { entered.release(); return pending.promise; };
    const sending = h.conversation.send('r', 'hello');
    await entered.promise;
    h.retire?.();
    expect(h.conversation.getSnapshot().state).toBe('unbound');
    pending.release({ state: 'complete', requestID: 'r' });
    await code(sending, AGENT_ERROR.UNKNOWN_OUTCOME);
    h.dispatch = async () => ({ id: 's', workspaceID: 'w' });
    await h.open();
    const state = h.conversation.getSnapshot();
    if (state.state !== 'bound') throw new Error('conversation did not bind');
    expect(state.write).toEqual({ state: 'unknown', requestID: 'r' });
  });

  test('a delayed attempt lookup cannot overwrite a newer send', async () => {
    const h = new Harness(); await h.open();
    h.dispatch = async () => ({ state: 'accepted', requestID: 'r1' });
    await h.conversation.send('r1', 'first');
    const pending = gate<JsonValue>();
    h.attempt = pending.promise;
    const resolving = h.conversation.resolve();
    h.dispatch = async () => ({ state: 'complete', requestID: 'r2' });
    await h.conversation.send('r2', 'second');
    pending.release({ version: 1, identity, operation: AGENT_OPERATION.SEND_PROMPT, requestID: 'r1', state: 'complete' });
    await code(resolving, AGENT_ERROR.CHANGED);
    const state = h.conversation.getSnapshot();
    if (state.state !== 'bound') throw new Error('conversation did not bind');
    expect(state.write).toEqual({ state: 'complete', requestID: 'r2' });
  });

  test('wrong-session history and cyclic cursors retain the previous records', async () => {
    const h = new Harness(); await h.open();
    h.dispatch = async () => ({ items: [message('z'), message('a')], next: 'cursor' });
    await h.conversation.history();
    h.dispatch = async () => ({ items: [message('other', 'different')] });
    await code(h.conversation.history(), AGENT_ERROR.INVALID_RESPONSE);
    h.dispatch = async () => ({ items: [message('cycle')], next: 'cursor' });
    await code(h.conversation.history(true), AGENT_ERROR.INVALID_RESPONSE);
    const state = h.conversation.getSnapshot();
    if (state.state !== 'bound') throw new Error('conversation did not bind');
    expect(state.history.items.map((message) => message.id)).toEqual(['z', 'a']);
  });

  test('dispose retires pending work and unsubscribes the conversation listener', async () => {
    const h = new Harness(); await h.open();
    let notifications = 0;
    h.conversation.subscribe(() => { notifications += 1; });
    h.conversation.dispose(); h.conversation.dispose();
    expect(notifications).toBe(1);
    h.retire?.();
    expect(notifications).toBe(1);
    await code(h.conversation.history(), AGENT_ERROR.CHANGED);
  });
  test('opens sparse session and retains absent project, directory, model, and time fields', async () => {
    const h = new Harness();
    h.dispatch = async () => ({ id: 's', workspaceID: 'w' });
    await h.open();
    const state = h.conversation.getSnapshot();
    expect(state.state).toBe('bound');
    if (state.state !== 'bound') throw new Error('conversation did not bind');
    expect(state.session).toEqual({ id: 's', workspaceID: 'w' });
    expect(Object.keys(state.session)).toEqual(['id', 'workspaceID']);
    h.dispatch = async () => ({ items: [message('m1')] });
    await h.conversation.history();
    const loaded = h.conversation.getSnapshot();
    if (loaded.state !== 'bound') throw new Error('conversation did not bind');
    expect(loaded.history.items[0]).toEqual(message('m1'));
  });

  test('merges pages in order, deduplicates IDs, and applies incoming updated records', async () => {
    const h = new Harness(); await h.open();
    let page = 0;
    h.dispatch = async (_operation, input): Promise<JsonValue> => {
      if (AGENT_INPUT_SCHEMAS[AGENT_OPERATION.LIST_MESSAGES].parse(input).cursor) return { items: [message('m2'), message('m1', 's', 'updated')] };
      page += 1;
      return page === 1 ? { items: [message('m1')], next: 'cursor-1' } : { items: [message('m1')] };
    };
    await h.conversation.history();
    await h.conversation.history(true);
    const state = h.conversation.getSnapshot();
    if (state.state !== 'bound') throw new Error('conversation did not bind');
    expect(state.history.items).toEqual([message('m1', 's', 'updated'), message('m2')]);
    expect(new Set(state.history.items.map((item) => item.id)).size).toBe(2);
  });

  test('rejects cross-workspace responses and preserves prior history after a failed read', async () => {
    const h = new Harness(); await h.open();
    h.dispatch = async () => ({ items: [message('m1')] });
    await h.conversation.history();
    h.dispatch = async () => ({ id: 's', workspaceID: 'other' });
    await code(h.conversation.open(await h.client.inspect(), 'w', 's'), AGENT_ERROR.INVALID_RESPONSE);
    expect(h.conversation.getSnapshot().state).toBe('unbound');
    h.dispatch = async () => ({ id: 's', workspaceID: 'w' });
    await h.open();
    h.dispatch = async () => ({ items: [message('m1')] });
    await h.conversation.history();
    h.dispatch = async () => { throw new Error('offline'); };
    await code(h.conversation.history(), AGENT_ERROR.BACKEND_FAILED);
    const failed = h.conversation.getSnapshot();
    if (failed.state !== 'bound') throw new Error('failed history erased binding');
    expect(failed.history.items).toEqual([message('m1')]);
  });

  test('retirement makes stale open and history results unable to restore state', async () => {
    for (const operation of [AGENT_OPERATION.GET_SESSION, AGENT_OPERATION.LIST_MESSAGES]) {
      const h = new Harness();
      if (operation === AGENT_OPERATION.LIST_MESSAGES) await h.open();
      const waiting = gate<JsonValue>();
      const entered = gate<void>();
      h.dispatch = async () => { entered.release(); return waiting.promise; };
      const work = operation === AGENT_OPERATION.GET_SESSION
        ? (async () => h.conversation.open(await h.client.inspect(), 'w', 's'))()
        : h.conversation.history();
      await entered.promise;
      h.key = 'runtime-b'; h.retire?.();
      waiting.release(operation === AGENT_OPERATION.GET_SESSION ? { id: 's', workspaceID: 'w' } : { items: [message('late')] });
      await code(work, AGENT_ERROR.CHANGED);
      expect(h.conversation.getSnapshot().state).toBe('unbound');
    }
  });

  test('newer history read wins when reads finish out of order', async () => {
    const h = new Harness(); await h.open();
    const first = gate<JsonValue>(); const second = gate<JsonValue>(); let reads = 0;
    h.dispatch = async () => { reads += 1; return reads === 1 ? first.promise : second.promise; };
    const oldRead = h.conversation.history();
    const newRead = h.conversation.history();
    second.release({ items: [message('new')] }); await newRead;
    first.release({ items: [message('old')] }); await code(oldRead, AGENT_ERROR.CHANGED);
    const state = h.conversation.getSnapshot();
    if (state.state !== 'bound') throw new Error('conversation did not bind');
    expect(state.history.items).toEqual([message('new')]);
  });

  test('unknown entered send is never retried and blocks further sends after reopen', async () => {
    const h = new Harness(); await h.open(); let sends = 0;
    h.dispatch = async () => { sends += 1; throw new Error('lost receipt'); };
    await code(h.conversation.send('r1', 'hello'), AGENT_ERROR.UNKNOWN_OUTCOME);
    await code(h.conversation.send('r2', 'again'), AGENT_ERROR.UNKNOWN_OUTCOME);
    expect(sends).toBe(1);
    h.dispatch = async () => ({ id: 's', workspaceID: 'w' }); await h.open();
    const state = h.conversation.getSnapshot();
    if (state.state !== 'bound') throw new Error('conversation did not rebind');
    expect(state.write).toMatchObject({ state: 'unknown', requestID: 'r1' });
    await code(h.conversation.send('r2', 'again'), AGENT_ERROR.UNKNOWN_OUTCOME);
    expect(sends).toBe(1);
  });

  test('null attempt keeps unknown and matching complete ledger record resolves it', async () => {
    const h = new Harness(); await h.open();
    h.dispatch = async () => { throw new Error('lost receipt'); };
    await code(h.conversation.send('r1', 'hello'), AGENT_ERROR.UNKNOWN_OUTCOME);
    await h.conversation.resolve();
    const state = h.conversation.getSnapshot();
    if (state.state !== 'bound') throw new Error('conversation did not bind');
    expect(state.write).toMatchObject({ state: 'unknown', requestID: 'r1' });
    const complete = new Harness(); await complete.open();
    complete.dispatch = async () => { throw new Error('lost receipt'); };
    await code(complete.conversation.send('r2', 'hello'), AGENT_ERROR.UNKNOWN_OUTCOME);
    complete.attempt = { version: AGENT_ATTEMPT.VERSION, identity, operation: AGENT_OPERATION.SEND_PROMPT, requestID: 'r2', state: AGENT_ATTEMPT.COMPLETE };
    await complete.conversation.resolve();
    const resolved = complete.conversation.getSnapshot();
    if (resolved.state !== 'bound') throw new Error('conversation did not bind');
    expect(resolved.write).toEqual({ state: AGENT_ATTEMPT.COMPLETE, requestID: 'r2' });
  });

  test('wrong receipt request ID remains unknown and duplicate request IDs are refused', async () => {
    const wrong = new Harness(); await wrong.open();
    wrong.dispatch = async () => ({ state: 'complete', requestID: 'different' });
    await code(wrong.conversation.send('r1', 'hello'), AGENT_ERROR.UNKNOWN_OUTCOME);
    const duplicate = new Harness(); await duplicate.open();
    duplicate.dispatch = async () => ({ state: 'complete', requestID: 'r2' });
    await duplicate.conversation.send('r2', 'hello');
    await code(duplicate.conversation.send('r2', 'again'), AGENT_ERROR.ATTEMPT_EXISTS);
  });

  test('host unavailable feature refuses before transport', async () => {
    const h = new Harness();
    const snapshot = await h.client.inspect();
    const rows = { ...snapshot.availability.features,
      [AGENT_FEATURE.ACQUIRE_SESSION]: { available: false, reason: AGENT_ERROR.UNSUPPORTED },
    } satisfies AgentClientSnapshot['availability']['features'];
    const unavailable = { ...snapshot, availability: { ...snapshot.availability, features: rows } } satisfies AgentClientSnapshot;
    const calls = h.calls.length;
    await code(h.conversation.open(unavailable, 'w', 's'), AGENT_ERROR.UNSUPPORTED);
    expect(h.calls).toHaveLength(calls);
  });
});
