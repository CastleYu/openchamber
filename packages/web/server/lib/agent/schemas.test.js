import { describe, expect, it } from 'vitest';

import { AGENT_FAMILY, AGENT_OPERATION } from './constants.js';
import { AGENT_INPUT_SCHEMAS, AGENT_OUTPUT_SCHEMAS, agentIdentitySchema, agentOperationSchema } from './schemas.js';

const OP = AGENT_OPERATION;
const OPERATIONS = [
  OP.GET_SESSION, OP.CREATE_SESSION, OP.LIST_SESSIONS, OP.LIST_MESSAGES, OP.LIST_CHILDREN,
  OP.LIST_ACTIVE_STATUSES, OP.GET_SESSION_STATUS, OP.LIST_PENDING_PERMISSIONS, OP.REPLY_PERMISSION,
  OP.GET_MESSAGE, OP.ADD_SYNTHETIC, OP.SWITCH_SELECTION, OP.LIST_COMMANDS, OP.GET_SELECTION_CATALOG,
  OP.GET_DEFAULT_MODEL, OP.IMPORT_SESSION, OP.FORK_SESSION, OP.REMOVE_SESSION, OP.UPDATE_SESSION,
  OP.SEND_PROMPT, OP.SEND_COMMAND, OP.INTERRUPT_SESSION,
];

const SESSION = { id: 'session-1', workspaceID: 'workspace-1', title: 'Session', metadata: { source: 'test' } };
const MESSAGE = { id: 'message-1', role: 'assistant', text: 'Hello', state: 'complete' };
const RECEIPT = { state: 'accepted', requestID: 'request-1' };
const inputs = {
  [OP.GET_SESSION]: { workspaceID: 'workspace-1', sessionID: 'session-1' },
  [OP.CREATE_SESSION]: { workspaceID: 'workspace-1', title: 'New session' },
  [OP.LIST_SESSIONS]: { workspaceID: 'workspace-1', cursor: 'cursor-1', limit: 10 },
  [OP.LIST_MESSAGES]: { workspaceID: 'workspace-1', sessionID: 'session-1', limit: 10 },
  [OP.LIST_CHILDREN]: { workspaceID: 'workspace-1', sessionID: 'session-1' },
  [OP.LIST_ACTIVE_STATUSES]: { workspaceID: 'workspace-1' },
  [OP.GET_SESSION_STATUS]: { workspaceID: 'workspace-1', sessionID: 'session-1' },
  [OP.LIST_PENDING_PERMISSIONS]: { workspaceID: 'workspace-1' },
  [OP.REPLY_PERMISSION]: { workspaceID: 'workspace-1', sessionID: 'session-1', permissionID: 'permission-1', choice: 'allow' },
  [OP.GET_MESSAGE]: { workspaceID: 'workspace-1', sessionID: 'session-1', messageID: 'message-1' },
  [OP.ADD_SYNTHETIC]: { workspaceID: 'workspace-1', sessionID: 'session-1', text: 'Synthetic' },
  [OP.SWITCH_SELECTION]: { workspaceID: 'workspace-1', sessionID: 'session-1', model: 'model-1', agent: 'agent-1' },
  [OP.LIST_COMMANDS]: { workspaceID: 'workspace-1' },
  [OP.GET_SELECTION_CATALOG]: { workspaceID: 'workspace-1' },
  [OP.GET_DEFAULT_MODEL]: { workspaceID: 'workspace-1' },
  [OP.IMPORT_SESSION]: { workspaceID: 'workspace-1', session: SESSION, messages: [MESSAGE] },
  [OP.FORK_SESSION]: { workspaceID: 'workspace-1', sessionID: 'session-1', messageID: 'message-1' },
  [OP.REMOVE_SESSION]: { workspaceID: 'workspace-1', sessionID: 'session-1' },
  [OP.UPDATE_SESSION]: { workspaceID: 'workspace-1', sessionID: 'session-1', title: 'Updated', metadata: { count: 2 } },
  [OP.SEND_PROMPT]: { workspaceID: 'workspace-1', sessionID: 'session-1', requestID: 'request-1', text: 'Hello', model: 'model-1' },
  [OP.SEND_COMMAND]: { workspaceID: 'workspace-1', sessionID: 'session-1', requestID: 'request-1', commandID: 'command-1', arguments: '--verbose' },
  [OP.INTERRUPT_SESSION]: { workspaceID: 'workspace-1', sessionID: 'session-1', requestID: 'request-1' },
};
const outputs = {
  [OP.GET_SESSION]: SESSION,
  [OP.CREATE_SESSION]: SESSION,
  [OP.LIST_SESSIONS]: { items: [SESSION], next: 'next-1' },
  [OP.LIST_MESSAGES]: { items: [MESSAGE] },
  [OP.LIST_CHILDREN]: { items: [SESSION] },
  [OP.LIST_ACTIVE_STATUSES]: [{ sessionID: 'session-1', state: 'busy' }],
  [OP.GET_SESSION_STATUS]: { sessionID: 'session-1', state: 'idle' },
  [OP.LIST_PENDING_PERMISSIONS]: [{ id: 'permission-1', sessionID: 'session-1', description: 'Allow access', choices: ['allow', 'deny'] }],
  [OP.REPLY_PERMISSION]: RECEIPT,
  [OP.GET_MESSAGE]: MESSAGE,
  [OP.ADD_SYNTHETIC]: MESSAGE,
  [OP.SWITCH_SELECTION]: { model: 'model-1', agent: 'agent-1' },
  [OP.LIST_COMMANDS]: [{ id: 'command-1', label: 'Build', description: 'Build project' }],
  [OP.GET_SELECTION_CATALOG]: { models: [{ id: 'model-1', label: 'Model' }], agents: [{ id: 'agent-1', label: 'Agent' }] },
  [OP.GET_DEFAULT_MODEL]: { modelID: null },
  [OP.IMPORT_SESSION]: SESSION,
  [OP.FORK_SESSION]: SESSION,
  [OP.REMOVE_SESSION]: { state: 'complete', requestID: 'request-1' },
  [OP.UPDATE_SESSION]: SESSION,
  [OP.SEND_PROMPT]: RECEIPT,
  [OP.SEND_COMMAND]: RECEIPT,
  [OP.INTERRUPT_SESSION]: RECEIPT,
};
const REQUIRED_IDS = {
  [OP.GET_SESSION]: ['workspaceID', 'sessionID'],
  [OP.CREATE_SESSION]: ['workspaceID'],
  [OP.LIST_SESSIONS]: ['workspaceID'],
  [OP.LIST_MESSAGES]: ['workspaceID', 'sessionID'],
  [OP.LIST_CHILDREN]: ['workspaceID', 'sessionID'],
  [OP.LIST_ACTIVE_STATUSES]: ['workspaceID'],
  [OP.GET_SESSION_STATUS]: ['workspaceID', 'sessionID'],
  [OP.LIST_PENDING_PERMISSIONS]: ['workspaceID'],
  [OP.REPLY_PERMISSION]: ['workspaceID', 'sessionID'],
  [OP.GET_MESSAGE]: ['workspaceID', 'sessionID'],
  [OP.ADD_SYNTHETIC]: ['workspaceID', 'sessionID'],
  [OP.SWITCH_SELECTION]: ['workspaceID', 'sessionID'],
  [OP.LIST_COMMANDS]: ['workspaceID'],
  [OP.GET_SELECTION_CATALOG]: ['workspaceID'],
  [OP.GET_DEFAULT_MODEL]: ['workspaceID'],
  [OP.IMPORT_SESSION]: ['workspaceID'],
  [OP.FORK_SESSION]: ['workspaceID', 'sessionID'],
  [OP.REMOVE_SESSION]: ['workspaceID', 'sessionID'],
  [OP.UPDATE_SESSION]: ['workspaceID', 'sessionID'],
  [OP.SEND_PROMPT]: ['workspaceID', 'sessionID'],
  [OP.SEND_COMMAND]: ['workspaceID', 'sessionID'],
  [OP.INTERRUPT_SESSION]: ['workspaceID', 'sessionID'],
};

