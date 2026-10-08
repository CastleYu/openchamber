import { z } from 'zod';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_HOST_OPERATION } from './constants.js';
import { createAgentAuthority } from './authority.js';
import { AgentDispatchError, createAgentDispatcher } from './dispatcher.js';
import { createAgentFeatures } from './features.js';
import { loadAgentAdapter } from './loader.js';
import { agentAdapterProfileSchema, agentHostConnectionSchema } from './schemas.js';
import { createAgentTransport } from './transport.js';

const refuse = (code) => new AgentDispatchError(code, AGENT_HOST_OPERATION.GET_BINDING);

/** Protected host selection only. Never expose maintenance ports to candidate code or HTTP. */
export const createAgentHost = ({ getAcceptance, attempts, getHostSupport }) => {
  if (!z.function().safeParse(getAcceptance).success) throw refuse(AGENT_ERROR.INVALID_INPUT);
  let epoch = 0;
  let active = null;
  let lifetime = new AbortController();
  let family = AGENT_FAMILY.OPENCODE;
  let selection = Object.freeze({ family, revision: epoch });
  const getSelection = () => selection;
  const clear = () => {
    epoch += 1;
    active = null;
    selection = Object.freeze({ family, revision: epoch });
    lifetime.abort();
    lifetime = new AbortController();
  };
  const selectOpenCode = () => {
    family = AGENT_FAMILY.OPENCODE;
    clear();
  };
  const dispatcher = createAgentDispatcher({ getBinding: () => active?.authority.getBinding() ?? null, attempts });
  const features = createAgentFeatures({ getRuntime: dispatcher.describeRuntime, getHostSupport });
  const select = async ({ directory, manifest, profile, connection }) => {
    const location = z.string().min(1).safeParse(directory);
    const adapter = agentAdapterProfileSchema.safeParse(profile);
    const endpoint = agentHostConnectionSchema.safeParse(connection);
    if (!location.success || !adapter.success || !endpoint.success) throw refuse(AGENT_ERROR.INVALID_INPUT);
    // Retire the previous binding before loading. An explicit failed switch stays closed.
    family = AGENT_FAMILY.CAGENT;
    clear();
    const ticket = epoch;
    const selected = adapter.data;
    const current = endpoint.data;
    const identity = Object.freeze({
      family: selected.family, connectionID: current.connectionID, epoch: ticket,
      adapterRevision: selected.adapterRevision, capabilityRevision: selected.capabilityRevision,
    });
    // A factory port expires with its own selection, even when revisions are reused.
    const transport = createAgentTransport({
      getConnection: () => ticket === epoch ? active?.connection ?? null : null,
      selectionSignal: lifetime.signal,
    });
    const registration = await loadAgentAdapter({
      directory: location.data, manifest, profile: selected, transport,
    });
    if (ticket !== epoch) throw refuse(AGENT_ERROR.CHANGED);
    const selection = Object.freeze({
      ...identity, adapterID: selected.adapterID, serverRevision: current.serverRevision,
      ready: current.ready, authorized: current.authorized,
    });
    const authority = createAgentAuthority({
      registrations: [registration], getSelection: () => selection, getAcceptance,
    });
    active = Object.freeze({
      authority,
      connection: Object.freeze({
        identity, baseURL: current.baseURL, headers: Object.freeze(current.headers),
        ready: current.ready, authorized: current.authorized,
      }),
    });
    return identity;
  };
  return Object.freeze({ select, selectOpenCode, getSelection, clear, dispatcher, features });
};
