import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { agentArtifactDigest } from './artifacts.js';
import { AGENT_ARTIFACT, AGENT_OPERATION, AGENT_PACKET, AGENT_PACKET_ERROR, AGENT_PACKET_STATE } from './constants.js';
import { createAgentPacketWorkspace } from './packet-workspace.js';

const roots = new Set();
const makeRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-agent-workspace-'));
  roots.add(root);
  return root;
};
const fileRecord = (name, text) => ({
  path: name,
  bytes: Buffer.byteLength(text),
  digest: createHash('sha256').update(text).digest('hex'),
});
const manifestFor = (files) => ({ version: AGENT_ARTIFACT.VERSION, artifactDigest: agentArtifactDigest(files), files });
const writeFiles = async (directory, files) => {
  for (const file of files) {
    const target = path.join(directory, ...file.path.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.text);
  }
};
const setup = async ({ source = 'export const value = 1;\n', checks, packets, progressPath } = {}) => {
  const root = await makeRoot();
  const protectedDirectory = path.join(root, 'protected');
  const candidateDirectory = path.join(root, 'candidate');
  const progressDirectory = progressPath ?? path.join(root, 'progress');
  await Promise.all([fs.mkdir(protectedDirectory), fs.mkdir(progressDirectory)]);
  await fs.writeFile(path.join(protectedDirectory, 'host.js'), 'host-owned runner');
  const sources = [{ path: 'src/agent.js', text: source }];
  await writeFiles(candidateDirectory, sources);
  const operations = packets ?? [{
    operation: AGENT_OPERATION.GET_SESSION,
    directory: candidateDirectory,
    files: sources.map(({ path: name }) => name),
    dependsOn: [],
    checks: checks ?? [{ id: 'smoke', run: () => true }],
  }];
  const manifest = manifestFor([fileRecord('host.js', 'host-owned runner')]);
  const options = {
    protectedDirectory, progressDirectory, manifest, packets: operations,
  };
  return {
    root, protectedDirectory, candidateDirectory, progressDirectory, manifest, options,
    workspace: () => createAgentPacketWorkspace(options),
  };
};
const symlinkOrSkip = async (target, link, t, type = 'junction') => {
  try {
    await fs.symlink(target, link, type);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) t.skip(`native link unavailable: ${error.code}`);
    throw error;
  }
};

afterEach(async () => {
  await Promise.all([...roots].map((directory) => fs.rm(directory, { recursive: true, force: true })));
  roots.clear();
});

