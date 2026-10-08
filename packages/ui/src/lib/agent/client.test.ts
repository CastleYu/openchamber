import { describe, expect, test } from 'bun:test';
import { AGENT_ERROR, AGENT_FEATURE, AGENT_MUTATIONS, AGENT_OPERATION, AGENT_ROUTE } from '../../../../web/server/lib/agent/constants.js';
import { AgentClient, AgentClientError, type AgentClientPorts, type AgentClientScope } from './client';
import type { JsonValue } from '../../../../web/server/lib/agent/dispatcher.js';
import type { RuntimeFetchOptions } from '../runtime-fetch';

const identity = Object.freeze({ family: 'cagent' as const, connectionID: 'conn-a', epoch: 3, adapterRevision: 'adapter-1', capabilityRevision: 'caps-1' });
const runtime = () => ({ identity, operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((operation) => [operation, { available: true }])) });
const features = () => ({ identity, features: Object.fromEntries(Object.values(AGENT_FEATURE).map((feature) => [feature, { available: true }])) });
const response = (body: JsonValue, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const scopeOf = (): AgentClientScope => ({ runtimeKey: 'runtime-a', revision: 0, identity });

class Harness {
  key = 'runtime-a';
  retire: (() => void) | undefined;
  calls: Array<{ path: string | URL | Request; init: RuntimeFetchOptions | undefined }> = [];
  answer: (path: string | URL | Request, init?: RuntimeFetchOptions) => Promise<Response> = async () => response({});
  unsubscribed = 0;
  client = new AgentClient({
    getRuntimeKey: () => this.key,
    subscribe: (callback) => { this.retire = callback; return () => { this.unsubscribed += 1; }; },
    fetch: async (path, init) => { this.calls.push({ path, init }); return this.answer(path, init); },
  } satisfies AgentClientPorts);
}

const code = async (work: Promise<unknown>, expected: string) => {
  try { await work; throw new Error('expected AgentClientError'); }
  catch (error) {
    if (!(error instanceof AgentClientError)) throw error;
    expect(error.code).toBe(expected);
  }
};
const gate = <T,>() => {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => { release = resolve; });
  return { promise, release: (value: T) => release(value) };
};

