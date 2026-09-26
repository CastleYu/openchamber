import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root;
let previousDir;
let previousConfig;
let service;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc2-websearch-config-'));
  previousDir = process.env.OPENCODE_CONFIG_DIR;
  previousConfig = process.env.OPENCODE_CONFIG;
  process.env.OPENCODE_CONFIG_DIR = path.join(root, 'global');
  delete process.env.OPENCODE_CONFIG;
  vi.resetModules();
  service = await import('./websearch-config.js');
});

afterEach(async () => {
  if (previousDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = previousDir;
  if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG;
  else process.env.OPENCODE_CONFIG = previousConfig;
  await fs.rm(root, { recursive: true, force: true });
});

describe('OC2 web search config storage', () => {
  it('writes the user config and preserves unrelated keys through selection, off and reset', async () => {
    const first = service.setWebSearchSelection('provider-one');
    expect(first.changed).toBe(true);
    expect(first.path).toBe(path.join(root, 'global', 'opencode.json'));
    expect(JSON.parse(await fs.readFile(first.path, 'utf8'))).toEqual({ websearch: { provider: 'provider-one' } });
    expect(service.setWebSearchSelection('provider-one').changed).toBe(false);
    expect(service.setWebSearchSelection(false).changed).toBe(true);
    expect(JSON.parse(await fs.readFile(first.path, 'utf8'))).toEqual({ websearch: false });
    expect(service.setWebSearchSelection(null).changed).toBe(true);
    expect(JSON.parse(await fs.readFile(first.path, 'utf8'))).toEqual({});
  });

  it('prefers OPENCODE_CONFIG and reports a project override until custom config owns the key', async () => {
    const project = path.join(root, 'project');
    const projectConfig = path.join(project, 'opencode.json');
    const custom = path.join(root, 'managed.json');
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(projectConfig, JSON.stringify({ websearch: { provider: 'project' } }));
    process.env.OPENCODE_CONFIG = custom;
    expect(service.getWebSearchSource(project)).toEqual({ projectPath: projectConfig });
    expect(service.setWebSearchSelection('managed')).toEqual({ path: custom, changed: true });
    expect(service.getWebSearchSource(project)).toEqual({ projectPath: null });
  });

  it('fails closed on an unreadable project or target config', async () => {
    const project = path.join(root, 'project');
    const projectConfig = path.join(project, 'opencode.json');
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(projectConfig, '{"websearch":');
    expect(() => service.getWebSearchSource(project)).toThrow();

    const target = path.join(root, 'global', 'opencode.json');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '{"websearch":');
    expect(() => service.setWebSearchSelection(false)).toThrow();
    expect(await fs.readFile(target, 'utf8')).toBe('{"websearch":');
  });
});