describe('agent packet workspace', () => {
  it('preserves the earlier checkpoint when its write boundary changes during checks', async () => {
    let alter = false;
    let checkpoint;
    let alias;
    const context = await setup({ checks: [{ id: 'smoke', run: async () => {
      if (alter) await fs.link(checkpoint, alias);
      return !alter;
    } }] });
    checkpoint = path.join(context.progressDirectory, context.manifest.artifactDigest, `${AGENT_OPERATION.GET_SESSION}.json`);
    alias = path.join(context.root, 'alias.json');
    expect(await context.workspace().run(AGENT_OPERATION.GET_SESSION)).toMatchObject({ state: AGENT_PACKET_STATE.PASSED });
    const previous = await fs.readFile(checkpoint, 'utf8');
    alter = true;
    expect(await context.workspace().run(AGENT_OPERATION.GET_SESSION)).toMatchObject({ reason: AGENT_PACKET_ERROR.STORAGE });
    expect(await fs.readFile(checkpoint, 'utf8')).toBe(previous);
    expect(await fs.readdir(path.dirname(checkpoint))).toEqual([`${AGENT_OPERATION.GET_SESSION}.json`]);
  });

  it('refuses a progress kit directory replaced while fixtures run', async () => {
    let kit;
    const context = await setup({ checks: [{ id: 'smoke', run: async () => {
      await fs.rename(kit, `${kit}.retired`);
      await fs.mkdir(kit);
      return true;
    } }] });
    kit = path.join(context.progressDirectory, context.manifest.artifactDigest);
    expect(await context.workspace().run(AGENT_OPERATION.GET_SESSION)).toMatchObject({ reason: AGENT_PACKET_ERROR.STORAGE });
    expect(await fs.readdir(kit)).toEqual([]);
  });
  it('persists a native checkpoint under the kit digest and operation name', async () => {
    const context = await setup();
    const result = await context.workspace().run(AGENT_OPERATION.GET_SESSION);
    const checkpoint = path.join(context.progressDirectory, context.manifest.artifactDigest, `${AGENT_OPERATION.GET_SESSION}.json`);
    expect(result).toMatchObject({ state: AGENT_PACKET_STATE.PASSED, failures: 0 });
    expect(JSON.parse(await fs.readFile(checkpoint, 'utf8'))).toMatchObject({
      kitDigest: context.manifest.artifactDigest, operation: AGENT_OPERATION.GET_SESSION, state: AGENT_PACKET_STATE.PASSED,
    });
  });

  it('persists the correction ceiling across fresh workspace instances', async () => {
    const context = await setup({ checks: [{ id: 'smoke', run: () => false }] });
    const outcomes = [];
    for (let index = 0; index < 4; index += 1) outcomes.push(await context.workspace().run(AGENT_OPERATION.GET_SESSION));
    expect(outcomes.map(({ failures }) => failures)).toEqual([1, 2, 3, 3]);
    expect(outcomes[2]).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.LIMIT });
    expect(outcomes[3]).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.LIMIT });
  });

  it('accepts a passed dependency after restart while its candidate digest is unchanged', async () => {
    const root = await makeRoot();
    const protectedDirectory = path.join(root, 'protected');
    const progressDirectory = path.join(root, 'progress');
    const firstDirectory = path.join(root, 'first');
    const secondDirectory = path.join(root, 'second');
    await Promise.all([fs.mkdir(protectedDirectory), fs.mkdir(progressDirectory)]);
    await fs.writeFile(path.join(protectedDirectory, 'host.js'), 'host');
    await writeFiles(firstDirectory, [{ path: 'dep.js', text: 'export const dep = 1;' }]);
    await writeFiles(secondDirectory, [{ path: 'next.js', text: 'export const next = 1;' }]);
    const dependency = AGENT_OPERATION.GET_SESSION;
    const operation = AGENT_OPERATION.CREATE_SESSION;
    const packets = [
      { operation: dependency, directory: firstDirectory, files: ['dep.js'], dependsOn: [], checks: [{ id: 'dep', run: () => true }] },
      { operation, directory: secondDirectory, files: ['next.js'], dependsOn: [dependency], checks: [{ id: 'next', run: () => true }] },
    ];
    const manifest = manifestFor([fileRecord('host.js', 'host')]);
    const options = { protectedDirectory, progressDirectory, manifest, packets };
    expect(await createAgentPacketWorkspace(options).run(dependency)).toMatchObject({ state: AGENT_PACKET_STATE.PASSED });
    expect(await createAgentPacketWorkspace(options).run(operation)).toMatchObject({ state: AGENT_PACKET_STATE.PASSED });
    await fs.writeFile(path.join(firstDirectory, 'dep.js'), 'export const dep = 2;');
    expect(await createAgentPacketWorkspace(options).run(operation)).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.DEPENDENCY,
    });
  });

  it.each(['malformed-json', 'wrong-kit', 'oversized'])('blocks on %s checkpoint data', async (kind) => {
    const context = await setup();
    const kit = path.join(context.progressDirectory, context.manifest.artifactDigest);
    await fs.mkdir(kit);
    const checkpoint = path.join(kit, `${AGENT_OPERATION.GET_SESSION}.json`);
    const bytes = kind === 'malformed-json' ? '{' : kind === 'wrong-kit'
      ? JSON.stringify({ version: 1, kitDigest: '0'.repeat(64), operation: AGENT_OPERATION.GET_SESSION,
        state: AGENT_PACKET_STATE.PASSED, candidateDigest: '1'.repeat(64), failures: 0, checks: [{ id: 'smoke', passed: true }] })
      : Buffer.alloc(65537, 0x20);
    await fs.writeFile(checkpoint, bytes);
    expect(await context.workspace().run(AGENT_OPERATION.GET_SESSION)).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.STORAGE,
    });
  });

  it('refuses a linked progress root', async (t) => {
    const context = await setup();
    const linked = path.join(context.root, 'linked-progress');
    await symlinkOrSkip(context.progressDirectory, linked, t, 'junction');
    expect(await createAgentPacketWorkspace({ ...context.options, progressDirectory: linked }).run(AGENT_OPERATION.GET_SESSION))
      .toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.STORAGE });
  });

  it('refuses a linked kit directory and a hard-linked checkpoint', async (t) => {
    const linkedContext = await setup();
    const linkedKit = path.join(linkedContext.progressDirectory, linkedContext.manifest.artifactDigest);
    await fs.mkdir(linkedKit);
    const outside = path.join(linkedContext.root, 'outside-kit');
    await fs.mkdir(outside);
    await fs.rm(linkedKit, { recursive: true });
    await symlinkOrSkip(outside, linkedKit, t, 'junction');
    expect(await linkedContext.workspace().run(AGENT_OPERATION.GET_SESSION)).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.STORAGE,
    });

    const hardContext = await setup();
    const passed = await hardContext.workspace().run(AGENT_OPERATION.GET_SESSION);
    expect(passed.state).toBe(AGENT_PACKET_STATE.PASSED);
    const checkpoint = path.join(hardContext.progressDirectory, hardContext.manifest.artifactDigest, `${AGENT_OPERATION.GET_SESSION}.json`);
    await fs.link(checkpoint, path.join(hardContext.root, 'checkpoint-alias.json'));
    expect(await hardContext.workspace().run(AGENT_OPERATION.GET_SESSION)).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.STORAGE,
    });
  });

  it('rejects overlapping progress and protected or candidate roots', async () => {
    const context = await setup();
    for (const progressDirectory of [context.protectedDirectory, context.candidateDirectory,
      path.join(context.protectedDirectory, 'nested-progress'), path.join(context.candidateDirectory, 'nested-progress')]) {
      expect(() => createAgentPacketWorkspace({ ...context.options, progressDirectory })).toThrow(
        expect.objectContaining({ name: 'AgentPacketError', code: AGENT_PACKET_ERROR.INVALID }),
      );
    }
  });

  it('refuses candidate files above the byte limit before fixtures run', async () => {
    let calls = 0;
    const context = await setup({ checks: [{ id: 'smoke', run: () => { calls += 1; return true; } }] });
    await fs.writeFile(path.join(context.candidateDirectory, 'src/agent.js'), Buffer.alloc(AGENT_PACKET.MAX_FILE_BYTES + 1));
    expect(await context.workspace().run(AGENT_OPERATION.GET_SESSION)).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.BOUNDARY,
    });
    expect(calls).toBe(0);
  });

  it('returns BUSY across separate instances while a fixture is held', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let started;
    const entered = new Promise((resolve) => { started = resolve; });
    const context = await setup({ checks: [{ id: 'wait', run: async () => { started(); await gate; return true; } }] });
    const running = context.workspace().run(AGENT_OPERATION.GET_SESSION);
    await entered;
    const busy = await context.workspace().run(AGENT_OPERATION.GET_SESSION);
    release();
    await running;
    expect(busy).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.BUSY });
  });
});
