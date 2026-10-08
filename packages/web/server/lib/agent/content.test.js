import { describe, expect, it } from 'vitest';

import {
  AGENT_FINISH, AGENT_MESSAGE_ERROR, AGENT_MESSAGE_STATE, AGENT_OPERATION, AGENT_PART,
  AGENT_PERMISSION_OUTCOME, AGENT_PERMISSION_SCOPE, AGENT_ROLE, AGENT_TOOL_STATE,
} from './constants.js';
import { AGENT_INPUT_SCHEMAS, AGENT_OUTPUT_SCHEMAS } from './schemas.js';

const OP = AGENT_OPERATION;
const MSG = {
  id: 'message-1', sessionID: 'session-1', role: AGENT_ROLE.ASSISTANT,
  parts: [{ id: 'part-1', type: AGENT_PART.TEXT, text: 'Hello' }],
  state: AGENT_MESSAGE_STATE.COMPLETE,
};
const SESSION = { id: 'session-1', workspaceID: 'workspace-1' };
const PERMISSION = {
  id: 'permission-1', sessionID: 'session-1', description: 'Read a file',
  choices: [{
    id: 'allow-once', label: 'Allow once', outcome: AGENT_PERMISSION_OUTCOME.ALLOW,
    scope: AGENT_PERMISSION_SCOPE.ONCE,
  }],
};

const parseMessage = (message) => AGENT_OUTPUT_SCHEMAS[OP.GET_MESSAGE].safeParse(message);

