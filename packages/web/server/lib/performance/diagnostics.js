import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const PerformanceStage = Object.freeze({ Query: 'query', Json: 'json', Schema: 'schema', Root: 'root', Aggregate: 'aggregate' });
const childError = z.object({
  code: z.union([z.number().int(), z.enum(['EPERM', 'EACCES', 'ENOENT', 'ENAMETOOLONG', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'])]).optional(),
  killed: z.boolean().optional(), stderr: z.string().optional(),
});
const nativePattern = /OC_PERF\|(snapshot|first|next|open|times|memory)\|(\d+)\|(\d+)/;

export class PerformanceFailure extends Error {
  constructor(stage, detail = {}) {
    super('Process metrics unavailable');
    this.stage = stage;
    this.detail = detail;
    this.diagnosticId = randomUUID();
  }
}

export function queryFailure(error) {
  const parsed = childError.safeParse(error);
  const fields = parsed.success ? parsed.data : {};
  const native = nativePattern.exec(fields.stderr || '');
  return new PerformanceFailure(PerformanceStage.Query, {
    exitCode: fields.code ?? null, timedOut: fields.killed === true,
    nativeStage: native?.[1] ?? null,
    processId: native ? Number(native[2]) : null,
    nativeCode: native ? Number(native[3]) : null,
  });
}
