import { z } from 'zod';

import type { Metadata, ToolInput } from './model';

/** Protocol names for built-in OC2 tools; OC1 tool parsing remains separate. */
export const OPENCODE_TOOLS = {
  edit: 'edit', execute: 'execute', glob: 'glob', grep: 'grep', patch: 'patch',
  question: 'question', read: 'read', shell: 'shell', skill: 'skill',
  subagent: 'subagent', webfetch: 'webfetch', websearch: 'websearch', write: 'write',
  sessionRename: 'session_rename', sessionMove: 'session_move', models: 'models',
} as const;

// Code Mode's built-in tool is named exactly `execute`. A namespaced plugin
// with the same suffix must keep the generic tool presentation.
export const isExecuteTool = (name: string): boolean => name === 'execute';

const text = z.string().trim().min(1).optional().catch(undefined);
const inputSchema = z.object({ code: text }).catch({});
const callSchema = z.object({
  tool: text,
  status: text,
  input: z.unknown().optional().catch(undefined),
});
const metadataSchema = z.object({
  toolCalls: z.array(callSchema.nullable().catch(null)).optional().catch(undefined),
  truncated: z.boolean().optional().catch(undefined),
  outputPath: text,
  sessionID: text,
  sessionId: text,
}).catch({});

const SUBAGENT_TOOLS = new Set(['task', 'subagent']);
export const isSubagentTool = (name: string): boolean => SUBAGENT_TOOLS.has(name.trim().toLowerCase());

export const normalizeToolName = (name: string | null | undefined): string => {
  const parts = name?.trim().toLowerCase().split('.').filter(Boolean);
  return parts?.at(-1) ?? '';
};

/** The built-in command tool as OpenCode 2.x names it. */
export const isShellTool = (name: string): boolean => normalizeToolName(name) === OPENCODE_TOOLS.shell;

/** Tools that block the turn on a form the user must answer; only `question` does today. */
export const blocksOnForm = (name: string): boolean => normalizeToolName(name) === OPENCODE_TOOLS.question;

/** OC1 and OC2 spell the child identity differently in tool metadata. */
export const subagentSessionId = (metadata: Metadata | undefined): string | undefined => {
  const parsed = metadataSchema.parse(metadata ?? {});
  return parsed.sessionID ?? parsed.sessionId;
};

export type ExecuteToolCall = {
  tool: string;
  status?: string;
  input?: string;
};

const MAX_CALL_INPUT = 160;
const MAX_DESCRIPTION_CALLS = 4;

export const executeScript = (input: ToolInput | undefined): string | undefined =>
  inputSchema.parse(input ?? {}).code;

/** Keep the server's call order and skip only entries without a tool name. */
export function executeToolCalls(metadata: Metadata | undefined): ExecuteToolCall[] {
  const calls = metadataSchema.parse(metadata ?? {}).toolCalls ?? [];
  const result: ExecuteToolCall[] = [];
  for (const call of calls) {
    if (!call?.tool) continue;
    const entry: ExecuteToolCall = { tool: call.tool };
    if (call.status) entry.status = call.status;
    if (call.input !== undefined && call.input !== null) {
      try {
        const json = JSON.stringify(call.input);
        if (json && json !== '{}' && json !== 'null') {
          entry.input = json.length > MAX_CALL_INPUT ? `${json.slice(0, MAX_CALL_INPUT)}\u2026` : json;
        }
      } catch {
        // A malformed argument does not hide the remaining calls.
      }
    }
    result.push(entry);
  }
  return result;
}

export function executeOutputTruncation(metadata: Metadata | undefined): { outputPath?: string } | null {
  const parsed = metadataSchema.parse(metadata ?? {});
  if (!parsed.truncated) return null;
  return parsed.outputPath ? { outputPath: parsed.outputPath } : {};
}

/** Compact row text, deduplicated in first-seen order. */
export function executeDescription(input: ToolInput | undefined, metadata: Metadata | undefined): string {
  const calls = executeToolCalls(metadata);
  const counts = new Map<string, number>();
  for (const call of calls) counts.set(call.tool, (counts.get(call.tool) ?? 0) + 1);
  if (counts.size === 0) return executeScript(input)?.split('\n')[0]?.slice(0, 100) ?? '';
  const named = [...counts].slice(0, MAX_DESCRIPTION_CALLS);
  const description = named.map(([name, count]) => count > 1 ? `${name} \u00d7${count}` : name).join(', ');
  const overflow = counts.size - named.length;
  return overflow > 0 ? `${description}, +${overflow}` : description;
}
