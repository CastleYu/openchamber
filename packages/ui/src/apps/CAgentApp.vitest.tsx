import { Window } from 'happy-dom';
import { z } from 'zod';
import { describe, expect, test } from 'bun:test';
import {
  AGENT_EXTENSION, AGENT_FAMILY, AGENT_FEATURE, AGENT_MESSAGE_STATE, AGENT_OPERATION, AGENT_PART, AGENT_ROLE, AGENT_ROUTE,
} from '../../../web/server/lib/agent/constants.js';
import type { AgentOperation, JsonValue } from '../../../web/server/lib/agent/dispatcher.js';
import type { AgentFeature } from '../../../web/server/lib/agent/features.js';
import type { ExtensionManifest } from '../../../web/server/lib/agent/extensions.js';
import { AgentClient, type AgentClientPorts } from '@/lib/agent/client';
import { AgentConversation } from '@/lib/agent/conversation';
import { AgentRequestJournal } from '@/lib/agent/journal';
import { AgentExtensionJournal } from '@/lib/agent/extension-journal';
import { AgentExtensions } from '@/lib/agent/extensions';
import { I18nProvider } from '@/lib/i18n';
import type { AgentChatBinding } from '@/lib/agent/chatBinding';
import CAgentApp from './CAgentApp';

const bootstrapWindow = new Window({ url: 'http://localhost' });
const installWindow = (target: Window) => {
  const globals = new Map<string, unknown>([
    ['window', target], ['document', target.document], ['navigator', target.navigator], ['Node', target.Node],
    ['Element', target.Element], ['HTMLElement', target.HTMLElement], ['HTMLInputElement', target.HTMLInputElement],
    ['HTMLTextAreaElement', target.HTMLTextAreaElement], ['HTMLFormElement', target.HTMLFormElement],
    ['Event', target.Event], ['InputEvent', target.InputEvent], ['MouseEvent', target.MouseEvent],
    ['MutationObserver', target.MutationObserver], ['IS_REACT_ACT_ENVIRONMENT', true],
  ]);
  for (const [name, value] of globals) Object.defineProperty(globalThis, name, {
    configurable: true, writable: true,
    value,
  });
};
installWindow(bootstrapWindow);
const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');

const identity = Object.freeze({
  family: AGENT_FAMILY.CAGENT, connectionID: 'connection-1', principalID: `principal-${'a'.repeat(64)}`, epoch: 1, adapterRevision: 'adapter-1', capabilityRevision: 'caps-1',
});
const response = (value: JsonValue, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});
const message = (id: string, text: string) => ({
  id, sessionID: 'session-1', role: AGENT_ROLE.ASSISTANT,
  parts: [{ id: `${id}-part`, type: AGENT_PART.TEXT, text }], state: AGENT_MESSAGE_STATE.COMPLETE,
});
const gate = <T,>() => {
  let release: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => { release = resolve; });
  return { promise, release };
};
const attemptInput = z.object({ requestID: z.string() });
const dispatchInput = z.object({ operation: z.enum(Object.values(AGENT_OPERATION)), input: z.json() });
const extensionInput = z.object({ actionID: z.string(), identity: z.json(), input: z.object({
  values: z.record(z.string(), z.json()), requestID: z.string().optional(),
}).passthrough() }).passthrough();
const extensionLabel = { key: 'cagent.extension.panel', en: 'Panel action', zhCN: '面板操作' };
const extensionFieldLabel = { key: 'cagent.extension.value', en: 'Value', zhCN: '数值' };
const extensionValue = (kind: 'number' | 'text' = 'number'): ExtensionManifest['input'][number]['value'] => {
  if (kind === 'text') return { kind: AGENT_EXTENSION.KIND.TEXT, maxLength: 40 };
  return { kind: AGENT_EXTENSION.KIND.NUMBER, min: 1, max: 5 };
};
const extensionManifest = (options: { actionID?: string; context?: { workspace: boolean; session: boolean }; effect?: 'read' | 'mutation'; kind?: 'number' | 'text' } = {}) => ({
  version: AGENT_EXTENSION.VERSION, actionID: options.actionID ?? 'cagent.extension.panel', revision: 'rev-1', label: extensionLabel,
  context: options.context ?? { workspace: true, session: true }, effect: options.effect ?? 'mutation', authorization: 'current-principal',
  cancellation: 'none', outcome: 'accepted-only',
  input: [{ key: 'value', label: extensionFieldLabel, required: true, value: extensionValue(options.kind) }],
  output: { kind: AGENT_EXTENSION.KIND.TEXT, maxLength: 200 }, evidence: [{ document: 'extensions', section: 'verified' }],
} satisfies ExtensionManifest);
const extensionAction = (options: Parameters<typeof extensionManifest>[0] = {}, available = true) => ({ manifest: extensionManifest(options),
  availability: available ? { available: true } : { available: false, reason: 'unavailable' as const } });

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

