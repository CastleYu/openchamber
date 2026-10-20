import { z } from 'zod';

// Stable ACP v1, pinned to 24f3b07f44f043c617666c20208b093e919648ac.
export const METHOD = Object.freeze({
  INITIALIZE: 'initialize', NEW: 'session/new', LOAD: 'session/load', RESUME: 'session/resume', LIST: 'session/list', DELETE: 'session/delete',
  PROMPT: 'session/prompt', CANCEL: 'session/cancel', UPDATE: 'session/update',
  PERMISSION: 'session/request_permission', AUTH: 'authenticate', MODE: 'session/set_mode', CONFIG: 'session/set_config_option', ELICIT: 'elicitation/create', ELICIT_COMPLETE: 'elicitation/complete',
});
export const UPDATE = Object.freeze({ USER: 'user_message_chunk', TEXT: 'agent_message_chunk', THOUGHT: 'agent_thought_chunk', TOOL: 'tool_call', TOOL_UPDATE: 'tool_call_update', CONFIG: 'config_option_update', MODE: 'current_mode_update', COMMANDS: 'available_commands_update', USAGE: 'usage_update', INFO: 'session_info_update', PLAN: 'plan' });
const optionalText = z.string().nullish().transform((value) => value ?? undefined);
export const modesSchema = z.object({ currentModeId: z.string(), availableModes: z.array(z.object({ id: z.string(), name: z.string(), description: optionalText })) });
const choiceSchema = z.object({ value: z.string(), name: z.string(), description: optionalText });
const selectSchema = z.object({ id: z.string(), name: z.string(), description: optionalText, category: optionalText, type: z.literal('select'), currentValue: z.string(), options: z.array(z.union([choiceSchema, z.object({ group: z.string(), name: z.string(), options: z.array(choiceSchema) })])) });
// Unknown future option types are ignored; the client advertises no extensions.
export const configSchema = z.array(z.json()).transform((values) => values.flatMap((value) => {
  const parsed = z.object({ type: z.string() }).safeParse(value);
  return parsed.success && parsed.data.type === 'select' ? [selectSchema.parse(value)] : [];
}));
export const commandsSchema = z.array(z.object({ name: z.string(), description: z.string(), input: z.object({ hint: z.string() }).nullable().optional() }));
export const usageSchema = z.object({ used: z.number().nonnegative(), size: z.number().nonnegative(), cost: z.object({ amount: z.number(), currency: z.string() }).nullish().transform((value) => value ?? undefined) });
export const sessionResultSchema = z.object({ sessionId: z.string().optional(), modes: modesSchema.nullish().transform((value) => value ?? undefined), configOptions: configSchema.nullish().transform((value) => value ?? undefined) });
export const initializeSchema = z.object({
  protocolVersion: z.literal(1),
  agentInfo: z.object({ name: z.string(), title: optionalText, version: z.string() }).optional(),
  agentCapabilities: z.object({ loadSession: z.boolean().optional(), sessionCapabilities: z.object({ list: z.object({}).nullish(), resume: z.object({}).nullish(), delete: z.object({}).nullish(), close: z.object({}).nullish() }).nullish(), promptCapabilities: z.object({ image: z.boolean().optional(), audio: z.boolean().optional(), embeddedContext: z.boolean().optional() }).optional() }).default({}),
  authMethods: z.array(z.object({ id: z.string(), name: z.string(), description: optionalText, type: optionalText })).default([]),
});
export const listSchema = z.object({ sessions: z.array(z.object({ sessionId: z.string(), cwd: z.string(), title: z.string().nullable().optional(), updatedAt: z.string().nullable().optional() })), nextCursor: z.string().nullable().optional() });
export const localUpdateSchema = z.object({ title: z.string().optional(), metadata: z.record(z.string(), z.json()).optional(), time: z.object({ archived: z.number().nullable().optional() }).optional() });
