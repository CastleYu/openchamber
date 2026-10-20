import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createLegacyProviderRuntime, type LegacyProviderRuntime } from '../../web/server/lib/opencode/legacy-provider-runtime.js';
import { createLegacyProviderRequest } from '../../web/server/lib/opencode/legacy-provider-request.js';
import { createKernelOperations } from '../../web/server/lib/opencode/kernel-operations.js';
import { LEGACY_PROVIDER_BRIDGE } from '../legacyProviderBridge';
import type { OpenCodeManager } from './opencode';
import type { BridgeRequest, BridgeResponse } from './bridge';

const requestSchema = z.object({ method: z.string(), path: z.string(), body: z.json().optional() }).strict();
const abortSchema = z.object({ requestID: z.string().min(1) }).strict();

/** Each webview document owns its caller and cancellation, never the shared credentials. */
export class LegacyProviderDocument {
  private static readonly owners = new WeakMap<OpenCodeManager, LegacyProviderRuntime>();
  private caller = randomUUID();
  private lifetime = new AbortController();
  private readonly requests = new Map<string, AbortController>();
  private disposed = false;

  constructor(private readonly manager: OpenCodeManager | undefined,
    private readonly subscriptions: Array<{ dispose(): void }>) {}

  private owner(manager: OpenCodeManager): LegacyProviderRuntime {
    let owner = LegacyProviderDocument.owners.get(manager);
    if (!owner) {
      owner = createLegacyProviderRuntime({
        getRuntime: () => manager.getKernelRuntime(),
        getNativeConfigContext: () => manager.getNativeConfigContext(),
        getBackendSelection: () => ({ family: 'opencode', revision: 0 }),
        getHeaders: () => manager.getOpenCodeAuthHeaders(),
        subscribeCredentialOwner: listener => manager.subscribeCredentialOwner(listener),
        kernelOperations: createKernelOperations({ getRuntime: () => manager.getKernelRuntime(), getHeaders: () => manager.getOpenCodeAuthHeaders() }),
      });
      LegacyProviderDocument.owners.set(manager, owner);
      this.subscriptions.push(owner);
    }
    return owner;
  }

  reset(): void {
    this.lifetime.abort();
    this.requests.clear();
    this.caller = randomUUID();
    this.lifetime = new AbortController();
  }

  dispose(): void {
    this.disposed = true;
    this.lifetime.abort();
    this.requests.clear();
  }

  async handle(message: BridgeRequest): Promise<BridgeResponse | undefined> {
    const { id, type, payload } = message;
    if (type !== LEGACY_PROVIDER_BRIDGE.REQUEST && type !== LEGACY_PROVIDER_BRIDGE.ABORT) return undefined;
    const response = (status: number, body: z.infer<ReturnType<typeof z.json>>): BridgeResponse => ({ id, type, success: true, data: { status, body } });
    if (type === LEGACY_PROVIDER_BRIDGE.ABORT) {
      const parsed = abortSchema.safeParse(payload);
      if (!parsed.success) return response(400, { error: 'invalid_provider_request' });
      this.requests.get(parsed.data.requestID)?.abort();
      return response(200, { canceled: true });
    }
    if (this.disposed) return response(409, { error: 'provider_document_retired' });
    if (!this.manager) return response(501, { error: 'unsupported_runtime' });
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success || this.requests.has(id)) return response(400, { error: 'invalid_provider_request' });
    const manager = this.manager;
    const controller = new AbortController();
    const lifetime = this.lifetime;
    const signal = AbortSignal.any([lifetime.signal, controller.signal]);
    this.requests.set(id, controller);
    try {
      const request = createLegacyProviderRequest({ api: this.owner(manager), getRuntime: () => manager.getKernelRuntime() });
      const result = await request({ ...parsed.data, caller: this.caller, signal });
      if (signal.aborted) return response(409, { error: 'provider_request_retired' });
      return response(result.status, result.body);
    } finally {
      if (this.requests.get(id) === controller) this.requests.delete(id);
    }
  }
}
