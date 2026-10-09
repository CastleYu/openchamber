import {
  AGENT_ERROR, AGENT_FEATURE, AGENT_OPERATION,
} from '../../../../web/server/lib/agent/constants.js';
import type {
  AgentInputs, AgentMessage, AgentOperation, AgentSession, AgentStatus, DispatchReceipt,
} from '../../../../web/server/lib/agent/dispatcher.js';
import type { AgentFeature } from '../../../../web/server/lib/agent/features.js';
import { AgentClient, AgentClientError, type AgentClientSnapshot } from './client';
import { type AgentRequestJournal, type AgentRequestOwner } from './journal';

type Code = typeof AGENT_ERROR[keyof typeof AGENT_ERROR];
const AGENT_CONVERSATION = Object.freeze({
  UNBOUND: 'unbound', BOUND: 'bound', EMPTY: 'empty', LOADING: 'loading', READY: 'ready', FAILED: 'failed',
  IDLE: 'idle', SENDING: 'sending', ACCEPTED: 'accepted', COMPLETE: 'complete', UNKNOWN: 'unknown', NOT_SENT: 'not-sent',
  PAGE_SIZE: 100,
} as const);
type ConversationHistory = Readonly<{
  state: 'empty' | 'loading' | 'ready' | 'failed';
  items: readonly AgentMessage[];
  next?: string;
  error?: Code;
}>;
type ConversationWrite =
  | Readonly<{ state: 'idle' }>
  | Readonly<{ state: 'sending' | 'accepted' | 'complete' | 'unknown' | 'not-sent'; requestID: string; error?: Code }>;
type ConversationStatus =
  | Readonly<{ state: 'empty' }>
  | Readonly<{ state: 'ready'; value: AgentStatus }>
  | Readonly<{ state: 'failed'; error: Code; previous?: AgentStatus }>;
export type ConversationState =
  | Readonly<{ state: 'unbound' }>
  | Readonly<{ state: 'bound'; snapshot: AgentClientSnapshot; workspaceID: string;
      session: AgentSession; history: ConversationHistory; write: ConversationWrite; status: ConversationStatus }>;

const reconcile = (old: readonly AgentMessage[], incoming: readonly AgentMessage[]): AgentMessage[] => {
  const result = [...old];
  const positions = new Map(result.map((message, index) => [message.id, index]));
  for (const message of incoming) {
    const index = positions.get(message.id);
    if (index === undefined) {
      positions.set(message.id, result.length);
      result.push(message);
    } else result[index] = message;
  }
  return result;
};

/** Neutral conversation state. No directory, project, provider or timestamps are synthesized. */
export class AgentConversation {
  private value: ConversationState = Object.freeze({ state: AGENT_CONVERSATION.UNBOUND });
  private revision = 0;
  private loadRevision = 0;
  private statusRevision = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly requests = new Set<string>();
  private readonly writes = new Map<string, ConversationWrite>();
  private readonly cursors = new Set<string>();
  private readonly unsubscribe: () => void;

  constructor(private readonly client: AgentClient, private readonly journal?: AgentRequestJournal) {
    this.unsubscribe = client.subscribeRetirement(() => this.clear());
  }

  getSnapshot = (): ConversationState => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(value: ConversationState): void {
    this.value = Object.freeze(value);
    for (const listener of this.listeners) listener();
  }

  clear(): void {
    if (this.value.state === AGENT_CONVERSATION.BOUND && this.value.write.state === AGENT_CONVERSATION.SENDING) {
      this.writes.set(this.owner(this.value), Object.freeze({ state: AGENT_CONVERSATION.UNKNOWN, requestID: this.value.write.requestID }));
    }
    this.revision += 1;
    this.loadRevision += 1;
    this.statusRevision += 1;
    this.cursors.clear();
    this.publish({ state: AGENT_CONVERSATION.UNBOUND });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.clear();
    this.listeners.clear();
    this.writes.clear();
    this.requests.clear();
  }

  private bound(): Extract<ConversationState, { state: 'bound' }> {
    if (this.disposed || this.value.state !== AGENT_CONVERSATION.BOUND) throw new AgentClientError(AGENT_ERROR.CHANGED);
    return this.value;
  }

  private owner(current: Extract<ConversationState, { state: 'bound' }>): string {
    const identity = current.snapshot.scope.identity;
    return JSON.stringify([current.snapshot.scope.runtimeKey, identity.family, identity.connectionID, identity.principalID, current.workspaceID, current.session.id]);
  }

  private requestOwner(current: Extract<ConversationState, { state: 'bound' }>): AgentRequestOwner {
    const { family, connectionID, principalID } = current.snapshot.scope.identity;
    const owner = { family, connectionID, workspaceID: current.workspaceID, sessionID: current.session.id };
    return principalID ? { ...owner, principalID } : owner;
  }

  private write(current: Extract<ConversationState, { state: 'bound' }>, value: ConversationWrite): void {
    this.writes.set(this.owner(current), value);
    this.publish({ ...this.bound(), write: value });
  }

