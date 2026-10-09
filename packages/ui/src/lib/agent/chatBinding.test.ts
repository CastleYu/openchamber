import { expect, test } from 'bun:test';
import { AGENT_ERROR, AGENT_FEATURE, AGENT_OPERATION, AGENT_ROUTE } from '../../../../web/server/lib/agent/constants.js';
import { agentDispatchRequestSchema } from '../../../../web/server/lib/agent/schemas.js';
import type { JsonValue } from '../../../../web/server/lib/agent/dispatcher.js';
import { clearRuntimeAuthCredentialProvider, setRuntimeBearerToken } from '../runtime-auth';
import { createAgentChatBinding } from './chatBinding';
import { AgentClientError } from './client';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  clear() { this.values.clear(); }
}

test('production binding recovers uncertain sends after credential rotation and isolates another host principal', async () => {
  const originalFetch = globalThis.fetch;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  let principalID = `principal-${'a'.repeat(64)}`;
  const identity = () => ({ family: 'cagent', connectionID: 'connection', epoch: 1, adapterRevision: 'r', capabilityRevision: 'c', principalID });
  const credentials: Array<string | null> = [];
  const answer = (body: JsonValue, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    credentials.push(new Headers(init?.headers).get('Authorization'));
    const route = String(input);
    if (route.endsWith(AGENT_ROUTE.RUNTIME)) return answer({ identity: identity(), operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((id) => [id, { available: true }])) });
    if (route.endsWith(AGENT_ROUTE.FEATURES)) return answer({ identity: identity(), features: Object.fromEntries(Object.values(AGENT_FEATURE).map((id) => [id, { available: true }])) });
    const request = agentDispatchRequestSchema.parse(JSON.parse(String(init?.body)));
    return request.operation === AGENT_OPERATION.GET_SESSION
      ? answer({ identity: identity(), data: { id: 's', workspaceID: 'w' } })
      : answer({ error: AGENT_ERROR.BACKEND_FAILED }, 502);
  }, { preconnect() {} });
  try {
    setRuntimeBearerToken('fixture-first');
    const first = await createAgentChatBinding();
    try {
      await first.conversation.open(first.snapshot, 'w', 's');
      await expect(first.conversation.send('request', 'private prompt')).rejects.toThrow(AgentClientError);
      expect(storage.length).toBe(1);
      expect(storage.getItem(storage.key(0) ?? '')).not.toContain('private prompt');
    } finally { first.dispose(); }
    setRuntimeBearerToken('fixture-rotated');
    const rotated = await createAgentChatBinding();
    try {
      await rotated.conversation.open(rotated.snapshot, 'w', 's');
      const state = rotated.conversation.getSnapshot();
      if (state.state !== 'bound') throw new Error('binding missing');
      expect(state.write).toMatchObject({ state: 'unknown', requestID: 'request' });
    } finally { rotated.dispose(); }
    principalID = `principal-${'b'.repeat(64)}`;
    const other = await createAgentChatBinding();
    try {
      await other.conversation.open(other.snapshot, 'w', 's');
      const state = other.conversation.getSnapshot();
      if (state.state !== 'bound') throw new Error('binding missing');
      expect(state.write.state).not.toBe('unknown');
      expect(storage.length).toBe(1);
      expect(credentials).toContain('Bearer fixture-first');
      expect(credentials).toContain('Bearer fixture-rotated');
    } finally { other.dispose(); }
  } finally {
    globalThis.fetch = originalFetch;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    clearRuntimeAuthCredentialProvider();
  }
});
