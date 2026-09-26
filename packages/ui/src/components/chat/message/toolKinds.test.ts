import { expect, test } from 'bun:test';

import { isFileChangeTool, isPatchTool, isQuestionTool, isShellTool, isSubagentTool } from './toolKinds';

test('OC1 and OC2 built-in tool names keep the same presentation paths', () => {
    expect(isShellTool('bash')).toBe(true);
    expect(isShellTool('shell')).toBe(true);
    expect(isSubagentTool('task')).toBe(true);
    expect(isSubagentTool('subagent')).toBe(true);
    expect(isPatchTool('apply_patch')).toBe(true);
    expect(isPatchTool('patch')).toBe(true);
    expect(isQuestionTool('question')).toBe(true);
    expect(isFileChangeTool('patch')).toBe(true);
    expect(isFileChangeTool('read')).toBe(false);
});
