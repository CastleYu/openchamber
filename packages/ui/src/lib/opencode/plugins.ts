import type { PluginInfo } from '@opencode/client';

import { opencodeClient } from './client';
import { OpenCodeRuntimeChangedError, OpenCodeRuntimeError } from './runtime';
import { createV2RuntimeClient } from './v2/client';

export type PluginRuntimeSource =
  | { kind: 'package'; target: string; version: string | null; outdated: boolean; updating: boolean }
  | { kind: 'local'; path: string }
  | { kind: 'builtin' };

export type PluginRuntimeState = { kind: 'active' } | { kind: 'failed'; error: string; ref: string | null };

export interface PluginRuntimeInfo {
  source: PluginRuntimeSource;
  state: PluginRuntimeState;
}

const toSource = (source: PluginInfo['source']): PluginRuntimeSource => {
  switch (source.type) {
    case 'package':
      return {
        kind: 'package', target: source.target, version: source.version ?? null,
        outdated: source.outdated === true, updating: source.updating === true,
      };
    case 'local': return { kind: 'local', path: source.path };
    case 'builtin':
    case 'sdk': return { kind: 'builtin' };
  }
};

const toInfo = (info: PluginInfo): PluginRuntimeInfo => ({
  source: toSource(info.source),
  state: info.state.status === 'active'
    ? { kind: 'active' }
    : { kind: 'failed', error: info.state.error, ref: info.state.ref ?? null },
});

const clientFor = (directory: string | null) => {
  const runtime = opencodeClient.getBoundRuntime();
  if (runtime?.generation !== 'oc2') throw new OpenCodeRuntimeError(runtime?.generation ?? 'unknown', 'plugin runtime');
  const client = createV2RuntimeClient({
    baseUrl: opencodeClient.getBaseUrl(), directory: directory ?? undefined,
    assertProtocol: () => {
      if (opencodeClient.getBoundRuntime() !== runtime) throw new OpenCodeRuntimeChangedError();
    },
  });
  return { runtime, client };
};

/** A complete inventory for this directory's OpenCode location. Failure throws. */
export async function listPluginRuntime(directory: string | null): Promise<PluginRuntimeInfo[]> {
  const { runtime, client } = clientFor(directory);
  const response = await client.plugin.list();
  if (opencodeClient.getBoundRuntime() !== runtime) throw new OpenCodeRuntimeChangedError();
  return response.data.map(toInfo);
}

/** OpenCode checks mutable package targets and returns the whole inventory. */
export async function checkPluginUpdates(directory: string | null): Promise<PluginRuntimeInfo[]> {
  const { runtime, client } = clientFor(directory);
  const response = await client.plugin.check();
  if (opencodeClient.getBoundRuntime() !== runtime) throw new OpenCodeRuntimeChangedError();
  return response.data.map(toInfo);
}

/** Reinstall and reload exactly one package target without rewriting config. */
export async function updatePluginPackage(directory: string | null, target: string): Promise<void> {
  const { runtime, client } = clientFor(directory);
  await client.plugin.update({ targets: [target] });
  if (opencodeClient.getBoundRuntime() !== runtime) throw new OpenCodeRuntimeChangedError();
}