describe('AgentClient', () => {
  test('inspect parses exhaustive runtime and feature snapshots and captures detached scope', async () => {
    const h = new Harness();
    h.answer = async (path) => response(String(path) === AGENT_ROUTE.RUNTIME ? runtime() : features());
    const snapshot = await h.client.inspect();
    expect(Object.keys(snapshot.runtime.operations)).toHaveLength(Object.values(AGENT_OPERATION).length);
    expect(Object.keys(snapshot.availability.features)).toHaveLength(Object.values(AGENT_FEATURE).length);
    expect(snapshot.scope).toEqual({ runtimeKey: 'runtime-a', revision: 0, identity });
    expect(snapshot.scope.identity).not.toBe(identity);
  });

  test('inspect rejects identity mismatch, missing operation rows, and malformed payloads', async () => {
    const h = new Harness();
    h.answer = async (path) => response(String(path) === AGENT_ROUTE.RUNTIME ? runtime() : { ...features(), identity: { ...identity, epoch: 4 } });
    await code(h.client.inspect(), AGENT_ERROR.CHANGED);
    const missing = new Harness();
    missing.answer = async (path) => response(String(path) === AGENT_ROUTE.RUNTIME ? { identity, operations: {} } : features());
    await code(missing.client.inspect(), AGENT_ERROR.INVALID_RESPONSE);
    const malformed = new Harness();
    malformed.answer = async () => response({ nope: true });
    await code(malformed.client.inspect(), AGENT_ERROR.INVALID_RESPONSE);
  });

  test('dispatch validates input before transport and preserves method, path, body, and request ID', async () => {
    const h = new Harness();
    await code(h.client.dispatch(scopeOf(), AGENT_OPERATION.SEND_PROMPT, { workspaceID: '', sessionID: 's', requestID: 'r', text: 'hello' }), AGENT_ERROR.INVALID_INPUT);
    expect(h.calls).toHaveLength(0);
    h.answer = async () => response({ identity, data: { state: 'accepted', requestID: 'r' } });
    const result = await h.client.dispatch(scopeOf(), AGENT_OPERATION.SEND_PROMPT, { workspaceID: 'w', sessionID: 's', requestID: 'r', text: 'hello' });
    expect(result).toEqual({ state: 'accepted', requestID: 'r' });
    const call = h.calls[0];
    expect(call.path).toBe(AGENT_ROUTE.DISPATCH);
    expect(call.init?.method).toBe('POST');
    expect(JSON.parse(String(call.init?.body))).toEqual({ operation: AGENT_OPERATION.SEND_PROMPT, identity, input: { workspaceID: 'w', sessionID: 's', requestID: 'r', text: 'hello' } });
  });

  test('dispatch rejects mismatched identities and malformed mutation results as unknown outcome', async () => {
    const h = new Harness();
    h.answer = async () => response({ identity: { ...identity, epoch: 4 }, data: { state: 'accepted', requestID: 'r' } });
    await code(h.client.dispatch(scopeOf(), AGENT_OPERATION.SEND_PROMPT, { workspaceID: 'w', sessionID: 's', requestID: 'r', text: 'x' }), AGENT_ERROR.UNKNOWN_OUTCOME);
    const malformed = new Harness();
    malformed.answer = async () => response({ identity, data: { wrong: true } });
    await code(malformed.client.dispatch(scopeOf(), AGENT_OPERATION.SEND_PROMPT, { workspaceID: 'w', sessionID: 's', requestID: 'r', text: 'x' }), AGENT_ERROR.UNKNOWN_OUTCOME);
  });

  test('read output is schema parsed and invalid read data is rejected', async () => {
    const h = new Harness();
    h.answer = async () => response({ identity, data: { modelID: null } });
    expect(await h.client.dispatch(scopeOf(), AGENT_OPERATION.GET_DEFAULT_MODEL, { workspaceID: 'w' })).toEqual({ modelID: null });
    h.answer = async () => response({ identity, data: { modelID: 2 } });
    await code(h.client.dispatch(scopeOf(), AGENT_OPERATION.GET_DEFAULT_MODEL, { workspaceID: 'w' }), AGENT_ERROR.INVALID_RESPONSE);
  });

  test('host unsupported and unauthorized refusals remain distinct', async () => {
    for (const refusal of [AGENT_ERROR.UNSUPPORTED, AGENT_ERROR.UNAUTHORIZED]) {
      const h = new Harness();
      h.answer = async () => response({ error: refusal }, 403);
      await code(h.client.dispatch(scopeOf(), AGENT_OPERATION.GET_DEFAULT_MODEL, { workspaceID: 'w' }), refusal);
    }
  });

  test('mutation transport loss and malformed response report unknown outcome without retry', async () => {
    const h = new Harness();
    h.answer = async () => { throw new Error('offline'); };
    await code(h.client.dispatch(scopeOf(), AGENT_OPERATION.SEND_PROMPT, { workspaceID: 'w', sessionID: 's', requestID: 'r', text: 'x' }), AGENT_ERROR.UNKNOWN_OUTCOME);
    expect(h.calls).toHaveLength(1);
    const malformed = new Harness();
    malformed.answer = async () => new Response('not-json');
    await code(malformed.client.dispatch(scopeOf(), AGENT_OPERATION.CREATE_SESSION, { workspaceID: 'w', requestID: 'r' }), AGENT_ERROR.UNKNOWN_OUTCOME);
    expect(malformed.calls).toHaveLength(1);
  });

  test('read transport loss reports backend failure', async () => {
    const h = new Harness();
    h.answer = async () => { throw new Error('offline'); };
    await code(h.client.dispatch(scopeOf(), AGENT_OPERATION.GET_DEFAULT_MODEL, { workspaceID: 'w' }), AGENT_ERROR.BACKEND_FAILED);
    expect(h.calls).toHaveLength(1);
  });

  test('abort before transport produces zero effects', async () => {
    const h = new Harness();
    const abort = new AbortController();
    abort.abort();
    await code(h.client.dispatch(scopeOf(), AGENT_OPERATION.GET_DEFAULT_MODEL, { workspaceID: 'w' }, abort.signal), AGENT_ERROR.CANCELLED);
    expect(h.calls).toHaveLength(0);
  });

  test('retiring endpoint A to B to A aborts in-flight work and rejects old scope before transport', async () => {
    const h = new Harness();
    const waiting = gate<Response>();
    let seenSignal: AbortSignal | null | undefined;
    h.answer = async (_path, init) => { seenSignal = init?.signal; return waiting.promise; };
    const request = h.client.dispatch(scopeOf(), AGENT_OPERATION.GET_DEFAULT_MODEL, { workspaceID: 'w' });
    await Promise.resolve();
    h.key = 'runtime-b'; h.retire?.();
    h.key = 'runtime-a'; h.retire?.();
    expect(seenSignal?.aborted).toBe(true);
    waiting.release(response({ identity, data: { modelID: null } }));
    await code(request, AGENT_ERROR.CHANGED);
    await code(h.client.dispatch(scopeOf(), AGENT_OPERATION.GET_DEFAULT_MODEL, { workspaceID: 'w' }), AGENT_ERROR.CHANGED);
    expect(h.calls).toHaveLength(1);
  });

  test('retired reads report backend changed while entered mutations report unknown outcome', async () => {
    for (const operation of [AGENT_OPERATION.GET_DEFAULT_MODEL, AGENT_OPERATION.SEND_PROMPT]) {
      const h = new Harness();
      const waiting = gate<Response>();
      h.answer = async () => waiting.promise;
      const request = operation === AGENT_OPERATION.GET_DEFAULT_MODEL
        ? h.client.dispatch(scopeOf(), operation, { workspaceID: 'w' })
        : h.client.dispatch(scopeOf(), operation, { workspaceID: 'w', sessionID: 's', requestID: 'r', text: 'x' });
      await Promise.resolve();
      h.key = 'runtime-b'; h.retire?.();
      waiting.release(response({ identity, data: operation === AGENT_OPERATION.GET_DEFAULT_MODEL ? { modelID: null } : { state: 'accepted', requestID: 'r' } }));
      await code(request, operation === AGENT_OPERATION.GET_DEFAULT_MODEL ? AGENT_ERROR.CHANGED : AGENT_ERROR.UNKNOWN_OUTCOME);
    }
  });

  test('readAttempt distinguishes null, accepts an older epoch, and validates request identity', async () => {
    const h = new Harness();
    h.answer = async () => response({ identity, attempt: null });
    expect(await h.client.readAttempt(scopeOf(), 'r')).toBeNull();
    const older = new Harness();
    older.answer = async () => response({ identity, attempt: { version: 1, identity: { ...identity, epoch: 2 }, operation: AGENT_MUTATIONS[0], requestID: 'r', state: 'unknown' } });
    expect(await older.client.readAttempt(scopeOf(), 'r')).toMatchObject({ requestID: 'r' });
    const mismatch = new Harness();
    mismatch.answer = async () => response({ identity, attempt: { version: 1, identity, operation: AGENT_MUTATIONS[0], requestID: 'other', state: 'unknown' } });
    await code(mismatch.client.readAttempt(scopeOf(), 'r'), AGENT_ERROR.INVALID_RESPONSE);
  });

  test('readAttempt rejects attempt family and connection mismatches and malformed rows', async () => {
    for (const attemptIdentity of [{ ...identity, family: 'opencode' }, { ...identity, connectionID: 'other' }]) {
      const h = new Harness();
      h.answer = async () => response({ identity, attempt: { version: 1, identity: attemptIdentity, operation: AGENT_MUTATIONS[0], requestID: 'r', state: 'unknown' } });
      await code(h.client.readAttempt(scopeOf(), 'r'), AGENT_ERROR.INVALID_RESPONSE);
    }
    const absent = new Harness();
    absent.answer = async () => response({ identity });
    await code(absent.client.readAttempt(scopeOf(), 'r'), AGENT_ERROR.INVALID_RESPONSE);
  });

  test('dispose is idempotent, unsubscribes once, and cancels active request', async () => {
    const h = new Harness();
    const waiting = gate<Response>();
    let seenSignal: AbortSignal | null | undefined;
    h.answer = async (_path, init) => { seenSignal = init?.signal; return waiting.promise; };
    const request = h.client.dispatch(scopeOf(), AGENT_OPERATION.GET_DEFAULT_MODEL, { workspaceID: 'w' });
    await Promise.resolve();
    h.client.dispose(); h.client.dispose();
    expect(h.unsubscribed).toBe(1);
    expect(seenSignal?.aborted).toBe(true);
    waiting.release(response({ identity, data: { modelID: null } }));
    await code(request, AGENT_ERROR.CHANGED);
  });
});
