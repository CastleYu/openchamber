import { z } from 'zod';
import { AGENT_ERROR, AGENT_FAMILY } from '../../../../web/server/lib/agent/constants.js';
import { extensionActionIDSchema } from '../../../../web/server/lib/agent/extensions.js';
import { agentPrincipalSchema } from '../../../../web/server/lib/agent/schemas.js';
import { AgentClientError } from './client';

const LIMIT = Object.freeze({ PREFIX: ':extension:', VERSION: 1, RECORD: 16384, ID: 1024, NAMESPACE: 128 } as const);
const ownerSchema = z.object({
  family: z.literal(AGENT_FAMILY.CAGENT), connectionID: z.string().min(1).max(LIMIT.ID),
  principalID: agentPrincipalSchema, workspaceID: z.string().min(1).max(LIMIT.ID).optional(),
  sessionID: z.string().min(1).max(LIMIT.ID).optional(),
}).strict().refine((owner) => owner.sessionID === undefined || owner.workspaceID !== undefined);
const pendingSchema = z.object({ actionID: extensionActionIDSchema, requestID: z.string().min(1).max(LIMIT.ID) }).strict();
const recordSchema = pendingSchema.extend({ version: z.literal(LIMIT.VERSION), owner: ownerSchema }).strict();
export type AgentExtensionOwner = Readonly<z.infer<typeof ownerSchema>>;
export type AgentExtensionPending = Readonly<z.infer<typeof pendingSchema>>;
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const invalid = (): AgentClientError => new AgentClientError(AGENT_ERROR.INVALID_INPUT);
const corrupt = (): AgentClientError => new AgentClientError(AGENT_ERROR.ATTEMPT_CORRUPT);
const storageFailure = (): AgentClientError => new AgentClientError(AGENT_ERROR.ATTEMPT_STORAGE);
const contextKey = (owner: AgentExtensionOwner): string => JSON.stringify([
  owner.family, owner.connectionID, owner.principalID, owner.workspaceID ?? null, owner.sessionID ?? null,
]);
const prefix = (namespace: string, owner: AgentExtensionOwner): string =>
  `${namespace}${LIMIT.PREFIX}${encodeURIComponent(contextKey(owner))}:`;
const keyFor = (namespace: string, owner: AgentExtensionOwner, pending: AgentExtensionPending): string =>
  `${prefix(namespace, owner)}${encodeURIComponent(pending.requestID)}`;

/** Durable action-specific extension request identities. */
export class AgentExtensionJournal {
  constructor(private readonly storage: StoragePort, private readonly namespace: string) {
    if (!z.string().min(1).max(LIMIT.NAMESPACE).safeParse(namespace).success) throw invalid();
  }

  private owner(input: AgentExtensionOwner): AgentExtensionOwner {
    const parsed = ownerSchema.safeParse(input);
    if (!parsed.success) throw invalid();
    return parsed.data;
  }

  private pending(input: AgentExtensionPending): AgentExtensionPending {
    const parsed = pendingSchema.safeParse(input);
    if (!parsed.success) throw invalid();
    return parsed.data;
  }

  private record(raw: string, key: string): z.infer<typeof recordSchema> {
    if (raw.length > LIMIT.RECORD) throw corrupt();
    let decoded: unknown;
    try { decoded = JSON.parse(raw); } catch { throw corrupt(); }
    const parsed = recordSchema.safeParse(decoded);
    if (!parsed.success || keyFor(this.namespace, parsed.data.owner, parsed.data) !== key) throw corrupt();
    return parsed.data;
  }

  read(input: AgentExtensionOwner): readonly AgentExtensionPending[] {
    const owner = this.owner(input);
    const start = prefix(this.namespace, owner);
    const result: AgentExtensionPending[] = [];
    try {
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);
        if (key === null || !key.startsWith(start)) continue;
        const raw = this.storage.getItem(key);
        if (raw === null) throw corrupt();
        const parsed = this.record(raw, key);
        result.push(Object.freeze({ actionID: parsed.actionID, requestID: parsed.requestID }));
      }
    } catch (error) {
      if (error instanceof AgentClientError) throw error;
      throw storageFailure();
    }
    return Object.freeze(result);
  }

  mark(ownerInput: AgentExtensionOwner, pendingInput: AgentExtensionPending): void {
    const owner = this.owner(ownerInput);
    const pending = this.pending(pendingInput);
    const key = keyFor(this.namespace, owner, pending);
    let raw: string | null;
    try { raw = this.storage.getItem(key); } catch { throw storageFailure(); }
    if (raw !== null) {
      this.record(raw, key);
      throw new AgentClientError(AGENT_ERROR.ATTEMPT_EXISTS);
    }
    const value = JSON.stringify({ version: LIMIT.VERSION, owner, ...pending });
    if (value.length > LIMIT.RECORD) throw invalid();
    try { this.storage.setItem(key, value); } catch { throw storageFailure(); }
  }

  clear(ownerInput: AgentExtensionOwner, pendingInput: AgentExtensionPending): void {
    const owner = this.owner(ownerInput);
    const pending = this.pending(pendingInput);
    const key = keyFor(this.namespace, owner, pending);
    let raw: string | null;
    try { raw = this.storage.getItem(key); } catch { throw storageFailure(); }
    if (raw === null) return;
    const record = this.record(raw, key);
    if (record.actionID !== pending.actionID) throw invalid();
    try { this.storage.removeItem(key); } catch { throw storageFailure(); }
  }
}
