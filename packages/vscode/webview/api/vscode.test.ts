import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

describe('VS Code webview actions', () => {
  test('keeps Agent Manager and local-path commands on the real host bridge', async () => {
    const originalWindow = globalThis.window;
    const originalAcquire = Object.getOwnPropertyDescriptor(globalThis, 'acquireVsCodeApi');
    const messages: Array<{ id?: string; type: string; payload?: unknown }> = [];

    try {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
      Object.defineProperty(globalThis, 'acquireVsCodeApi', {
        configurable: true,
        value: () => ({
          postMessage: (message: { id?: string; type: string; payload?: unknown }) => messages.push(message),
          getState: () => undefined,
          setState: () => undefined,
        }),
      });
      const { createVSCodeActionsAPI } = await import('./vscode');
      const actions = createVSCodeActionsAPI();
      const finish = async (pending: Promise<unknown>) => {
        const request = messages.at(-1);
        assert.ok(request?.id);
        globalThis.window.dispatchEvent(new MessageEvent('message', {
          data: { id: request.id, type: request.type, success: true, data: { result: true } },
        }));
        await pending;
      };

      await finish(actions.openAgentManager());
      assert.deepEqual(messages.at(-1), {
        id: messages.at(-1)?.id,
        type: 'vscode:command',
        payload: { command: 'openchamber.openAgentManager', args: undefined },
      });
      await finish(actions.openLocalPath?.('/repo/file.txt') ?? Promise.reject(new Error('local path action missing')));
      assert.deepEqual(messages.at(-1)?.payload, { path: '/repo/file.txt' });
      assert.equal(messages.at(-1)?.type, 'vscode:openLocalPath');
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
      if (originalAcquire) Object.defineProperty(globalThis, 'acquireVsCodeApi', originalAcquire);
      else Reflect.deleteProperty(globalThis, 'acquireVsCodeApi');
    }
  });
});
