import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-v2-config-'));
const previousXdg = process.env.XDG_CONFIG_HOME;
const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
const previousCustom = process.env.OPENCODE_CONFIG;
process.env.XDG_CONFIG_HOME = path.join(root, 'xdg');
delete process.env.OPENCODE_CONFIG_DIR;
delete process.env.OPENCODE_CONFIG;

const oc1 = await import('./shared.js');
const oc2 = await import('./shared-v2.js');
const mcp = await import('./mcp-v2.js');
const configDir = path.join(process.env.XDG_CONFIG_HOME, 'opencode');
const projectDir = path.join(root, 'project');

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
  if (previousCustom === undefined) delete process.env.OPENCODE_CONFIG;
  else process.env.OPENCODE_CONFIG = previousCustom;
});

describe('OC2 user JSONC override', () => {
  it('merges and edits the winning JSONC MCP entry without changing OC1 config precedence', () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    const oc1Path = path.join(configDir, 'config.json');
    const jsonPath = path.join(configDir, 'opencode.json');
    const jsoncPath = path.join(configDir, 'opencode.jsonc');
    fs.writeFileSync(oc1Path, JSON.stringify({ marker: 'oc1' }));
    fs.writeFileSync(jsonPath, JSON.stringify({ marker: 'json', mcp: { servers: { docs: { type: 'remote', url: 'https://base.example/mcp' } } } }));
    fs.writeFileSync(jsoncPath, '{ // user override\n "marker": "jsonc", "mcp": { "servers": { "docs": { "type": "remote", "url": "https://override.example/mcp" } } } }');

    expect(oc1.readConfig(projectDir).marker).toBe('oc1');
    expect(oc2.readConfig(projectDir).marker).toBe('jsonc');
    expect(oc2.readConfigLayers(projectDir).paths.userOverridePath).toBe(jsoncPath);
    expect(oc2.getJsonEntrySource(oc2.readConfigLayers(projectDir), 'mcp', 'docs').path).toBe(jsoncPath);
    expect(mcp.getMcpConfig('docs', projectDir).url).toBe('https://override.example/mcp');

    mcp.updateMcpConfig('docs', { disabled: true }, projectDir);
    expect(mcp.getMcpConfig('docs', projectDir).disabled).toBe(true);
    expect(JSON.parse(fs.readFileSync(jsonPath, 'utf8')).mcp.servers.docs.disabled).toBeUndefined();
    expect(oc1.readConfig(projectDir).marker).toBe('oc1');
  });

  it('reports a malformed override and refuses to edit an entry as though it were absent', () => {
    const jsoncPath = path.join(configDir, 'opencode.jsonc');
    fs.writeFileSync(jsoncPath, '{ "mcp": { "servers": { "docs":');
    const layers = oc2.readConfigLayers(projectDir);
    expect(layers.layerErrors).toEqual(expect.arrayContaining([expect.objectContaining({ path: jsoncPath, code: 'INVALID_JSONC' })]));
    expect(() => mcp.updateMcpConfig('docs', { disabled: false }, projectDir)).toThrow(/invalid JSONC/);
    expect(fs.readFileSync(jsoncPath, 'utf8')).toBe('{ "mcp": { "servers": { "docs":');
  });
});
