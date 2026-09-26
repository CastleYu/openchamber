import { describe, expect, test } from 'bun:test';
import { buildMcpBodyV2, isMcpConfigEnabled, parseMcpConfigs, type McpDraft } from './useMcpConfigStore';

const previous = parseMcpConfigs([{
  name: 'remote', type: 'remote', url: 'https://example.test/mcp', scope: 'project',
  disabled: false,
  timeout: { startup: 1000, catalog: 2000, execution: 9000 },
  oauth: {
    client_id: 'client', client_secret: 'secret', scope: 'read', redirect_uri: 'http://localhost/callback',
    callback_port: 3456, auth_server_metadata_url: 'https://example.test/oauth-metadata',
  },
  protocol: 'auto', codemode: true,
}], 'oc2')[0];

const draft: McpDraft = {
  name: 'remote', scope: 'project', type: 'remote', command: [], url: 'https://example.test/mcp',
  environment: [], headers: [], oauthEnabled: true,
  oauthClientId: 'client', oauthClientSecret: 'secret', oauthScope: 'read',
  oauthRedirectUri: 'http://localhost/callback', timeout: '',
  timeoutStartup: '1000', timeoutCatalog: '2000', timeoutExecution: '9000', enabled: true,
};

describe('MCP configuration generations', () => {
  test('keeps OC1 enabled and numeric timeout semantics', () => {
    const server = parseMcpConfigs([{
      name: 'legacy', type: 'remote', url: 'https://example.test/sse',
      enabled: false, timeout: 5000, oauth: { clientId: 'old-client' },
    }], 'oc1')[0];
    expect(server.generation).toBe('oc1');
    expect(isMcpConfigEnabled(server)).toBe(false);
    if (server.generation === 'oc1' && server.type === 'remote') {
      expect(server.timeout).toBe(5000);
      expect(server.oauth).toEqual({ clientId: 'old-client' });
    }
  });

  test('keeps OC2 split timeouts and snake case OAuth from the route', () => {
    expect(previous.generation).toBe('oc2');
    expect(isMcpConfigEnabled(previous)).toBe(true);
    if (previous.generation === 'oc2') {
      expect(previous.timeout).toEqual({ startup: 1000, catalog: 2000, execution: 9000 });
      expect(previous.type === 'remote' && previous.oauth).toEqual({
        client_id: 'client', client_secret: 'secret', scope: 'read', redirect_uri: 'http://localhost/callback',
        callback_port: 3456, auth_server_metadata_url: 'https://example.test/oauth-metadata',
      });
    }
  });

  test('editing an unrelated field does not rewrite OAuth and preserves distinct timeouts', () => {
    if (previous.generation !== 'oc2') throw new Error('Expected OC2 fixture');
    const body = buildMcpBodyV2({ ...draft, url: 'https://example.test/new' }, previous);
    expect(body).toMatchObject({ disabled: false, url: 'https://example.test/new', timeout: { startup: 1000, catalog: 2000, execution: 9000 } });
    expect(Object.hasOwn(body, 'oauth')).toBe(false);
    expect(Object.hasOwn(body, 'enabled')).toBe(false);
  });

  test('editing OAuth writes snake case and carries callback metadata', () => {
    if (previous.generation !== 'oc2') throw new Error('Expected OC2 fixture');
    const body = buildMcpBodyV2({ ...draft, oauthClientId: 'new-client', timeoutExecution: '12000' }, previous);
    expect(body.timeout).toEqual({ startup: 1000, catalog: 2000, execution: 12000 });
    expect(body.oauth).toEqual({
      client_id: 'new-client', client_secret: 'secret', scope: 'read', redirect_uri: 'http://localhost/callback',
      callback_port: 3456, auth_server_metadata_url: 'https://example.test/oauth-metadata',
    });
  });

  test('code mode and protocol write explicit overrides and remove defaults', () => {
    if (previous.generation !== 'oc2') throw new Error('Expected OC2 fixture');
    expect(buildMcpBodyV2({ codemode: 'off', protocol: '2026-07-28' }, previous)).toMatchObject({ codemode: false, protocol: '2026-07-28' });
    expect(buildMcpBodyV2({ codemode: 'default', protocol: 'legacy' }, previous)).toMatchObject({ codemode: null, protocol: null });
  });

  test('new OC2 server leaves automatic OAuth unconfigured unless import supplied it', () => {
    const automatic = buildMcpBodyV2({ ...draft, oauthEnabled: false, oauthClientId: '', oauthClientSecret: '', oauthScope: '', oauthRedirectUri: '' });
    expect(Object.hasOwn(automatic, 'oauth')).toBe(false);
    const imported = buildMcpBodyV2({ ...draft, oauthRaw: false });
    expect(imported.oauth).toBe(false);
  });
});
