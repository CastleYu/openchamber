import { z } from 'zod';

import {
  AGENT_ERROR, AGENT_FAMILY, AGENT_FEATURE, AGENT_FINISH, AGENT_MESSAGE_ERROR, AGENT_MESSAGE_STATE, AGENT_OPERATION,
  AGENT_PART, AGENT_PERMISSION_OUTCOME, AGENT_PERMISSION_SCOPE, AGENT_ROLE, AGENT_SERVER_METHOD, AGENT_SUPPORT, AGENT_TOOL_STATE,
} from './constants.js';

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
const measure = z.number().nonnegative();
const count = z.number().int().nonnegative();
const messageError = z.object({ kind: z.enum(Object.values(AGENT_MESSAGE_ERROR)), message: z.string() }).strict();
const toolState = z.discriminatedUnion('status', [
  z.object({ status: z.literal(AGENT_TOOL_STATE.PENDING), input: json.optional() }).strict(),
  z.object({ status: z.literal(AGENT_TOOL_STATE.RUNNING), input: json.optional() }).strict(),
  z.object({ status: z.literal(AGENT_TOOL_STATE.UNKNOWN), input: json.optional() }).strict(),
  z.object({ status: z.literal(AGENT_TOOL_STATE.COMPLETE), input: json.optional(), output: json }).strict(),
  z.object({ status: z.literal(AGENT_TOOL_STATE.FAILED), input: json.optional(), error: messageError, output: json.optional() }).strict(),
]);
const part = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal(AGENT_PART.TEXT), text: z.string(), synthetic: z.boolean().optional(), ignored: z.boolean().optional() }).strict(),
  z.object({ id, type: z.literal(AGENT_PART.REASONING), text: z.string() }).strict(),
  z.object({ id, type: z.literal(AGENT_PART.TOOL), callID: id, name: id, state: toolState }).strict(),
  z.object({ id, type: z.literal(AGENT_PART.ATTACHMENT), assetID: id, mime: id, filename: z.string().optional() }).strict(),
]);
const message = z.object({
  id, sessionID: id, role: z.enum(Object.values(AGENT_ROLE)),
  parts: z.array(part).refine((items) => new Set(items.map((item) => item.id)).size === items.length),
  state: z.enum(Object.values(AGENT_MESSAGE_STATE)),
  time: z.object({ created: measure.optional(), completed: measure.optional() }).strict().optional(),
  parentID: id.optional(), agent: id.optional(),
  model: z.object({ id, providerID: id.optional(), variant: id.optional() }).strict().optional(),
  summary: z.boolean().optional(), finish: z.enum(Object.values(AGENT_FINISH)).optional(), error: messageError.optional(),
  usage: z.object({
    input: count.optional(), output: count.optional(), reasoning: count.optional(),
    cacheRead: count.optional(), cacheWrite: count.optional(), cost: measure.optional(),
  }).strict().optional(),
}).strict();
const status = z.object({ sessionID: id, state: z.enum(['idle', 'busy', 'waiting', 'unknown']) }).strict();
const permission = z.object({
  id, sessionID: id, description: z.string(),
  choices: z.array(z.object({
    id, label: id, outcome: z.enum(Object.values(AGENT_PERMISSION_OUTCOME)), scope: z.enum(Object.values(AGENT_PERMISSION_SCOPE)),
  }).strict()).min(1).refine((items) => new Set(items.map((item) => item.id)).size === items.length),
}).strict();
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
export const agentRequestControlSchema = z.object({ signal: z.instanceof(AbortSignal).optional() }).strict();

export const agentServerRequestSchema = z.object({
  method: z.enum(Object.values(AGENT_SERVER_METHOD)),
  path: z.string().regex(/^\/(?!\/)[^\\?#\u0000-\u001f]*$/),
  query: z.record(z.string(), z.string()).optional(), body: z.json().optional(),
}).strict();
export const agentServerResponseSchema = z.object({
  status: z.number().int().min(100).max(599), body: z.json(),
}).strict();
export const agentAdapterSchema = z.object({
  capabilities: z.partialRecord(agentOperationSchema, z.object({
    state: z.enum(Object.values(AGENT_SUPPORT)),
    evidence: z.array(id).refine((items) => new Set(items).size === items.length), reason: id.optional(),
  }).strict()),
  handlers: z.partialRecord(agentOperationSchema, z.function()),
}).strict();
export const agentRegistrationSchema = agentAdapterSchema.extend({
  adapterID: id, family: z.enum(Object.values(AGENT_FAMILY)), adapterRevision: id, capabilityRevision: id,
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const agentSelectionSchema = agentIdentitySchema.extend({
  adapterID: id, serverRevision: id, ready: z.boolean(), authorized: z.boolean(),
}).strict();
export const agentAdapterProfileSchema = agentRegistrationSchema.pick({
  adapterID: true, family: true, adapterRevision: true, capabilityRevision: true,
}).extend({ family: z.literal(AGENT_FAMILY.CAGENT) }).strict();
export const agentConnectionSchema = z.object({
  identity: agentIdentitySchema.extend({ family: z.literal(AGENT_FAMILY.CAGENT) }),
  baseURL: z.url(), headers: z.record(z.string(), z.string()),
  ready: z.boolean(), authorized: z.boolean(),
}).strict();
export const agentHostConnectionSchema = agentConnectionSchema.omit({ identity: true }).extend({
  connectionID: id, serverRevision: id,
}).strict();
export const agentApprovalSchema = z.object({
  family: z.enum(Object.values(AGENT_FAMILY)), connectionID: id, adapterID: id,
  adapterRevision: id, capabilityRevision: id, serverRevision: id,
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
  operations: z.array(z.object({
    operation: agentOperationSchema,
    evidence: z.array(id).min(1).refine((items) => new Set(items).size === items.length),
  }).strict()).refine((items) => new Set(items.map((item) => item.operation)).size === items.length),
}).strict();
export const agentRuntimeSchema = z.object({
  identity: agentIdentitySchema,
  operations: z.record(agentOperationSchema, z.discriminatedUnion('available', [
    z.object({ available: z.literal(true) }).strict(),
    z.object({ available: z.literal(false), reason: z.enum(Object.values(AGENT_ERROR)) }).strict(),
  ])),
}).strict();
export const agentFeatureSnapshotSchema = z.object({
  identity: agentIdentitySchema,
  features: z.record(z.enum(Object.values(AGENT_FEATURE)), z.discriminatedUnion('available', [
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
  [AGENT_OPERATION.IMPORT_SESSION]: z.object({ workspaceID: id, session: sessionRecord, messages: z.array(message), ...effect }).strict()
    .refine((item) => item.workspaceID === item.session.workspaceID && item.messages.every((record) => record.sessionID === item.session.id)),
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
