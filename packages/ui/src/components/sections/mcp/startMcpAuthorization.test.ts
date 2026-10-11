import { describe, expect, test } from 'bun:test';
import { assertMcpCanAuthorize } from './startMcpAuthorization';
import type { McpServerWithScope } from '@/stores/useMcpConfigStore';

describe('MCP authorization eligibility', () => {
  test('rejects enabled-only configurations', () => {
    const server: McpServerWithScope = {
      name: 'legacy',
      enabled: true,
      scope: null,
      readOnly: true,
      connection: 'enabled-only',
      generation: 'oc1',
    };
    expect(() => assertMcpCanAuthorize(server)).toThrow('cannot be authorized');
  });
});