  private available(snapshot: AgentClientSnapshot, operation: AgentOperation, feature: AgentFeature): void {
    const action = snapshot.runtime.operations[operation];
    const support = snapshot.availability.features[feature];
    if (!action.available) throw new AgentClientError(action.reason);
    if (!support.available) throw new AgentClientError(support.reason);
  }

  async open(snapshot: AgentClientSnapshot, workspaceID: string, sessionID: string, signal?: AbortSignal): Promise<void> {
    if (this.disposed) throw new AgentClientError(AGENT_ERROR.CHANGED);
    this.clear();
    const revision = this.revision;
    this.available(snapshot, AGENT_OPERATION.GET_SESSION, AGENT_FEATURE.ACQUIRE_SESSION);
    const session = await this.client.dispatch(snapshot.scope, AGENT_OPERATION.GET_SESSION, { workspaceID, sessionID }, signal);
    if (revision !== this.revision) throw new AgentClientError(AGENT_ERROR.CHANGED);
    if (session.id !== sessionID || session.workspaceID !== workspaceID) throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
    const bound = { state: AGENT_CONVERSATION.BOUND, snapshot, workspaceID, session,
      history: Object.freeze({ state: AGENT_CONVERSATION.EMPTY, items: Object.freeze([]) }),
      status: Object.freeze({ state: AGENT_CONVERSATION.EMPTY }),
      write: Object.freeze({ state: AGENT_CONVERSATION.IDLE }) };
    const pending = this.journal?.read(this.requestOwner(bound))[0];
    this.publish({ ...bound, write: pending
      ? Object.freeze({ state: AGENT_CONVERSATION.UNKNOWN, requestID: pending })
      : this.writes.get(this.owner(bound)) ?? bound.write });
  }

  /** Explicit refresh only. Historical messages never imply live execution. */
  async status(signal?: AbortSignal): Promise<AgentStatus> {
    const current = this.bound();
    this.available(current.snapshot, AGENT_OPERATION.GET_SESSION_STATUS, AGENT_FEATURE.PROMPT);
    const revision = this.revision;
    const read = ++this.statusRevision;
    try {
      const value = await this.client.dispatch(current.snapshot.scope, AGENT_OPERATION.GET_SESSION_STATUS,
        { workspaceID: current.workspaceID, sessionID: current.session.id }, signal);
      if (revision !== this.revision || read !== this.statusRevision) throw new AgentClientError(AGENT_ERROR.CHANGED);
      if (value.sessionID !== current.session.id) throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
      this.publish({ ...this.bound(), status: Object.freeze({ state: AGENT_CONVERSATION.READY, value }) });
      return value;
    } catch (error) {
      if (revision === this.revision && read === this.statusRevision) {
        const old = this.bound().status;
        this.publish({ ...this.bound(), status: Object.freeze({ state: AGENT_CONVERSATION.FAILED,
          error: error instanceof AgentClientError ? error.code : AGENT_ERROR.BACKEND_FAILED,
          previous: old.state === AGENT_CONVERSATION.READY ? old.value : old.state === AGENT_CONVERSATION.FAILED ? old.previous : undefined }) });
      }
      throw error;
    }
  }

  /** Explicit refresh only. Historical messages never imply live execution. */
  async history(more = false, signal?: AbortSignal): Promise<void> {
    const current = this.bound();
    this.available(current.snapshot, AGENT_OPERATION.LIST_MESSAGES, AGENT_FEATURE.HISTORY);
    if (more && !current.history.next) return;
    const cursor = more ? current.history.next : undefined;
    if (cursor && this.cursors.has(cursor)) throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
    const revision = this.revision;
    const load = ++this.loadRevision;
    this.publish({ ...current, history: Object.freeze({ ...current.history, state: AGENT_CONVERSATION.LOADING, error: undefined }) });
    try {
      const input: AgentInputs[typeof AGENT_OPERATION.LIST_MESSAGES] = {
        workspaceID: current.workspaceID, sessionID: current.session.id, limit: AGENT_CONVERSATION.PAGE_SIZE,
      };
      if (cursor) input.cursor = cursor;
      const page = await this.client.dispatch(current.snapshot.scope, AGENT_OPERATION.LIST_MESSAGES, input, signal);
      if (revision !== this.revision || load !== this.loadRevision) throw new AgentClientError(AGENT_ERROR.CHANGED);
      if (page.items.some((message) => message.sessionID !== current.session.id)
        || new Set(page.items.map((message) => message.id)).size !== page.items.length
        || (more && page.next && (page.next === cursor || this.cursors.has(page.next)))) throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
      if (!more) this.cursors.clear();
      if (cursor) this.cursors.add(cursor);
      // Pages are partial: retain previously loaded records, never infer deletion.
      const ids = new Set(page.items.map((message) => message.id));
      const items = more ? reconcile(this.bound().history.items, page.items)
        : reconcile(page.items, this.bound().history.items.filter((message) => !ids.has(message.id)));
      const history = { state: AGENT_CONVERSATION.READY, items: Object.freeze(items), next: page.next };
      this.publish({ ...this.bound(), history: Object.freeze(history) });
    } catch (error) {
      if (revision === this.revision && load === this.loadRevision) {
        this.publish({ ...this.bound(), history: Object.freeze({ ...this.bound().history,
          state: AGENT_CONVERSATION.FAILED, error: error instanceof AgentClientError ? error.code : AGENT_ERROR.BACKEND_FAILED }) });
      }
      throw error;
    }
  }

