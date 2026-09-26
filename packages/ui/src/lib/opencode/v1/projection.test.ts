import { describe, expect, test } from 'bun:test';
import type { Message as LegacyMessage, Part as LegacyPart, Session as LegacySession } from '@opencode-ai/sdk/v2';
import { describeMessageError } from '../model';
import { projectLegacyMessage, projectLegacyMessages, projectLegacyPart, projectLegacySession } from './projection';

const session: LegacySession = {
  id: 'ses_1', slug: 'bright-fox', version: '1.18.32', projectID: 'prj_1',
  directory: '/work', title: 'Test', time: { created: 1, updated: 2, compacting: 3 },
  summary: { additions: 1, deletions: 2, files: 1, diffs: [{ additions: 1, deletions: 2, file: 'a.ts', patch: 'diff' }] },
  share: { url: 'https://example.test/share' },
  permission: [{ permission: 'edit', pattern: '*', action: 'ask' }],
  revert: { messageID: 'msg_1', partID: 'part_1', snapshot: 'snap', diff: 'diff' },
  metadata: { nested: { list: [1, true, null, 'text'] }, count: 0 },
};

const user: Extract<LegacyMessage, { role: 'user' }> = {
  id: 'msg_1', sessionID: 'ses_1', role: 'user', time: { created: 1 },
  agent: 'build', model: { providerID: 'p', modelID: 'm' },
  format: { type: 'json_schema', schema: { properties: { nested: { type: 'array' } } } },
  summary: { title: 'Summary', diffs: [{ additions: 1, deletions: 0 }] },
  system: 'Use tools', tools: { shell: true },
};

const assistant: Extract<LegacyMessage, { role: 'assistant' }> = {
  id: 'msg_2', sessionID: 'ses_1', role: 'assistant', parentID: 'msg_1',
  providerID: 'p', modelID: 'm', mode: 'primary', agent: 'build',
  path: { cwd: '/work', root: '/work' }, time: { created: 2, completed: 3 },
  cost: 0.2, tokens: { total: 10, input: 5, output: 3, reasoning: 2, cache: { read: 1, write: 0 } },
  finish: 'custom-finish', summary: true, structured: { nested: [null, 1, true] },
  error: { name: 'APIError', data: { message: 'rate limited', statusCode: 429, isRetryable: true, responseBody: 'wait' } },
};

