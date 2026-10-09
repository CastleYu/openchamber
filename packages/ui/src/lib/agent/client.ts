import { z } from 'zod';
import {
  AGENT_ATTEMPT, AGENT_ERROR, AGENT_EXTENSION, AGENT_HTTP, AGENT_MUTATIONS, AGENT_ROUTE, AGENT_SERVER_METHOD,
} from '../../../../web/server/lib/agent/constants.js';
import {
  AGENT_INPUT_SCHEMAS, AGENT_OUTPUT_SCHEMAS, agentBackendSelectionSchema, agentAttemptRequestSchema,
  agentAttemptResultSchema, agentFailureSchema, agentFeatureSnapshotSchema,
  agentIdentitySchema, agentOperationSchema, agentRuntimeSchema,
  agentExtensionInputSchema, agentExtensionResultSchema, agentExtensionSnapshotSchema,
} from '../../../../web/server/lib/agent/schemas.js';
import { extensionManifestSchema, parseExtensionInput, parseExtensionResult,
  type ExtensionManifest } from '../../../../web/server/lib/agent/extensions.js';
import type { AgentExtensionInput, AgentExtensionResult, AgentExtensionSnapshot } from '../../../../web/server/lib/agent/extension-runtime.js';
import type {
  AgentIdentity, AgentInputs, AgentOperation, AgentOutputs, AgentRuntime, JsonValue,
} from '../../../../web/server/lib/agent/dispatcher.js';
import type { AgentFeatureSnapshot } from '../../../../web/server/lib/agent/features.js';
import type { AgentBackendSelection } from '../../../../web/server/lib/agent/host.js';
import { runtimeFetch, type RuntimeFetchOptions } from '../runtime-fetch';
import { subscribeRuntimeAuthChanged } from '../runtime-auth';
import { getRuntimeKey, subscribeRuntimeEndpointWillChange } from '../runtime-switch';

type ErrorCode = typeof AGENT_ERROR[keyof typeof AGENT_ERROR];
type EndpointScope = Readonly<{ runtimeKey: string; revision: number }>;
export type AgentClientScope = EndpointScope & Readonly<{ identity: AgentIdentity }>;
export type AgentClientSnapshot = Readonly<{
  scope: AgentClientScope; runtime: AgentRuntime; availability: AgentFeatureSnapshot;
}>;
export type AgentClientPorts = {
  fetch: typeof runtimeFetch;
  getRuntimeKey(): string;
  subscribe(onChange: () => void): () => void;
};

const same = (left: AgentIdentity, right: AgentIdentity): boolean => left.family === right.family
  && left.connectionID === right.connectionID && left.epoch === right.epoch
  && left.adapterRevision === right.adapterRevision && left.capabilityRevision === right.capabilityRevision
  && left.principalID === right.principalID;
const envelope = z.object({ identity: agentIdentitySchema, data: z.json() }).strict();
const mutations = new Set(AGENT_MUTATIONS);
const subscribeRuntimeLifetime = (onChange: () => void): (() => void) => {
  const endpoint = subscribeRuntimeEndpointWillChange(onChange);
  const auth = subscribeRuntimeAuthChanged(onChange);
  return () => { endpoint(); auth(); };
};

export class AgentClientError extends Error {
  constructor(readonly code: ErrorCode) {
    super(`Agent request refused: ${code}`);
    this.name = 'AgentClientError';
  }
}

/** Owns endpoint retirement and parsing. Host approval still owns dispatch authority. */
export class AgentClient {
  private revision = 0;
  private controller = new AbortController();
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(private readonly ports: AgentClientPorts = {
    fetch: runtimeFetch, getRuntimeKey, subscribe: subscribeRuntimeLifetime,
  }) {
    this.unsubscribe = ports.subscribe(() => this.retire());
  }

  private retire(): void {
    this.revision += 1;
    this.controller.abort();
    this.controller = new AbortController();
    for (const listener of this.listeners) listener();
  }

  /** Consumers clear endpoint-owned state synchronously, including A/B/A retirement. */
  subscribeRetirement(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.retire();
    this.listeners.clear();
  }

  private capture(): EndpointScope {
    return Object.freeze({ runtimeKey: this.ports.getRuntimeKey(), revision: this.revision });
  }

  private current(scope: EndpointScope): boolean {
    return !this.disposed && scope.revision === this.revision && scope.runtimeKey === this.ports.getRuntimeKey();
  }

  private assertCurrent(scope: EndpointScope): void {
    if (!this.current(scope)) throw new AgentClientError(AGENT_ERROR.CHANGED);
  }

