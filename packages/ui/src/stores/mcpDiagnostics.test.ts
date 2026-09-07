import { describe, expect, test } from 'bun:test';

import { mergeMcpDiagnostics, type McpRuntimeDiagnostic, type McpRuntimeDiagnosticMap } from './mcpDiagnostics';

const failed = (error: string, at = 1000, source: McpRuntimeDiagnostic['source'] = 'status'): McpRuntimeDiagnostic => (
  { status: 'failed', error, at, source }
);

describe('mergeMcpDiagnostics', () => {
  test('records a failure observed by status polling', () => {
    const next = mergeMcpDiagnostics({}, { db: { status: 'failed', error: 'Connection closed' } }, 5000);
    expect(next.db).toEqual({ status: 'failed', error: 'Connection closed', at: 5000, source: 'status' });
  });

  test('keeps an existing diagnostic untouched while the message is unchanged', () => {
    const previous: McpRuntimeDiagnosticMap = { db: failed('Connection closed', 1000) };
    const next = mergeMcpDiagnostics(previous, { db: { status: 'failed', error: 'Connection closed' } }, 9000);
    expect(next.db).toEqual(failed('Connection closed', 1000));
  });

  test('replaces the diagnostic when the failure message changes', () => {
    const previous: McpRuntimeDiagnosticMap = { db: failed('Connection closed', 1000) };
    const next = mergeMcpDiagnostics(previous, { db: { status: 'failed', error: 'spawn ENOENT' } }, 9000);
    expect(next.db).toEqual({ status: 'failed', error: 'spawn ENOENT', at: 9000, source: 'status' });
  });

  test('drops diagnostics once the server recovers or leaves the snapshot', () => {
    const previous: McpRuntimeDiagnosticMap = {
      db: failed('Connection closed', 1000),
      cache: failed('timeout', 1000),
    };
    const next = mergeMcpDiagnostics(previous, { cache: { status: 'failed', error: 'timeout' } }, 9000);
    expect(next.db).toBe(undefined);
    expect(next.cache).toEqual(failed('timeout', 1000));
  });

  test('does not mutate the previous map', () => {
    const previous: McpRuntimeDiagnosticMap = { db: failed('Connection closed', 1000) };
    mergeMcpDiagnostics(previous, { cache: { status: 'failed', error: 'timeout' } }, 9000);
    expect(Object.keys(previous)).toEqual(['db']);
  });
});