const base = { id: 'part_1', sessionID: 'ses_1', messageID: 'msg_2' };
const parts: LegacyPart[] = [
  { ...base, type: 'text', text: 'hello', synthetic: true, ignored: true, metadata: { nested: [1, null] } },
  { ...base, id: 'part_2', type: 'reasoning', text: 'why', time: { start: 1 }, metadata: { visible: false } },
  { ...base, id: 'part_3', type: 'file', mime: 'text/plain', url: 'data:text/plain,hi', source: { type: 'file', path: '/work/a', text: { value: 'a', start: 0, end: 1 } } },
  { ...base, id: 'part_3_symbol', type: 'file', mime: 'text/plain', url: 'data:text/plain,hi', source: { type: 'symbol', path: '/work/a', name: 'main', kind: 12, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, text: { value: 'main', start: 0, end: 4 } } },
  { ...base, id: 'part_3_resource', type: 'file', mime: 'text/plain', url: 'data:text/plain,hi', source: { type: 'resource', clientName: 'mcp', uri: 'resource://one', text: { value: 'one', start: 0, end: 3 } } },
  { ...base, id: 'part_4', type: 'agent', name: 'explore', source: { value: '@explore', start: 0, end: 8 } },
  { ...base, id: 'part_5', type: 'tool', callID: 'call_1', tool: 'shell', metadata: { trace: { id: 1 } }, state: {
    status: 'completed', input: { command: 'pwd', options: { quiet: true } }, output: '/work', title: 'shell',
    metadata: { exit: 0 }, time: { start: 1, end: 2, compacted: 3 },
    attachments: [{ ...base, id: 'file_1', type: 'file', mime: 'text/plain', url: 'data:text/plain,ok' }],
  } },
  { ...base, id: 'part_5_pending', type: 'tool', callID: 'call_2', tool: 'shell', state: { status: 'pending', input: { command: 'pwd' }, raw: '{"command":"pwd"}' } },
  { ...base, id: 'part_5_running', type: 'tool', callID: 'call_3', tool: 'shell', state: { status: 'running', input: { command: 'pwd' }, title: 'Running', metadata: { attempt: 1 }, time: { start: 1 } } },
  { ...base, id: 'part_5_error', type: 'tool', callID: 'call_4', tool: 'shell', state: { status: 'error', input: { command: 'pwd' }, error: 'failed', metadata: { code: 1 }, time: { start: 1, end: 2 } } },
  { ...base, id: 'part_6', type: 'subtask', prompt: 'Check', description: 'Audit', agent: 'explore' },
  { ...base, id: 'part_7', type: 'step-start', snapshot: 'before' },
  { ...base, id: 'part_8', type: 'step-finish', reason: 'stop', cost: 0.1, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
  { ...base, id: 'part_9', type: 'snapshot', snapshot: 'after' },
  { ...base, id: 'part_10', type: 'patch', hash: 'hash', files: ['a.ts'] },
  { ...base, id: 'part_11', type: 'retry', attempt: 2, time: { created: 4 }, error: { name: 'APIError', data: { message: 'retry', isRetryable: true, statusCode: 503 } } },
  { ...base, id: 'part_12', type: 'compaction', auto: false, overflow: true, tail_start_id: 'msg_1' },
];

describe('OC1 domain projection', () => {
  test('preserves every actual session and message field without replacing IDs', () => {
    expect(projectLegacySession(session)).toEqual(session);
    expect(projectLegacyMessage(user)).toEqual(user);
    expect(projectLegacyMessage(assistant)).toEqual(assistant);
    expect(projectLegacyMessages([{ info: assistant, parts }])[0].info.id).toBe('msg_2');
  });

  test('preserves each OC1 part variant and nested JSON payload', () => {
    expect(parts.map(projectLegacyPart)).toEqual(parts);
    expect(projectLegacyMessages([{ info: assistant, parts }])[0].parts.map((part) => part.id)).toEqual(parts.map((part) => part.id));
  });

  test('keeps legacy error names, retryability and OC2 structured errors distinct', () => {
    const projected = projectLegacyMessage(assistant);
    if (projected.role !== 'assistant' || !projected.error) throw new Error('Expected assistant error');
    expect(describeMessageError(projected.error)).toEqual({ name: 'APIError', message: 'rate limited', status: 429, retryable: true });
    expect(describeMessageError({ type: 'ServiceUnavailableError', message: 'offline', status: 503 })).toEqual({ name: 'ServiceUnavailableError', message: 'offline', status: 503 });
    expect(projectLegacyMessage({ ...assistant, error: { name: 'MessageOutputLengthError', data: { limit: 100, detail: [null, 'x'] } } })).toMatchObject({ error: { name: 'MessageOutputLengthError', data: { limit: 100, detail: [null, 'x'] } } });
    const errors: Array<NonNullable<typeof assistant.error>> = [
      { name: 'ProviderAuthError', data: { providerID: 'p', message: 'auth' } },
      { name: 'UnknownError', data: { message: 'unknown', ref: 'ref_1' } },
      { name: 'MessageOutputLengthError', data: { limit: 100 } },
      { name: 'MessageAbortedError', data: { message: 'aborted' } },
      { name: 'StructuredOutputError', data: { message: 'schema', retries: 2 } },
      { name: 'ContextOverflowError', data: { message: 'full', responseBody: 'body' } },
      { name: 'ContentFilterError', data: { message: 'blocked' } },
      { name: 'APIError', data: { message: 'retry', isRetryable: true, statusCode: 503, responseHeaders: { retry: '1' }, metadata: { request: 'r' } } },
    ];
    for (const error of errors) expect(projectLegacyMessage({ ...assistant, error })).toMatchObject({ error });
  });

  test('rejects injected non-JSON payloads at ingress', () => {
    expect(() => projectLegacySession({ ...session, metadata: { bad: undefined } })).toThrow();
    expect(() => projectLegacyMessage({ ...assistant, structured: () => 1 })).toThrow();
    expect(() => projectLegacyMessage({ ...user, format: { type: 'json_schema', schema: { bad: undefined } } })).toThrow();
    expect(() => projectLegacyPart({ ...base, type: 'tool', callID: 'call', tool: 'shell', state: { status: 'pending', input: { bad: undefined }, raw: '' } })).toThrow();
  });
});
