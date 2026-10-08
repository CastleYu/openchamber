import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { AGENT_ADAPTER, AGENT_ARTIFACT, AGENT_ERROR } from './constants.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const portable = (name) => name.split('/').every((segment) => segment.length > 0
  && segment !== '.' && segment !== '..'
  && !/[\\:\u0000-\u001f<>"|?*]/.test(segment)
  && !/[. ]$/.test(segment)
  && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(segment));
const fileSchema = z.object({
  path: z.string().min(1).refine(portable),
  bytes: z.number().int().nonnegative().max(AGENT_ARTIFACT.MAX_FILE_BYTES), digest,
}).strict();
const filesSchema = z.array(fileSchema).min(1).max(AGENT_ARTIFACT.MAX_FILES)
  .refine((files) => new Set(files.map((file) => file.path.toLowerCase())).size === files.length)
  .refine((files) => files.reduce((total, file) => total + file.bytes, 0) <= AGENT_ARTIFACT.MAX_TOTAL_BYTES);
const manifestSchema = z.object({
  version: z.literal(AGENT_ARTIFACT.VERSION), artifactDigest: digest, files: filesSchema,
}).strict();

export class AgentArtifactError extends Error {
  constructor(code) {
    super(`Agent artifact refused: ${code}`);
    this.name = 'AgentArtifactError';
    this.code = code;
  }
}

const canonical = (files) => createHash('sha256').update(JSON.stringify([
  AGENT_ARTIFACT.VERSION,
  [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map((file) => [file.path, file.bytes, file.digest]),
])).digest('hex');

/** Candidate generation may compute a digest; only a protected manifest grants trust. */
export const agentArtifactDigest = (files) => {
  const parsed = filesSchema.safeParse(files);
  if (!parsed.success) throw new AgentArtifactError(AGENT_ERROR.INVALID_INPUT);
  return canonical(parsed.data);
};

/** Read-only verification of a dedicated artifact snapshot, never the live repository. */
const inspectArtifacts = async ({ directory, manifest }, capture = false) => {
  const input = manifestSchema.safeParse(manifest);
  const location = z.string().min(1).safeParse(directory);
  if (!input.success || !location.success) throw new AgentArtifactError(AGENT_ERROR.INVALID_INPUT);
  // Zod produced a detached copy before the first await.
  const expected = input.data;
  if (canonical(expected.files) !== expected.artifactDigest) throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_MISMATCH);
  const root = path.resolve(location.data);
  const files = new Map(expected.files.map((file) => [file.path, file]));
  if (capture && !files.has(AGENT_ADAPTER.ENTRY)) throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_UNAVAILABLE);
  const chunks = [];
  const directories = new Set();
  for (const name of files.keys()) {
    const segments = name.split('/');
    for (let index = 1; index < segments.length; index += 1) directories.add(segments.slice(0, index).join('/'));
  }
  const seen = new Set();
  try {
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_BOUNDARY);
    const realRoot = await fs.realpath(root);
    const visit = async (relative = '') => {
      const current = relative ? path.join(realRoot, ...relative.split('/')) : realRoot;
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink() || !portable(name)) throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_BOUNDARY);
        if (entry.isDirectory()) {
          if (!directories.has(name)) throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_BOUNDARY);
          await visit(name);
          continue;
        }
        const record = files.get(name);
        if (!entry.isFile() || !record) throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_BOUNDARY);
        const target = path.join(realRoot, ...name.split('/'));
        const stat = await fs.lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(target) !== target) {
          throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_BOUNDARY);
        }
        const handle = await fs.open(target, 'r');
        try {
          const before = await handle.stat();
          if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino) {
            throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_BOUNDARY);
          }
          if (before.size !== record.bytes) throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_MISMATCH);
          const hash = createHash('sha256');
          const buffer = Buffer.alloc(Math.min(record.bytes + 1, 65536));
          let bytes = 0;
          while (true) {
            const read = await handle.read(buffer, 0, Math.min(buffer.length, record.bytes - bytes + 1), null);
            if (read.bytesRead === 0) break;
            bytes += read.bytesRead;
            if (bytes > record.bytes) throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_MISMATCH);
            hash.update(buffer.subarray(0, read.bytesRead));
            if (capture && name === AGENT_ADAPTER.ENTRY) chunks.push(Buffer.from(buffer.subarray(0, read.bytesRead)));
          }
          const after = await handle.stat();
          if (bytes !== record.bytes || hash.digest('hex') !== record.digest
            || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
            throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_MISMATCH);
          }
          seen.add(name);
        } finally {
          await handle.close();
        }
      }
    };
    await visit();
    if (seen.size !== files.size) throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_UNAVAILABLE);
    return Object.freeze({ artifactDigest: expected.artifactDigest, files: seen.size,
      moduleURL: capture ? `data:text/javascript;base64,${Buffer.concat(chunks).toString('base64')}` : null });
  } catch (error) {
    if (error instanceof AgentArtifactError) throw error;
    throw new AgentArtifactError(AGENT_ERROR.ARTIFACT_UNAVAILABLE);
  }
};

export const verifyAgentArtifacts = async (options) => {
  const result = await inspectArtifacts(options);
  return Object.freeze({ artifactDigest: result.artifactDigest, files: result.files });
};

/** Captures only the fixed entry's verified bytes; import never reopens its source path. */
export const readAgentAdapterArtifact = async (options) => {
  const result = await inspectArtifacts(options, true);
  return Object.freeze({ artifactDigest: result.artifactDigest, moduleURL: result.moduleURL });
};
