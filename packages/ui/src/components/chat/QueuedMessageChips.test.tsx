import { afterAll, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';

const browser = new Window({ url: 'http://localhost/' });
const descriptors = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, localStorage: browser.localStorage, Element: browser.Element, HTMLElement: browser.HTMLElement, CustomEvent: browser.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
  descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { value, configurable: true });
}
const { createRoot } = await import('react-dom/client');
const { QueuedMessageChips } = await import('./QueuedMessageChips');
const { useMessageQueueStore, getMessageQueueKey, createMessageQueueTarget, QUEUE_DELIVERY } = await import('@/stores/messageQueueStore');
const { useUIStore } = await import('@/stores/useUIStore');
const { I18nProvider, useI18nStore } = await import('@/lib/i18n');
const target = createMessageQueueTarget('session-1', '/repo', 'runtime-test');
if (!target) throw new Error('Invalid test queue target');
const key = getMessageQueueKey(target);
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
afterAll(async () => {
  await act(async () => root.unmount());
  browser.happyDOM.abort();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
const button = (label: string) => {
  const result = Array.from(container.querySelectorAll('button')).find(node => node.textContent?.trim() === label);
  if (!result) throw new Error('Missing button: ' + label);
  return result;
};
test('held queue disables sending, keeps editing and updates language without losing intent', async () => {
  let sent = 0;
  const message = { id: 'held', content: 'keep my draft', text: 'keep my draft', createdAt: 1, delivery: QUEUE_DELIVERY.CHANGED };
  useMessageQueueStore.setState({ queuedMessages: { [key]: [message] }, sendingIds: {} });
  useUIStore.setState({ messageQueueExpanded: true });
  await act(async () => {
    useI18nStore.getState().setLocale('en');
    root.render(<I18nProvider><QueuedMessageChips target={target} onEditMessage={() => undefined} onSendMessage={() => { sent++; }} /></I18nProvider>);
  });
  expect(container.textContent).toContain('Paused for another connection');
  expect(button('send').disabled).toBe(true);
  expect(button('edit').disabled).toBe(false);
  await act(async () => button('send').click());
  expect(sent).toBe(0);
  await act(async () => useI18nStore.getState().setLocale('zh-CN'));
  for (let attempt = 0; attempt < 50 && !container.textContent?.includes('已暂停：属于其他连接'); attempt++) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  expect(container.textContent).toContain('已暂停：属于其他连接');
  expect(useMessageQueueStore.getState().queuedMessages[key]?.[0]?.content).toBe('keep my draft');
  await act(async () => {
    useI18nStore.getState().setLocale('en');
    useMessageQueueStore.setState({ queuedMessages: { [key]: [{ ...message, delivery: QUEUE_DELIVERY.READY }] } });
  });
  for (let attempt = 0; attempt < 50 && !Array.from(container.querySelectorAll('button')).some(node => node.textContent?.trim() === 'send'); attempt++) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  expect(button('send').disabled).toBe(false);
  await act(async () => button('send').click());
  expect(sent).toBe(1);
});
