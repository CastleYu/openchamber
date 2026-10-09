import { AGENT_ERROR, AGENT_FAMILY } from '../../../../web/server/lib/agent/constants.js';
import { getRuntimeKey } from '../runtime-switch';
import { AgentClient, AgentClientError, type AgentClientSnapshot } from './client';
import { AgentConversation } from './conversation';
import { AgentRequestJournal } from './journal';

export type AgentChatBinding = Readonly<{
  client: AgentClient; snapshot: AgentClientSnapshot; conversation: AgentConversation; dispose(): void;
}>;
/** The host principal scopes recovery independently of rotated credentials. */
export async function createAgentChatBinding(): Promise<AgentChatBinding> {
  const client = new AgentClient();
  let retired = false;
  const unsubscribe = client.subscribeRetirement(() => { retired = true; });
  try {
    const runtimeKey = getRuntimeKey();
    const snapshot = await client.inspect();
    const principal = snapshot.scope.identity.principalID;
    if (!principal) throw new AgentClientError(AGENT_ERROR.UNAUTHORIZED);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([runtimeKey, principal])));
    const namespace = `agent-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    if (retired || snapshot.scope.runtimeKey !== runtimeKey || getRuntimeKey() !== runtimeKey) throw new AgentClientError(AGENT_ERROR.CHANGED);
    if (snapshot.scope.identity.family !== AGENT_FAMILY.CAGENT) throw new AgentClientError(AGENT_ERROR.CHANGED);
    const journal = new AgentRequestJournal(localStorage, namespace);
    const conversation = new AgentConversation(client, journal);
    return Object.freeze({ client, snapshot, conversation, dispose: () => { conversation.dispose(); client.dispose(); } });
  } catch (error) {
    client.dispose();
    throw error instanceof AgentClientError ? error : new AgentClientError(AGENT_ERROR.ATTEMPT_STORAGE);
  } finally {
    unsubscribe();
  }
}
