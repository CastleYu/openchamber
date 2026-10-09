import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { agentArtifactDigest } from './artifacts.js';
import { AGENT_ARTIFACT, AGENT_OPERATION, AGENT_PACKET, AGENT_PACKET_ERROR, AGENT_PACKET_STATE } from './constants.js';
import { AgentPacketError, createAgentPacketRunner } from './packet-runner.js';

const roots = new Set();
const makeRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-agent-packets-'));
  roots.add(root);
  return root;
};
const fileRecord = (name, text) => ({
  path: name,
  bytes: Buffer.byteLength(text),
  digest: createHash('sha256').update(text).digest('hex'),
});
const manifestFor = (files) => ({
  version: AGENT_ARTIFACT.VERSION,
  artifactDigest: agentArtifactDigest(files),
  files,
});
const writeFiles = async (directory, files) => {
  for (const file of files) {
    const target = path.join(directory, ...file.path.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.text);
  }
};
const setup = async ({ sources = [{ path: 'src/agent.js', text: 'export const value = 1;\n' }], checks, packets, readProgress, writeProgress } = {}) => {
  const root = await makeRoot();
  const protectedDirectory = path.join(root, 'protected');
  const candidateDirectory = path.join(root, 'candidate');
  await fs.mkdir(protectedDirectory, { recursive: true });
  await fs.writeFile(path.join(protectedDirectory, 'host.js'), 'host-owned runner');
  await writeFiles(candidateDirectory, sources);
  const operations = packets ?? [{
    operation: AGENT_OPERATION.GET_SESSION,
    directory: candidateDirectory,
    files: sources.map(({ path: name }) => name),
    dependsOn: [],
    checks: checks ?? [{ id: 'smoke', run: () => true }],
  }];
  const progress = new Map();
  const runner = createAgentPacketRunner({
    protectedDirectory,
    manifest: manifestFor([fileRecord('host.js', 'host-owned runner')]),
    packets: operations,
    readProgress: readProgress ?? (async (operation) => progress.get(operation) ?? null),
    writeProgress: writeProgress ?? (async (value) => progress.set(value.operation, value)),
  });
  return { root, protectedDirectory, candidateDirectory, sources, packets: operations, progress, runner };
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

describe('agent packet runner', () => {
  it('persists finite extension packet progress without treating it as a core operation', async () => {
    const context = await setup();
    const actionID = 'cagent.fixture.report';
    const runner = createAgentPacketRunner({
      protectedDirectory: context.protectedDirectory,
      manifest: manifestFor([fileRecord('host.js', 'host-owned runner')]),
      packets: [{ ...context.packets[0], operation: actionID }],
      readProgress: async (id) => context.progress.get(id) ?? null,
      writeProgress: async (value) => context.progress.set(value.operation, value),
    });
    expect(await runner.run(actionID)).toMatchObject({ operation: actionID, state: AGENT_PACKET_STATE.PASSED });
    expect(context.progress.get(actionID).operation).toBe(actionID);
    expect(context.progress.has(AGENT_OPERATION.GET_SESSION)).toBe(false);
  });

  it('accepts a candidate whose real files match the packet and reports a digest', async () => {
    const { runner, sources } = await setup();
    const result = await runner.run(AGENT_OPERATION.GET_SESSION);
    expect(result).toMatchObject({
      operation: AGENT_OPERATION.GET_SESSION, state: AGENT_PACKET_STATE.PASSED, reason: null,
      candidateDigest: agentArtifactDigest(sources.map(({ path: name, text }) => fileRecord(name, text))),
      failures: 0, checks: [{ id: 'smoke', passed: true }],
    });
  });

  it.each(['extra', 'missing'])('rejects a candidate with an %s file', async (change) => {
    const context = await setup();
    if (change === 'extra') await fs.writeFile(path.join(context.candidateDirectory, 'extra.txt'), 'extra');
    else await fs.rm(path.join(context.candidateDirectory, 'src/agent.js'));
    const result = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    expect(result).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: change === 'missing' ? AGENT_PACKET_ERROR.INPUT : AGENT_PACKET_ERROR.BOUNDARY });
  });

  it('rejects a linked candidate file without reading its target', async (t) => {
    const context = await setup();
    const outside = path.join(context.root, 'outside.js');
    await fs.writeFile(outside, 'outside');
    await fs.rm(path.join(context.candidateDirectory, 'src/agent.js'));
    await symlinkOrSkip(outside, path.join(context.candidateDirectory, 'src/agent.js'), t, 'file');
    const result = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    expect(result).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.BOUNDARY });
  });

  it('detects a protected baseline change before invoking checks', async () => {
    let calls = 0;
    const context = await setup({ checks: [{ id: 'smoke', run: () => { calls += 1; return true; } }] });
    await fs.writeFile(path.join(context.protectedDirectory, 'host.js'), 'changed');
    const result = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    expect(result).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.PROTECTED });
    expect(calls).toBe(0);
  });

  it('blocks on the third false result and never runs checks again', async () => {
    let calls = 0;
    const context = await setup({ checks: [{ id: 'smoke', run: () => { calls += 1; return false; } }] });
    const first = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    const second = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    const third = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    const later = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    expect(first).toMatchObject({ state: AGENT_PACKET_STATE.FAILED, reason: AGENT_PACKET_ERROR.CHECK, failures: 1 });
    expect(second).toMatchObject({ state: AGENT_PACKET_STATE.FAILED, failures: 2 });
    expect(third).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.LIMIT, failures: 3 });
    expect(later).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.LIMIT, failures: 3 });
    expect(calls).toBe(3);
  });

  it.each(['read', 'write'])('returns a fixed storage reason when progress %s fails', async (mode) => {
    const context = await setup(mode === 'read'
      ? { readProgress: async () => { throw new Error('private path'); } }
      : { writeProgress: async () => { throw new Error('private path'); } });
    const result = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    expect(result).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.STORAGE });
    expect(result.state).not.toBe(AGENT_PACKET_STATE.PASSED);
  });

  it('does not consume a correction when a fixture cannot start', async () => {
    const context = await setup({ checks: [{ id: 'smoke', run: () => { throw new Error('fixture setup'); } }] });
    const result = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    expect(result).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.SETUP, failures: 0 });
  });

  it('resumes a passed dependency only while its candidate digest is unchanged', async () => {
    const root = await makeRoot();
    const protectedDirectory = path.join(root, 'protected');
    const firstDirectory = path.join(root, 'first');
    const secondDirectory = path.join(root, 'second');
    await fs.mkdir(protectedDirectory);
    await fs.writeFile(path.join(protectedDirectory, 'host.js'), 'host');
    const depSources = [{ path: 'dep.js', text: 'export const dep = 1;' }];
    const nextSources = [{ path: 'next.js', text: 'export const next = 1;' }];
    await writeFiles(firstDirectory, depSources);
    await writeFiles(secondDirectory, nextSources);
    const dependency = AGENT_OPERATION.GET_SESSION;
    const operation = AGENT_OPERATION.CREATE_SESSION;
    const packets = [
      { operation: dependency, directory: firstDirectory, files: ['dep.js'], dependsOn: [], checks: [{ id: 'dep', run: () => true }] },
      { operation, directory: secondDirectory, files: ['next.js'], dependsOn: [dependency], checks: [{ id: 'next', run: () => true }] },
    ];
    const progress = new Map();
    const runner = createAgentPacketRunner({
      protectedDirectory, manifest: manifestFor([fileRecord('host.js', 'host')]), packets,
      readProgress: async (key) => progress.get(key) ?? null,
      writeProgress: async (value) => progress.set(value.operation, value),
    });
    expect(await runner.run(dependency)).toMatchObject({ state: AGENT_PACKET_STATE.PASSED });
    expect(await runner.run(operation)).toMatchObject({ state: AGENT_PACKET_STATE.PASSED });
    await fs.writeFile(path.join(firstDirectory, 'dep.js'), 'export const dep = 2;');
    expect(await runner.run(operation)).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.DEPENDENCY });
  });

  it.each(['wrong-kit', 'malformed'])('rejects %s stored progress', async (kind) => {
    const context = await setup({ readProgress: async () => kind === 'wrong-kit'
      ? { version: 1, kitDigest: '0'.repeat(64), operation: AGENT_OPERATION.GET_SESSION, state: AGENT_PACKET_STATE.PASSED, candidateDigest: '1'.repeat(64), failures: 0, checks: [{ id: 'smoke', passed: true }] }
      : { version: 1, kitDigest: 1, operation: AGENT_OPERATION.CREATE_SESSION, state: 'invalid', candidateDigest: '', failures: -1, checks: [] } });
    const result = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    expect(result).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.STORAGE });
  });

  it('passes frozen captured source snapshots to fixture checks', async () => {
    const context = await setup({ checks: [{ id: 'snapshot', run: (files) => {
      expect(Object.isFrozen(files)).toBe(true);
      expect(Object.isFrozen(files[0])).toBe(true);
      expect(() => { files[0].text = 'changed'; }).toThrow();
      expect(() => { files.push({ path: 'extra', text: 'extra' }); }).toThrow();
      return files[0].text === context.sources[0].text;
    } }] });
    const result = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    expect(result.state).toBe(AGENT_PACKET_STATE.PASSED);
  });

  it('refuses hard-linked candidate files', async () => {
    const context = await setup();
    await fs.link(path.join(context.candidateDirectory, 'src/agent.js'), path.join(context.root, 'alias.js'));
    expect(await context.runner.run(AGENT_OPERATION.GET_SESSION)).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.BOUNDARY, failures: 0,
    });
  });

  it.each(['invalid-utf8', 'oversized'])('refuses %s candidate input without calling checks', async (kind) => {
    let calls = 0;
    const context = await setup({ checks: [{ id: 'smoke', run: () => { calls += 1; return true; } }] });
    await fs.writeFile(path.join(context.candidateDirectory, 'src/agent.js'), kind === 'invalid-utf8'
      ? Buffer.from([0xff]) : Buffer.alloc(AGENT_PACKET.MAX_FILE_BYTES + 1));
    expect(await context.runner.run(AGENT_OPERATION.GET_SESSION)).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, failures: 0,
    });
    expect(calls).toBe(0);
    expect(context.progress.size).toBe(0);
  });

  it('refuses a candidate changed during checks and never persists a pass', async () => {
    const context = await setup({ checks: [{ id: 'change', run: async () => {
      await fs.writeFile(path.join(context.candidateDirectory, 'src/agent.js'), 'changed');
      return true;
    } }] });
    expect(await context.runner.run(AGENT_OPERATION.GET_SESSION)).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.BOUNDARY, failures: 0,
    });
    expect(context.progress.size).toBe(0);
  });

  it('treats a model-shaped pass string as an invalid check result', async () => {
    const context = await setup({ checks: [{ id: 'report', run: () => 'passed' }] });
    expect(await context.runner.run(AGENT_OPERATION.GET_SESSION)).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.SETUP, failures: 0,
    });
    expect(context.progress.size).toBe(0);
  });

  it('resumes in a new runner and checks transitive dependencies before and after fixtures', async () => {
    const root = await makeRoot();
    const protectedDirectory = path.join(root, 'protected');
    await fs.mkdir(protectedDirectory);
    await fs.writeFile(path.join(protectedDirectory, 'host.js'), 'host');
    const ids = [AGENT_OPERATION.GET_SESSION, AGENT_OPERATION.CREATE_SESSION, AGENT_OPERATION.LIST_MESSAGES];
    let mutate = false;
    let calls = 0;
    const packets = [];
    for (const [index, operation] of ids.entries()) {
      const directory = path.join(root, `candidate-${index}`);
      await writeFiles(directory, [{ path: 'map.json', text: '{}'}]);
      packets.push({ operation, directory, files: ['map.json'], dependsOn: index ? [ids[index - 1]] : [],
        checks: [{ id: 'mapping', run: async () => {
          calls += 1;
          if (index === 2 && mutate) await fs.writeFile(path.join(packets[0].directory, 'map.json'), '{"changed":true}');
          return true;
        } }] });
    }
    const progress = new Map();
    const options = { protectedDirectory, manifest: manifestFor([fileRecord('host.js', 'host')]), packets,
      readProgress: async (operation) => progress.get(operation) ?? null,
      writeProgress: async (value) => progress.set(value.operation, value) };
    for (const operation of ids.slice(0, 2)) expect((await createAgentPacketRunner(options).run(operation)).state).toBe(AGENT_PACKET_STATE.PASSED);
    expect((await createAgentPacketRunner(options).run(ids[2])).state).toBe(AGENT_PACKET_STATE.PASSED);
    expect(calls).toBe(3);
    mutate = true;
    expect(await createAgentPacketRunner(options).run(ids[2])).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.DEPENDENCY,
    });
    expect(calls).toBe(4);
    expect(await createAgentPacketRunner(options).run(ids[2])).toMatchObject({
      state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.DEPENDENCY,
    });
    expect(calls).toBe(4);
  });

  it('rejects protected-kit mutation performed by a fixture', async () => {
    const context = await setup({ checks: [{ id: 'mutate', run: async () => {
      await fs.writeFile(path.join(context.protectedDirectory, 'host.js'), 'fixture changed it');
      return true;
    } }] });
    const result = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    expect(result).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.PROTECTED });
  });

  it('returns BUSY while another operation is running', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const context = await setup({ checks: [{ id: 'wait', run: async () => { await gate; return true; } }] });
    const running = context.runner.run(AGENT_OPERATION.GET_SESSION);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const busy = await context.runner.run(AGENT_OPERATION.GET_SESSION);
    release();
    await running;
    expect(busy).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.BUSY });
  });

  it.each([
    (directory) => [{ operation: AGENT_OPERATION.GET_SESSION, directory, files: ['../escape'], dependsOn: [], checks: [{ id: 'check', run: () => true }] }],
    (directory) => [{ operation: AGENT_OPERATION.GET_SESSION, directory, files: ['a', 'a'], dependsOn: [], checks: [{ id: 'check', run: () => true }] }],
    (directory) => [
      { operation: AGENT_OPERATION.GET_SESSION, directory, files: ['a'], dependsOn: [AGENT_OPERATION.CREATE_SESSION], checks: [{ id: 'check', run: () => true }] },
      { operation: AGENT_OPERATION.CREATE_SESSION, directory: `${directory}-second`, files: ['b'], dependsOn: [AGENT_OPERATION.GET_SESSION], checks: [{ id: 'check', run: () => true }] },
    ],
  ])('rejects invalid packet paths, duplicates, and dependency cycles at construction', async (makePackets) => {
    const root = await makeRoot();
    const protectedDirectory = path.join(root, 'protected');
    await fs.mkdir(protectedDirectory);
    await fs.writeFile(path.join(protectedDirectory, 'host.js'), 'host');
    expect(() => createAgentPacketRunner({
      protectedDirectory,
      manifest: manifestFor([fileRecord('host.js', 'host')]),
      packets: makePackets(path.join(root, 'candidate')),
      readProgress: async () => null,
      writeProgress: async () => {},
    })).toThrow(expect.objectContaining({ name: 'AgentPacketError', code: AGENT_PACKET_ERROR.INVALID }));
  });
});