class Harness {
  readonly calls: Array<{ operation: AgentOperation; input: JsonValue }> = [];
  readonly attempts: string[] = [];
  history = [message('message-1', 'Existing answer')];
  historyFails = false;
  statusFails = false;
  sendFails = false;
  unavailable: AgentOperation | undefined;
  unavailableFeature: AgentFeature | undefined;
  extensionActions = [extensionAction()];
  extensionCatalogFails = false;
  extensionCalls: Array<{ actionID: string; values: JsonValue }> = [];
  extensionResult = '<img src=x onerror=alert(1)> raw result';
  attempt: JsonValue | null = null;
  factoryCalls = 0;
  disposed = 0;
  readonly client: AgentClient;

  constructor() {
    const ports: AgentClientPorts = {
      getRuntimeKey: () => 'cagent-app-test',
      subscribe: () => () => {},
      fetch: async (path, init) => this.fetch(path, init),
    };
    this.client = new AgentClient(ports);
  }

  private async fetch(path: string | URL | Request, init?: RequestInit): Promise<Response> {
    const route = String(path);
    if (route === AGENT_ROUTE.EXTENSIONS) return this.extensionCatalogFails
      ? response({ error: 'backend-failed' }, 503)
      : response(z.json().parse(JSON.parse(JSON.stringify({ identity, actions: this.extensionActions }))));
    if (route === AGENT_ROUTE.RUNTIME || route === AGENT_ROUTE.FEATURES) {
      const operations: Record<string, JsonValue> = {};
      for (const operation of Object.values(AGENT_OPERATION)) {
        operations[operation] = operation === this.unavailable
          ? { available: false, reason: 'unavailable' } : { available: true };
      }
      if (route === AGENT_ROUTE.RUNTIME) return response({ identity, operations });
      const features: Record<string, JsonValue> = {};
      for (const feature of Object.values(AGENT_FEATURE)) {
        features[feature] = feature === this.unavailableFeature
          ? { available: false, reason: 'unavailable' } : { available: true };
      }
      return response({ identity, features });
    }
    if (route === AGENT_ROUTE.ATTEMPT) {
      const input = attemptInput.parse(JSON.parse(String(init?.body)));
      this.attempts.push(input.requestID);
      return response({ identity, attempt: this.attempt });
    }
    if (route === AGENT_ROUTE.EXTENSION_DISPATCH) {
      const body = extensionInput.parse(JSON.parse(String(init?.body)));
      this.extensionCalls.push({ actionID: body.actionID, values: body.input.values });
      const result = { identity, result: { text: this.extensionResult } };
      if (body.input.requestID) return response({ ...result, receipt: { requestID: body.input.requestID, state: 'accepted' } });
      return response(result);
    }
    if (route !== AGENT_ROUTE.DISPATCH) throw new Error(`Unexpected route: ${route}`);
    const body = dispatchInput.parse(JSON.parse(String(init?.body)));
    this.calls.push(body);
    switch (body.operation) {
      case AGENT_OPERATION.GET_SESSION:
        return response({ identity, data: { id: 'session-1', workspaceID: 'workspace-1' } });
      case AGENT_OPERATION.LIST_MESSAGES:
        return this.historyFails ? response({ error: 'backend-failed' }, 503) : response({ identity, data: { items: this.history } });
      case AGENT_OPERATION.GET_SESSION_STATUS:
        return this.statusFails ? response({ error: 'backend-failed' }, 503) : response({ identity, data: { sessionID: 'session-1', state: 'idle' } });
      case AGENT_OPERATION.SEND_PROMPT:
        if (this.sendFails) throw new Error('receipt lost');
        return response({ identity, data: { state: 'accepted', requestID: attemptInput.parse(body.input).requestID } });
      default:
        throw new Error(`Unexpected operation: ${body.operation}`);
    }
  }

  async create(): Promise<AgentChatBinding> {
    this.factoryCalls += 1;
    const snapshot = await this.client.inspect();
    const conversation = new AgentConversation(this.client, new AgentRequestJournal(new MemoryStorage(), 'cagent-app-test'));
    const extensions = new AgentExtensions(this.client, snapshot, new AgentExtensionJournal(new MemoryStorage(), 'cagent-app-test'));
    return Object.freeze({
      client: this.client, snapshot, conversation, extensions,
      dispose: () => { this.disposed += 1; extensions.dispose(); conversation.dispose(); this.client.dispose(); },
    });
  }

  operations(operation: AgentOperation): number {
    return this.calls.filter((call) => call.operation === operation).length;
  }
}

