import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { z } from 'zod';

import { AGENT_FILE_ERROR, AGENT_FILE_MODE, AGENT_PACKET_ERROR, AGENT_PACKET_STATE, AGENT_PACKET_STORAGE } from './constants.js';
import { AgentPacketError, agentPacketProgressSchema, createAgentPacketRunner } from './packet-runner.js';

const contains = (left, right) => {
  const relative = path.relative(left, right);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const directory = (root) => {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(root) !== root) {
    throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
  }
  return stat;
};
const file = (target) => {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.realpathSync(target) !== target) {
      throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
    }
    return stat;
  } catch (error) {
    if (error?.code === AGENT_FILE_ERROR.MISSING) return null;
    throw error;
  }
};

// A process-owned IPC listener has no stale lock file after an abrupt exit.
const acquire = (stat) => new Promise((resolve, reject) => {
  const id = createHash('sha256').update(`${stat.dev}:${stat.ino}`).digest('hex');
  const endpoint = process.platform === AGENT_PACKET_STORAGE.WINDOWS ? `${AGENT_PACKET_STORAGE.PIPE_PREFIX}${id}`
    : process.platform === AGENT_PACKET_STORAGE.LINUX ? `${AGENT_PACKET_STORAGE.ABSTRACT_PREFIX}${id}` : null;
  if (!endpoint) {
    reject(new AgentPacketError(AGENT_PACKET_ERROR.STORAGE));
    return;
  }
  const server = net.createServer((socket) => socket.destroy());
  const fail = (error) => reject(new AgentPacketError(error?.code === AGENT_PACKET_STORAGE.BUSY
    ? AGENT_PACKET_ERROR.BUSY : AGENT_PACKET_ERROR.STORAGE));
  server.once(AGENT_PACKET_STORAGE.ERROR, fail);
  server.listen({ path: endpoint }, () => {
    server.removeListener(AGENT_PACKET_STORAGE.ERROR, fail);
    let healthy = true;
    server.on(AGENT_PACKET_STORAGE.ERROR, () => { healthy = false; });
    resolve(Object.freeze({
      assert: () => {
        if (!healthy || !server.listening) throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
      },
      close: () => new Promise((done, failed) => server.close((error) => error
        ? failed(new AgentPacketError(AGENT_PACKET_ERROR.STORAGE)) : done())),
    }));
  });
});

/** Native persistence for protected packet execution, separate from activation approvals. */
export const createAgentPacketWorkspace = ({ progressDirectory, ...options }) => {
  const checked = z.string().refine(path.isAbsolute).safeParse(progressDirectory);
  if (!checked.success) throw new AgentPacketError(AGENT_PACKET_ERROR.INVALID);
  const root = path.resolve(checked.data);
  let lease;
  let identity;
  let kit;
  let kitIdentity;
  const validate = () => {
    lease.assert();
    const current = directory(root);
    if (current.dev !== identity.dev || current.ino !== identity.ino) throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
    const currentKit = directory(kit);
    if (currentKit.dev !== kitIdentity.dev || currentKit.ino !== kitIdentity.ino) throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
  };
  const readProgress = async (operation) => {
    validate();
    const target = path.join(kit, `${operation}${AGENT_PACKET_STORAGE.SUFFIX}`);
    const stat = file(target);
    if (!stat) return null;
    const fd = fs.openSync(target, AGENT_PACKET_STORAGE.READ);
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || before.dev !== stat.dev || before.ino !== stat.ino
        || before.size > AGENT_PACKET_STORAGE.MAX_RECORD_BYTES) throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
      const buffer = Buffer.alloc(before.size + 1);
      let count = 0;
      while (count < buffer.length) {
        const size = fs.readSync(fd, buffer, count, buffer.length - count, null);
        if (!size) break;
        count += size;
      }
      const after = fs.fstatSync(fd);
      if (count !== before.size || after.size !== before.size || after.nlink !== 1
        || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
      validate();
      const record = agentPacketProgressSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))));
      if (record.operation !== operation || record.kitDigest !== digest) {
        throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
      }
      return record;
    } finally {
      fs.closeSync(fd);
    }
  };
  const writeProgress = async (progress) => {
    const record = agentPacketProgressSchema.parse(progress);
    const bytes = Buffer.from(JSON.stringify(record));
    if (bytes.length > AGENT_PACKET_STORAGE.MAX_RECORD_BYTES) throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
    validate();
    const target = path.join(kit, `${record.operation}${AGENT_PACKET_STORAGE.SUFFIX}`);
    file(target);
    const temporary = `${target}.${randomUUID()}${AGENT_PACKET_STORAGE.TEMP_SUFFIX}`;
    let fd;
    let pending = false;
    try {
      fd = fs.openSync(temporary, AGENT_FILE_MODE.EXCLUSIVE, AGENT_FILE_MODE.OWNER_READ_WRITE);
      pending = true;
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      validate();
      file(target);
      fs.renameSync(temporary, target);
      pending = false;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (pending) fs.unlinkSync(temporary);
    }
  };
  // The runner copies and validates protected definitions before the first await.
  const runner = createAgentPacketRunner({ ...options, readProgress, writeProgress });
  const digest = options.manifest.artifactDigest;
  const roots = [options.protectedDirectory, ...options.packets.map((packet) => packet.directory)].map((entry) => path.resolve(entry));
  if (roots.some((entry) => contains(root, entry) || contains(entry, root))) throw new AgentPacketError(AGENT_PACKET_ERROR.INVALID);
  let busy = false;
  const run = async (operation) => {
    const blocked = (reason) => Object.freeze({ operation, state: AGENT_PACKET_STATE.BLOCKED, reason,
      candidateDigest: null, failures: 0, checks: Object.freeze([]) });
    if (busy) return blocked(AGENT_PACKET_ERROR.BUSY);
    busy = true;
    let outcome;
    try {
      identity = directory(root);
      lease = await acquire(identity);
      const current = directory(root);
      if (current.dev !== identity.dev || current.ino !== identity.ino) throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
      kit = path.join(root, digest);
      try { fs.mkdirSync(kit, { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE }); }
      catch (error) { if (error?.code !== AGENT_FILE_ERROR.EXISTS) throw error; }
      kitIdentity = directory(kit);
      validate();
      outcome = await runner.run(operation);
      validate();
    } catch (error) {
      outcome = blocked(error instanceof AgentPacketError ? error.code : AGENT_PACKET_ERROR.STORAGE);
    } finally {
      try { if (lease) await lease.close(); }
      catch { outcome = blocked(AGENT_PACKET_ERROR.STORAGE); }
      lease = undefined;
      busy = false;
    }
    return outcome;
  };
  return Object.freeze({ run });
};
