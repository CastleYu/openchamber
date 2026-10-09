import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_HOST_OPERATION, AGENT_STARTUP } from './constants.js';
import { agentArtifactDigest } from './artifacts.js';
import { createAgentHost } from './host.js';
import { selectAgentStartup, startOpenCodeConsumers } from './startup.js';

const profile = Object.freeze({ adapterID: 'startup-test', family: AGENT_FAMILY.CAGENT,
  adapterRevision: 'adapter-r1', capabilityRevision: 'capability-r1' });
const connection = Object.freeze({ connectionID: 'startup-connection', serverRevision: 'server-r1',
  baseURL: 'http://127.0.0.1:4096/', headers: {}, ready: true, authorized: true });
const manifestFor = (source) => {
  const bytes = Buffer.from(source);
  const files = [{ path: 'adapter.mjs', bytes: bytes.length,
    digest: createHash('sha256').update(bytes).digest('hex') }];
  return { version: 1, files, artifactDigest: agentArtifactDigest(files) };
};
const candidate = (directory = 'missing-artifacts') => ({ directory, manifest: manifestFor('export const unused = true;'),
  profile: { ...profile }, connection: { ...connection, headers: {} } });
const consumerHost = (family = AGENT_FAMILY.OPENCODE) => {
  const controller = new AbortController();
  return { host: { getSelection: () => ({ family }), getSelectionSignal: () => controller.signal }, controller };
};

