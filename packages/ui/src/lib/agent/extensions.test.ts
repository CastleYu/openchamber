import { describe, expect, test } from 'bun:test';
import { AGENT_ATTEMPT, AGENT_ERROR, AGENT_EXTENSION, AGENT_FEATURE, AGENT_OPERATION, AGENT_ROUTE } from '../../../../web/server/lib/agent/constants.js';
import type { JsonValue } from '../../../../web/server/lib/agent/dispatcher.js';
import type { ExtensionManifest } from '../../../../web/server/lib/agent/extensions.js';
import type { RuntimeFetchOptions } from '../runtime-fetch';
import { AgentClient, AgentClientError, type AgentClientPorts } from './client';
import { AgentExtensions } from './extensions';
import { AgentExtensionJournal } from './extension-journal';
import { z } from 'zod';
import { agentExtensionInputSchema } from '../../../../web/server/lib/agent/schemas.js';
const extensionRequestSchema = z.object({ actionID: z.string(), input: agentExtensionInputSchema });

const IDENTITY = Object.freeze({ family: 'cagent' as const, connectionID: 'conn-a', epoch: 3,
  adapterRevision: 'adapter-1', capabilityRevision: 'caps-1', principalID: `principal-${'a'.repeat(64)}` });
const LABEL = { key: 'cagent.extension.run', en: 'Run', zhCN: '运行' };
const FIELD = { key: 'cagent.extension.value', en: 'Value', zhCN: '值' };
const MANIFEST = (effect: 'read' | 'mutation' = 'read', actionID = 'cagent.extension.run',
  context: ExtensionManifest['context'] = { workspace: true, session: true }) => ({
  version: AGENT_EXTENSION.VERSION, actionID, revision: 'rev-1', label: LABEL,
  context, effect, authorization: 'current-principal',
  cancellation: 'none', outcome: 'accepted-only',
  input: [{ key: 'value', label: FIELD, required: true, value: { kind: AGENT_EXTENSION.KIND.NUMBER, min: 0, max: 10 } }],
  output: { kind: AGENT_EXTENSION.KIND.TABLE, columns: [{ key: 'value', label: FIELD, required: true,
    value: { kind: AGENT_EXTENSION.KIND.NUMBER, min: 0, max: 10 } }], maxRows: 2 },
  evidence: [{ document: 'extensions', section: 'verified' }],
} satisfies ExtensionManifest);
const ROW = (effect: 'read' | 'mutation' = 'read', actionID = 'cagent.extension.run') => ({ manifest: MANIFEST(effect, actionID), availability: { available: true } });
const RUNTIME = { identity: IDENTITY, operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((key) => [key, { available: true }])) };
const FEATURES = { identity: IDENTITY, features: Object.fromEntries(Object.values(AGENT_FEATURE).map((key) => [key, { available: true }])) };
const BODY = (value: JsonValue, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const gate = <T,>() => { let release: (value: T) => void = () => {}; const promise = new Promise<T>((resolve) => { release = resolve; }); return { promise, release }; };

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> {
  private readonly values = new Map<string, string>();
  failSet = false;
  failRemove = false;
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.failSet) throw Error('storage unavailable'); this.values.set(key, value); }
  removeItem(key: string): void { if (this.failRemove) throw Error('storage unavailable'); this.values.delete(key); }
}

