import { z } from 'zod';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_OPERATION } from './constants.js';

const id = z.string().min(1);
const json = z.json();
const metadata = z.record(z.string(), json);
const page = { cursor: z.string().optional(), limit: z.number().int().positive().optional() };
const workspace = z.object({ workspaceID: id }).strict();
const session = z.object({ workspaceID: id, sessionID: id }).strict();
const selection = { model: z.string().optional(), agent: z.string().optional() };
const effect = { requestID: id };
const sessionRecord = z.object({
  id, workspaceID: id, title: z.string().optional(), parentID: id.optional(), metadata: metadata.optional(),
}).strict();
const message = z.object({
  id, role: z.enum(['user', 'assistant', 'system']), text: z.string(),
  state: z.enum(['pending', 'complete', 'failed']),
}).strict();
const status = z.object({ sessionID: id, state: z.enum(['idle', 'busy', 'waiting', 'unknown']) }).strict();
const permission = z.object({ id, sessionID: id, description: z.string(), choices: z.array(z.string()) }).strict();
const command = z.object({ id, label: z.string(), description: z.string().optional() }).strict();
const receipt = z.discriminatedUnion('state', [
  z.object({ state: z.literal('accepted'), requestID: id }).strict(),
  z.object({ state: z.literal('complete'), requestID: id, messageID: id.optional() }).strict(),
  z.object({ state: z.literal('unknown'), requestID: id, reason: z.string() }).strict(),
]);
const resultPage = (item) => z.object({ items: z.array(item), next: z.string().optional() }).strict();
const labelItem = z.object({ id, label: z.string() }).strict();

export const agentIdentitySchema = z.object({
  family: z.enum([AGENT_FAMILY.OPENCODE, AGENT_FAMILY.CAGENT]),
  connectionID: id,
  epoch: z.number().int().nonnegative(),
  adapterRevision: id,
  capabilityRevision: id,
}).strict();

export const agentOperationSchema = z.enum(Object.values(AGENT_OPERATION));
export const agentRuntimeSchema = z.object({
  identity: agentIdentitySchema,
  operations: z.record(agentOperationSchema, z.discriminatedUnion('available', [
    z.object({ available: z.literal(true) }).strict(),
    z.object({ available: z.literal(false), reason: z.enum(Object.values(AGENT_ERROR)) }).strict(),
  ])),
}).strict();

export const AGENT_INPUT_SCHEMAS = Object.freeze({
  [AGENT_OPERATION.GET_SESSION]: session,
  [AGENT_OPERATION.CREATE_SESSION]: z.object({ workspaceID: id, title: z.string().optional(), ...effect }).strict(),
  [AGENT_OPERATION.LIST_SESSIONS]: workspace.extend(page).strict(),
  [AGENT_OPERATION.LIST_MESSAGES]: session.extend(page).strict(),
  [AGENT_OPERATION.LIST_CHILDREN]: session.extend(page).strict(),
  [AGENT_OPERATION.LIST_ACTIVE_STATUSES]: workspace,
  [AGENT_OPERATION.GET_SESSION_STATUS]: session,
  [AGENT_OPERATION.LIST_PENDING_PERMISSIONS]: workspace,
  [AGENT_OPERATION.REPLY_PERMISSION]: z.object({ workspaceID: id, sessionID: id, permissionID: id, choice: z.string(), ...effect }).strict(),
  [AGENT_OPERATION.GET_MESSAGE]: z.object({ workspaceID: id, sessionID: id, messageID: id }).strict(),
  [AGENT_OPERATION.ADD_SYNTHETIC]: z.object({ workspaceID: id, sessionID: id, text: z.string(), ...effect }).strict(),
  [AGENT_OPERATION.SWITCH_SELECTION]: session.extend({ ...selection, ...effect }).strict(),
  [AGENT_OPERATION.LIST_COMMANDS]: workspace,
  [AGENT_OPERATION.GET_SELECTION_CATALOG]: workspace,
  [AGENT_OPERATION.GET_DEFAULT_MODEL]: workspace,
  [AGENT_OPERATION.IMPORT_SESSION]: z.object({ workspaceID: id, session: sessionRecord, messages: z.array(message), ...effect }).strict(),
  [AGENT_OPERATION.FORK_SESSION]: z.object({ workspaceID: id, sessionID: id, messageID: id.optional(), ...effect }).strict(),
  [AGENT_OPERATION.REMOVE_SESSION]: session.extend(effect).strict(),
  [AGENT_OPERATION.UPDATE_SESSION]: z.object({ workspaceID: id, sessionID: id, title: z.string().optional(), metadata: metadata.optional(), ...effect }).strict(),
  [AGENT_OPERATION.SEND_PROMPT]: z.object({ workspaceID: id, sessionID: id, ...selection, requestID: id, text: z.string() }).strict(),
  [AGENT_OPERATION.SEND_COMMAND]: z.object({ workspaceID: id, sessionID: id, ...selection, requestID: id, commandID: id, arguments: z.string() }).strict(),
  [AGENT_OPERATION.INTERRUPT_SESSION]: z.object({ workspaceID: id, sessionID: id, requestID: id }).strict(),
});

export const AGENT_OUTPUT_SCHEMAS = Object.freeze({
  [AGENT_OPERATION.GET_SESSION]: sessionRecord,
  [AGENT_OPERATION.CREATE_SESSION]: sessionRecord,
  [AGENT_OPERATION.LIST_SESSIONS]: resultPage(sessionRecord),
  [AGENT_OPERATION.LIST_MESSAGES]: resultPage(message),
  [AGENT_OPERATION.LIST_CHILDREN]: resultPage(sessionRecord),
  [AGENT_OPERATION.LIST_ACTIVE_STATUSES]: z.array(status),
  [AGENT_OPERATION.GET_SESSION_STATUS]: status,
  [AGENT_OPERATION.LIST_PENDING_PERMISSIONS]: z.array(permission),
  [AGENT_OPERATION.REPLY_PERMISSION]: receipt,
  [AGENT_OPERATION.GET_MESSAGE]: message,
  [AGENT_OPERATION.ADD_SYNTHETIC]: message,
  [AGENT_OPERATION.SWITCH_SELECTION]: z.object(selection).strict(),
  [AGENT_OPERATION.LIST_COMMANDS]: z.array(command),
  [AGENT_OPERATION.GET_SELECTION_CATALOG]: z.object({ models: z.array(labelItem), agents: z.array(labelItem) }).strict(),
  [AGENT_OPERATION.GET_DEFAULT_MODEL]: z.object({ modelID: id.nullable() }).strict(),
  [AGENT_OPERATION.IMPORT_SESSION]: sessionRecord,
  [AGENT_OPERATION.FORK_SESSION]: sessionRecord,
  [AGENT_OPERATION.REMOVE_SESSION]: receipt,
  [AGENT_OPERATION.UPDATE_SESSION]: sessionRecord,
  [AGENT_OPERATION.SEND_PROMPT]: receipt,
  [AGENT_OPERATION.SEND_COMMAND]: receipt,
  [AGENT_OPERATION.INTERRUPT_SESSION]: receipt,
});
