import { AGENT_ERROR } from '../../../web/server/lib/agent/constants.js';
import { AgentClient, AgentClientError } from '@/lib/agent/client';
import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

const BOOT = Object.freeze({ LOADING: 'loading', SELECTED: 'selected', FAILED: 'failed' } as const);
type Selection = Awaited<ReturnType<AgentClient['selection']>>;
export type AgentBootState =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'selected'; value: Selection }>
  | Readonly<{ state: 'failed'; error: typeof AGENT_ERROR[keyof typeof AGENT_ERROR] }>;
export const AGENT_BOOT_PENDING: AgentBootState = Object.freeze({ state: BOOT.LOADING });

/** Owns family discovery before either backend's application effects mount. */
export class AgentBootstrap {
  private value: AgentBootState = AGENT_BOOT_PENDING;
  private revision = 0;
  private disposed = false;
  private controller: AbortController | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeRetired: () => void;
  private readonly unsubscribeChanged: () => void;

  constructor(
    private readonly client = new AgentClient(),
    subscribeChanged: (listener: () => void) => () => void = subscribeRuntimeEndpointChanged,
  ) {
    this.unsubscribeRetired = client.subscribeRetirement(() => {
      this.invalidate();
      this.publish(Object.freeze({ state: BOOT.FAILED, error: AGENT_ERROR.CHANGED }));
    });
    this.unsubscribeChanged = subscribeChanged(() => { void this.refresh(); });
  }

  getSnapshot = (): AgentBootState => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(value: AgentBootState): void {
    if (this.disposed) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  private invalidate(): void {
    this.revision += 1;
    this.controller?.abort();
    this.controller = null;
    this.publish(AGENT_BOOT_PENDING);
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    this.invalidate();
    const revision = this.revision;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const value = await this.client.selection(controller.signal);
      if (this.disposed || revision !== this.revision) return;
      this.publish(Object.freeze({ state: BOOT.SELECTED, value }));
    } catch (error) {
      if (this.disposed || revision !== this.revision) return;
      this.publish(Object.freeze({
        state: BOOT.FAILED,
        error: error instanceof AgentClientError ? error.code : AGENT_ERROR.BACKEND_FAILED,
      }));
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.invalidate();
    this.disposed = true;
    this.unsubscribeChanged();
    this.unsubscribeRetired();
    this.client.dispose();
    this.listeners.clear();
  }
}
