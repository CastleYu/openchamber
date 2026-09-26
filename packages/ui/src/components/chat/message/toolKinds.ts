/** Tool names reported by the two OpenCode generations. */
const TOOL = {
    shell: ['bash', 'shell'],
    subagent: ['task', 'subagent'],
    patch: ['apply_patch', 'patch'],
    question: ['question'],
    fileChange: ['edit', 'multiedit', 'write', 'apply_patch', 'patch'],
} as const;

const matches = (tool: string, names: readonly string[]): boolean => names.includes(tool.trim().toLowerCase());

export const isShellTool = (tool: string): boolean => matches(tool, TOOL.shell);
export const isSubagentTool = (tool: string): boolean => matches(tool, TOOL.subagent);
export const isPatchTool = (tool: string): boolean => matches(tool, TOOL.patch);
export const isQuestionTool = (tool: string): boolean => matches(tool, TOOL.question);
export const isFileChangeTool = (tool: string): boolean => matches(tool, TOOL.fileChange);
