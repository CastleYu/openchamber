import { z } from 'zod';
import { AGENT_ATTEMPT, AGENT_ERROR, AGENT_EXTENSION, AGENT_FAMILY } from '../../../../web/server/lib/agent/constants.js';
import type { JsonValue } from '../../../../web/server/lib/agent/dispatcher.js';
import type { AgentExtensionReceipt, AgentExtensionSnapshot } from '../../../../web/server/lib/agent/extension-runtime.js';
import type { ExtensionManifest, ExtensionResult } from '../../../../web/server/lib/agent/extensions.js';
import { parseExtensionInput } from '../../../../web/server/lib/agent/extensions.js';
import { AgentClient, AgentClientError, type AgentClientSnapshot } from './client';
import { AgentExtensionJournal, type AgentExtensionOwner, type AgentExtensionPending } from './extension-journal';

type Code = typeof AGENT_ERROR[keyof typeof AGENT_ERROR];
const STATE = Object.freeze({ EMPTY: 'empty', LOADING: 'loading', READY: 'ready', FAILED: 'failed',
  RETIRED: 'retired', IDLE: 'idle', RUNNING: 'running' } as const);
const contextSchema = z.object({ workspaceID: z.string().min(1).max(1024).optional(),
  sessionID: z.string().min(1).max(1024).optional() }).strict()
  .refine((context) => !context.sessionID || Boolean(context.workspaceID));
export type AgentExtensionContext = Readonly<{ workspaceID?: string; sessionID?: string }>;
type Recovery = Readonly<{ owner: AgentExtensionOwner; pending: AgentExtensionPending }>;
type ReadyState = Readonly<{
  state: 'ready'; context: AgentExtensionContext; actions: AgentExtensionSnapshot['actions'];
  pending: readonly AgentExtensionPending[];
  task: Readonly<{ state: 'idle' }> | Readonly<{ state: 'running'; actionID: string }>;
  result: Readonly<{ actionID: string; result: ExtensionResult; receipt?: AgentExtensionReceipt }> | null;
  error: Code | null;
  catalogError: Code | null;
}>;
export type AgentExtensionsState = Readonly<{ state: 'empty' | 'loading' | 'retired' }>
  | Readonly<{ state: 'failed'; error: Code }> | ReadyState;

/** Finite actions and durable intent. Only host evidence resolves uncertain writes. */
export class AgentExtensions {
  private value: AgentExtensionsState = Object.freeze({ state: STATE.EMPTY });
  private revision = 0;
  private disposed = false;
  private recovery: readonly Recovery[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(private readonly client: AgentClient, private readonly snapshot: AgentClientSnapshot,
    private readonly journal: AgentExtensionJournal) {
    this.unsubscribe = client.subscribeRetirement(() => this.retire());
  }

  getSnapshot = (): AgentExtensionsState => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(value: AgentExtensionsState): void {
    this.value = Object.freeze(value);
    for (const listener of this.listeners) listener();
  }

  private retire(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;
    this.recovery = [];
    this.publish({ state: STATE.RETIRED });
  }

  dispose(): void {
    this.unsubscribe();
    this.retire();
    this.listeners.clear();
  }

  private ready(): ReadyState {
    if (this.disposed) throw new AgentClientError(AGENT_ERROR.CHANGED);
    if (this.value.state !== STATE.READY) throw new AgentClientError(AGENT_ERROR.UNAVAILABLE);
    return this.value;
  }

  private idle(): ReadyState {
    const current = this.ready();
    if (current.task.state !== STATE.IDLE) throw new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME);
    return current;
  }

  private owner(context: AgentExtensionContext): AgentExtensionOwner {
    const identity = this.snapshot.scope.identity;
    if (identity.family !== AGENT_FAMILY.CAGENT || !identity.principalID) throw new AgentClientError(AGENT_ERROR.UNAUTHORIZED);
    return Object.freeze({ family: AGENT_FAMILY.CAGENT, connectionID: identity.connectionID,
      principalID: identity.principalID, ...context });
  }

  private read(context: AgentExtensionContext): readonly AgentExtensionPending[] {
    const contexts: AgentExtensionContext[] = [context];
    if (context.workspaceID) contexts.push({});
    if (context.sessionID) contexts.push({ workspaceID: context.workspaceID });
    const recovery = contexts.flatMap((item) => {
      const owner = this.owner(item);
      return this.journal.read(owner).map((pending) => Object.freeze({ owner, pending }));
    });
    if (new Set(recovery.map((item) => item.pending.requestID)).size !== recovery.length) {
      throw new AgentClientError(AGENT_ERROR.ATTEMPT_CORRUPT);
    }
    this.recovery = Object.freeze(recovery);
    return Object.freeze(recovery.map((item) => item.pending));
  }

  async open(context: AgentExtensionContext = {}): Promise<void> {
    if (this.disposed) throw new AgentClientError(AGENT_ERROR.CHANGED);
    const parsed = contextSchema.safeParse(context);
    if (!parsed.success) throw new AgentClientError(AGENT_ERROR.INVALID_INPUT);
    const revision = ++this.revision;
    const captured = Object.freeze(parsed.data);
    this.publish({ state: STATE.LOADING });
    try {
      const pending = this.read(captured);
      const catalog = await this.client.extensions(this.snapshot.scope);
      if (revision !== this.revision || this.disposed) throw new AgentClientError(AGENT_ERROR.CHANGED);
      this.publish({ state: STATE.READY, context: captured, actions: catalog.actions, pending,
        task: { state: STATE.IDLE }, result: null, error: null, catalogError: null });
    } catch (error) {
      if (revision === this.revision && !this.disposed) {
        this.publish({ state: STATE.FAILED, error: error instanceof AgentClientError ? error.code : AGENT_ERROR.BACKEND_FAILED });
      }
      throw error;
    }
  }

