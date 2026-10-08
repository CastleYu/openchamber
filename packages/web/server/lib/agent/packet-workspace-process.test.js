import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

import { agentArtifactDigest } from './artifacts.js';
import { AGENT_OPERATION, AGENT_PACKET_ERROR, AGENT_PACKET_STATE } from './constants.js';
import { createAgentPacketWorkspace } from './packet-workspace.js';

const children = new Set();
const roots = new Set();
const source = `
import { createAgentPacketWorkspace } from './packet-workspace.js';
process.once('message', async ({ options, hold, pass }) => {
  const checks = [{ id: 'native', run: async () => {
    if (hold) {
      process.send({ checking: true });
      await new Promise((resolve) => process.once('message', resolve));
    }
    return pass;
  } }];
  options.packets[0].checks = checks;
  const result = await createAgentPacketWorkspace(options).run(options.packets[0].operation);
  process.send({ result }, () => process.disconnect());
});`;
const child = () => {
  const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', source], {
    cwd: path.dirname(fileURLToPath(import.meta.url)), windowsHide: true,
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  children.add(process);
  return process;
};
const receive = async (process) => {
  const [message] = await once(process, 'message', { signal: AbortSignal.timeout(15000) });
  return message;
};
const fixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-packet-process-'));
  roots.add(root);
  const protectedDirectory = path.join(root, 'protected');
  const progressDirectory = path.join(root, 'progress');
  const candidate = path.join(root, 'candidate');
  await Promise.all([protectedDirectory, progressDirectory, candidate].map((directory) => fs.mkdir(directory)));
  const text = 'protected process fixture';
  await fs.writeFile(path.join(protectedDirectory, 'kit.txt'), text);
  await fs.writeFile(path.join(candidate, 'codec.js'), 'candidate');
  const files = [{ path: 'kit.txt', bytes: Buffer.byteLength(text), digest: createHash('sha256').update(text).digest('hex') }];
  return { protectedDirectory, progressDirectory, manifest: { version: 1, files, artifactDigest: agentArtifactDigest(files) },
    packets: [{ operation: AGENT_OPERATION.GET_SESSION, directory: candidate, files: ['codec.js'], dependsOn: [] }] };
};
afterEach(async () => {
  await Promise.all([...children].map(async (process) => {
    if (process.exitCode !== null || process.signalCode !== null) return;
    const closed = once(process, 'exit');
    process.kill();
    await closed;
  }));
  children.clear();
  await Promise.all([...roots].map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.clear();
});

it('excludes a second native process and releases ownership after abrupt exit', async () => {
  const options = await fixture();
  const owner = child();
  const ready = receive(owner);
  owner.send({ options, hold: true, pass: true });
  expect(await ready).toEqual({ checking: true });
  const contender = child();
  const refused = receive(contender);
  contender.send({ options, hold: false, pass: true });
  expect((await refused).result).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED, reason: AGENT_PACKET_ERROR.BUSY });
  const exited = once(owner, 'exit');
  owner.kill();
  await exited;
  const fresh = child();
  const resumed = receive(fresh);
  fresh.send({ options, hold: false, pass: true });
  expect((await resumed).result).toMatchObject({ state: AGENT_PACKET_STATE.PASSED, reason: null });
  const workspace = createAgentPacketWorkspace({ ...options,
    packets: options.packets.map((packet) => ({ ...packet, checks: [{ id: 'native', run: () => true }] })) });
  expect(await workspace.run(AGENT_OPERATION.GET_SESSION)).toMatchObject({ state: AGENT_PACKET_STATE.PASSED });
}, 30000);

it('retains the correction ceiling across three native processes', async () => {
  const options = await fixture();
  for (let index = 0; index < 3; index += 1) {
    const process = child();
    const received = receive(process);
    process.send({ options, hold: false, pass: false });
    expect((await received).result).toMatchObject({ failures: index + 1 });
  }
  const fresh = child();
  const received = receive(fresh);
  fresh.send({ options, hold: false, pass: true });
  expect((await received).result).toMatchObject({ state: AGENT_PACKET_STATE.BLOCKED,
    reason: AGENT_PACKET_ERROR.LIMIT, failures: 3 });
}, 30000);
