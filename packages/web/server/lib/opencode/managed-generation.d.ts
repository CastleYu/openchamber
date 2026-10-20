import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';

export function probeManagedOpenCodeGeneration(options: {
  resolvedBinary: string;
  resolveManagedOpenCodeLaunchSpec(binary: string): { binary: string; args?: string[] };
  useWslForOpencode?: boolean;
  spawnSync?: (binary: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => SpawnSyncReturns<string>;
  platform?: NodeJS.Platform;
}): { generation: 'oc1' | 'oc2'; version: string; launchSpec: { binary: string; args?: string[] } };
