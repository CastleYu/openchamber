import { describe, expect, test } from 'bun:test';

import { describeMcpFailure } from './mcpFailureHints';

describe('describeMcpFailure', () => {
  test('returns null for empty or whitespace-only errors', () => {
    expect(describeMcpFailure('')).toBeNull();
    expect(describeMcpFailure('   ')).toBeNull();
    expect(describeMcpFailure(null)).toBeNull();
    expect(describeMcpFailure(undefined)).toBeNull();
  });

  test('classifies Windows cmd-shim failures before generic command-not-found', () => {
    const hint = describeMcpFailure("spawn npx ENOENT: 'npx.cmd' is not recognized as an internal or external command");
    expect(hint?.causeKey).toBe('settings.mcp.page.failure.windowsCmdShim.cause');
    expect(hint?.hintKey).toBe('settings.mcp.page.failureHint.windowsCmdShim');
  });

  test('classifies missing commands', () => {
    const hint = describeMcpFailure('spawn bun ENOENT');
    expect(hint?.causeKey).toBe('settings.mcp.page.failure.commandNotFound.cause');
    expect(hint?.hintKey).toBe('settings.mcp.page.failureHint.commandNotFound');
  });

  test('classifies refused connections and DNS failures', () => {
    expect(describeMcpFailure('connect ECONNREFUSED 127.0.0.1:3333')?.causeKey).toBe('settings.mcp.page.failure.connectionRefused.cause');
    expect(describeMcpFailure("getaddrinfo ENOTFOUND mcp.example.com")?.causeKey).toBe('settings.mcp.page.failure.connectionRefused.cause');
  });

  test('classifies a local server process that died', () => {
    const hint = describeMcpFailure('Connection closed');
    expect(hint?.causeKey).toBe('settings.mcp.page.failure.processClosed.cause');
    expect(describeMcpFailure('MCP server process exited with code 1')?.causeKey).toBe('settings.mcp.page.failure.processClosed.cause');
  });

  test('classifies timeouts', () => {
    expect(describeMcpFailure('Request timed out after 5000ms')?.causeKey).toBe('settings.mcp.page.failure.timeout.cause');
    expect(describeMcpFailure('ETIMEDOUT')?.causeKey).toBe('settings.mcp.page.failure.timeout.cause');
  });

  test('classifies rejected authentication before generic not-found', () => {
    expect(describeMcpFailure('HTTP 401 Unauthorized')?.causeKey).toBe('settings.mcp.page.failure.authRejected.cause');
    expect(describeMcpFailure('Invalid API key provided')?.causeKey).toBe('settings.mcp.page.failure.authRejected.cause');
  });

  test('classifies oauth client registration failures', () => {
    expect(describeMcpFailure('OAuth error: invalid_client')?.causeKey).toBe('settings.mcp.page.failure.oauthRegistration.cause');
  });

  test('classifies certificate problems', () => {
    expect(describeMcpFailure('self-signed certificate in certificate chain')?.causeKey).toBe('settings.mcp.page.failure.certificate.cause');
  });

  test('classifies wrong remote addresses', () => {
    expect(describeMcpFailure('HTTP 404')?.causeKey).toBe('settings.mcp.page.failure.wrongAddress.cause');
  });

  test('returns null for unrecognized error text', () => {
    expect(describeMcpFailure('Something completely unexpected happened')).toBeNull();
  });
});
