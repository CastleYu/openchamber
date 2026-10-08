import { AGENT_ERROR, AGENT_FAMILY } from '../../../../web/server/lib/agent/constants.js';
import { getRuntimeBearerTokenSync, getRuntimeExtraHeadersSync } from '../runtime-auth';
import { getRuntimeKey } from '../runtime-switch';
import { AgentClient, AgentClientError, type AgentClientSnapshot } from './client';
import { AgentConversation } from './conversation';
import { AgentRequestJournal } from './journal';

export type AgentChatBinding = Readonly<{
  client: AgentClient; snapshot: AgentClientSnapshot; conversation: AgentConversation; dispose(): void;
}>;

const authScope = (): string => JSON.stringify([
  getRuntimeBearerTokenSync(), Object.entries(getRuntimeExtraHeadersSync()).sort(([left], [right]) => left.localeCompare(right)),
]);

/** Secrets are input to the digest in memory only, never stored or returned. */
export async function createAgentChatBinding(): Promise<AgentChatBinding> {
  const client = new AgentClient();
  try {
    const runtimeKey = getRuntimeKey();
    const auth = authScope();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([runtimeKey, auth])));
    const namespace = `agent-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const snapshot = await client.inspect();
    if (snapshot.scope.runtimeKey !== runtimeKey || authScope() !== auth) throw new AgentClientError(AGENT_ERROR.CHANGED);
    if (snapshot.scope.identity.family !== AGENT_FAMILY.CAGENT) throw new AgentClientError(AGENT_ERROR.CHANGED);
    const journal = new AgentRequestJournal(localStorage, namespace);
    const conversation = new AgentConversation(client, journal);
    return Object.freeze({ client, snapshot, conversation, dispose: () => { conversation.dispose(); client.dispose(); } });
  } catch (error) {
    client.dispose();
    throw error instanceof AgentClientError ? error : new AgentClientError(AGENT_ERROR.ATTEMPT_STORAGE);
  }
}