describe('selectAgentStartup', () => {
  it('reads a protected local descriptor for an explicit CAgent selection', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agent-startup-file-'));
    const file = path.join(root, 'selection.json');
    const input = { family: AGENT_FAMILY.CAGENT, candidate: candidate() };
    let forwarded;
    try {
      await writeFile(file, JSON.stringify(input));
      const host = { selectOpenCode: () => { throw new Error('unexpected'); },
        select: async (value) => { forwarded = value; return 'selected'; } };
      await expect(selectAgentStartup(host, undefined, file)).resolves.toBe('selected');
      expect(forwarded).toEqual(input.candidate);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('refuses invalid local descriptors before selection and never discloses their bytes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agent-startup-file-'));
    const file = path.join(root, 'selection.json');
    let effects = 0;
    const host = { selectOpenCode: () => { effects += 1; }, select: () => { effects += 1; } };
    const refused = (input, target = file) => expect(selectAgentStartup(host, input, target))
      .rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT,
        message: `Agent operation ${AGENT_HOST_OPERATION.GET_BINDING} refused: ${AGENT_ERROR.INVALID_INPUT}` });
    try {
      await refused(undefined);
      await refused(undefined, 'relative.json');
      await refused(undefined, root);
      for (const content of [Buffer.from([0xff]), 'private-secret-json',
        JSON.stringify({ family: AGENT_FAMILY.OPENCODE, secret: 'private-secret' }),
        ' '.repeat(AGENT_STARTUP.MAX_BYTES + 1)]) {
        await writeFile(file, content);
        await refused(undefined);
      }
      await writeFile(file, JSON.stringify({ family: AGENT_FAMILY.OPENCODE }));
      await refused({ family: AGENT_FAMILY.OPENCODE });
      const alias = path.join(root, 'linked.json');
      await link(file, alias);
      await refused(undefined, alias);
      expect(effects).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('accepts an explicit OpenCode descriptor from the same local entry', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agent-startup-file-'));
    const file = path.join(root, 'selection.json');
    let effects = 0;
    try {
      await writeFile(file, JSON.stringify({ family: AGENT_FAMILY.OPENCODE }));
      const host = { selectOpenCode: () => { effects += 1; }, select: () => { throw new Error('unexpected'); } };
      await expect(selectAgentStartup(host, undefined, file)).resolves.toBeNull();
      expect(effects).toBe(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('selects OpenCode by default', async () => {
    let selections = 0;
    const host = { selectOpenCode: () => { selections += 1; }, select: () => { throw new Error('unexpected'); } };

    await expect(selectAgentStartup(host)).resolves.toBeNull();
    expect(selections).toBe(1);
  });

  it('rejects malformed and extra startup options before host effects', async () => {
    let effects = 0;
    const host = { selectOpenCode: () => { effects += 1; }, select: () => { effects += 1; } };
    const invalid = [null, { family: AGENT_FAMILY.OPENCODE, candidate: {} },
      { family: AGENT_FAMILY.CAGENT }, { family: AGENT_FAMILY.CAGENT, candidate: candidate(), extra: true },
      { family: 'other' },
      { family: AGENT_FAMILY.CAGENT, candidate: { ...candidate(), connection: { ...connection, ready: 'yes' } } },
      { family: AGENT_FAMILY.CAGENT, candidate: { ...candidate(), profile: { ...profile, extra: true } } }];

    for (const input of invalid) {
      await expect(selectAgentStartup(host, input)).rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
    }
    expect(effects).toBe(0);
  });

  it('forwards a detached parsed CAgent candidate and returns the host identity', async () => {
    const identity = { family: AGENT_FAMILY.CAGENT, connectionID: 'startup-connection', epoch: 7,
      adapterRevision: 'adapter-r1', capabilityRevision: 'capability-r1' };
    const input = { family: AGENT_FAMILY.CAGENT, candidate: candidate() };
    let forwarded;
    const host = { selectOpenCode: () => { throw new Error('unexpected'); },
      select: async (value) => { forwarded = value; return identity; } };

    await expect(selectAgentStartup(host, input)).resolves.toBe(identity);
    expect(forwarded).toEqual(input.candidate);
    expect(forwarded).not.toBe(input.candidate);
    expect(forwarded.manifest).not.toBe(input.candidate.manifest);
  });

  it('propagates a rejected explicit CAgent selection without falling back', async () => {
    const failure = new Error('selection failed');
    let openCodeSelections = 0;
    const host = { selectOpenCode: () => { openCodeSelections += 1; }, select: () => Promise.reject(failure) };

    await expect(selectAgentStartup(host, { family: AGENT_FAMILY.CAGENT, candidate: candidate() })).rejects.toBe(failure);
    expect(openCodeSelections).toBe(0);
  });

  it('leaves CAgent selected with no consumers when real artifact loading fails', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-startup-'));
    const host = createAgentHost({ getAcceptance: () => null });
    const starts = { permissions: 0, queue: 0 };
    try {
      await expect(selectAgentStartup(host, { family: AGENT_FAMILY.CAGENT, candidate: candidate(directory) }))
        .rejects.toBeDefined();
      expect(host.getSelection().family).toBe(AGENT_FAMILY.CAGENT);
      startOpenCodeConsumers({ host,
        startPermissions: () => { starts.permissions += 1; return () => {}; },
        startQueue: () => { starts.queue += 1; return () => {}; } });
      expect(starts).toEqual({ permissions: 0, queue: 0 });
    } finally {
      host.clear();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('startOpenCodeConsumers', () => {
  it('does not start actors for CAgent', () => {
    const { host } = consumerHost(AGENT_FAMILY.CAGENT);
    let starts = 0;

    const stop = startOpenCodeConsumers({ host, startPermissions: () => { starts += 1; return () => {}; },
      startQueue: () => { starts += 1; return () => {}; } });
    stop();
    expect(starts).toBe(0);
  });

  it('stops both OpenCode consumers once when the selection signal aborts', () => {
    const { host, controller } = consumerHost();
    const stopped = { permissions: 0, queue: 0 };

    startOpenCodeConsumers({ host, startPermissions: () => () => { stopped.permissions += 1; },
      startQueue: () => () => { stopped.queue += 1; } });
    controller.abort();
    expect(stopped).toEqual({ permissions: 1, queue: 1 });
  });

  it('cleans up permissions when queue startup throws', () => {
    const { host } = consumerHost();
    const failure = new Error('queue failed');
    let stopped = 0;

    expect(() => startOpenCodeConsumers({ host, startPermissions: () => () => { stopped += 1; },
      startQueue: () => { throw failure; } })).toThrow(failure);
    expect(stopped).toBe(1);
  });

  it('does not start the queue if permissions startup retires the selection', () => {
    const { host, controller } = consumerHost();
    const stopped = { permissions: 0, queue: 0 };
    let queueStarts = 0;

    startOpenCodeConsumers({ host, startPermissions: () => {
      controller.abort();
      return () => { stopped.permissions += 1; };
    }, startQueue: () => { queueStarts += 1; return () => { stopped.queue += 1; }; } });
    expect(queueStarts).toBe(0);
    expect(stopped).toEqual({ permissions: 1, queue: 0 });
  });

  it('cleans up both consumers when queue startup retires the selection', () => {
    const { host, controller } = consumerHost();
    const stopped = { permissions: 0, queue: 0 };

    startOpenCodeConsumers({ host, startPermissions: () => () => { stopped.permissions += 1; },
      startQueue: () => {
        controller.abort();
        return () => { stopped.queue += 1; };
      } });
    expect(stopped).toEqual({ permissions: 1, queue: 1 });
  });

  it('keeps explicit cleanup idempotent', () => {
    const { host } = consumerHost();
    const stopped = { permissions: 0, queue: 0 };
    const stop = startOpenCodeConsumers({ host, startPermissions: () => () => { stopped.permissions += 1; },
      startQueue: () => () => { stopped.queue += 1; } });

    stop();
    stop();
    expect(stopped).toEqual({ permissions: 1, queue: 1 });
  });

  it('does not start consumers for an already retired OpenCode selection', () => {
    const { host, controller } = consumerHost();
    controller.abort();
    let starts = 0;

    startOpenCodeConsumers({ host, startPermissions: () => { starts += 1; return () => {}; },
      startQueue: () => { starts += 1; return () => {}; } });
    expect(starts).toBe(0);
  });
});
