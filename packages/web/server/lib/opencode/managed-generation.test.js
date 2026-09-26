import { describe, expect, it, vi } from 'vitest';
import { probeManagedOpenCodeGeneration } from './managed-generation.js';

const probe = (output, options = {}) => {
  const spawnSync = vi.fn(() => ({ status: 0, stdout: output, stderr: '' }));
  const resolveManagedOpenCodeLaunchSpec = vi.fn(() => options.launchSpec ?? {
    binary: 'C:/Program Files/node/node.exe', args: ['C:/bin/opencode-cli.mjs'], wrapperType: 'node-shebang',
  });
  const result = probeManagedOpenCodeGeneration({ resolvedBinary: 'C:/bin/opencode.cmd',
    resolveManagedOpenCodeLaunchSpec, spawnSync, platform: 'win32' });
  return { result, spawnSync, resolveManagedOpenCodeLaunchSpec };
};

describe('managed CLI generation probe', () => {
  it('uses the resolved launch spec, not the shim filename', () => {
    const { result, spawnSync, resolveManagedOpenCodeLaunchSpec } = probe('opencode 2.0.16\n');
    expect(result).toMatchObject({ generation: 'oc2', version: '2.0.16' });
    expect(resolveManagedOpenCodeLaunchSpec).toHaveBeenCalledWith('C:/bin/opencode.cmd');
    expect(spawnSync).toHaveBeenCalledWith('C:/Program Files/node/node.exe',
      ['C:/bin/opencode-cli.mjs', '--version'], expect.objectContaining({ timeout: 5000, windowsHide: true }));
  });

  it('accepts the selected OC1 generation without a minor-version guess', () => {
    expect(probe('1.18.32').result).toMatchObject({ generation: 'oc1', version: '1.18.32' });
  });

  it('rejects prerelease, unsupported, and ambiguous output before writes', () => {
    for (const output of ['2.0.15-beta.1', '2.0.14', '3.0.0', 'no version']) {
      expect(() => probe(output)).toThrow();
    }
  });

  it('rejects WSL before probing a wrapper', () => {
    const spawnSync = vi.fn();
    expect(() => probeManagedOpenCodeGeneration({ resolvedBinary: 'opencode',
      resolveManagedOpenCodeLaunchSpec: vi.fn(), spawnSync,
      platform: 'win32', useWslForOpencode: true })).toThrow('WSL');
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('does not expose failed command output', () => {
    expect(() => probeManagedOpenCodeGeneration({ resolvedBinary: 'opencode',
      resolveManagedOpenCodeLaunchSpec: () => ({ binary: 'opencode', args: [] }),
      spawnSync: () => ({ status: 1, stdout: '', stderr: 'secret diagnostics' }),
    })).toThrow('Could not identify the selected OpenCode CLI');
  });
});
