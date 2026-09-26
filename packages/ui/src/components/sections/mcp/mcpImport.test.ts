import { describe, expect, test } from 'bun:test';

import { applyImportedMcpToDraft, parseImportedMcpSnippet } from './mcpImport';

describe('parseImportedMcpSnippet', () => {
  test('imports OpenCode mcp wrapper config', () => {
    const result = parseImportedMcpSnippet(JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        stitch: {
          type: 'remote',
          url: 'https://stitch.googleapis.com/mcp',
          enabled: true,
          headers: {
            'X-Goog-Api-Key': 'test-key',
          },
        },
      },
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.name).toBe('stitch');
    expect(result.type).toBe('remote');
    expect(result.url).toBe('https://stitch.googleapis.com/mcp');
    expect(result.enabled).toBe(true);
    expect(result.headers).toEqual([{ key: 'X-Goog-Api-Key', value: 'test-key' }]);
  });

  test('keeps existing mcpServers wrapper support', () => {
    const result = parseImportedMcpSnippet(JSON.stringify({
      mcpServers: {
        localTool: {
          command: 'node server.js',
          args: ['--stdio'],
        },
      },
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.name).toBe('localTool');
    expect(result.type).toBe('local');
    expect(result.command).toEqual(['node', 'server.js', '--stdio']);
  });

  test('rejects multiple OpenCode mcp wrapper entries', () => {
    const result = parseImportedMcpSnippet(JSON.stringify({
      mcp: {
        one: { type: 'remote', url: 'https://one.example/mcp' },
        two: { type: 'remote', url: 'https://two.example/mcp' },
      },
    }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected import to fail');
    expect(result.error).toContain('Paste one server at a time');
    expect(result.error).toContain('servers in mcp');
  });

  test('imports OC2 mcp.servers with split timeouts, code mode and protocol', () => {
    const result = parseImportedMcpSnippet(JSON.stringify({ mcp: { servers: { remote: {
      type: 'remote', url: 'https://example.test/mcp', disabled: true,
      timeout: { catalog: 2000, execution: 9000 }, codemode: false, protocol: '2026-07-28',
      oauth: { client_id: 'client', callback_port: 3456, auth_server_metadata_url: 'https://example.test/oauth' },
    } } } }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.timeoutCatalog).toBe('2000');
    expect(result.timeoutExecution).toBe('9000');
    expect(result.codemode).toBe('off');
    expect(result.protocol).toBe('2026-07-28');
    expect(result.enabled).toBe(false);
    const draft = applyImportedMcpToDraft(result, { name: '' }, { isNewServer: true });
    expect(draft.oauthRaw).toEqual({ client_id: 'client', callback_port: 3456, auth_server_metadata_url: 'https://example.test/oauth' });
  });
});
