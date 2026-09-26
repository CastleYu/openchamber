import { expect, test } from 'bun:test';
import type { Message, Part, Session } from '@/lib/opencode/model';
import { loadFusionOutputs, type FusionSource } from './fusion';
import { getMultiRunIdentity, withMultiRunMembership } from './identity';

type FusionApi = Parameters<typeof loadFusionOutputs>[0];
type MessageRecord = { info: Message; parts: Part[] };

const session: Session = {
  id: 'run', directory: '/repo', projectID: 'project', title: 'renamed freely', time: { created: 1, updated: 1 },
  metadata: withMultiRunMembership({}, {
    version: 1, sessionID: 'run', group: { kind: 'id', id: '9f512893-6e63-4e49-a534-5de733ca103e' },
    groupSlug: 'bench', role: 'run', providerID: 'openrouter', modelID: 'vendor/model',
  }),
};
const identity = getMultiRunIdentity(session);
if (!identity) throw new Error('Fixture must have membership');
const source: FusionSource = { session, identity, directory: '/repo', projectDirectory: '/repo' };

const assistant = (id: string, created: number, text: string): MessageRecord => ({
  info: { id, sessionID: session.id, role: 'assistant', time: { created, completed: created + 1 },
    agent: 'build', providerID: 'openrouter', modelID: 'vendor/model' },
  parts: [{ id: `${id}-text`, sessionID: session.id, messageID: id, type: 'text', text }],
});
const user: MessageRecord = { info: { id: 'user', sessionID: session.id, role: 'user', time: { created: 3 } }, parts: [] };

function fixture(records: MessageRecord[], options: { changedMembership?: boolean; failRead?: boolean; switchAfterGet?: boolean } = {}) {
  const calls: string[] = [];
  let current = true;
  const api: FusionApi = {
    async getSession(id, directory) {
      calls.push('get');
      expect([id, directory]).toEqual(['run', '/repo']);
      if (options.switchAfterGet) current = false;
      return options.changedMembership ? { ...session, id: 'fork' } : { ...session, title: 'renamed again' };
    },
    async getSessionMessages(id, limit, directory) {
      calls.push('messages');
      expect([id, limit, directory]).toEqual(['run', 50, '/repo']);
      if (options.failRead) throw new Error('read unavailable');
      return records;
    },
  };
  const assertCurrent = () => { if (!current) throw new Error('Runtime changed'); };
  return { api, calls, assertCurrent };
}

for (const generation of ['oc1', 'oc2'] as const) {
  test(`${generation} fuses the latest assistant output despite page order`, async () => {
    const records = generation === 'oc1'
      ? [assistant('older', 2, 'older'), user, assistant('latest', 4, 'latest result')]
      : [assistant('latest', 4, 'latest result'), user, assistant('older', 2, 'older')];
    const current = fixture(records);
    const result = await loadFusionOutputs(current.api, [source], source.identity, generation, current.assertCurrent);
    expect(result.map((item) => item.text)).toEqual(['latest result']);
    expect(result[0]?.source.session.title).toBe('renamed again');
    expect(current.calls).toEqual(['get', 'messages']);
  });
}

test('a selected ID whose membership changed is rejected before reading output', async () => {
  const current = fixture([], { changedMembership: true });
  await expect(loadFusionOutputs(current.api, [source], source.identity, 'oc2', current.assertCurrent)).rejects.toThrow('membership changed');
  expect(current.calls).toEqual(['get']);
});

test('a failed output read is distinct from a successful empty answer', async () => {
  const failed = fixture([], { failRead: true });
  await expect(loadFusionOutputs(failed.api, [source], source.identity, 'oc1', failed.assertCurrent)).rejects.toThrow('read unavailable');
  const empty = fixture([user]);
  expect(await loadFusionOutputs(empty.api, [source], source.identity, 'oc2', empty.assertCurrent)).toEqual([]);
});

test('a runtime switch after source lookup stops the next request', async () => {
  const current = fixture([assistant('answer', 2, 'answer')], { switchAfterGet: true });
  await expect(loadFusionOutputs(current.api, [source], source.identity, 'oc2', current.assertCurrent)).rejects.toThrow('Runtime changed');
  expect(current.calls).toEqual(['get']);
});