const withUnknownKey = (value) => (Array.isArray(value)
  ? [...value, { unexpected: true }]
  : { ...value, unexpected: true });

describe('agent boundary schemas', () => {
  it('matches the declared 22-operation input and output inventory', () => {
    const declared = Object.values(OP);
    expect(OPERATIONS).toHaveLength(22);
    expect(new Set(OPERATIONS).size).toBe(OPERATIONS.length);
    expect([...OPERATIONS].sort()).toEqual([...declared].sort());
    expect(Object.keys(AGENT_INPUT_SCHEMAS).sort()).toEqual([...declared].sort());
    expect(Object.keys(AGENT_OUTPUT_SCHEMAS).sort()).toEqual([...declared].sort());
    expect(Object.keys(inputs).sort()).toEqual([...declared].sort());
    expect(Object.keys(outputs).sort()).toEqual([...declared].sort());
    expect(agentOperationSchema.options).toEqual(declared);
  });

  it.each(OPERATIONS)('%s accepts its declared input and output shape', (operation) => {
    expect(AGENT_INPUT_SCHEMAS[operation].parse(inputs[operation])).toEqual(inputs[operation]);
    expect(AGENT_OUTPUT_SCHEMAS[operation].parse(outputs[operation])).toEqual(outputs[operation]);
  });

  it.each(OPERATIONS)('%s requires its workspace and session identifiers', (operation) => {
    for (const field of REQUIRED_IDS[operation]) {
      const { [field]: omitted, ...withoutID } = inputs[operation];
      expect(omitted).toBeDefined();
      expect(AGENT_INPUT_SCHEMAS[operation].safeParse(withoutID).success, `${operation} missing ${field}`).toBe(false);
      expect(AGENT_INPUT_SCHEMAS[operation].safeParse({ ...inputs[operation], [field]: '' }).success, `${operation} empty ${field}`).toBe(false);
    }
  });

  it.each(OPERATIONS)('%s rejects unknown input keys and malformed output', (operation) => {
    expect(AGENT_INPUT_SCHEMAS[operation].safeParse({ ...inputs[operation], unexpected: true }).success).toBe(false);
    expect(AGENT_OUTPUT_SCHEMAS[operation].safeParse(null).success).toBe(false);
    expect(AGENT_OUTPUT_SCHEMAS[operation].safeParse(withUnknownKey(outputs[operation])).success).toBe(false);
  });

  it('validates identity fields and rejects unknown identity keys', () => {
    const identity = {
      family: AGENT_FAMILY.CAGENT, connectionID: 'connection', epoch: 0,
      adapterRevision: 'adapter', capabilityRevision: 'capability',
    };
    expect(agentIdentitySchema.parse(identity)).toEqual(identity);
    expect(agentIdentitySchema.safeParse({ ...identity, family: 'other' }).success).toBe(false);
    expect(agentIdentitySchema.safeParse({ ...identity, epoch: -1 }).success).toBe(false);
    expect(agentIdentitySchema.safeParse({ ...identity, connectionID: '' }).success).toBe(false);
    expect(agentIdentitySchema.safeParse({ ...identity, extra: true }).success).toBe(false);
  });
});