describe('agent message and permission contracts', () => {
  it('accepts sparse metadata and preserves reasoning and tool output', () => {
    const message = {
      ...MSG,
      parts: [
        { id: 'reason-1', type: AGENT_PART.REASONING, text: 'Thinking' },
        {
          id: 'tool-1', type: AGENT_PART.TOOL, callID: 'call-1', name: 'read',
          state: { status: AGENT_TOOL_STATE.COMPLETE, input: { path: 'a.txt' }, output: { text: 'contents' } },
        },
        { id: 'text-1', type: AGENT_PART.TEXT, text: 'Done', synthetic: true, ignored: false },
      ],
    };
    const parsed = AGENT_OUTPUT_SCHEMAS[OP.GET_MESSAGE].parse(message);
    expect(parsed).toEqual(message);
    expect(parsed.parts[0].text).toBe('Thinking');
    expect(parsed.parts[1].state.output).toEqual({ text: 'contents' });
    expect(AGENT_OUTPUT_SCHEMAS[OP.LIST_MESSAGES].safeParse({ items: [message] }).success).toBe(true);
    expect(AGENT_OUTPUT_SCHEMAS[OP.ADD_SYNTHETIC].safeParse(message).success).toBe(true);
  });

  it('accepts all declared optional message metadata', () => {
    const message = {
      ...MSG, role: AGENT_ROLE.SYNTHETIC, state: AGENT_MESSAGE_STATE.INTERRUPTED,
      time: { created: 0, completed: 1 }, parentID: 'parent-1', agent: 'agent-1',
      model: { id: 'model-1', providerID: 'provider-1', variant: 'fast' }, summary: true,
      finish: AGENT_FINISH.INTERRUPTED,
      error: { kind: AGENT_MESSAGE_ERROR.INTERRUPTED, message: 'Stopped' },
      usage: { input: 2, output: 3, reasoning: 1, cacheRead: 4, cacheWrite: 5, cost: 0.1 },
    };
    expect(parseMessage(message).success).toBe(true);
  });

  it.each([
    ['unknown role', { role: 'other' }],
    ['unknown message state', { state: 'queued' }],
    ['unknown finish', { finish: 'other' }],
    ['unknown error kind', { error: { kind: 'other', message: 'x' } }],
    ['negative time', { time: { created: -1 } }],
    ['infinite time', { time: { completed: Number.POSITIVE_INFINITY } }],
    ['negative usage', { usage: { input: -1 } }],
    ['fractional token count', { usage: { output: 1.5 } }],
    ['infinite usage', { usage: { cost: Number.POSITIVE_INFINITY } }],
    ['unknown message key', { extra: true }],
  ])('rejects %s', (_name, patch) => {
    expect(parseMessage({ ...MSG, ...patch }).success).toBe(false);
  });

  it('rejects duplicate or empty part IDs and unknown part fields', () => {
    expect(parseMessage({ ...MSG, parts: [MSG.parts[0], { ...MSG.parts[0] }] }).success).toBe(false);
    expect(parseMessage({ ...MSG, parts: [{ ...MSG.parts[0], id: '' }] }).success).toBe(false);
    expect(parseMessage({ ...MSG, parts: [{ ...MSG.parts[0], extra: true }] }).success).toBe(false);
    expect(parseMessage({
      ...MSG, parts: [{ id: 'reason-1', type: AGENT_PART.REASONING, text: 'Thinking', synthetic: true }],
    }).success).toBe(false);
  });

  it('rejects invalid tool states and complete tools without output', () => {
    const tool = {
      id: 'tool-1', type: AGENT_PART.TOOL, callID: 'call-1', name: 'read',
      state: { status: AGENT_TOOL_STATE.RUNNING, input: {} },
    };
    expect(parseMessage({ ...MSG, parts: [tool] }).success).toBe(true);
    expect(parseMessage({ ...MSG, parts: [{ ...tool, state: { status: 'done' } }] }).success).toBe(false);
    expect(parseMessage({ ...MSG, parts: [{ ...tool, state: { status: AGENT_TOOL_STATE.COMPLETE, input: {} } }] }).success).toBe(false);
    expect(parseMessage({ ...MSG, parts: [{ ...tool, state: { status: AGENT_TOOL_STATE.COMPLETE, output: null } }] }).success).toBe(true);
    expect(parseMessage({ ...MSG, parts: [{ ...tool, state: { status: AGENT_TOOL_STATE.FAILED } }] }).success).toBe(false);
    expect(parseMessage({ ...MSG, parts: [{ ...tool, state: { status: AGENT_TOOL_STATE.COMPLETE, output: {}, extra: true } }] }).success).toBe(false);
    expect(parseMessage({
      ...MSG,
      parts: [{
        ...tool,
        state: {
          status: AGENT_TOOL_STATE.FAILED,
          error: { kind: AGENT_MESSAGE_ERROR.BACKEND, message: 'Unavailable' },
        },
      }],
    }).success).toBe(true);
  });

  it('rejects direct URL fields while preserving opaque asset references', () => {
    const attachment = { id: 'part-1', type: AGENT_PART.ATTACHMENT, assetID: 'asset-1', mime: 'text/plain' };
    expect(parseMessage({ ...MSG, parts: [attachment] }).success).toBe(true);
    expect(parseMessage({ ...MSG, parts: [{ ...attachment, url: 'https://example.test/a' }] }).success).toBe(false);
    expect(parseMessage({ ...MSG, parts: [{ ...attachment, assetID: 'opaque:namespace/asset' }] }).success).toBe(true);
  });

  it('validates messages nested in import input', () => {
    const input = { workspaceID: 'workspace-1', session: SESSION, messages: [MSG], requestID: 'request-1' };
    expect(AGENT_INPUT_SCHEMAS[OP.IMPORT_SESSION].safeParse(input).success).toBe(true);
    expect(AGENT_INPUT_SCHEMAS[OP.IMPORT_SESSION].safeParse({ ...input, workspaceID: 'other' }).success).toBe(false);
    expect(AGENT_INPUT_SCHEMAS[OP.IMPORT_SESSION].safeParse({ ...input, messages: [{ ...MSG, sessionID: 'other' }] }).success).toBe(false);
    expect(AGENT_INPUT_SCHEMAS[OP.IMPORT_SESSION].safeParse({
      ...input, messages: [{ ...MSG, parts: [{ ...MSG.parts[0], extra: true }] }],
    }).success).toBe(false);
    expect(AGENT_INPUT_SCHEMAS[OP.IMPORT_SESSION].safeParse({
      ...input, messages: [{ ...MSG, usage: { input: Number.NaN } }],
    }).success).toBe(false);
  });

  it('validates permission choice meaning and requires unique non-empty choices', () => {
    const schema = AGENT_OUTPUT_SCHEMAS[OP.LIST_PENDING_PERMISSIONS];
    expect(schema.safeParse([PERMISSION]).success).toBe(true);
    expect(schema.safeParse([{ ...PERMISSION, choices: [] }]).success).toBe(false);
    expect(schema.safeParse([{ ...PERMISSION, choices: [PERMISSION.choices[0], PERMISSION.choices[0]] }]).success).toBe(false);
    expect(schema.safeParse([{ ...PERMISSION, choices: [{ ...PERMISSION.choices[0], outcome: 'maybe' }] }]).success).toBe(false);
    expect(schema.safeParse([{ ...PERMISSION, choices: [{ ...PERMISSION.choices[0], scope: 'forever' }] }]).success).toBe(false);
    expect(schema.safeParse([{ ...PERMISSION, choices: [{ ...PERMISSION.choices[0], extra: true }] }]).success).toBe(false);
  });
});