  async refresh(): Promise<void> {
    const current = this.idle();
    const revision = this.revision;
    this.publish({ ...current, task: { state: STATE.RUNNING, actionID: '' } });
    try {
      const pending = this.read(current.context);
      const catalog = await this.client.extensions(this.snapshot.scope);
      if (revision !== this.revision || this.disposed) throw new AgentClientError(AGENT_ERROR.CHANGED);
      this.publish({ ...current, actions: catalog.actions, pending, task: { state: STATE.IDLE }, error: null, catalogError: null });
    } catch (error) {
      const code = error instanceof AgentClientError ? error.code : AGENT_ERROR.BACKEND_FAILED;
      if (revision === this.revision && !this.disposed) this.publish({ ...current,
        task: { state: STATE.IDLE }, error: code, catalogError: code });
      throw error;
    }
  }

  private context(manifest: ExtensionManifest, context: AgentExtensionContext): AgentExtensionContext {
    if (!manifest.context.workspace) return {};
    const workspaceID = context.workspaceID;
    if (!workspaceID) throw new AgentClientError(AGENT_ERROR.INVALID_INPUT);
    if (!manifest.context.session) return { workspaceID };
    const sessionID = context.sessionID;
    if (!sessionID) throw new AgentClientError(AGENT_ERROR.INVALID_INPUT);
    return { workspaceID, sessionID };
  }

  async run(actionID: string, values: JsonValue, requestID?: string): Promise<void> {
    const current = this.idle();
    if (current.catalogError) throw new AgentClientError(current.catalogError);
    const row = current.actions.find((item) => item.manifest.actionID === actionID);
    if (!row) throw new AgentClientError(AGENT_ERROR.UNKNOWN_OPERATION);
    if (!row.availability.available) throw new AgentClientError(row.availability.reason);
    const mutation = row.manifest.effect === AGENT_EXTENSION.EFFECT.MUTATION;
    if (mutation !== Boolean(requestID)) throw new AgentClientError(AGENT_ERROR.INVALID_INPUT);
    try { parseExtensionInput(row.manifest, values); }
    catch { throw new AgentClientError(AGENT_ERROR.INVALID_INPUT); }
    const context = this.context(row.manifest, current.context);
    const owner = this.owner(context);
    const pending = this.read(current.context);
    if (mutation && pending.length) throw new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME);
    const intent = requestID ? Object.freeze({ actionID, requestID }) : null;
    if (intent) this.journal.mark(owner, intent);
    const revision = this.revision;
    const marked = intent ? Object.freeze([...pending, intent]) : pending;
    this.publish({ ...current, pending: marked, task: { state: STATE.RUNNING, actionID }, error: null });
    try {
      const input = { ...context, values, requestID };
      const response = await this.client.dispatchExtension(this.snapshot.scope, row.manifest, input);
      if (intent) {
        try { this.journal.clear(owner, intent); }
        catch { throw new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME); }
      }
      if (revision !== this.revision || this.disposed) throw new AgentClientError(AGENT_ERROR.CHANGED);
      const result = { actionID, result: response.result, receipt: response.receipt };
      this.publish({ ...current, pending: this.read(current.context), task: { state: STATE.IDLE }, result, error: null });
    } catch (error) {
      let code = error instanceof AgentClientError ? error.code : mutation ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.BACKEND_FAILED;
      if (intent) {
        if (code === AGENT_ERROR.ATTEMPT_EXISTS) code = AGENT_ERROR.UNKNOWN_OUTCOME;
        if (code !== AGENT_ERROR.UNKNOWN_OUTCOME) {
          try { this.journal.clear(owner, intent); } catch { code = AGENT_ERROR.UNKNOWN_OUTCOME; }
        }
      }
      if (revision === this.revision && !this.disposed) {
        let restored = this.value.state === STATE.READY ? this.value.pending : pending;
        try { restored = this.read(current.context); } catch { code = AGENT_ERROR.ATTEMPT_STORAGE; }
        this.publish({ ...current, pending: restored, task: { state: STATE.IDLE }, error: code });
      }
      throw new AgentClientError(code);
    }
  }

  async resolve(requestID: string): Promise<void> {
    const current = this.idle();
    this.read(current.context);
    const recovery = this.recovery.find((item) => item.pending.requestID === requestID);
    if (!recovery) throw new AgentClientError(AGENT_ERROR.INVALID_INPUT);
    const revision = this.revision;
    this.publish({ ...current, task: { state: STATE.RUNNING, actionID: recovery.pending.actionID } });
    try {
      const attempt = await this.client.readAttempt(this.snapshot.scope, requestID);
      if (revision !== this.revision || this.disposed) throw new AgentClientError(AGENT_ERROR.CHANGED);
      if (!attempt || attempt.state === AGENT_ATTEMPT.UNKNOWN) throw new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME);
      if (attempt.operation !== recovery.pending.actionID) throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
      this.journal.clear(recovery.owner, recovery.pending);
      this.publish({ ...current, pending: this.read(current.context), task: { state: STATE.IDLE }, error: null });
    } catch (error) {
      if (revision === this.revision && !this.disposed) this.publish({ ...current, task: { state: STATE.IDLE },
        error: error instanceof AgentClientError ? error.code : AGENT_ERROR.BACKEND_FAILED });
      throw error;
    }
  }
}
