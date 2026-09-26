import { expect, test } from 'bun:test';
import { INITIAL_STATE } from './types';
import type { PendingInput } from '@/lib/opencode/operations';
import { readDomainInputSnapshot, readDomainStatusSnapshot, recordDomainRecoveryEvent } from './directory-recovery-snapshots';

test('OC2 live status wins over an in-flight stale status snapshot', async () => {
  const state = structuredClone(INITIAL_STATE);
  const source = { getState: () => state };
  const result = await readDomainStatusSnapshot(source, async () => {
    recordDomainRecoveryEvent(source, { type: 'status', eventID: 'evt_1', sessionID: 'ses_1', status: { type: 'busy' } });
    return { ses_1: { type: 'idle' } };
  });
  expect(result.ses_1).toEqual({ type: 'busy' });
});

test('OC2 form close during fetch cannot resurrect the pending form', async () => {
  const state = structuredClone(INITIAL_STATE);
  const form: PendingInput = { generation: 'oc2', kind: 'form',
    value: { id: 'form_1', sessionID: 'ses_1', title: 'Choose', fields: [{ key: 'choice', type: 'string' }] } };
  const source = { getState: () => state };
  const result = await readDomainInputSnapshot(source, async () => {
    recordDomainRecoveryEvent(source, { type: 'form-closed', eventID: 'evt_2', sessionID: 'ses_1', requestID: 'form_1' });
    return [form];
  });
  expect(result.ses_1).toBeUndefined();
});
