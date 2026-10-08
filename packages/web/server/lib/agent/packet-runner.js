import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { AgentArtifactError, agentArtifactDigest, agentArtifactManifestSchema, verifyAgentArtifacts } from './artifacts.js';
import { AGENT_ARTIFACT, AGENT_ERROR, AGENT_OPERATION, AGENT_PACKET, AGENT_PACKET_ERROR, AGENT_PACKET_STATE } from './constants.js';

const operationSchema = z.enum(Object.values(AGENT_OPERATION));
const idSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const callable = z.function();
const checkSchema = z.object({ id: idSchema, run: callable }).strict();
const packetSchema = z.object({
  operation: operationSchema, directory: z.string().refine(path.isAbsolute),
  files: z.array(z.string()).min(1).max(AGENT_PACKET.MAX_FILES),
  dependsOn: z.array(operationSchema).max(Object.keys(AGENT_OPERATION).length),
  checks: z.array(checkSchema).min(1).max(AGENT_PACKET.MAX_CHECKS),
}).strict();
const checkResultSchema = z.object({ id: idSchema, passed: z.boolean() }).strict();
const progressSchema = z.object({
  version: z.literal(AGENT_PACKET.VERSION), kitDigest: digestSchema, operation: operationSchema,
  state: z.enum(Object.values(AGENT_PACKET_STATE)), candidateDigest: digestSchema,
  failures: z.number().int().min(0).max(AGENT_PACKET.MAX_CORRECTIONS + 1),
  checks: z.array(checkResultSchema).min(1).max(AGENT_PACKET.MAX_CHECKS),
}).strict();
const optionsSchema = z.object({
  protectedDirectory: z.string().refine(path.isAbsolute), manifest: agentArtifactManifestSchema,
  packets: z.array(packetSchema).min(1).max(Object.keys(AGENT_OPERATION).length),
  readProgress: callable, writeProgress: callable,
}).strict();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const emptyDigest = hash(Buffer.alloc(0));
const contains = (left, right) => {
  const relative = path.relative(left, right);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const overlaps = (left, right) => contains(left, right) || contains(right, left);

export class AgentPacketError extends Error {
  constructor(code) {
    super(`Agent packet refused: ${code}`);
    this.name = 'AgentPacketError';
    this.code = code;
  }
}

const freezeProgress = (record) => Object.freeze({ ...record,
  checks: Object.freeze(record.checks.map((check) => Object.freeze({ ...check }))),
});
const result = (operation, state, reason, snapshot = null, failures = 0, checks = []) => Object.freeze({
  operation, state, reason, candidateDigest: snapshot?.digest ?? null, failures,
  checks: Object.freeze(checks.map((check) => Object.freeze({ ...check }))),
});

/** Captured candidate hashes establish content identity only, never acceptance or trust. */
const capture = async (packet, protectedDirectory) => {
  const sources = [];
  const records = [];
  let total = 0;
  try {
    const rootStat = await fs.lstat(packet.directory);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new AgentPacketError(AGENT_PACKET_ERROR.BOUNDARY);
    const root = await fs.realpath(packet.directory);
    const protectedRoot = await fs.realpath(protectedDirectory);
    if (root !== path.resolve(packet.directory) || overlaps(root, protectedRoot)) throw new AgentPacketError(AGENT_PACKET_ERROR.BOUNDARY);
    for (const name of packet.files) {
      const segments = name.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        const parent = await fs.lstat(path.join(root, ...segments.slice(0, index)));
        if (!parent.isDirectory() || parent.isSymbolicLink()) throw new AgentPacketError(AGENT_PACKET_ERROR.BOUNDARY);
      }
      const target = path.join(root, ...segments);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || await fs.realpath(target) !== target) {
        throw new AgentPacketError(AGENT_PACKET_ERROR.BOUNDARY);
      }
      const handle = await fs.open(target, 'r');
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.nlink !== 1 || before.dev !== stat.dev || before.ino !== stat.ino) {
          throw new AgentPacketError(AGENT_PACKET_ERROR.BOUNDARY);
        }
        total += before.size;
        if (before.size > AGENT_PACKET.MAX_FILE_BYTES || total > AGENT_PACKET.MAX_TOTAL_BYTES) {
          throw new AgentPacketError(AGENT_PACKET_ERROR.BOUNDARY);
        }
        const buffer = Buffer.alloc(before.size + 1);
        let count = 0;
        while (count < buffer.length) {
          const read = await handle.read(buffer, count, buffer.length - count, null);
          if (read.bytesRead === 0) break;
          count += read.bytesRead;
        }
        const after = await handle.stat();
        if (count !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs
          || before.ctimeMs !== after.ctimeMs || after.nlink !== 1) {
          throw new AgentPacketError(AGENT_PACKET_ERROR.BOUNDARY);
        }
        const bytes = buffer.subarray(0, count);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        sources.push(Object.freeze({ path: name, text }));
        records.push({ path: name, bytes: count, digest: hash(bytes) });
      } finally {
        await handle.close();
      }
    }
    const digest = agentArtifactDigest(records);
    await verifyAgentArtifacts({ directory: packet.directory,
      manifest: { version: AGENT_ARTIFACT.VERSION, artifactDigest: digest, files: records } });
    return Object.freeze({ digest, sources: Object.freeze(sources) });
  } catch (error) {
    if (error instanceof AgentPacketError) throw error;
    if (error instanceof AgentArtifactError && error.code === AGENT_ERROR.ARTIFACT_BOUNDARY) {
      throw new AgentPacketError(AGENT_PACKET_ERROR.BOUNDARY);
    }
    throw new AgentPacketError(AGENT_PACKET_ERROR.INPUT);
  }
};