  async send(requestID: string, text: string, signal?: AbortSignal): Promise<DispatchReceipt> {
    const current = this.bound();
    this.available(current.snapshot, AGENT_OPERATION.SEND_PROMPT, AGENT_FEATURE.PROMPT);
    if (current.write.state === AGENT_CONVERSATION.SENDING || current.write.state === AGENT_CONVERSATION.UNKNOWN) {
      throw new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME);
    }
    const identity = current.snapshot.scope.identity;
    const owner = this.requestOwner(current);
    if (this.journal?.read(owner).length) throw new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME);
    const key = JSON.stringify([current.snapshot.scope.runtimeKey, identity.family, identity.connectionID, identity.principalID, requestID]);
    if (this.requests.has(key)) throw new AgentClientError(AGENT_ERROR.ATTEMPT_EXISTS);
    this.journal?.mark(owner, requestID);
    this.requests.add(key);
    const revision = this.revision;
    this.loadRevision += 1;
    if (current.history.state === AGENT_CONVERSATION.LOADING) {
      this.publish({ ...current, history: Object.freeze({ ...current.history,
        state: current.history.items.length ? AGENT_CONVERSATION.READY : AGENT_CONVERSATION.EMPTY }) });
    }
    this.write(current, Object.freeze({ state: AGENT_CONVERSATION.SENDING, requestID }));
    try {
      const receipt = await this.client.dispatch(current.snapshot.scope, AGENT_OPERATION.SEND_PROMPT,
        { workspaceID: current.workspaceID, sessionID: current.session.id, requestID, text }, signal);
      if (receipt.requestID !== requestID) throw new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME);
      if (receipt.state !== AGENT_CONVERSATION.UNKNOWN) {
        try { this.journal?.clear(owner, requestID); }
        catch { throw new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME); }
      }
      if (revision === this.revision) {
        this.write(current, Object.freeze({ state: receipt.state, requestID }));
      }
      return receipt;
    } catch (error) {
      let code = error instanceof AgentClientError ? error.code : AGENT_ERROR.BACKEND_FAILED;
      // A host duplicate proves a prior attempt exists, not that it was unsent.
      if (code === AGENT_ERROR.ATTEMPT_EXISTS) code = AGENT_ERROR.UNKNOWN_OUTCOME;
      if (code !== AGENT_ERROR.UNKNOWN_OUTCOME) {
        try { this.journal?.clear(owner, requestID); }
        catch { code = AGENT_ERROR.UNKNOWN_OUTCOME; }
      }
      if (revision === this.revision) {
        this.write(current, Object.freeze({ state: code === AGENT_ERROR.UNKNOWN_OUTCOME
          ? AGENT_CONVERSATION.UNKNOWN : AGENT_CONVERSATION.NOT_SENT, requestID, error: code }));
      }
      throw new AgentClientError(code);
    }
  }

  async resolve(signal?: AbortSignal): Promise<void> {
    const current = this.bound();
    if (current.write.state !== AGENT_CONVERSATION.UNKNOWN && current.write.state !== AGENT_CONVERSATION.ACCEPTED) return;
    const revision = this.revision;
    const { requestID } = current.write;
    const attempt = await this.client.readAttempt(current.snapshot.scope, requestID, signal);
    if (revision !== this.revision) throw new AgentClientError(AGENT_ERROR.CHANGED);
    const latest = this.bound().write;
    if (latest.state === AGENT_CONVERSATION.IDLE || latest.requestID !== requestID) throw new AgentClientError(AGENT_ERROR.CHANGED);
    if (!attempt) return; // Missing ledger evidence never resolves an uncertain entered write.
    if (attempt.operation !== AGENT_OPERATION.SEND_PROMPT) throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
    if (latest.state === AGENT_CONVERSATION.ACCEPTED && attempt.state === AGENT_CONVERSATION.UNKNOWN) return;
    if (latest.state === AGENT_CONVERSATION.ACCEPTED && attempt.state === AGENT_CONVERSATION.NOT_SENT) {
      throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
    }
    if (attempt.state !== AGENT_CONVERSATION.UNKNOWN) this.journal?.clear(this.requestOwner(current), requestID);
    const pending = this.journal?.read(this.requestOwner(current))[0];
    this.write(current, Object.freeze(pending
      ? { state: AGENT_CONVERSATION.UNKNOWN, requestID: pending }
      : { state: attempt.state, requestID }));
  }
}
