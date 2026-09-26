import { spawnSync as defaultSpawnSync } from 'node:child_process';
import { isSupportedOpenCodeVersion } from './compatibility.js';

const VERSION = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?(?=\s|$)/m;
const TIMEOUT_MS = 5_000;

/** Run the exact launch command with --version before any managed config write. */
export const probeManagedOpenCodeGeneration = ({
  resolvedBinary,
  resolveManagedOpenCodeLaunchSpec,
  useWslForOpencode = false,
  spawnSync = defaultSpawnSync,
  platform = process.platform,
}) => {
  if (platform === 'win32' && useWslForOpencode) {
    throw new Error('Launching OpenCode through WSL is not supported');
  }
  const launchSpec = resolveManagedOpenCodeLaunchSpec(resolvedBinary);
  if (!launchSpec?.binary) throw new Error('OpenCode launch command is unavailable');
  const args = [...(launchSpec.args ?? []), '--version'];
  const result = spawnSync(launchSpec.binary, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Could not identify the selected OpenCode CLI before managed configuration');
  }
  const match = VERSION.exec(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  if (!match) throw new Error('The selected OpenCode CLI returned no supported version');
  const version = match[0].trim().replace(/^v/, '');
  if (!isSupportedOpenCodeVersion(version)) throw new Error(`OpenCode ${version} is not supported`);
  return { generation: Number(match[1]) === 1 ? 'oc1' : 'oc2', version, launchSpec };
};
