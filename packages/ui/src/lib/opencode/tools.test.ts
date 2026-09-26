import { describe, expect, test } from 'bun:test';

import type { Metadata } from './model';
import { executeDescription, executeOutputTruncation, executeScript, executeToolCalls, isExecuteTool } from './tools';

describe('OC2 execute wire fields', () => {
  const input = { code: 'const result = await tools.mcp.search({ query: "bug" });\nconsole.log(result)' };
  const metadata: Metadata = {
    toolCalls: [
      { tool: 'mcp.search', status: 'completed', input: { query: 'bug' } },
      { tool: 'mcp.read', status: 'error', input: { path: 'src/a.ts' } },
      { tool: 'mcp.search', status: 'running', input: {} },
    ],
    truncated: true,
    outputPath: '/tmp/opencode/execute-output.txt',
  };

  test('reads input.code and ordered metadata.toolCalls without merging repeated calls', () => {
    expect(isExecuteTool('execute')).toBe(true);
    expect(isExecuteTool('mcp.demo.execute')).toBe(false);
    expect(executeScript(input)).toBe(input.code);
    expect(executeToolCalls(metadata)).toEqual([
      { tool: 'mcp.search', status: 'completed', input: '{"query":"bug"}' },
      { tool: 'mcp.read', status: 'error', input: '{"path":"src/a.ts"}' },
      { tool: 'mcp.search', status: 'running' },
    ]);
    expect(executeDescription(input, metadata)).toBe('mcp.search ×2, mcp.read');
    expect(executeOutputTruncation(metadata)).toEqual({ outputPath: '/tmp/opencode/execute-output.txt' });
  });

  test('skips only malformed entries and keeps the script first line while calls are pending', () => {
    expect(executeToolCalls({ toolCalls: [{ tool: '' }, null, { tool: 'mcp.valid', status: 7, input: { value: 1 } }] })).toEqual([
      { tool: 'mcp.valid', input: '{"value":1}' },
    ]);
    expect(executeDescription(input, { toolCalls: [] })).toBe('const result = await tools.mcp.search({ query: "bug" });');
    expect(executeOutputTruncation({ truncated: true, outputPath: 7 })).toEqual({});
    expect(executeOutputTruncation({ truncated: false, outputPath: '/tmp/output' })).toBeNull();
  });

  test('caps row names and compact arguments without changing call order', () => {
    const calls = ['one', 'two', 'three', 'four', 'five'].map((tool) => ({ tool, input: { text: 'x'.repeat(200) } }));
    expect(executeDescription(undefined, { toolCalls: calls })).toBe('one, two, three, four, +1');
    const parsed = executeToolCalls({ toolCalls: calls });
    expect(parsed.map((call) => call.tool)).toEqual(['one', 'two', 'three', 'four', 'five']);
    expect(parsed[0]?.input?.length).toBe(161);
  });
});
