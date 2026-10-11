import { afterEach, describe, expect, test, spyOn } from 'bun:test';
import { opencodeClient } from '@/lib/opencode/client';
import { useMcpConfigStore } from './useMcpConfigStore';

const draft = {
  name: 'mcp', scope: 'project' as const, type: 'local' as const,
  command: ['node', 'server.js'], url: 'https://unused.example',
  environment: [{ key: 'TOKEN', value: '${TOKEN}' }],
  headers: [{ key: 'Authorization', value: '${AUTH}' }],
  oauthEnabled: true, oauthClientId: 'client', oauthClientSecret: 'secret',
  oauthScope: 'read', oauthRedirectUri: 'https://unused.example/callback',
  timeout: '3000', enabled: true,
};

const bind = (profile: 'legacy-1.2.27' | 'oc1' | 'oc2', version: string) => {
  opencodeClient.bindRuntime({
    generation: profile === 'oc2' ? 'oc2' : 'oc1', profile,
    endpoint: 'http://kernel.test', epoch: Math.random(), version,
  });
};

afterEach(() => {
  useMcpConfigStore.setState({ mcpServers: [], serversByDirectory: {}, selectedMcpName: null });
});

describe('Legacy MCP persistence', () => {
  test('loads enabled-only entries beside typed servers and blocks their mutations', async () => {
    bind('legacy-1.2.27', '1.2.27');
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([
      { name: 'enabled-only', enabled: true, scope: null, readOnly: true },
      { name: 'local', type: 'local', command: ['node', 'server.js'], enabled: true },
      { name: 'disabled-only', enabled: false, scope: 'user', readOnly: false },
    ]));

    expect(await useMcpConfigStore.getState().loadMcpConfigs({ force: true })).toBe(true);
    const servers = useMcpConfigStore.getState().mcpServers;
    expect(servers.map(({ name }) => name)).toEqual(['enabled-only', 'local', 'disabled-only']);
    expect(servers[0]).toEqual({ name: 'enabled-only', enabled: true, scope: null, readOnly: true, connection: 'enabled-only', generation: 'oc1' });
    expect(servers[2]).toEqual({ name: 'disabled-only', enabled: false, scope: 'user', readOnly: false, connection: 'enabled-only', generation: 'oc1' });
    expect(await useMcpConfigStore.getState().updateMcp('enabled-only', { enabled: false })).toEqual({
      ok: false, message: 'This MCP server has no connection configuration and cannot be changed here.',
    });
    expect(await useMcpConfigStore.getState().deleteMcp('disabled-only')).toEqual({
      ok: false, message: 'This MCP server has no connection configuration and cannot be changed here.',
    });
    expect(fetch.mock.calls.length).toBe(1);
    fetch.mockRestore();
  });

  test('does not accept malformed typed entries as enabled-only configs', async () => {
    bind('legacy-1.2.27', '1.2.27');
    const error = spyOn(console, 'error').mockImplementation(() => {});
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([
      { name: 'valid-enabled-only', enabled: true, scope: 'project', readOnly: true },
      { name: 'broken-remote', type: 'remote', enabled: true },
    ]));

    expect(await useMcpConfigStore.getState().loadMcpConfigs({ force: true })).toBe(false);
    expect(useMcpConfigStore.getState().mcpServers).toEqual([]);
    expect(error.mock.calls.length).toBe(1);
    fetch.mockRestore();
    error.mockRestore();
  });

  test('serializes local and remote requests with only their accepted fields and keeps raw tokens', async () => {
    bind('legacy-1.2.27', '1.2.27');
    const bodies: string[] = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') bodies.push(String(init.body));
      return Response.json(init?.method === 'POST' ? {} : []);
    });

    await useMcpConfigStore.getState().createMcp(draft);
    await useMcpConfigStore.getState().createMcp({
      ...draft, name: 'remote', type: 'remote', command: [],
      url: 'https://remote.example/mcp',
    });

    expect(bodies[0]).toBe(JSON.stringify({
      type: 'local', command: ['node', 'server.js'], environment: { TOKEN: '${TOKEN}' },
      enabled: true, timeout: 3000,
    }));
    expect(bodies[1]).toBe(JSON.stringify({
      type: 'remote', url: 'https://remote.example/mcp', headers: { Authorization: '${AUTH}' },
      oauth: { clientId: 'client', clientSecret: 'secret', scope: 'read' }, enabled: true, timeout: 3000,
    }));
    fetch.mockRestore();
  });

  test('retains merged raw placeholders and refuses readonly edits before network mutation', async () => {
    bind('legacy-1.2.27', '1.2.27');
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([{
      name: 'inherited', type: 'local', command: ['node', '${SERVER_FILE}'],
      environment: { TOKEN: '${TOKEN}' }, enabled: true, readOnly: true,
    }]));
    await useMcpConfigStore.getState().loadMcpConfigs({ force: true });
    const loaded = useMcpConfigStore.getState().mcpServers[0];
    expect(loaded.readOnly).toBe(true);
    expect(loaded.type === 'local' && loaded.environment).toEqual({ TOKEN: '${TOKEN}' });
    expect(await useMcpConfigStore.getState().updateMcp('inherited', { enabled: false })).toEqual({
      ok: false, message: 'This MCP server is inherited and cannot be changed here.',
    });
    expect(await useMcpConfigStore.getState().deleteMcp('inherited')).toEqual({
      ok: false, message: 'This MCP server is inherited and cannot be changed here.',
    });
    expect(fetch.mock.calls.length).toBe(1);
    fetch.mockRestore();
  });

  test('keeps Legacy updates partial and omits fields from the other transport type', async () => {
    bind('legacy-1.2.27', '1.2.27');
    let patchBody: string | undefined;
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'PATCH') patchBody = String(init.body);
      if (init?.method !== 'PATCH') return Response.json([{
        name: 'remote', type: 'remote', url: 'https://old.example/mcp',
        headers: { Authorization: '${AUTH}' }, enabled: true, timeout: 3000,
      }]);
      return Response.json({});
    });
    await useMcpConfigStore.getState().loadMcpConfigs({ force: true });
    await useMcpConfigStore.getState().updateMcp('remote', { url: 'https://new.example/mcp' });
    expect(patchBody).toBe(JSON.stringify({ url: 'https://new.example/mcp' }));
    fetch.mockRestore();
  });

  test('keeps ordinary OC1 and OC2 serializer selection unchanged', async () => {
    for (const [profile, version] of [['oc1', '1.18.32'], ['oc2', '2.0.20']] as const) {
      bind(profile, version);
      let body: string | undefined;
      const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        if (init?.method === 'POST') body = String(init.body);
        return Response.json(init?.method === 'POST' ? {} : []);
      });
      await useMcpConfigStore.getState().createMcp(draft);
      expect((body ?? '').includes('"type":"local"')).toBe(true);
      if (profile === 'oc1') expect((body ?? '').includes('"url":"https://unused.example"')).toBe(true);
      fetch.mockRestore();
    }
  });
});
