import { describe, expect, it } from 'vitest';
import { LEGACY_CONFIG_KIND, mergeLegacyConfig, parseLegacyConfig } from './legacy-config.js';

const { AGENT, COMMAND, MCP } = LEGACY_CONFIG_KIND;

describe('legacy OpenCode configuration schemas', () => {
  it('preserves agent extensions and exact permission rules', () => {
    const config = { mode: 'subagent', permission: { __originalKeys: ['read'], custom: { '*.md': 'ask' }, edit: 'allow' }, extension: { enabled: true } };
    expect(parseLegacyConfig(AGENT, config)).toEqual(config);
    expect(parseLegacyConfig(AGENT, { permission: { read: { '*.md': 'deny' }, todowrite: 'ask' } }).permission)
      .toEqual({ read: { '*.md': 'deny' }, todowrite: 'ask' });
  });

  it('preserves command extensions while requiring the template string', () => {
    const config = { template: 'run', subtask: true, vendor: { option: 1 } };
    expect(parseLegacyConfig(COMMAND, config)).toEqual(config);
    expect(() => parseLegacyConfig(COMMAND, { template: 4 })).toThrow();
  });

  it('parses strict local, remote, and enabled-only MCP shapes', () => {
    expect(parseLegacyConfig(MCP, { type: 'local', command: ['node'], timeout: Number.MAX_SAFE_INTEGER })).toEqual({ type: 'local', command: ['node'], timeout: Number.MAX_SAFE_INTEGER });
    expect(parseLegacyConfig(MCP, { type: 'remote', url: 'not URL-validated', oauth: { clientId: 'id' } })).toEqual({ type: 'remote', url: 'not URL-validated', oauth: { clientId: 'id' } });
    expect(parseLegacyConfig(MCP, { enabled: false })).toEqual({ enabled: false });
    for (const invalid of [null, undefined, 'text', 1, [], Object.assign([], { enabled: false })]) {
      expect(() => parseLegacyConfig(MCP, invalid)).toThrowError(expect.objectContaining({ statusCode: 400 }));
    }
    for (const timeout of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseLegacyConfig(MCP, { type: 'local', command: [], timeout })).toThrow();
    }
    expect(() => parseLegacyConfig(MCP, { type: 'remote', url: 'x', environment: {} })).toThrow();
    expect(() => parseLegacyConfig(MCP, { type: 'remote', url: 'x', oauth: { redirectUri: 'x' } })).toThrow();
    expect(() => parseLegacyConfig(MCP, { type: 'local', command: [], unexpected: true })).toThrow();
  });

  it('merges partial updates and applies optional deletion rules', () => {
    expect(mergeLegacyConfig(AGENT, { description: 'old', extension: true }, { description: null, temperature: 0.5 }))
      .toEqual({ extension: true, temperature: 0.5 });
    expect(mergeLegacyConfig(COMMAND, { template: 'old', description: 'old', extra: 1 }, { template: null, description: undefined }))
      .toEqual({ template: '', description: 'old', extra: 1 });
    expect(mergeLegacyConfig(MCP, { name: 'm', scope: 'user', type: 'remote', url: 'x', oauth: false, enabled: true }, { name: 'm', scope: 'project', oauth: null }))
      .toEqual({ type: 'remote', url: 'x', enabled: true });
    expect(() => mergeLegacyConfig(MCP, { type: 'remote', url: 'x' }, { url: null })).toThrow();
    expect(() => mergeLegacyConfig(MCP, { type: 'local', command: ['node'] }, { command: null })).toThrow();
    expect(() => mergeLegacyConfig(COMMAND, { template: 'x' }, { template: 12 })).toThrow();
  });

  it('rejects inherited schema names with a safe client error', () => {
    for (const kind of ['toString', '__proto__', 'constructor', 'missing']) {
      expect(() => parseLegacyConfig(kind, {})).toThrowError(expect.objectContaining({ statusCode: 400 }));
    }
  });

  it('reports safe client errors without echoing invalid input', () => {
    try {
      parseLegacyConfig(MCP, { type: 'remote', url: 'private-value', oauth: { clientSecret: 23 } });
      throw new Error('expected parser rejection');
    } catch (error) {
      expect(error.statusCode).toBe(400);
      expect(error.message).not.toContain('private-value');
      expect(error.message).not.toContain('23');
    }
  });
});
