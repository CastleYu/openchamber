import { z } from 'zod';

export const LEGACY_CONFIG_KIND = Object.freeze({ AGENT: 'agent', COMMAND: 'command', MCP: 'mcp' });
const ACTION = Object.freeze({ ASK: 'ask', ALLOW: 'allow', DENY: 'deny' });
const MODE = Object.freeze({ SUBAGENT: 'subagent', PRIMARY: 'primary', ALL: 'all' });
const MCP_TYPE = Object.freeze({ LOCAL: 'local', REMOTE: 'remote' });

const actionSchema = z.enum([ACTION.ASK, ACTION.ALLOW, ACTION.DENY]);
const permissionObjectSchema = z.record(z.string(), actionSchema);
const permissionRuleSchema = z.union([actionSchema, permissionObjectSchema]);
const permissionConfigSchema = z.union([
  z.object({
    __originalKeys: z.array(z.string()).optional(),
    read: permissionRuleSchema.optional(),
    edit: permissionRuleSchema.optional(),
    glob: permissionRuleSchema.optional(),
    grep: permissionRuleSchema.optional(),
    list: permissionRuleSchema.optional(),
    bash: permissionRuleSchema.optional(),
    task: permissionRuleSchema.optional(),
    external_directory: permissionRuleSchema.optional(),
    todowrite: actionSchema.optional(),
    todoread: actionSchema.optional(),
    question: actionSchema.optional(),
    webfetch: actionSchema.optional(),
    websearch: actionSchema.optional(),
    codesearch: actionSchema.optional(),
    lsp: permissionRuleSchema.optional(),
    doom_loop: actionSchema.optional(),
    skill: permissionRuleSchema.optional(),
  }).catchall(permissionRuleSchema),
  actionSchema,
]);
const agentConfigSchema = z.object({
  model: z.string().optional(),
  variant: z.string().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  prompt: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  disable: z.boolean().optional(),
  description: z.string().optional(),
  mode: z.enum([MODE.SUBAGENT, MODE.PRIMARY, MODE.ALL]).optional(),
  hidden: z.boolean().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).or(z.enum(['primary', 'secondary', 'accent', 'success', 'warning', 'error', 'info'])).optional(),
  steps: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  maxSteps: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  permission: permissionConfigSchema.optional(),
}).passthrough();
const commandConfigSchema = z.object({
  template: z.string(),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  subtask: z.boolean().optional(),
}).passthrough();
const mcpOAuthSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
}).strict();
const mcpLocalSchema = z.object({
  type: z.literal(MCP_TYPE.LOCAL),
  command: z.array(z.string()),
  environment: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  timeout: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
const mcpRemoteSchema = z.object({
  type: z.literal(MCP_TYPE.REMOTE),
  url: z.string(),
  enabled: z.boolean().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: z.union([mcpOAuthSchema, z.literal(false)]).optional(),
  timeout: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
const mcpConfigSchema = z.union([
  mcpLocalSchema,
  mcpRemoteSchema,
  z.object({ enabled: z.boolean() }).strict(),
]);
const configSchema = Object.freeze({
  [LEGACY_CONFIG_KIND.AGENT]: agentConfigSchema,
  [LEGACY_CONFIG_KIND.COMMAND]: commandConfigSchema,
  [LEGACY_CONFIG_KIND.MCP]: mcpConfigSchema,
});
const uiFields = Object.freeze(['name', 'scope']);
const configRecordSchema = z.object({}).passthrough();

function stripUiFields(value) {
  const config = { ...value };
  for (const field of uiFields) delete config[field];
  return config;
}

function parse(kind, value) {
  if (!Object.hasOwn(configSchema, kind)) throw badConfig();
  const schema = configSchema[kind];
  const input = configRecordSchema.safeParse(value);
  if (!input.success) throw badConfig();
  const parsed = schema.safeParse(kind === LEGACY_CONFIG_KIND.MCP ? stripUiFields(input.data) : input.data);
  if (!parsed.success) throw badConfig();
  return parsed.data;
}

function badConfig() {
  return Object.assign(new Error('Invalid OpenCode configuration'), { statusCode: 400 });
}

export function parseLegacyConfig(kind, value) {
  return parse(kind, value);
}

export function mergeLegacyConfig(kind, current, updates) {
  const currentResult = configRecordSchema.safeParse(current);
  const updatesResult = configRecordSchema.safeParse(updates);
  if (!currentResult.success || !updatesResult.success) throw badConfig();
  const base = kind === LEGACY_CONFIG_KIND.MCP ? stripUiFields(currentResult.data) : { ...currentResult.data };
  const patch = kind === LEGACY_CONFIG_KIND.MCP ? stripUiFields(updatesResult.data) : updatesResult.data;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null && kind === LEGACY_CONFIG_KIND.COMMAND && key === 'template') {
      base[key] = '';
    } else if (value === null) {
      delete base[key];
    } else {
      base[key] = value;
    }
  }
  return parse(kind, base);
}
