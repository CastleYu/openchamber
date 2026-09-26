import { describe, expect, test } from 'bun:test';
import type { V2Event } from '@opencode/client';
import { parseV2Event, projectV2Event } from './events';

describe('OC2 event projection', () => {
  test('catalog events preserve the list that changed', () => {
    const types = ['config.updated', 'websearch.updated', 'credential.updated'] as const;
    const catalogs = ['config', 'websearch', 'credential'];
    types.forEach((type, index) => {
      const event: V2Event = { id: 'evt_0123456789abcdef', created: 1, type, data: {}, location: { directory: '/repo' } };
      expect(projectV2Event(event)).toMatchObject({ type: 'refresh', scope: 'global', catalog: catalogs[index], directory: '/repo' });
    });
  });
  test('validates a raw WebSocket event with the pinned OC2 schema', () => {
    const event = { id: 'evt_0123456789abcdef', created: 1, type: 'session.text.delta',
      data: { sessionID: 'ses_0123456789abcdef', assistantMessageID: 'msg_0123456789abcdef', ordinal: 0, delta: 'x' } };
    expect(parseV2Event(event)).toMatchObject(event);
    expect(parseV2Event({ ...event, data: { ...event.data, ordinal: 'zero' } })).toBeNull();
    expect(parseV2Event({ ...event, id: 'invalid' })).toBeNull();
  });
  test('projects the pinned optional VCS branch event with its directory', () => {
    const wire = { id: 'evt_0123456789abcdef', created: 1, type: 'vcs.branch.updated',
      data: { branch: 'feature' }, location: { directory: '/repo' } };
    const event = parseV2Event(wire);
    expect(event).toMatchObject(wire);
    if (!event) throw new Error('VCS event did not parse');
    expect(projectV2Event(event)).toEqual({ type: 'vcs-branch', branch: 'feature', directory: '/repo', eventID: wire.id });
    const detached = parseV2Event({ ...wire, data: {} });
    expect(detached).not.toBeNull();
    if (!detached) throw new Error('Detached VCS event did not parse');
    expect(projectV2Event(detached)).toMatchObject({ type: 'vcs-branch', branch: undefined });
    expect(parseV2Event({ ...wire, data: { branch: 3 } })).toBeNull();
  });
  test('keeps the same text and reasoning part IDs as HTTP history', () => {
    const text = {
      id: 'evt-1', created: 1, type: 'session.text.delta',
      data: { sessionID: 'ses-1', assistantMessageID: 'msg-1', ordinal: 2, delta: 'abc' },
    } as V2Event;
    const reasoning = {
      id: 'evt-2', created: 2, type: 'session.reasoning.delta',
      data: { sessionID: 'ses-1', assistantMessageID: 'msg-1', ordinal: 1, delta: 'why' },
    } as V2Event;
    expect(projectV2Event(text)).toMatchObject({ type: 'part-delta', partID: 'msg-1:text:2', delta: 'abc' });
    expect(projectV2Event(reasoning)).toMatchObject({ type: 'part-delta', partID: 'msg-1:reasoning:1', delta: 'why' });
  });

  test('keeps permissions and forms tagged separately', () => {
    const permission = {
      id: 'evt-3', created: 3, type: 'permission.asked',
      data: { id: 'perm-1', sessionID: 'ses-1', action: 'shell', resources: ['ls'] },
    } as V2Event;
    const form = {
      id: 'evt-4', created: 4, type: 'form.created',
      data: { form: { id: 'form-1', sessionID: 'ses-1', title: 'Choose', fields: [{ key: 'choice', type: 'string' }] } },
    } as V2Event;
    expect(projectV2Event(permission)).toMatchObject({ type: 'permission-asked', request: { generation: 'oc2', value: { id: 'perm-1' } } });
    expect(projectV2Event(form)).toMatchObject({ type: 'input-created', request: { generation: 'oc2', kind: 'form', value: { id: 'form-1' } } });
  });

  test('does not invent a full session from a partial metadata event', () => {
    const event = {
      id: 'evt-5', created: 5, type: 'session.renamed',
      durable: { aggregateID: 'ses-1', seq: 7, version: 1 },
      data: { sessionID: 'ses-1', title: 'New' },
    } as V2Event;
    expect(projectV2Event(event)).toEqual({ type: 'session-refresh', sessionID: 'ses-1', directory: undefined, eventID: 'evt-5', sequence: 7 });
  });
});
