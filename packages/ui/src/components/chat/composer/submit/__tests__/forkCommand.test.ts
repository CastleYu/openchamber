import { expect, test } from 'bun:test';
import type { Session } from '@/lib/opencode/model';
import { createChatDraftIdentity } from '@/lib/chatDraftPersistence';
import { runForkCommand, type ForkCommandDeps } from '../forkCommand';

const fork: Session = { id: 'ses_fork', projectID: 'prj', directory: '/repo', title: 'Fork', time: { created: 1, updated: 1 } };
const selection = { providerID: 'fixture', modelID: 'model', agent: 'build', variant: 'high' };

function setup() {
  const sent: Array<{ text: string; target: { sessionId: string; directory?: string } }> = [];
  const restored: string[] = [];
  let current = true;
  let failSend = false;
  const deps: ForkCommandDeps = {
    fork: async () => fork,
    directoryFor: (session) => session.directory,
    send: async (text, _selection, target) => { sent.push({ text, target }); if (failSend) throw new Error('send failed'); },
    draftIdentity: (directory, id) => createChatDraftIdentity('runtime', directory, id),
    restoreText: (_target, text) => { restored.push(text); },
    isCurrent: () => current,
  };
  return { deps, sent, restored, setCurrent: (value: boolean) => { current = value; }, setFailSend: () => { failSend = true; } };
}

test('bare /fork opens a fork with no prompt, while /fork text sends there', async () => {
  const ctx = setup();
  expect(await runForkCommand('ses_source', '', selection, ctx.deps)).toBe('forked');
  expect(ctx.sent).toEqual([]);
  expect(await runForkCommand('ses_source', '  take another path  ', selection, ctx.deps)).toBe('sent');
  expect(ctx.sent).toEqual([{ text: 'take another path', target: { sessionId: 'ses_fork', directory: '/repo' } }]);
});

test('send failure restores the text in the fork, not the source', async () => {
  const ctx = setup();
  ctx.setFailSend();
  expect(await runForkCommand('ses_source', 'try again', selection, ctx.deps)).toBe('send-failed');
  expect(ctx.restored).toEqual(['try again']);
});

test('a runtime switch after fork prevents send and draft restoration', async () => {
  const ctx = setup();
  ctx.deps.fork = async () => { ctx.setCurrent(false); return fork; };
  expect(await runForkCommand('ses_source', 'try again', selection, ctx.deps)).toBe('stale');
  expect(ctx.sent).toEqual([]);
  expect(ctx.restored).toEqual([]);
});
