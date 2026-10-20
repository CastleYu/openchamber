import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import { I18nProvider } from '@/lib/i18n';
import type { AcpInteraction, AcpAnswer } from '@/lib/opencode/acp-interactions';
import { AcpInteractionCard } from './AcpInteractionCard';

let win: Window;
let root: Root;
let container: HTMLDivElement;
let restore: () => void;
const form: AcpInteraction = { id: 'input', scope: 'request', requestID: 1, agent: 'Fixture Agent', mode: 'form', state: 'pending', message: 'Pick settings', fields: [{ key: 'name', type: 'string', required: true, default: 'Ada' }, { key: 'count', type: 'integer', required: true, default: 2 }, { key: 'ready', type: 'boolean', required: true, default: false }, { key: 'colors', type: 'array', required: true, choices: [{ value: 'blue', label: 'Blue' }], default: ['blue'] }] };
beforeEach(() => {
  win = new Window({ url: 'https://acp.test' });
  const globals = { window: win, document: win.document, Event: win.Event, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, getComputedStyle: win.getComputedStyle.bind(win), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  restore = () => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); restore(); });
async function render(request: AcpInteraction, respond: (id: string, answer: AcpAnswer) => Promise<boolean>) {
  await act(async () => root.render(<I18nProvider><AcpInteractionCard request={request} respond={respond} /></I18nProvider>));
}
async function submit() {
  const element = container.querySelector('form');
  if (!element) throw new Error('Missing form');
  await act(async () => { element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}
test('form shows identity, submits typed defaults and keeps failed replies retryable', async () => {
  const replies: AcpAnswer[] = [];
  await render(form, async (id, answer) => { expect(id).toBe('input'); replies.push(answer); if (replies.length === 1) throw new Error('Temporary failure'); return true; });
  expect(container.textContent).toContain('Fixture Agent');
  expect(container.querySelector('input')?.value).toBe('Ada');
  await submit();
  expect(container.querySelector('[role=alert]')?.textContent).toBe('Temporary failure');
  expect(container.querySelector('form')).not.toBeNull();
  await submit();
  expect(replies[1]).toEqual({ action: 'accept', content: { name: 'Ada', count: 2, ready: false, colors: ['blue'] } });
  expect(container.querySelector('form')).toBeNull();
});
for (const [index, action] of [[1, 'decline'], [2, 'cancel']] as const) test(`${action} sends no form values`, async () => {
  const replies: AcpAnswer[] = [];
  await render(form, async (_id, answer) => { replies.push(answer); return true; });
  const button = container.querySelectorAll<HTMLButtonElement>('form > div:last-child button')[index];
  if (!button) throw new Error('Missing interaction action');
  await act(async () => button.click());
  expect(replies).toEqual([{ action }]);
});
test('URL displays full target and opens only on consent, then waits for agent completion', async () => {
  const url = 'https://login.example.test/authorize?state=opaque';
  const open = spyOn(window, 'open');
  open.mockReturnValue(null);
  const replies: AcpAnswer[] = [];
  try {
    await render({ id: 'url', scope: 'request', requestID: 1, agent: 'Fixture Agent', mode: 'url', state: 'pending', message: 'Sign in', url, elicitationId: 'workflow' }, async (_id, answer) => { replies.push(answer); return true; });
    expect(container.textContent).toContain(url); expect(container.textContent).toContain('login.example.test');
    expect(open.mock.calls).toEqual([]);
    await submit();
    expect(open.mock.calls).toEqual([[url, '_blank', 'noopener,noreferrer']]);
    expect(replies).toEqual([{ action: 'accept' }]);
    expect(container.querySelector('[role=status]')).not.toBeNull();
  } finally { open.mockRestore(); }
});
