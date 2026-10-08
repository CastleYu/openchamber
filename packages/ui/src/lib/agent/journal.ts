import { z } from 'zod';
import { AGENT_ERROR, AGENT_FAMILY } from '../../../../web/server/lib/agent/constants.js';
import { AgentClientError } from './client';

const JOURNAL = Object.freeze({ PREFIX: ':request:', VERSION: 1, MAX_RECORD: 16384, MAX_ID: 1024, MAX_NAMESPACE: 128 } as const);
const ownerSchema = z.object({
  family: z.enum([AGENT_FAMILY.OPENCODE, AGENT_FAMILY.CAGENT]), connectionID: z.string().min(1).max(JOURNAL.MAX_ID),
  workspaceID: z.string().min(1).max(JOURNAL.MAX_ID), sessionID: z.string().min(1).max(JOURNAL.MAX_ID),
}).strict();
const recordSchema = z.object({
  version: z.literal(JOURNAL.VERSION), owner: ownerSchema, requestID: z.string().min(1).max(JOURNAL.MAX_ID),
}).strict();
export type AgentRequestOwner = Readonly<z.infer<typeof ownerSchema>>;
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const ownerKey = (owner: AgentRequestOwner): string => JSON.stringify([
  owner.family, owner.connectionID, owner.workspaceID, owner.sessionID,
]);
const ownerPrefix = (namespace: string, owner: AgentRequestOwner): string =>
  `${namespace}${JOURNAL.PREFIX}${encodeURIComponent(ownerKey(owner))}:`;
const requestKey = (namespace: string, owner: AgentRequestOwner, requestID: string): string =>
  `${ownerPrefix(namespace, owner)}${encodeURIComponent(requestID)}`;
const invalid = (): AgentClientError => new AgentClientError(AGENT_ERROR.INVALID_INPUT);
const corrupt = (): AgentClientError => new AgentClientError(AGENT_ERROR.ATTEMPT_CORRUPT);
const storageError = (): AgentClientError => new AgentClientError(AGENT_ERROR.ATTEMPT_STORAGE);

/** Durable unresolved request identities, scoped to one opaque runtime namespace. */
export class AgentRequestJournal {
  constructor(private readonly storage: StoragePort, private readonly namespace: string) {
    const parsed = z.string().min(1).max(JOURNAL.MAX_NAMESPACE).safeParse(namespace);
    if (!parsed.success) throw invalid();
  }

  private owner(input: AgentRequestOwner): AgentRequestOwner {
    const parsed = ownerSchema.safeParse(input);
    if (!parsed.success) throw invalid();
    return parsed.data;
  }

  private id(input: string): string {
    const parsed = z.string().min(1).max(JOURNAL.MAX_ID).safeParse(input);
    if (!parsed.success) throw invalid();
    return parsed.data;
  }

  private entries(owner: AgentRequestOwner): readonly string[] {
    const prefix = ownerPrefix(this.namespace, owner);
    const result: string[] = [];
    try {
      for (let index = 0; index < this.storage.length; index += 1) {
        const key = this.storage.key(index);
        if (key === null || !key.startsWith(prefix)) continue;
        const raw = this.storage.getItem(key);
        if (raw === null) throw corrupt();
        if (raw.length > JOURNAL.MAX_RECORD) throw corrupt();
        let decoded: unknown;
        try { decoded = JSON.parse(raw); } catch { throw corrupt(); }
        const parsed = recordSchema.safeParse(decoded);
        if (!parsed.success || requestKey(this.namespace, parsed.data.owner, parsed.data.requestID) !== key) throw corrupt();
        result.push(parsed.data.requestID);
      }
    } catch (error) {
      if (error instanceof AgentClientError) throw error;
      throw storageError();
    }
    return Object.freeze(result);
  }

  read(owner: AgentRequestOwner): readonly string[] {
    return this.entries(this.owner(owner));
  }

  mark(owner: AgentRequestOwner, requestID: string): void {
    const validOwner = this.owner(owner);
    const id = this.id(requestID);
    const key = requestKey(this.namespace, validOwner, id);
    let existing: string | null;
    try { existing = this.storage.getItem(key); } catch { throw storageError(); }
    if (existing !== null) {
      if (existing.length > JOURNAL.MAX_RECORD) throw corrupt();
      let decoded: unknown;
      try { decoded = JSON.parse(existing); } catch { throw corrupt(); }
      const parsed = recordSchema.safeParse(decoded);
      if (!parsed.success || requestKey(this.namespace, parsed.data.owner, parsed.data.requestID) !== key) throw corrupt();
      throw new AgentClientError(AGENT_ERROR.ATTEMPT_EXISTS);
    }
    const record = JSON.stringify({ version: JOURNAL.VERSION, owner: validOwner, requestID: id });
    if (record.length > JOURNAL.MAX_RECORD) throw invalid();
    try { this.storage.setItem(key, record); } catch { throw storageError(); }
  }

  clear(owner: AgentRequestOwner, requestID: string): void {
    const validOwner = this.owner(owner);
    const id = this.id(requestID);
    const key = requestKey(this.namespace, validOwner, id);
    let raw: string | null;
    try { raw = this.storage.getItem(key); } catch { throw storageError(); }
    if (raw === null) return;
    if (raw.length > JOURNAL.MAX_RECORD) throw corrupt();
    let decoded: unknown;
    try { decoded = JSON.parse(raw); } catch { throw corrupt(); }
    const parsed = recordSchema.safeParse(decoded);
    if (!parsed.success || requestKey(this.namespace, parsed.data.owner, parsed.data.requestID) !== key) throw corrupt();
    try { this.storage.removeItem(key); } catch { throw storageError(); }
  }
}