/** Host-owned definitions and checkpoint ports must be outside the local agent's writable scope. */
export const createAgentPacketRunner = (options) => {
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success) throw new AgentPacketError(AGENT_PACKET_ERROR.INVALID);
  const config = parsed.data;
  const packets = new Map(config.packets.map((packet) => [packet.operation, packet]));
  const roots = [config.protectedDirectory, ...config.packets.map((packet) => packet.directory)].map((root) => path.resolve(root));
  try {
    if (packets.size !== config.packets.length) throw new AgentPacketError(AGENT_PACKET_ERROR.INVALID);
    for (let index = 0; index < roots.length; index += 1) {
      if (roots.slice(index + 1).some((root) => overlaps(roots[index], root))) throw new AgentPacketError(AGENT_PACKET_ERROR.INVALID);
    }
    for (const packet of packets.values()) {
      agentArtifactDigest(packet.files.map((name) => ({ path: name, bytes: 0, digest: emptyDigest })));
      if (new Set(packet.checks.map((check) => check.id)).size !== packet.checks.length
        || new Set(packet.dependsOn).size !== packet.dependsOn.length
        || packet.dependsOn.some((operation) => !packets.has(operation))) throw new AgentPacketError(AGENT_PACKET_ERROR.INVALID);
    }
    const visit = (operation, pending = new Set(), done = new Set()) => {
      if (pending.has(operation)) throw new AgentPacketError(AGENT_PACKET_ERROR.INVALID);
      if (done.has(operation)) return;
      pending.add(operation);
      for (const dependency of packets.get(operation).dependsOn) visit(dependency, pending, done);
      pending.delete(operation);
      done.add(operation);
    };
    for (const operation of packets.keys()) visit(operation);
  } catch {
    throw new AgentPacketError(AGENT_PACKET_ERROR.INVALID);
  }
  const verifyProtected = async () => {
    try {
      await verifyAgentArtifacts({ directory: config.protectedDirectory, manifest: config.manifest });
    } catch {
      throw new AgentPacketError(AGENT_PACKET_ERROR.PROTECTED);
    }
  };
  const read = async (packet) => {
    try {
      const value = await config.readProgress(packet.operation);
      if (value === null) return null;
      const saved = progressSchema.parse(value);
      const passed = saved.checks.every((check) => check.passed);
      if (saved.kitDigest !== config.manifest.artifactDigest || saved.operation !== packet.operation
        || saved.checks.length !== packet.checks.length
        || saved.checks.some((check, index) => check.id !== packet.checks[index].id)
        || (saved.state === AGENT_PACKET_STATE.PASSED) !== passed
        || (!passed && saved.failures === 0)
        || (saved.state === AGENT_PACKET_STATE.BLOCKED) !== (saved.failures > AGENT_PACKET.MAX_CORRECTIONS)) {
        throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
      }
      return saved;
    } catch {
      throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
    }
  };
  const verifyDependencies = async (packet, seen = new Set()) => {
    for (const dependency of packet.dependsOn) {
      if (seen.has(dependency)) continue;
      const parent = packets.get(dependency);
      const previous = await read(parent);
      if (!previous || previous.state !== AGENT_PACKET_STATE.PASSED) throw new AgentPacketError(AGENT_PACKET_ERROR.DEPENDENCY);
      const current = await capture(parent, config.protectedDirectory);
      if (current.digest !== previous.candidateDigest) throw new AgentPacketError(AGENT_PACKET_ERROR.DEPENDENCY);
      await verifyDependencies(parent, seen);
      seen.add(dependency);
    }
  };
  let busy = false;
  const run = async (operation) => {
    const packet = packets.get(operation);
    if (!packet) throw new AgentPacketError(AGENT_PACKET_ERROR.INVALID);
    if (busy) return result(operation, AGENT_PACKET_STATE.BLOCKED, AGENT_PACKET_ERROR.BUSY);
    busy = true;
    let snapshot = null;
    let failures = 0;
    try {
      await verifyProtected();
      const saved = await read(packet);
      failures = saved?.failures ?? 0;
      if (failures > AGENT_PACKET.MAX_CORRECTIONS) return result(operation, AGENT_PACKET_STATE.BLOCKED, AGENT_PACKET_ERROR.LIMIT, null, failures);
      await verifyDependencies(packet);
      snapshot = await capture(packet, config.protectedDirectory);
      const checks = [];
      for (const check of packet.checks) {
        let passed;
        try {
          passed = z.boolean().parse(await check.run(snapshot.sources));
        } catch {
          throw new AgentPacketError(AGENT_PACKET_ERROR.SETUP);
        }
        checks.push({ id: check.id, passed });
      }
      await verifyProtected();
      await verifyDependencies(packet);
      const current = await capture(packet, config.protectedDirectory);
      if (current.digest !== snapshot.digest) throw new AgentPacketError(AGENT_PACKET_ERROR.BOUNDARY);
      const passed = checks.every((check) => check.passed);
      if (!passed) failures += 1;
      const state = passed ? AGENT_PACKET_STATE.PASSED
        : failures > AGENT_PACKET.MAX_CORRECTIONS ? AGENT_PACKET_STATE.BLOCKED : AGENT_PACKET_STATE.FAILED;
      const progress = freezeProgress({ version: AGENT_PACKET.VERSION, kitDigest: config.manifest.artifactDigest,
        operation, state, candidateDigest: snapshot.digest, failures, checks });
      try {
        await config.writeProgress(progress);
      } catch {
        throw new AgentPacketError(AGENT_PACKET_ERROR.STORAGE);
      }
      return result(operation, state, passed ? null : state === AGENT_PACKET_STATE.BLOCKED
        ? AGENT_PACKET_ERROR.LIMIT : AGENT_PACKET_ERROR.CHECK, snapshot, failures, checks);
    } catch (error) {
      return result(operation, AGENT_PACKET_STATE.BLOCKED,
        error instanceof AgentPacketError ? error.code : AGENT_PACKET_ERROR.SETUP, snapshot, failures);
    } finally {
      busy = false;
    }
  };
  return Object.freeze({ run });
};
