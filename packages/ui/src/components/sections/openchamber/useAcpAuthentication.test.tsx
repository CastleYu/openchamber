import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import { AcpClient } from '@/lib/opencode/acp';
import { useAcpAuthentication } from './useAcpAuthentication';

test('authentication recovers snapshots, retries failure, disables on agent failure and ignores unmounted completion', async () => {
  const win = new Window({ url: 'https://acp.test' });
  const globals = { window: win, document: win.document, HTMLElement: win.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const root = createRoot(document.createElement('div'));
  let latest: ReturnType<typeof useAcpAuthentication> | undefined;
  const current = () => { if (!latest) throw new Error('Missing authentication state'); return latest; };
  function Probe({ enabled }: { enabled: boolean }) { latest = useAcpAuthentication(enabled); return null; }
  const info = spyOn(AcpClient.prototype, 'info').mockResolvedValue({ epoch: 4, error: null, authMethods: [{ id: 'login', name: 'Login' }] });
  const authenticate = spyOn(AcpClient.prototype, 'authenticate').mockRejectedValue(new Error('Login failed'));
  let failStream = () => {};
  const events = spyOn(AcpClient.prototype, 'interactionEvents').mockImplementation(async function* (signal) {
    yield { type: 'connection-inputs', eventID: 'one', inputs: [{ id: 'url', scope: 'request', requestID: 1, agent: 'Fixture', mode: 'url', state: 'pending', message: 'Sign in', url: 'https://example.test/login', elicitationId: 'flow' }] };
    await new Promise<void>((resolve) => { failStream = resolve; signal?.addEventListener('abort', () => resolve(), { once: true }); });
    if (!signal?.aborted) yield { type: 'connection-inputs', eventID: 'two', inputs: [], error: 'Agent exited' };
    await new Promise<void>((resolve) => { signal?.addEventListener('abort', () => resolve(), { once: true }); if (signal?.aborted) resolve(); });
  });
  try {
    await act(async () => root.render(<Probe enabled />));
    expect(current().inputs).toHaveLength(1); expect(current().connected).toBe(true);
    await act(async () => current().authenticate('login'));
    expect(authenticate.mock.calls).toEqual([['login', 4]]); expect(current().error).toBe('Login failed'); expect(current().status).toBe('idle');
    authenticate.mockResolvedValue({});
    await act(async () => current().authenticate('login')); expect(current().status).toBe('authenticated');
    await act(async () => failStream()); expect(current().inputs).toEqual([]); expect(current().connected).toBe(false); expect(current().error).toBe('Agent exited');
    await expect(current().respond('url', { action: 'accept' })).rejects.toThrow('connection changed');
    await act(async () => current().reconnect()); expect(current().inputs).toHaveLength(1);
    let finish = () => {};
    authenticate.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({}); }));
    await act(async () => { void current().authenticate('login'); });
    await act(async () => root.render(<Probe enabled={false} />));
    await act(async () => finish()); expect(current().status).toBe('idle'); expect(current().inputs).toEqual([]);
  } finally {
    await act(async () => root.unmount()); info.mockRestore(); authenticate.mockRestore(); events.mockRestore();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
