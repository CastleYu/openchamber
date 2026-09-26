import { beforeEach, describe, expect, mock, test } from 'bun:test';

const calls: Array<{ path: string; init?: RequestInit }> = [];
let response: Response;
let loads = 0;
let invalidates = 0;
let epoch = 1;

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return response;
  },
}));
mock.module('@/lib/opencode/client', () => ({
  opencodeClient: { getBoundRuntime: () => ({ generation: 'oc2', endpoint: 'http://localhost', epoch }) },
}));
mock.module('@/stores/useAgentsStore', () => ({
  invalidateAgentsLoadCache: () => { invalidates += 1; },
  useAgentsStore: { getState: () => ({ loadAgents: async () => { loads += 1; return true; } }) },
}));

const { fetchAgentV2Entity, fetchAgentV2Permissions, writeAgentV2 } = await import('./agentV2Config');

describe('OC2 agent settings route', () => {
  beforeEach(() => {
    calls.length = 0;
    loads = 0;
    invalidates = 0;
    epoch = 1;
    response = Response.json({ success: true });
  });

  test('reads source config without coercing inherited runtime values', async () => {
    response = Response.json({
      source: 'md', scope: 'project', path: '/project/.opencode/agents/plan.md', legacy: false,
      config: { model: 'openai/gpt#fast', request: { headers: { 'x-test': 'kept' }, body: { temperature: 0.3, extra: true } }, custom: 'kept' },
    });
    const result = await fetchAgentV2Entity('plan', '/project');
    expect(calls[0].path).toBe('/api/config/agents/plan/config?directory=%2Fproject');
    expect(result.config.request?.body?.extra).toBe(true);
    expect(result.config.custom).toBe('kept');
  });

  test('writes only ordered permission rules to the same directory', async () => {
    const rules = [{ action: 'shell', resource: 'git push *', effect: 'deny' as const }];
    await writeAgentV2('PATCH', 'plan', { permissions: rules }, '/project');
    expect(calls[0].path).toBe('/api/config/agents/plan?directory=%2Fproject');
    expect(calls[0].init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ permissions: rules });
    expect(invalidates).toBe(1);
    expect(loads).toBe(1);
  });

  test('does not treat a failed permissions read as an empty ruleset', async () => {
    response = Response.json({ error: 'Unavailable' }, { status: 503 });
    await expect(fetchAgentV2Permissions('plan', '/project')).rejects.toThrow('503');
  });

  test('discards a config read from a replaced runtime epoch', async () => {
    response = Response.json({ source: 'none', scope: null, path: null, legacy: false, config: {} });
    const pending = fetchAgentV2Entity('plan', '/project');
    epoch = 2;
    await expect(pending).rejects.toThrow('runtime changed');
  });
});