class Harness {
  key = 'runtime-a';
  retire: (() => void) | undefined;
  calls: Array<{ path: string | URL | Request; init: RuntimeFetchOptions | undefined }> = [];
  actions = [ROW()];
  attempt: JsonValue = null;
  answer: (path: string | URL | Request, init?: RuntimeFetchOptions) => Promise<Response> = async (path) => {
    const route = String(path);
    if (route === AGENT_ROUTE.RUNTIME) return BODY(RUNTIME);
    if (route === AGENT_ROUTE.FEATURES) return BODY(FEATURES);
    if (route === AGENT_ROUTE.EXTENSIONS) return BODY({ identity: IDENTITY, actions: this.actions });
    if (route === AGENT_ROUTE.ATTEMPT) return BODY({ identity: IDENTITY, attempt: this.attempt });
    const request = extensionRequestSchema.parse(JSON.parse(String(this.calls.at(-1)?.init?.body)));
    if (request.input.requestID) return BODY({ identity: IDENTITY, result: { rows: [{ value: 4 }] },
      receipt: { requestID: request.input.requestID, state: AGENT_ATTEMPT.ACCEPTED } });
    return BODY({ identity: IDENTITY, result: { rows: [{ value: 4 }] } });
  };
  client = new AgentClient({ getRuntimeKey: () => this.key, subscribe: (listener) => { this.retire = listener; return () => {}; },
    fetch: async (path, init) => { this.calls.push({ path, init }); return this.answer(path, init); } } satisfies AgentClientPorts);
  storage = new MemoryStorage();
  journal = new AgentExtensionJournal(this.storage, 'runtime-a');
  async controller(context = { workspaceID: 'w', sessionID: 's' }) {
    const snapshot = await this.client.inspect();
    const controller = new AgentExtensions(this.client, snapshot, this.journal);
    await controller.open(context);
    return controller;
  }
  dispose(): void { this.client.dispose(); }
}

const code = async (work: Promise<unknown>, expected: string) => {
  try { await work; throw Error('expected AgentClientError'); }
  catch (error) { if (!(error instanceof AgentClientError)) throw error; expect(error.code).toBe(expected); }
};

