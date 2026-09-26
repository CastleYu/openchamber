import { describe, expect, test } from 'bun:test';
import type { Message, Part } from './opencode/model';
import { collectSessionTitleTurns, formatSessionTitleContext } from './sessionTitle';
import { formatSessionAsMarkdown } from './exportSession';
import { findLatestContextFill } from '@/stores/utils/tokenUtils';

const record = (info: Message, text = ''): { info: Message; parts: Part[] } => ({
  info, parts: text ? [{ id: `part-${info.id}`, sessionID: 'ses', messageID: info.id, type: 'text', text }] : [],
});
const user = (id: string) => record({ id, sessionID: 'ses', role: 'user', time: { created: 1 } }, `Request ${id}`);
const reply = (id: string, parentID?: string) => record({
  id, sessionID: 'ses', role: 'assistant', parentID, agent: 'build', providerID: 'p', modelID: 'm',
  time: { created: 2, completed: 3 }, finish: 'stop',
}, `Answer ${id}`);

describe('shared message views', () => {
  test('keeps OC1 parent links authoritative and groups parentless OC2 replies by user turn', () => {
    const legacy = collectSessionTitleTurns([user('one'), user('two'), reply('answer', 'one')]);
    expect(legacy.map((turn) => turn.user.info.id)).toEqual(['one']);
    const current = collectSessionTitleTurns([
      user('one'), reply('answer'),
      record({ id: 'idle', sessionID: 'ses', role: 'idle', time: { created: 4 }, outcome: 'succeeded' }),
    ]);
    expect(current.map((turn) => turn.user.info.id)).toEqual(['one']);
    expect(current[0].assistant.info.parentID).toBeUndefined();
  });

  test('preserves OC2 user-attached context in titles and exports while excluding plugin prompts', () => {
    const records = [
      record({ id: 'plugin', sessionID: 'ses', role: 'synthetic', time: { created: 0 }, text: 'plugin-only' }),
      record({ id: 'context', sessionID: 'ses', role: 'synthetic', time: { created: 0 }, text: 'Selected page', metadata: {
        openchamberContext: { kind: 'browser-annotation', pageUrl: 'https://example.test', prompt: 'Selected page', text: 'Review this' },
      } }),
      user('one'), reply('answer'),
    ];
    const titleContext = formatSessionTitleContext(collectSessionTitleTurns(records));
    expect(titleContext).toContain('Selected page');
    expect(titleContext).not.toContain('plugin-only');
    const exported = formatSessionAsMarkdown(records, 'Example');
    expect(exported).toContain('**Context**');
    expect(exported).toContain('Selected page');
    expect(exported).not.toContain('plugin-only');
  });

  test('invalidates old context usage after either generation completes compaction', () => {
    const measured = { role: 'assistant', tokens: { input: 100, output: 2 } };
    expect(findLatestContextFill([measured, { role: 'assistant', summary: true, finish: 'stop' }]))
      .toEqual({ state: 'compacted', index: 1 });
    expect(findLatestContextFill([measured, { role: 'compaction', summary: 'short', status: 'completed' }]))
      .toEqual({ state: 'compacted', index: 1 });
    expect(findLatestContextFill([measured, { role: 'compaction', summary: 'short', status: 'running' }])?.state)
      .toBe('measured');
  });
});
