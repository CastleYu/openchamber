import { expect, test } from 'bun:test';
import type { Message } from '@/lib/opencode/model';
import { assistantForkBoundary, findLastCompletedTurnMessageId } from './assistant-fork';
import { withoutSourceOwnedLinks } from '@/lib/sessionForkLinks';

const answer: Message = { id: 'answer', sessionID: 'session', role: 'assistant', time: { created: 2, completed: 3 }, agent: 'build', providerID: 'fixture', modelID: 'fixture' };
const next: Message = { id: 'next', sessionID: 'session', role: 'user', time: { created: 4 }, agent: 'build', model: { providerID: 'fixture', modelID: 'fixture' } };

test('keeps the whole answer turn and excludes the next user prompt', () => {
  expect(assistantForkBoundary([answer, { ...answer, id: 'step2' }, next], answer.id)).toBe(next.id);
  expect(assistantForkBoundary([answer], answer.id)).toBeUndefined();
  expect(() => assistantForkBoundary([next], next.id)).toThrow();
  expect(() => assistantForkBoundary([answer], 'missing')).toThrow();
});

test('cuts before OC2 compaction, shell, or a completed subagent run', () => {
  const compaction: Message = { id: 'compact', sessionID: 'session', role: 'compaction', time: { created: 4 }, status: 'running', reason: 'manual', summary: '' };
  const shell: Message = { id: 'shell', sessionID: 'session', role: 'shell', time: { created: 4 }, shellID: 'sh', command: 'pwd', status: 'running' };
  const run: Message = { id: 'run', sessionID: 'session', role: 'synthetic', time: { created: 4 }, text: 'done',
    metadata: { source: 'subagent', childID: 'child', state: 'completed' } };
  for (const boundary of [compaction, shell, run]) {
    expect(assistantForkBoundary([answer, boundary, next], answer.id)).toBe(boundary.id);
  }
});

test('fork metadata retains personal fields while unlinking source-owned sessions', () => {
  const source = { other: 'retained', openchamber: { btwSessionID: 'source-btw', reviewSessionID: 'source-review', personal: true, goal: { id: 'goal', status: 'active' } } };
  expect(withoutSourceOwnedLinks(source)).toEqual({ other: 'retained', openchamber: { personal: true, goal: { id: 'goal', status: 'paused', statusReason: 'paused in fork' } } });
  expect(source.openchamber.btwSessionID).toBe('source-btw');
});

test('last finished turn excludes a still-running source turn', () => {
  const firstUser: Message = { ...next, id: 'first-user', time: { created: 1 } };
  const runningUser: Message = { ...next, id: 'running-user', time: { created: 5 } };
  const completedStep: Message = { ...answer, id: 'completed-step', time: { created: 6, completed: 7 } };
  const messages = [firstUser, answer, runningUser, completedStep];
  expect(findLastCompletedTurnMessageId(messages, true)).toBe(answer.id);
  expect(findLastCompletedTurnMessageId(messages, false)).toBe(completedStep.id);
  expect(findLastCompletedTurnMessageId([firstUser, runningUser], false)).toBeNull();
});