describe('AgentExtensions', () => {
  test('persists mutation intent before dispatch and clears it after confirmed response', async () => {
    const h = new Harness(); h.actions = [ROW('mutation')];
    h.answer = async (path, init) => {
      if (String(path) === AGENT_ROUTE.RUNTIME) return BODY(RUNTIME);
      if (String(path) === AGENT_ROUTE.FEATURES) return BODY(FEATURES);
      if (String(path) === AGENT_ROUTE.EXTENSIONS) return BODY({ identity: IDENTITY, actions: h.actions });
      if (String(path) === AGENT_ROUTE.EXTENSION_DISPATCH) {
        expect(h.storage.length).toBe(1);
        const input = extensionRequestSchema.parse(JSON.parse(String(init?.body)));
        if (!input.input.requestID) throw Error('request ID required');
        return BODY({ identity: IDENTITY, result: { rows: [] }, receipt: { requestID: input.input.requestID, state: AGENT_ATTEMPT.ACCEPTED } });
      }
      return BODY({ identity: IDENTITY, attempt: null });
    };
    const controller = await h.controller(); await controller.run(MANIFEST('mutation').actionID, { value: 1 }, 'write-1');
    expect(h.storage.length).toBe(0); expect(controller.getSnapshot()).toMatchObject({ state: 'ready', task: { state: 'idle' } });
    controller.dispose(); h.dispose();
  });

  test('restores unknown writes, blocks mutations, and still allows reads', async () => {
    const h = new Harness(); h.actions = [ROW('mutation'), ROW('read', 'cagent.extension.read')];
    h.journal.mark({ family: 'cagent', connectionID: IDENTITY.connectionID, principalID: IDENTITY.principalID, workspaceID: 'w', sessionID: 's' },
      { actionID: MANIFEST('mutation').actionID, requestID: 'lost' });
    const controller = await h.controller();
    await code(controller.run(MANIFEST('mutation').actionID, { value: 1 }, 'new'), AGENT_ERROR.UNKNOWN_OUTCOME);
    await controller.run('cagent.extension.read', { value: 1 });
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready', pending: [{ requestID: 'lost' }], result: { actionID: 'cagent.extension.read' } });
    controller.dispose(); h.dispose();
  });

  test('resolve verifies the original action and never dispatches it again', async () => {
    const h = new Harness(); h.actions = [ROW('mutation')];
    h.journal.mark({ family: 'cagent', connectionID: IDENTITY.connectionID, principalID: IDENTITY.principalID, workspaceID: 'w', sessionID: 's' },
      { actionID: MANIFEST('mutation').actionID, requestID: 'lost' });
    h.attempt = { version: AGENT_ATTEMPT.VERSION, identity: IDENTITY, requestID: 'lost',
      operation: 'cagent.extension.other', state: AGENT_ATTEMPT.ACCEPTED };
    const controller = await h.controller();
    await code(controller.resolve('lost'), AGENT_ERROR.INVALID_RESPONSE);
    expect(h.calls.filter((call) => String(call.path) === AGENT_ROUTE.EXTENSION_DISPATCH)).toHaveLength(0);
    expect(h.storage.length).toBe(1); controller.dispose(); h.dispose();
  });

  test('projects workspace and session recovery while isolating principals', async () => {
    const h = new Harness();
    h.journal.mark({ family: 'cagent', connectionID: IDENTITY.connectionID, principalID: IDENTITY.principalID, workspaceID: 'w' },
      { actionID: MANIFEST('mutation').actionID, requestID: 'workspace' });
    h.journal.mark({ family: 'cagent', connectionID: IDENTITY.connectionID, principalID: `principal-${'b'.repeat(64)}`, workspaceID: 'w', sessionID: 's' },
      { actionID: MANIFEST('mutation').actionID, requestID: 'foreign' });
    const controller = await h.controller();
    expect(controller.getSnapshot()).toMatchObject({ pending: [{ requestID: 'workspace' }] });
    controller.dispose(); h.dispose();
  });

  test('failed refresh keeps prior result and blocks dispatch until catalog recovers', async () => {
    const h = new Harness(); const controller = await h.controller();
    await controller.run(MANIFEST().actionID, { value: 1 });
    const prior = controller.getSnapshot();
    h.answer = async (path) => String(path) === AGENT_ROUTE.EXTENSIONS ? BODY({ error: AGENT_ERROR.BACKEND_FAILED }, 503)
      : String(path) === AGENT_ROUTE.ATTEMPT ? BODY({ identity: IDENTITY, attempt: null })
        : BODY(String(path) === AGENT_ROUTE.RUNTIME ? RUNTIME : FEATURES);
    await code(controller.refresh(), AGENT_ERROR.BACKEND_FAILED);
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready', result: prior.state === 'ready' ? prior.result : null, catalogError: AGENT_ERROR.BACKEND_FAILED });
    await code(controller.run(MANIFEST().actionID, { value: 1 }), AGENT_ERROR.BACKEND_FAILED);
    expect(h.calls.filter((call) => String(call.path) === AGENT_ROUTE.EXTENSION_DISPATCH)).toHaveLength(1);
    controller.dispose(); h.dispose();
  });

  test('suppresses stale open and retirement completions', async () => {
    const h = new Harness(); const waiting = gate<Response>();
    let catalogs = 0;
    h.answer = async (path) => String(path) === AGENT_ROUTE.EXTENSIONS
      ? (++catalogs === 1 ? waiting.promise : BODY({ identity: IDENTITY, actions: [ROW()] }))
      : BODY(String(path) === AGENT_ROUTE.RUNTIME ? RUNTIME : FEATURES);
    const snapshot = await h.client.inspect(); const controller = new AgentExtensions(h.client, snapshot, h.journal);
    const opening = controller.open({ workspaceID: 'old', sessionID: 'old-session' });
    await controller.open({ workspaceID: 'new', sessionID: 'new-session' });
    waiting.release(BODY({ identity: IDENTITY, actions: [ROW()] }));
    await code(opening, AGENT_ERROR.CHANGED);
    expect(controller.getSnapshot()).toMatchObject({ state: 'ready', context: { workspaceID: 'new' } });
    const retired = gate<Response>();
    h.answer = async (path) => String(path) === AGENT_ROUTE.EXTENSIONS ? retired.promise
      : BODY(String(path) === AGENT_ROUTE.RUNTIME ? RUNTIME : FEATURES);
    const reopening = controller.open(); h.retire?.();
    retired.release(BODY({ identity: IDENTITY, actions: [ROW()] }));
    await code(reopening, AGENT_ERROR.CHANGED);
    expect(controller.getSnapshot()).toEqual({ state: 'retired' });
    controller.dispose(); h.dispose();
  });

  test('storage failure prevents mutation dispatch', async () => {
    const h = new Harness(); h.actions = [ROW('mutation')]; h.storage.failSet = true;
    const controller = await h.controller();
    await code(controller.run(MANIFEST('mutation').actionID, { value: 1 }, 'blocked'), AGENT_ERROR.ATTEMPT_STORAGE);
    expect(h.calls.filter((call) => String(call.path) === AGENT_ROUTE.EXTENSION_DISPATCH)).toHaveLength(0);
    controller.dispose(); h.dispose();
  });

  test('lost mutation persists across owners and resolves only authoritative evidence without replay', async () => {
    const h = new Harness(); h.actions = [ROW('mutation')];
    const initial = h.answer;
    h.answer = async (path, init) => {
      if (String(path) === AGENT_ROUTE.EXTENSION_DISPATCH) throw Error('lost response');
      return initial(path, init);
    };
    const first = await h.controller();
    await code(first.run(MANIFEST('mutation').actionID, { value: 1 }, 'lost'), AGENT_ERROR.UNKNOWN_OUTCOME);
    first.dispose();
    const restored = await h.controller();
    await code(restored.resolve('lost'), AGENT_ERROR.UNKNOWN_OUTCOME);
    expect(h.storage.length).toBe(1);
    h.attempt = { version: AGENT_ATTEMPT.VERSION, identity: IDENTITY, requestID: 'lost',
      operation: MANIFEST('mutation').actionID, state: AGENT_ATTEMPT.UNKNOWN };
    await code(restored.resolve('lost'), AGENT_ERROR.UNKNOWN_OUTCOME);
    for (const state of [AGENT_ATTEMPT.ACCEPTED, AGENT_ATTEMPT.COMPLETE, AGENT_ATTEMPT.NOT_SENT]) {
      if (h.storage.length === 0) h.journal.mark({ family: 'cagent', connectionID: IDENTITY.connectionID,
        principalID: IDENTITY.principalID, workspaceID: 'w', sessionID: 's' },
      { actionID: MANIFEST('mutation').actionID, requestID: 'lost' });
      h.attempt = { version: AGENT_ATTEMPT.VERSION, identity: IDENTITY, requestID: 'lost',
        operation: MANIFEST('mutation').actionID, state };
      await restored.resolve('lost');
      expect(h.storage.length).toBe(0);
    }
    expect(h.calls.filter((call) => String(call.path) === AGENT_ROUTE.EXTENSION_DISPATCH)).toHaveLength(1);
    restored.dispose(); h.dispose();
  });

  test('dispatch projects only manifest context and rejects missing required context before transport', async () => {
    const h = new Harness();
    h.actions = [{ ...ROW(), manifest: { ...MANIFEST(), context: { workspace: false, session: false } } }];
    const controller = await h.controller();
    await controller.run(MANIFEST().actionID, { value: 1 });
    const call = h.calls.find((item) => String(item.path) === AGENT_ROUTE.EXTENSION_DISPATCH);
    expect(extensionRequestSchema.parse(JSON.parse(String(call?.init?.body))).input).toEqual({ values: { value: 1 } });
    h.actions = [ROW()];
    await controller.open();
    await code(controller.run(MANIFEST().actionID, { value: 1 }), AGENT_ERROR.INVALID_INPUT);
    expect(h.calls.filter((item) => String(item.path) === AGENT_ROUTE.EXTENSION_DISPATCH)).toHaveLength(1);
    controller.dispose(); h.dispose();
  });

  test('confirmed mutation with failed local cleanup retains its record until explicit recovery', async () => {
    const h = new Harness(); h.actions = [ROW('mutation')]; h.storage.failRemove = true;
    const controller = await h.controller();
    await code(controller.run(MANIFEST('mutation').actionID, { value: 1 }, 'cleanup'), AGENT_ERROR.UNKNOWN_OUTCOME);
    expect(h.storage.length).toBe(1);
    h.attempt = { version: AGENT_ATTEMPT.VERSION, identity: IDENTITY, requestID: 'cleanup',
      operation: MANIFEST('mutation').actionID, state: AGENT_ATTEMPT.ACCEPTED };
    await code(controller.resolve('cleanup'), AGENT_ERROR.ATTEMPT_STORAGE);
    expect(h.storage.length).toBe(1);
    h.storage.failRemove = false;
    await controller.resolve('cleanup');
    expect(h.storage.length).toBe(0);
    expect(h.calls.filter((item) => String(item.path) === AGENT_ROUTE.EXTENSION_DISPATCH)).toHaveLength(1);
    controller.dispose(); h.dispose();
  });
});
