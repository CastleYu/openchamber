import { describe, expect, test } from 'bun:test';
import { AGENT_ERROR, AGENT_EXTENSION, AGENT_ROUTE, AGENT_SERVER_METHOD } from '../../../../web/server/lib/agent/constants.js';
import type { JsonValue } from '../../../../web/server/lib/agent/dispatcher.js';
import type { ExtensionManifest } from '../../../../web/server/lib/agent/extensions.js';
import type { RuntimeFetchOptions } from '../runtime-fetch';
import { AgentClient, AgentClientError, type AgentClientPorts, type AgentClientScope } from './client';

const identity = Object.freeze({ family: 'cagent' as const, connectionID: 'conn-a', epoch: 3, adapterRevision: 'adapter-1', capabilityRevision: 'caps-1', principalID: `principal-${'a'.repeat(64)}` });
const label = { key: 'cagent.extension.run', en: 'Run', zhCN: '运行' };
const fieldLabel = { key: 'cagent.extension.value', en: 'Value', zhCN: '值' };
const manifest = (effect: 'read' | 'mutation' = 'read', outcome: 'observed' | 'accepted-only' = 'accepted-only') => ({
  version: AGENT_EXTENSION.VERSION, actionID: 'cagent.extension.run', revision: 'rev-1', label,
  context: { workspace: true, session: false }, effect, authorization: 'current-principal',
  cancellation: 'none', outcome, input: [{ key: 'value', label: fieldLabel, required: true, value: { kind: AGENT_EXTENSION.KIND.NUMBER, min: 0, max: 10 } }],
  output: { kind: AGENT_EXTENSION.KIND.TABLE, columns: [{ key: 'value', label: fieldLabel, required: true, value: { kind: AGENT_EXTENSION.KIND.NUMBER, min: 0, max: 10 } }], maxRows: 2 },
  evidence: [{ document: 'extensions', section: 'verified' }],
} satisfies ExtensionManifest);
const row = (value = manifest()) => ({ manifest: value, availability: { available: true } });
const response = (body: JsonValue, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const scopeOf = (): AgentClientScope => ({ runtimeKey: 'runtime-a', revision: 0, identity });

class Harness {
  key = 'runtime-a';
  retire: (() => void) | undefined;
  calls: Array<{ path: string | URL | Request; init: RuntimeFetchOptions | undefined }> = [];
  answer: (path: string | URL | Request, init?: RuntimeFetchOptions) => Promise<Response> = async () => response({});
  client = new AgentClient({
    getRuntimeKey: () => this.key,
    subscribe: (callback) => { this.retire = callback; return () => {}; },
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

describe('AgentClient extensions', () => {
  test('enumerates strict manifests and availability with identity and GET route', async () => {
    const h = new Harness();
    h.answer = async () => response({ identity, actions: [row()] });
    const result = await h.client.extensions(scopeOf());
    expect(result).toEqual({ identity, actions: [row()] });
    expect(h.calls[0].path).toBe(AGENT_ROUTE.EXTENSIONS);
    expect(h.calls[0].init?.method).toBeUndefined();
    expect(h.calls[0].init?.cache).toBe('no-store');
    h.client.dispose();
  });

  test('rejects malformed, duplicate, over-limit, or foreign snapshots', async () => {
    const invalid: JsonValue[] = [
      { identity, actions: [{ ...row(), manifest: { ...manifest(), extra: true } }] },
      { identity, actions: [row(), row()] },
      { identity, actions: [{ ...row(), availability: { available: true, reason: 'nope' } }] },
      { identity, actions: Array.from({ length: 65 }, (_, index) => row({ ...manifest(), actionID: `cagent.extension.${index}` })) },
    ];
    for (const value of invalid) {
      const h = new Harness(); h.answer = async () => response(value);
      await code(h.client.extensions(scopeOf()), AGENT_ERROR.INVALID_RESPONSE); h.client.dispose();
    }
    const foreign = new Harness();
    foreign.answer = async () => response({ identity: { ...identity, principalID: `principal-${'b'.repeat(64)}` }, actions: [] });
    await code(foreign.client.extensions(scopeOf()), AGENT_ERROR.CHANGED);
    foreign.client.dispose();
  });

  test('pre-aborted reads and invalid context or values make no request', async () => {
    const h = new Harness();
    const abort = new AbortController(); abort.abort();
    await code(h.client.extensions(scopeOf(), abort.signal), AGENT_ERROR.CANCELLED);
    await code(h.client.dispatchExtension(scopeOf(), manifest(), { workspaceID: '', values: { value: 2 } }), AGENT_ERROR.INVALID_INPUT);
    await code(h.client.dispatchExtension(scopeOf(), manifest(), { workspaceID: 'w', sessionID: 's', values: { value: 2 } }), AGENT_ERROR.INVALID_INPUT);
    await code(h.client.dispatchExtension(scopeOf(), manifest(), { workspaceID: 'w', values: { value: Number.POSITIVE_INFINITY } }), AGENT_ERROR.INVALID_INPUT);
    expect(h.calls).toHaveLength(0); h.client.dispose();
  });

  test('dispatch preserves strict request envelope and parses table rows', async () => {
    const h = new Harness();
    h.answer = async () => response({ identity, result: { rows: [{ value: 4 }] } });
    expect(await h.client.dispatchExtension(scopeOf(), manifest(), { workspaceID: 'w', values: { value: 2 } })).toEqual({ identity, result: { rows: [{ value: 4 }] } });
    const call = h.calls[0];
    expect(call.path).toBe(AGENT_ROUTE.EXTENSION_DISPATCH);
    expect(call.init?.method).toBe(AGENT_SERVER_METHOD.POST);
    expect(JSON.parse(String(call.init?.body))).toEqual({ actionID: manifest().actionID, identity, input: { workspaceID: 'w', values: { value: 2 } } });
    h.client.dispose();
  });

  test('reads reject receipts; mutations require matching receipts and observed complete state', async () => {
    const read = new Harness(); read.answer = async () => response({ identity, result: { rows: [] }, receipt: { requestID: 'r', state: 'complete' } });
    await code(read.client.dispatchExtension(scopeOf(), manifest(), { workspaceID: 'w', values: { value: 1 } }), AGENT_ERROR.INVALID_RESPONSE); read.client.dispose();
    for (const receipt of [undefined, { requestID: 'other', state: 'complete' }, { requestID: 'r', state: 'accepted' }]) {
      const h = new Harness(); h.answer = async () => response(receipt
        ? { identity, result: { rows: [{ value: 1 }] }, receipt }
        : { identity, result: { rows: [{ value: 1 }] } });
      await code(h.client.dispatchExtension(scopeOf(), manifest('mutation', 'observed'), { workspaceID: 'w', requestID: 'r', values: { value: 1 } }), AGENT_ERROR.UNKNOWN_OUTCOME); h.client.dispose();
    }
    const accepted = new Harness(); accepted.answer = async () => response({ identity, result: { rows: [] }, receipt: { requestID: 'r', state: 'accepted' } });
    expect(await accepted.client.dispatchExtension(scopeOf(), manifest('mutation'), { workspaceID: 'w', requestID: 'r', values: { value: 1 } })).toMatchObject({ receipt: { state: 'accepted' } }); accepted.client.dispose();
  });

  test('unknown, unsupported, unaccepted and malformed outcomes never replay writes', async () => {
    for (const availability of [{ available: false, reason: AGENT_ERROR.UNSUPPORTED }, { available: false, reason: AGENT_ERROR.UNACCEPTED }]) {
      const h = new Harness(); h.answer = async () => response({ identity, actions: [{ manifest: manifest('mutation'), availability }] });
      const snapshot = await h.client.extensions(scopeOf());
      expect(snapshot.actions[0].availability).toEqual(availability); h.client.dispose();
    }
    const h = new Harness(); h.answer = async () => response({ identity, result: { rows: [] }, receipt: { requestID: 'r', state: 'unknown' } });
    await code(h.client.dispatchExtension(scopeOf(), manifest('mutation'), { workspaceID: 'w', requestID: 'r', values: { value: 1 } }), AGENT_ERROR.UNKNOWN_OUTCOME);
    expect(h.calls).toHaveLength(1); h.client.dispose();
    const lost = new Harness(); lost.answer = async () => { throw new Error('offline'); };
    await code(lost.client.dispatchExtension(scopeOf(), manifest('mutation'), { workspaceID: 'w', requestID: 'r', values: { value: 1 } }), AGENT_ERROR.UNKNOWN_OUTCOME);
    expect(lost.calls).toHaveLength(1); lost.client.dispose();
  });

  test('endpoint retirement and foreign identity retire the scope; stale entered mutation is unknown', async () => {
    const h = new Harness(); const waiting = gate<Response>();
    h.answer = async () => waiting.promise;
    const request = h.client.dispatchExtension(scopeOf(), manifest('mutation'), { workspaceID: 'w', requestID: 'r', values: { value: 1 } });
    await Promise.resolve(); h.key = 'runtime-b'; h.retire?.(); h.key = 'runtime-a'; h.retire?.();
    waiting.release(response({ identity, result: { rows: [] }, receipt: { requestID: 'r', state: 'complete' } }));
    await code(request, AGENT_ERROR.UNKNOWN_OUTCOME); expect(h.calls).toHaveLength(1); h.client.dispose();
    const foreign = new Harness();
    foreign.answer = async () => response({ identity: { ...identity, principalID: `principal-${'b'.repeat(64)}` }, actions: [] });
    await code(foreign.client.extensions(scopeOf()), AGENT_ERROR.CHANGED);
    await code(foreign.client.extensions(scopeOf()), AGENT_ERROR.CHANGED);
    expect(foreign.calls).toHaveLength(1); foreign.client.dispose();
    const write = new Harness();
    write.answer = async () => response({ identity: { ...identity, principalID: `principal-${'b'.repeat(64)}` },
      result: { rows: [] }, receipt: { requestID: 'r', state: 'complete' } });
    await code(write.client.dispatchExtension(scopeOf(), manifest('mutation'),
      { workspaceID: 'w', requestID: 'r', values: { value: 1 } }), AGENT_ERROR.UNKNOWN_OUTCOME);
    await code(write.client.extensions(scopeOf()), AGENT_ERROR.CHANGED);
    expect(write.calls).toHaveLength(1); write.client.dispose();
  });

  test('refuses invalid finite results for reads and preserves mutation uncertainty', async () => {
    const invalid: JsonValue[] = [{ rows: [{ value: 11 }] }, { rows: [{ value: 1, extra: true }] },
      { rows: [{ value: 1 }, { value: 2 }, { value: 3 }] }, { text: 'wrong-output-kind' }];
    for (const effect of [AGENT_EXTENSION.EFFECT.READ, AGENT_EXTENSION.EFFECT.MUTATION]) {
      for (const result of invalid) {
        const h = new Harness();
        h.answer = async () => response(effect === AGENT_EXTENSION.EFFECT.MUTATION
          ? { identity, result, receipt: { requestID: 'r', state: 'complete' } } : { identity, result });
        const input = effect === AGENT_EXTENSION.EFFECT.MUTATION
          ? { workspaceID: 'w', requestID: 'r', values: { value: 1 } } : { workspaceID: 'w', values: { value: 1 } };
        await code(h.client.dispatchExtension(scopeOf(), manifest(effect), input),
          effect === AGENT_EXTENSION.EFFECT.MUTATION ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.INVALID_RESPONSE);
        expect(h.calls).toHaveLength(1);
        h.client.dispose();
      }
    }
  });

  test('host denial remains explicit without a retry and a pre-aborted mutation is not sent', async () => {
    for (const error of [AGENT_ERROR.UNACCEPTED, AGENT_ERROR.UNSUPPORTED, AGENT_ERROR.UNAUTHORIZED]) {
      const h = new Harness(); h.answer = async () => response({ error }, 403);
      await code(h.client.dispatchExtension(scopeOf(), manifest('mutation'),
        { workspaceID: 'w', requestID: 'r', values: { value: 1 } }), error);
      expect(h.calls).toHaveLength(1); h.client.dispose();
    }
    const h = new Harness(); const controller = new AbortController(); controller.abort();
    await code(h.client.dispatchExtension(scopeOf(), manifest('mutation'),
      { workspaceID: 'w', requestID: 'r', values: { value: 1 } }, controller.signal), AGENT_ERROR.CANCELLED);
    expect(h.calls).toHaveLength(0); h.client.dispose();
  });

  test('global text and field results keep explicit absence and bounded list values', async () => {
    const h = new Harness();
    const text = { ...manifest(), context: { workspace: false, session: false }, input: [],
      output: { kind: AGENT_EXTENSION.KIND.TEXT, maxLength: 8 } } satisfies ExtensionManifest;
    h.answer = async () => response({ identity, result: { text: '<b>ok' } });
    expect((await h.client.dispatchExtension(scopeOf(), text, { values: {} })).result).toEqual({ text: '<b>ok' });
    const fields = { ...text, output: { kind: AGENT_EXTENSION.KIND.FIELDS, fields: [
      { key: 'flags', label: fieldLabel, required: false, value: { kind: AGENT_EXTENSION.KIND.LIST,
        item: { kind: AGENT_EXTENSION.KIND.BOOLEAN }, maxItems: 2 } },
    ] } } satisfies ExtensionManifest;
    h.answer = async () => response({ identity, result: { fields: {} } });
    expect((await h.client.dispatchExtension(scopeOf(), fields, { values: {} })).result).toEqual({ fields: {} });
    h.answer = async () => response({ identity, result: { fields: { flags: [false, true] } } });
    expect((await h.client.dispatchExtension(scopeOf(), fields, { values: {} })).result).toEqual({ fields: { flags: [false, true] } });
    h.client.dispose();
  });
});