  private failure(scope: EndpointScope, signal: AbortSignal, mutation: boolean, fallback: ErrorCode): AgentClientError {
    if (mutation) return new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME);
    if (!this.current(scope)) return new AgentClientError(AGENT_ERROR.CHANGED);
    if (signal.aborted) return new AgentClientError(AGENT_ERROR.CANCELLED);
    return new AgentClientError(fallback);
  }

  private async request(scope: EndpointScope, path: string, init: RuntimeFetchOptions, mutation = false): Promise<JsonValue> {
    this.assertCurrent(scope);
    const signal = init.signal ? AbortSignal.any([this.controller.signal, init.signal]) : this.controller.signal;
    if (signal.aborted) throw new AgentClientError(AGENT_ERROR.CANCELLED);
    let response: Response;
    try {
      response = await this.ports.fetch(path, { ...init, signal, cache: 'no-store' });
    } catch {
      throw this.failure(scope, signal, mutation, AGENT_ERROR.BACKEND_FAILED);
    }
    let payload: JsonValue;
    try {
      payload = z.json().parse(await response.json());
    } catch {
      throw this.failure(scope, signal, mutation, AGENT_ERROR.INVALID_RESPONSE);
    }
    if (!this.current(scope) || signal.aborted) {
      throw this.failure(scope, signal, mutation, AGENT_ERROR.CHANGED);
    }
    if (!response.ok) {
      const error = agentFailureSchema.safeParse(payload);
      if (!error.success) throw this.failure(scope, signal, mutation, AGENT_ERROR.INVALID_RESPONSE);
      if (error.data.error === AGENT_ERROR.CHANGED) this.retire();
      if (mutation && (error.data.error === AGENT_ERROR.BACKEND_FAILED || error.data.error === AGENT_ERROR.INVALID_RESPONSE)) {
        throw new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME);
      }
      throw new AgentClientError(error.data.error);
    }
    return payload;
  }

  /** Read protected family selection before requiring an adapter binding. */
  async selection(signal?: AbortSignal): Promise<Readonly<{
    scope: EndpointScope; selection: AgentBackendSelection;
  }>> {
    const scope = this.capture();
    const payload = await this.request(scope, AGENT_ROUTE.SELECTION, { signal });
    const parsed = agentBackendSelectionSchema.safeParse(payload);
    if (!parsed.success) throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
    this.assertCurrent(scope);
    return Object.freeze({ scope, selection: Object.freeze(parsed.data) });
  }

  async inspect(signal?: AbortSignal): Promise<AgentClientSnapshot> {
    const scope = this.capture();
    const [runtimePayload, featurePayload] = await Promise.all([
      this.request(scope, AGENT_ROUTE.RUNTIME, { signal }),
      this.request(scope, AGENT_ROUTE.FEATURES, { signal }),
    ]);
    const runtime = agentRuntimeSchema.safeParse(runtimePayload);
    const availability = agentFeatureSnapshotSchema.safeParse(featurePayload);
    if (!runtime.success || !availability.success) throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
    if (!same(runtime.data.identity, availability.data.identity)) {
      this.retire();
      throw new AgentClientError(AGENT_ERROR.CHANGED);
    }
    this.assertCurrent(scope);
    return Object.freeze({
      scope: Object.freeze({ ...scope, identity: Object.freeze({ ...runtime.data.identity }) }),
      runtime: runtime.data, availability: availability.data,
    });
  }

  async dispatch<K extends AgentOperation>(scope: AgentClientScope, operation: K, input: AgentInputs[K], signal?: AbortSignal): Promise<AgentOutputs[K]> {
    this.assertCurrent(scope);
    const identity = agentIdentitySchema.safeParse(scope.identity);
    const parsedOperation = agentOperationSchema.safeParse(operation);
    if (!identity.success || !parsedOperation.success) throw new AgentClientError(AGENT_ERROR.INVALID_INPUT);
    const parsedInput = AGENT_INPUT_SCHEMAS[operation].safeParse(input);
    if (!parsedInput.success) throw new AgentClientError(AGENT_ERROR.INVALID_INPUT);
    const mutation = mutations.has(operation);
    const payload = await this.request(scope, AGENT_ROUTE.DISPATCH, {
      method: AGENT_SERVER_METHOD.POST, signal,
      headers: { [AGENT_HTTP.CONTENT_TYPE]: AGENT_HTTP.JSON },
      body: JSON.stringify({ operation, identity: identity.data, input: parsedInput.data }),
    }, mutation);
    const result = envelope.safeParse(payload);
    if (result.success && !same(result.data.identity, identity.data)) this.retire();
    if (!result.success || !same(result.data.identity, identity.data)) {
      throw new AgentClientError(mutation ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.INVALID_RESPONSE);
    }
    const data = AGENT_OUTPUT_SCHEMAS[operation].safeParse(result.data.data);
    if (!data.success) throw new AgentClientError(mutation ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.INVALID_RESPONSE);
    return data.data;
  }

  async extensions(scope: AgentClientScope, signal?: AbortSignal): Promise<AgentExtensionSnapshot> {
    this.assertCurrent(scope);
    const payload = await this.request(scope, AGENT_ROUTE.EXTENSIONS, { signal });
    const parsed = agentExtensionSnapshotSchema.safeParse(payload);
    if (!parsed.success) throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
    if (!same(parsed.data.identity, scope.identity)) {
      this.retire();
      throw new AgentClientError(AGENT_ERROR.CHANGED);
    }
    return parsed.data;
  }

  /** The supplied manifest shapes parsing; only the host grants action authority. */
  async dispatchExtension(scope: AgentClientScope, manifest: ExtensionManifest, input: AgentExtensionInput,
    signal?: AbortSignal): Promise<AgentExtensionResult> {
    this.assertCurrent(scope);
    const identity = agentIdentitySchema.safeParse(scope.identity);
    const action = extensionManifestSchema.safeParse(manifest);
    const request = agentExtensionInputSchema.safeParse(input);
    if (!identity.success || !action.success || !request.success) throw new AgentClientError(AGENT_ERROR.INVALID_INPUT);
    const mutation = action.data.effect === AGENT_EXTENSION.EFFECT.MUTATION;
    if (Boolean(request.data.workspaceID) !== action.data.context.workspace
      || Boolean(request.data.sessionID) !== action.data.context.session
      || Boolean(request.data.requestID) !== mutation) throw new AgentClientError(AGENT_ERROR.INVALID_INPUT);
    let values;
    try { values = parseExtensionInput(action.data, request.data.values); }
    catch { throw new AgentClientError(AGENT_ERROR.INVALID_INPUT); }
    const payload = await this.request(scope, AGENT_ROUTE.EXTENSION_DISPATCH, {
      method: AGENT_SERVER_METHOD.POST, signal,
      headers: { [AGENT_HTTP.CONTENT_TYPE]: AGENT_HTTP.JSON },
      body: JSON.stringify({ actionID: action.data.actionID, identity: identity.data, input: { ...request.data, values } }),
    }, mutation);
    const response = agentExtensionResultSchema.safeParse(payload);
    const invalid = mutation ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.INVALID_RESPONSE;
    if (!response.success) throw new AgentClientError(invalid);
    if (!same(response.data.identity, identity.data)) {
      this.retire();
      throw new AgentClientError(mutation ? AGENT_ERROR.UNKNOWN_OUTCOME : AGENT_ERROR.CHANGED);
    }
    let result;
    try { result = parseExtensionResult(action.data, response.data.result); }
    catch { throw new AgentClientError(invalid); }
    const receipt = response.data.receipt;
    if (mutation) {
      if (!receipt || receipt.requestID !== request.data.requestID || receipt.state === AGENT_ATTEMPT.UNKNOWN
        || (action.data.outcome === AGENT_EXTENSION.OUTCOME.OBSERVED && receipt.state !== AGENT_ATTEMPT.COMPLETE)) {
        throw new AgentClientError(AGENT_ERROR.UNKNOWN_OUTCOME);
      }
    } else if (receipt) { throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE); }
    return receipt ? { identity: response.data.identity, result, receipt } : { identity: response.data.identity, result };
  }

  async readAttempt(scope: AgentClientScope, requestID: string, signal?: AbortSignal) {
    this.assertCurrent(scope);
    const input = agentAttemptRequestSchema.safeParse({ identity: scope.identity, requestID });
    if (!input.success) throw new AgentClientError(AGENT_ERROR.INVALID_INPUT);
    const payload = await this.request(scope, AGENT_ROUTE.ATTEMPT, {
      method: AGENT_SERVER_METHOD.POST, signal,
      headers: { [AGENT_HTTP.CONTENT_TYPE]: AGENT_HTTP.JSON }, body: JSON.stringify(input.data),
    });
    const result = agentAttemptResultSchema.safeParse(payload);
    if (result.success && !same(result.data.identity, input.data.identity)) this.retire();
    if (!result.success || !same(result.data.identity, input.data.identity)) throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
    const attempt = result.data.attempt;
    if (attempt && (attempt.requestID !== requestID || attempt.identity.family !== input.data.identity.family
      || attempt.identity.connectionID !== input.data.identity.connectionID
      || attempt.identity.principalID !== input.data.identity.principalID)) {
      throw new AgentClientError(AGENT_ERROR.INVALID_RESPONSE);
    }
    return attempt;
  }
}