const mount = async (create: () => Promise<AgentChatBinding>) => {
  const win = new Window({ url: 'http://localhost' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement',
    'HTMLTextAreaElement', 'HTMLFormElement', 'Event', 'InputEvent', 'MouseEvent', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT']) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  installWindow(win);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<I18nProvider><CAgentApp create={create} /></I18nProvider>));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.includes(text));
  const inputs = () => [...container.querySelectorAll<HTMLInputElement>('input')];
  const input = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };
  return {
    container, button, inputs, input,
    click: async (text: string) => { await act(async () => button(text)?.click()); },
    open: async () => {
      const fields = inputs();
      const workspace = fields[0];
      const session = fields[1];
      if (!workspace || !session) throw new Error('workspace and session inputs missing');
      await input(workspace, 'workspace-1');
      await input(session, 'session-1');
      expect(fields.map((field) => field.value)).toEqual(['workspace-1', 'session-1']);
      await act(async () => {
        const submit = button('Open conversation');
        const form = submit?.closest('form');
        if (submit && form) form.requestSubmit(submit);
      });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    },
    close: async () => {
      await act(async () => root.unmount());
      win.happyDOM.abort();
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
};

describe('CAgentApp conversations', () => {
  test('rejects an out-of-range extension number before dispatch', async () => {
    const harness = new Harness();
    const view = await mount(harness.create.bind(harness));
    try {
      await view.open();
      await view.click('Panel action');
      const number = view.container.querySelector<HTMLInputElement>('input[type="number"]');
      if (!number) throw new Error('extension number input missing');
      await view.input(number, '8');
      expect(number.value).toBe('8');
      await view.click('Run action');
      expect(number.validity.valid).toBe(false);
      expect(harness.extensionCalls).toHaveLength(0);
    } finally { await view.close(); }
  });

  test('shows extension text as literal content and treats accepted as pending completion', async () => {
    const harness = new Harness();
    harness.extensionResult = '<img src=x onerror=alert(1)> accepted payload';
    const view = await mount(harness.create.bind(harness));
    try {
      await view.open();
      await view.click('Panel action');
      const number = view.container.querySelector<HTMLInputElement>('input[type="number"]');
      if (!number) throw new Error('extension number input missing');
      await view.input(number, '3');
      await view.click('Run action');
      expect(harness.extensionCalls).toHaveLength(1);
      expect(harness.extensionCalls[0]?.values).toEqual({ value: 3 });
      expect(view.container.textContent).toContain(harness.extensionResult);
      expect(view.container.querySelector('img')).toBeNull();
      expect(view.container.textContent).toContain('Request accepted. Completion is not confirmed.');
      expect(view.container.querySelectorAll('[data-role="assistant"]')).toHaveLength(1);
      expect(view.container.querySelector('[data-role="assistant"]')?.textContent).toContain('Existing answer');
    } finally { await view.close(); }
  });

  test('disables required-scope and unavailable extension actions', async () => {
    const harness = new Harness();
    harness.extensionActions = [extensionAction(), extensionAction({ actionID: 'cagent.extension.unavailable' }, false)];
    const view = await mount(harness.create.bind(harness));
    try {
      await view.click('Panel action');
      expect(view.container.textContent).toContain('This action requires conversation context.');
      expect(view.button('Run action')?.disabled).toBe(true);
      expect([...view.container.querySelectorAll<HTMLButtonElement>('button')]
        .some((button) => button.textContent?.includes('Panel action') && button.disabled)).toBe(true);
    } finally { await view.close(); }
  });

  test('recovers a failed extension catalog through its retry action', async () => {
    const harness = new Harness(); harness.extensionCatalogFails = true;
    const view = await mount(harness.create.bind(harness));
    try {
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('Could not load extensions.');
      harness.extensionCatalogFails = false;
      await view.click('Retry');
      expect(view.container.textContent).toContain('Panel action');
      expect(view.button('Panel action')?.disabled).toBe(false);
    } finally { await view.close(); }
  });

  test('dispatches one accepted prompt and observes the answer only through refreshed history', async () => {
    const harness = new Harness();
    const view = await mount(harness.create.bind(harness));
    try {
      await view.open();
      const prompt = view.container.querySelector('textarea');
      if (!prompt) throw new Error('prompt textarea missing');
      await view.input(prompt, 'A new question');
      const statusCalls = harness.operations(AGENT_OPERATION.GET_SESSION_STATUS);
      await view.click('Send');
      expect(harness.operations(AGENT_OPERATION.SEND_PROMPT)).toBe(1);
      expect(harness.operations(AGENT_OPERATION.GET_SESSION_STATUS)).toBe(statusCalls + 1);
      expect(prompt.value).toBe('');
      expect(view.container.textContent).toContain('acceptance does not confirm completion');
      harness.history = [message('message-2', 'Observed answer')];
      expect(view.container.textContent).not.toContain('Observed answer');
      await view.click('Refresh history and status');
      expect(view.container.textContent).toContain('Observed answer');
    } finally { await view.close(); }
  });

  test('a failed pre-send status read produces no prompt dispatch', async () => {
    const harness = new Harness();
    const view = await mount(harness.create.bind(harness));
    try {
      await view.open();
      const prompt = view.container.querySelector('textarea');
      if (!prompt) throw new Error('prompt textarea missing');
      await view.input(prompt, 'Preserved draft');
      harness.statusFails = true;
      await view.click('Send');
      expect(harness.operations(AGENT_OPERATION.SEND_PROMPT)).toBe(0);
      expect(prompt.value).toBe('Preserved draft');
      expect(view.container.textContent).toContain('Session status: Unknown');
    } finally { await view.close(); }
  });

  test('opens through real input and button events, then refreshes history and status', async () => {
    const harness = new Harness();
    const view = await mount(harness.create.bind(harness));
    try {
      await view.open();
      expect(view.container.textContent).toContain('Existing answer');
      const historyCalls = harness.operations(AGENT_OPERATION.LIST_MESSAGES);
      const statusCalls = harness.operations(AGENT_OPERATION.GET_SESSION_STATUS);
      await view.click('Refresh history and status');
      expect(harness.operations(AGENT_OPERATION.LIST_MESSAGES)).toBe(historyCalls + 1);
      expect(harness.operations(AGENT_OPERATION.GET_SESSION_STATUS)).toBe(statusCalls + 1);
    } finally { await view.close(); }
  });

  test('keeps an uncertain send disabled and resolves its original request without replay', async () => {
    const harness = new Harness(); harness.sendFails = true;
    const view = await mount(harness.create.bind(harness));
    try {
      await view.open();
      const prompt = view.container.querySelector('textarea');
      if (!prompt) throw new Error('prompt textarea missing');
      await view.input(prompt, 'Keep this request');
      await view.click('Send');
      expect(view.container.textContent).toContain('Delivery is uncertain');
      expect(view.button('Send')?.disabled).toBe(true);
      expect(harness.operations(AGENT_OPERATION.SEND_PROMPT)).toBe(1);
      const send = harness.calls.find((call) => call.operation === AGENT_OPERATION.SEND_PROMPT);
      if (!send) throw new Error('send dispatch missing');
      const { requestID } = attemptInput.parse(send.input);
      harness.attempt = { version: 1, identity, operation: AGENT_OPERATION.SEND_PROMPT, requestID, state: 'complete' };
      await view.click('Check request outcome');
      expect(harness.operations(AGENT_OPERATION.SEND_PROMPT)).toBe(1);
      expect(harness.attempts).toEqual([requestID]);
      expect(view.container.textContent).toContain('Request accepted');
    } finally { await view.close(); }
  });

  test('keeps displayed history when history and status refreshes fail', async () => {
    const harness = new Harness();
    const view = await mount(harness.create.bind(harness));
    try {
      await view.open();
      harness.history = [message('message-2', 'Replacement answer')];
      harness.historyFails = true;
      harness.statusFails = true;
      await view.click('Refresh history and status');
      expect(view.container.textContent).toContain('Existing answer');
      expect(view.container.textContent).not.toContain('Replacement answer');
      expect(view.container.textContent).toContain('Could not complete this action');
    } finally { await view.close(); }
  });

  test('disposes a binding that resolves after unmount', async () => {
    const deferred = gate<AgentChatBinding>();
    const harness = new Harness();
    const view = await mount(() => deferred.promise);
    await view.close();
    const created = await harness.create();
    deferred.release(created);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(harness.disposed).toBe(1);
    expect(created.conversation.getSnapshot().state).toBe('unbound');
  });

  test('does not open or dispatch when session acquisition is unavailable', async () => {
    const harness = new Harness(); harness.unavailableFeature = AGENT_FEATURE.ACQUIRE_SESSION;
    const view = await mount(harness.create.bind(harness));
    try {
      const fields = view.inputs();
      const workspace = fields[0];
      const session = fields[1];
      if (!workspace || !session) throw new Error('workspace and session inputs missing');
      await view.input(workspace, 'workspace-1');
      await view.input(session, 'session-1');
      expect(view.button('Open conversation')?.disabled).toBe(true);
      await view.click('Open conversation');
      expect(harness.operations(AGENT_OPERATION.GET_SESSION)).toBe(0);
    } finally { await view.close(); }
  });
});
