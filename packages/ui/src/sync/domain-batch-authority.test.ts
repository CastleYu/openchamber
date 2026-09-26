import { expect, test } from 'bun:test';
import type { DomainEvent } from '@/lib/opencode/events';
import type { Session } from '@/lib/opencode/model';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { ChildStoreManager } from './child-store';
import { applyDomainBatch, createEventRoutingIndex } from './sync-context';
import { replaceGlobalSessionStatusById, useGlobalSessionStatusStore } from './global-session-status';
import { useNotificationStore } from './notification-store';

const makeSession = (id: string): Session => ({ id, projectID: 'project', directory: '/repo', title: id, time: { created: 1, updated: 2 } });

const resetLive = () => {
  replaceGlobalSessionStatusById(new Map());
  useGlobalSessionsStore.getState().resetForRuntimeSwitch();
  useNotificationStore.setState({ list: [], index: { session: { unseenCount: {}, unseenHasError: {} }, project: { unseenCount: {}, unseenHasError: {} } } });
};

function fixture(getSession: () => Promise<Session>) {
  const stores = new ChildStoreManager();
  const store = stores.ensureChild('/repo', { bootstrap: false });
  const source = { getSession };
  const routing = createEventRoutingIndex();
  const loader = { invalidateSession: () => {}, refreshTail: async () => {} };
  return { store, stores, apply: (...events: DomainEvent[]) => applyDomainBatch('/repo', events, source, stores, routing, loader, getRuntimeKey()) };
}

test('a late OC2 refresh cannot restore a deleted session in either cache', async () => {
  const session = makeSession('deleted-during-refresh');
  let finish: (value: Session) => void = () => { throw new Error('Refresh was not started'); };
  const pending = new Promise<Session>((resolve) => { finish = resolve; });
  const f = fixture(() => pending);
  try {
    f.store.setState({ session: [session] });
    useGlobalSessionsStore.getState().upsertSession(session);
    f.apply({ type: 'session-refresh', sessionID: session.id, eventID: 'rename', sequence: 10 });
    f.apply({ type: 'session-delete', sessionID: session.id, eventID: 'delete', sequence: 11 });
    finish(session);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.store.getState().session).toEqual([]);
    expect(useGlobalSessionsStore.getState().entityById.has(session.id)).toBe(false);
  } finally {
    f.stores.disposeAll();
  }
});

test('OC2 VCS events update only their directory in the current runtime', () => {
  const stores = new ChildStoreManager();
  const repo = stores.ensureChild('/repo', { bootstrap: false });
  const other = stores.ensureChild('/other', { bootstrap: false });
  const source = { getSession: async () => makeSession('unused') };
  const routing = createEventRoutingIndex();
  const loader = { invalidateSession: () => {}, refreshTail: async () => {} };
  try {
    repo.setState({ vcs: { branch: 'main' } });
    other.setState({ vcs: { branch: 'other' } });
    const event: DomainEvent = { type: 'vcs-branch', branch: 'feature', directory: '/repo', eventID: 'vcs-1' };
    applyDomainBatch('/other', [event], source, stores, routing, loader, 'stale-runtime');
    expect(repo.getState().vcs?.branch).toBe('main');
    applyDomainBatch('/other', [event], source, stores, routing, loader, getRuntimeKey());
    expect(repo.getState().vcs?.branch).toBe('feature');
    expect(other.getState().vcs?.branch).toBe('other');
  } finally { stores.disposeAll(); }
});

for (const resumed of [false, true]) test(`OC2 child settlement releases only the current completed parent turn (resumed=${resumed})`, () => {
  resetLive();
  const parent = makeSession('parent-notification');
  const child = { ...makeSession('child-notification'), parentID: parent.id };
  const f = fixture(async () => parent);
  try {
    f.store.setState({ session: [parent, child] });
    useGlobalSessionsStore.getState().applySnapshot([parent, child], [], 'ready');
    f.apply({ type: 'status', sessionID: child.id, status: { type: 'busy' }, sequence: 1, eventID: 'child-start' });
    f.apply({ type: 'status', sessionID: parent.id, status: { type: 'idle' }, outcome: 'completed', sequence: 2, eventID: 'parent-finish' });
    expect(useNotificationStore.getState().list).toHaveLength(0);
    if (resumed) f.apply({ type: 'status', sessionID: parent.id, status: { type: 'busy' }, sequence: 3, eventID: 'parent-resume' });
    f.apply({ type: 'status', sessionID: child.id, status: { type: 'idle' }, outcome: 'interrupted', sequence: 4, eventID: 'child-stop' });
    expect(useNotificationStore.getState().list).toHaveLength(resumed ? 0 : 1);
    if (resumed) {
      f.apply({ type: 'status', sessionID: parent.id, status: { type: 'idle' }, outcome: 'completed', sequence: 5, eventID: 'parent-new-finish' });
      expect(useNotificationStore.getState().list).toHaveLength(1);
    }
  } finally { f.stores.disposeAll(); resetLive(); }
});

test('a replacement OC2 source cannot release the previous source deferred outcome', () => {
  resetLive();
  const parent = makeSession('same-id-parent');
  const child = { ...makeSession('same-id-child'), parentID: parent.id };
  const old = fixture(async () => parent);
  const next = fixture(async () => parent);
  try {
    useGlobalSessionsStore.getState().applySnapshot([parent, child], [], 'ready');
    old.apply({ type: 'status', sessionID: child.id, status: { type: 'busy' }, eventID: 'old-child' });
    old.apply({ type: 'status', sessionID: parent.id, status: { type: 'idle' }, outcome: 'completed', eventID: 'old-parent' });
    next.apply({ type: 'status', sessionID: child.id, status: { type: 'idle' }, outcome: 'completed', eventID: 'new-child' });
    expect(useNotificationStore.getState().list).toHaveLength(0);
  } finally { old.stores.disposeAll(); next.stores.disposeAll(); resetLive(); }
});

test('a no-op sequence advance is committed before older status arrives', () => {
  const id = 'idle-sequence';
  const f = fixture(async () => makeSession(id));
  try {
    f.store.setState({ session_status: { [id]: { type: 'idle' } } });
    f.apply({ type: 'status', sessionID: id, status: { type: 'idle' }, sequence: 20, eventID: 'idle-20' });
    expect(f.store.getState().eventSequence?.[id]).toBe(20);
    f.apply({ type: 'status', sessionID: id, status: { type: 'busy' }, sequence: 19, eventID: 'busy-19' });
    expect(f.store.getState().session_status[id]).toEqual({ type: 'idle' });
    expect(useGlobalSessionStatusStore.getState().statusById.has(id)).toBe(false);
  } finally {
    f.stores.disposeAll();
  }
});

test('a stale terminal event cannot publish a global idle side effect', () => {
  const id = 'busy-sequence';
  const f = fixture(async () => makeSession(id));
  try {
    f.apply({ type: 'status', sessionID: id, status: { type: 'busy' }, sequence: 20, eventID: 'busy-20' });
    f.apply({ type: 'status', sessionID: id, status: { type: 'idle' }, outcome: 'completed', sequence: 19, eventID: 'idle-19' });
    expect(f.store.getState().session_status[id]).toEqual({ type: 'busy' });
    expect(useGlobalSessionStatusStore.getState().statusById.get(id)?.status).toEqual({ type: 'busy' });
  } finally {
    f.stores.disposeAll();
  }
});
