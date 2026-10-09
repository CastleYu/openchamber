import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { AGENT_ERROR, AGENT_FAMILY, AGENT_HOST_OPERATION, AGENT_STARTUP } from './constants.js';
import { agentArtifactManifestSchema } from './artifacts.js';
import { AgentDispatchError } from './dispatcher.js';
import { agentAdapterProfileSchema, agentHostConnectionSchema } from './schemas.js';

const selectionSchema = z.discriminatedUnion('family', [
  z.object({ family: z.literal(AGENT_FAMILY.OPENCODE) }).strict(),
  z.object({
    family: z.literal(AGENT_FAMILY.CAGENT),
    candidate: z.object({
      directory: z.string().min(1), manifest: agentArtifactManifestSchema,
      profile: agentAdapterProfileSchema, connection: agentHostConnectionSchema,
    }).strict(),
  }).strict(),
]);

const readStartup = async (file) => {
  const parsed = z.string().min(1).refine(path.isAbsolute).safeParse(file);
  if (!parsed.success) throw new Error();
  const target = path.resolve(parsed.data);
  if (await fs.realpath(target) !== target) throw new Error();
  const before = await fs.lstat(target);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > AGENT_STARTUP.MAX_BYTES) throw new Error();
  const handle = await fs.open(target, AGENT_STARTUP.READ);
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
      || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) throw new Error();
    const bytes = Buffer.alloc(AGENT_STARTUP.MAX_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const after = await handle.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs) throw new Error();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)));
  } finally { await handle.close(); }
};

/** Trusted process startup only. Never route these inputs through HTTP or adapter code. */
export const selectAgentStartup = async (host, input, file) => {
  if (file !== undefined) {
    try {
      if (input !== undefined) throw new Error();
      input = await readStartup(file);
    } catch { throw new AgentDispatchError(AGENT_ERROR.INVALID_INPUT, AGENT_HOST_OPERATION.GET_BINDING); }
  }
  if (input === undefined) input = { family: AGENT_FAMILY.OPENCODE };
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) throw new AgentDispatchError(AGENT_ERROR.INVALID_INPUT, AGENT_HOST_OPERATION.GET_BINDING);
  if (parsed.data.family === AGENT_FAMILY.OPENCODE) {
    host.selectOpenCode();
    return null;
  }
  return host.select(parsed.data.candidate);
};

/** Delay persisted OpenCode work until explicit startup selection, and detach on retirement. */
export const startOpenCodeConsumers = ({ host, startPermissions, startQueue }) => {
  if (host.getSelection().family !== AGENT_FAMILY.OPENCODE) return () => {};
  const signal = host.getSelectionSignal();
  if (signal.aborted) return () => {};
  const stopPermissions = startPermissions();
  let stopQueue;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal.removeEventListener('abort', stop);
    try { stopPermissions(); }
    finally { stopQueue?.(); }
  };
  if (signal.aborted) { stop(); return stop; }
  try { stopQueue = startQueue(); }
  catch (error) { stop(); throw error; }
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  return stop;
};
