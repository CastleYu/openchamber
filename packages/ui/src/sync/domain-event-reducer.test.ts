import { describe, expect, test } from 'bun:test';
import type { DomainEvent } from '@/lib/opencode/events';
import { applyDomainEvent } from './event-reducer';
import { INITIAL_STATE } from './types';

const state = () => structuredClone(INITIAL_STATE);

describe('OC2 domain event reducer', () => {
  test('updates and clears the tray branch without losing the default branch', () => {
    const draft = state();
    draft.vcs = { branch: 'main', default_branch: 'main' };
    expect(applyDomainEvent(draft, { type: 'vcs-branch', branch: 'feature', directory: '/repo', eventID: 'vcs-1' }).changed).toBe(true);
    expect(draft.vcs).toEqual({ branch: 'feature', default_branch: 'main' });
    expect(applyDomainEvent(draft, { type: 'vcs-branch', branch: 'feature', eventID: 'vcs-2' }).changed).toBe(false);
    expect(applyDomainEvent(draft, { type: 'vcs-branch', eventID: 'vcs-3' }).changed).toBe(true);
    expect(draft.vcs?.branch).toBeUndefined();
  });
  test('appends repeated text deltas and ignores a replayed durable sequence', () => {
    const draft = state();
    draft.message['ses-1'] = [{ id: 'msg-1', sessionID: 'ses-1', role: 'assistant', time: { created: 1 }, agent: 'build', providerID: 'p', modelID: 'm' }];
    draft.part['msg-1'] = [{ id: 'msg-1:text:0', sessionID: 'ses-1', messageID: 'msg-1', type: 'text', text: 'ha' }];
    const first: DomainEvent = { type: 'part-delta', sessionID: 'ses-1', messageID: 'msg-1', partID: 'msg-1:text:0', delta: 'ha', eventID: 'evt-1' };
    expect(applyDomainEvent(draft, first).changed).toBe(true);
    expect(draft.part['msg-1'][0]).toMatchObject({ text: 'haha' });
    const status: DomainEvent = { type: 'status', sessionID: 'ses-1', status: { type: 'busy' }, eventID: 'evt-2', sequence: 4 };
    expect(applyDomainEvent(draft, status).changed).toBe(true);
    expect(applyDomainEvent(draft, status).changed).toBe(false);
  });

  test('keeps permission and form requests in separately tagged state', () => {
    const draft = state();
    applyDomainEvent(draft, { type: 'permission-asked', eventID: 'p1', request: {
      generation: 'oc2', value: { id: 'perm-1', sessionID: 'ses-1', action: 'shell', resources: [] },
    } });
    applyDomainEvent(draft, { type: 'input-created', eventID: 'f1', request: {
      generation: 'oc2', kind: 'form', value: { id: 'form-1', sessionID: 'ses-1', title: 'Choose', fields: [{ key: 'choice', type: 'string' }] },
    } });
    expect(draft.pendingPermission['ses-1']).toHaveLength(1);
    expect(draft.pendingInput['ses-1']).toHaveLength(1);
    expect(draft.question['ses-1']).toBeUndefined();
    applyDomainEvent(draft, { type: 'form-closed', eventID: 'f2', sessionID: 'ses-1', requestID: 'form-1' });
    expect(draft.pendingInput['ses-1']).toHaveLength(0);
    expect(draft.pendingPermission['ses-1']).toHaveLength(1);
  });

  test('requests authoritative message recovery for an orphan delta', () => {
    const draft = state();
    expect(applyDomainEvent(draft, {
      type: 'part-delta', sessionID: 'ses-1', messageID: 'msg-1', partID: 'msg-1:text:0', delta: 'x', eventID: 'evt-3',
    })).toEqual({ changed: false, refresh: { type: 'message', sessionID: 'ses-1', messageID: 'msg-1' } });
  });
});
