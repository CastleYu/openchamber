import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots = [];
let logSpy;

async function loadMcp(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-mcp-legacy-'));
  roots.push(root);
  vi.stubEnv('XDG_CONFIG_HOME', path.join(root, 'xdg'));
  if (options.customPath) {
    vi.stubEnv('OPENCODE_CONFIG', options.customPath);
  } else {
    vi.stubEnv('OPENCODE_CONFIG', '');
  }
  vi.resetModules();
  const [mcp, shared, compatibility] = await Promise.all([
    import('./mcp.js'),
    import('./shared.js'),
    import('./compatibility.js'),
  ]);
  return { mcp, shared, compatibility, root };
}

afterEach(() => {
  logSpy?.mockRestore();
  logSpy = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Legacy MCP persistence', () => {
  it('reads exact entries and reports their winning config layers', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-mcp-custom-'));
    roots.push(root);
    const customPath = path.join(root, 'custom.json');
    const { mcp, shared, compatibility } = await loadMcp({ customPath });
    const project = path.join(root, 'project');
    fs.mkdirSync(project);
    fs.mkdirSync(path.dirname(shared.CONFIG_FILE), { recursive: true });
    fs.writeFileSync(shared.CONFIG_FILE, JSON.stringify({
      mcp: { userOnly: { enabled: false } },
    }));
    fs.writeFileSync(path.join(project, 'opencode.json'), JSON.stringify({
      mcp: { projectOnly: { enabled: true } },
    }));
    fs.writeFileSync(customPath, JSON.stringify({
      mcp: { customOnly: { enabled: false } },
    }));

    const entries = mcp.listMcpConfigs(project, compatibility.OPENCODE_PROFILE.LEGACY);
    expect(entries).toEqual([
      { name: 'userOnly', enabled: false, scope: 'user' },
      { name: 'projectOnly', enabled: true, scope: 'project' },
      { name: 'customOnly', enabled: false, scope: 'user' },
    ]);
    expect(mcp.getMcpConfig('userOnly', project, compatibility.OPENCODE_PROFILE.LEGACY))
      .toEqual({ name: 'userOnly', enabled: false, scope: 'user' });
  });

  it('round-trips Legacy-only MCP fields and keeps current OC1 normalization', async () => {
    const { mcp, shared, compatibility } = await loadMcp();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const legacy = compatibility.OPENCODE_PROFILE.LEGACY;
    const remote = { type: 'remote', url: 'https://mcp.example', oauth: false, timeout: 45000, enabled: false };

    mcp.createMcpConfig('legacy-remote', remote, undefined, shared.AGENT_SCOPE.USER, legacy);
    mcp.createMcpConfig('legacy-disabled', { enabled: false }, undefined, shared.AGENT_SCOPE.USER, legacy);
    expect(mcp.getMcpConfig('legacy-remote', undefined, legacy))
      .toEqual({ name: 'legacy-remote', ...remote, scope: 'user' });
    expect(mcp.getMcpConfig('legacy-disabled', undefined, legacy))
      .toEqual({ name: 'legacy-disabled', enabled: false, scope: 'user' });

    mcp.createMcpConfig('current-disabled', { enabled: false }, undefined, shared.AGENT_SCOPE.USER);
    expect(mcp.getMcpConfig('current-disabled')).toEqual({
      name: 'current-disabled', type: 'local', enabled: false, scope: 'user',
    });
  });

  it('rejects invalid creates before project filesystem writes', async () => {
    const { mcp, shared, compatibility } = await loadMcp();
    const project = path.join(roots.at(-1), 'project');
    expect(() => mcp.createMcpConfig(
      'bad-timeout', { type: 'remote', url: 'https://mcp.example', timeout: 0 }, project, 'project', compatibility.OPENCODE_PROFILE.LEGACY,
    )).toThrow();
    expect(fs.existsSync(path.join(project, '.opencode'))).toBe(false);
    expect(fs.existsSync(shared.CONFIG_FILE)).toBe(false);
  });

  it('rejects partial updates that remove required fields without changing the file', async () => {
    const { mcp, shared, compatibility } = await loadMcp();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const legacy = compatibility.OPENCODE_PROFILE.LEGACY;
    const original = { mcp: { remote: { type: 'remote', url: 'https://mcp.example', oauth: false, timeout: 1200 } } };
    fs.mkdirSync(path.dirname(shared.CONFIG_FILE), { recursive: true });
    fs.writeFileSync(shared.CONFIG_FILE, JSON.stringify(original, null, 2));
    expect(() => mcp.updateMcpConfig('remote', { url: null }, undefined, legacy)).toThrow();
    expect(fs.readFileSync(shared.CONFIG_FILE, 'utf8')).toBe(JSON.stringify(original, null, 2));

    mcp.updateMcpConfig('remote', { enabled: false }, undefined, legacy);
    expect(JSON.parse(fs.readFileSync(shared.CONFIG_FILE, 'utf8')).mcp.remote)
      .toEqual({ ...original.mcp.remote, enabled: false });
  });

  it('retains local timeout and removes optional fields without touching siblings', async () => {
    const { mcp, shared, compatibility } = await loadMcp();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const legacy = compatibility.OPENCODE_PROFILE.LEGACY;
    mcp.createMcpConfig('local', { type: 'local', command: ['node'], timeout: 4000 }, undefined, 'user', legacy);
    mcp.createMcpConfig('sibling', { enabled: false }, undefined, 'user', legacy);
    expect(mcp.getMcpConfig('local', undefined, legacy).timeout).toBe(4000);
    mcp.updateMcpConfig('local', { timeout: null, enabled: false }, undefined, legacy);
    expect(mcp.getMcpConfig('local', undefined, legacy)).toEqual({ name: 'local', type: 'local', command: ['node'], enabled: false, scope: 'user' });
    expect(JSON.parse(fs.readFileSync(shared.CONFIG_FILE, 'utf8')).mcp.sibling).toEqual({ enabled: false });
  });

  it('updates and deletes the project source while preserving a shadowed user entry', async () => {
    const { mcp, shared, compatibility, root } = await loadMcp();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const legacy = compatibility.OPENCODE_PROFILE.LEGACY;
    const project = path.join(root, 'project');
    fs.mkdirSync(project);
    fs.mkdirSync(path.dirname(shared.CONFIG_FILE), { recursive: true });
    const user = JSON.stringify({ mcp: { probe: { type: 'local', command: ['user'] } } });
    fs.writeFileSync(shared.CONFIG_FILE, user);
    const projectFile = path.join(project, 'opencode.json');
    fs.writeFileSync(projectFile, JSON.stringify({ mcp: { probe: { type: 'local', command: ['project'] } } }));
    mcp.updateMcpConfig('probe', { timeout: 3000 }, project, legacy);
    expect(JSON.parse(fs.readFileSync(projectFile, 'utf8')).mcp.probe.timeout).toBe(3000);
    expect(fs.readFileSync(shared.CONFIG_FILE, 'utf8')).toBe(user);
    mcp.deleteMcpConfig('probe', project);
    expect(mcp.getMcpConfig('probe', project, legacy).command).toEqual(['user']);
    expect(fs.readFileSync(shared.CONFIG_FILE, 'utf8')).toBe(user);
  });
});