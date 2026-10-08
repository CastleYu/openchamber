import { z } from 'zod';
import { AGENT_ERROR, AGENT_FAMILY, AGENT_HOST_OPERATION } from './constants.js';
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

/** Trusted process startup only. Never route these inputs through HTTP or adapter code. */
export const selectAgentStartup = async (host, input = { family: AGENT_FAMILY.OPENCODE }) => {
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
