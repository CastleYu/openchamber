import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AGENT_ARTIFACT, AGENT_OPERATION, AGENT_PACKET_STATE, AGENT_PACKET_ERROR, AGENT_ERROR } from '../../packages/web/server/lib/agent/constants.js';
import { agentArtifactDigest } from '../../packages/web/server/lib/agent/artifacts.js';

export const CALIBRATION = Object.freeze({
  VERSION: 1, TASK: Object.freeze({ MAPPING: 'mapping', CODEC: 'codec', GAP: 'gap' }),
  OPERATIONS: Object.freeze({ mapping: AGENT_OPERATION.GET_SESSION, codec: AGENT_OPERATION.GET_SESSION_STATUS, gap: AGENT_OPERATION.INTERRUPT_SESSION }),
  FILE: Object.freeze({ MAPPING: 'answer.json', CODEC: 'handler.mjs', GAP: 'answer.json', MODEL: 'model.json', MANIFEST: 'manifest.json' }),
  CHECK: 'calibration', MODE: Object.freeze({ MAPPING: 'declarative-only', CODEC: 'bounded-codec', MAINTAINER: 'maintainer-assisted' }),
  ERROR: Object.freeze({ INPUT: 'calibration-input-unavailable', SETUP: 'calibration-unavailable', PROTECTED: 'protected-kit-changed', INVALID: 'invalid-arguments', EXISTS: 'workspace-exists', INCOMPLETE: 'workspace-incomplete' }),
});
const id = z.string().min(1).max(96).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const calibrationModelSchema = z.object({ version: z.literal(CALIBRATION.VERSION), id, build: id,
  language: z.enum(['en', 'zh-CN']), execution: z.enum(['scripted', 'local-model', 'maintainer']),
  inputBudget: z.object({ unit: z.enum(['tokens', 'bytes']), limit: z.number().int().positive().max(1048576), method: id }).strict(),
}).strict().refine((value) => value.inputBudget.unit !== 'tokens' || value.inputBudget.limit <= 8000);
export const calibrationTrialSchema = z.object({ version: z.literal(CALIBRATION.VERSION), modelID: id, modelBuild: id,
  language: z.enum(['en', 'zh-CN']), input: z.record(z.enum(Object.values(CALIBRATION.TASK)), z.number().int().positive()),
  elapsedMs: z.number().int().nonnegative().safe(), interventions: z.number().int().nonnegative().safe(),
}).strict();
const mappingSchema = z.object({ method: z.literal('GET'), path: z.literal('/training/records'),
  query: z.object({ space: z.literal('workspaceID'), record: z.literal('sessionID') }).strict(),
  result: z.object({ id: z.literal('record'), workspaceID: z.literal('space') }).strict(),
}).strict();
const gapSchema = z.object({ operation: z.literal(AGENT_OPERATION.INTERRUPT_SESSION), missing: z.literal('confirmed-cancellation'),
  section: z.literal('training.cancel-gap'), question: z.string().trim().min(8).max(500),
}).strict();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const definition = () => {
  const states = [[0, 'idle'], [1, 'busy'], [2, 'waiting'], [99, 'unknown']];
  return { version: 1, operation: CALIBRATION.OPERATIONS.codec, cases: states.map(([phase, state]) => ({
    id: `phase-${phase}`, input: { workspaceID: 'training-workspace', sessionID: 'training-session' },
    identity: { family: 'cagent', connectionID: 'training', epoch: 1, adapterRevision: 'training', capabilityRevision: 'training' },
    exchanges: [{ request: { method: 'GET', path: '/training/status', query: { space: 'training-workspace', record: 'training-session' } },
      outcome: { kind: 'response', response: { status: 200, body: { record: 'training-session', phase } } } }],
    expected: { kind: 'result', result: { sessionID: 'training-session', state } },
  })).concat([{ id: 'transport-failure', input: { workspaceID: 'training-workspace', sessionID: 'training-session' },
    identity: { family: 'cagent', connectionID: 'training', epoch: 1, adapterRevision: 'training', capabilityRevision: 'training' },
    exchanges: [{ request: { method: 'GET', path: '/training/status', query: { space: 'training-workspace', record: 'training-session' } },
      outcome: { kind: 'failure', error: AGENT_ERROR.BACKEND_FAILED } }],
    expected: { kind: 'failure', error: AGENT_ERROR.BACKEND_FAILED },
  }]) };
};
const prompt = (task, language) => {
  const en = {
    mapping: 'Fill answer.json only. Synthetic documentation: GET /training/records has query keys space and record. Bind them to canonical workspaceID and sessionID. Response fields record and space map to canonical id and workspaceID. Return exactly {method,path,query:{space,record},result:{id,workspaceID}} with binding field names as values. No code or extra fields.',
    codec: 'Edit handler.mjs only. Export createOperation(context), returning a handler(input,identity,control). Synthetic documentation: GET /training/status query {space:input.workspaceID,record:input.sessionID}; forward identity and control. Response body {record,phase}. Return {sessionID:record,state}. Phase 0 means idle, 1 busy, 2 waiting; every other phase means unknown. Preserve transport failure. Use constants for documented keys/states; no imports, activation or direct network calls.',
    gap: 'Fill answer.json only. Synthetic documentation section training.cancel-gap provides no cancellation API or outcome observation. Required semantic: confirmed-cancellation for interruptSession. Report {operation,missing,section,question}, naming that missing field and section, and one question asking the maintainer for missing documentation. Do not guess an endpoint or implement cancellation.',
  };
  const zh = {
    mapping: '仅填写 answer.json。合成文档：GET /training/records 的查询键为 space 和 record，分别绑定规范输入 workspaceID 和 sessionID；响应 record 和 space 分别映射到规范结果 id 和 workspaceID。仅返回 {method,path,query:{space,record},result:{id,workspaceID}}，值使用绑定字段名。无需代码，不添加字段。',
    codec: '仅修改 handler.mjs，导出 createOperation(context)，返回 handler(input,identity,control)。合成文档：GET /training/status，查询 {space:input.workspaceID,record:input.sessionID}，转发 identity 和 control。响应体 {record,phase}，返回 {sessionID:record,state}。phase 0 表示 idle，1 busy，2 waiting，其余值为 unknown。保留传输失败。文档键和状态使用常量，不导入模块、不启用功能、不直接联网。',
    gap: '仅填写 answer.json。合成文档章节 training.cancel-gap 未提供取消 API 或结果观察。interruptSession 必需语义为 confirmed-cancellation。返回 {operation,missing,section,question}，指明此缺失字段及章节，并向维护者提出一个索取缺失文档的问题。不猜测端点或实现取消。',
  };
  return `# ${task}\n\n${language === 'en' ? en[task] : zh[task]}\n`;
};

/** Synthetic authoring calibration only; no CAgent wire behavior is asserted. */
export function buildCalibrationPlan(modelInput) {
  const model = calibrationModelSchema.parse(modelInput);
  const files = new Map([['protected/model.json', json(model)]]);
  for (const task of Object.values(CALIBRATION.TASK)) {
    const operation = CALIBRATION.OPERATIONS[task];
    files.set(`protected/${operation}/task.en.md`, prompt(task, 'en'));
    files.set(`protected/${operation}/task.zh-CN.md`, prompt(task, 'zh-CN'));
    files.set(`candidate/${operation}/${task === CALIBRATION.TASK.CODEC ? CALIBRATION.FILE.CODEC : CALIBRATION.FILE.MAPPING}`,
      task === CALIBRATION.TASK.CODEC ? "export function createOperation() { return async () => { throw new Error('unverified'); }; }\n" : json({ pending: true }));
  }
  files.set(`protected/${CALIBRATION.OPERATIONS.codec}/fixtures.json`, json(definition()));
  const records = [...files].filter(([name]) => name.startsWith('protected/')).map(([name, text]) => ({
    path: name.slice('protected/'.length), bytes: Buffer.byteLength(text), digest: hash(text),
  }));
  const manifest = { version: AGENT_ARTIFACT.VERSION, files: records, artifactDigest: agentArtifactDigest(records) };
  return { files, manifest, definition: definition(), model };
}

export function checkCalibrationAnswer(task, text) {
  if (![CALIBRATION.TASK.MAPPING, CALIBRATION.TASK.GAP].includes(task)) return false;
  try {
    const value = JSON.parse(text);
    return (task === CALIBRATION.TASK.MAPPING ? mappingSchema : gapSchema).safeParse(value).success;
  } catch { return false; }
}

export function calibrationAssignment(results) {
  const passed = (task) => results[task]?.state === AGENT_PACKET_STATE.PASSED;
  if (Object.values(results).some((value) => value.reason === AGENT_PACKET_ERROR.BOUNDARY)
    || !passed(CALIBRATION.TASK.MAPPING) || !passed(CALIBRATION.TASK.GAP)) return CALIBRATION.MODE.MAINTAINER;
  return passed(CALIBRATION.TASK.CODEC) ? CALIBRATION.MODE.CODEC : CALIBRATION.MODE.MAPPING;
}

export function validateCalibrationTrial(model, input) {
  const trial = calibrationTrialSchema.parse(input);
  if (!isDeepStrictEqual([trial.modelID, trial.modelBuild, trial.language], [model.id, model.build, model.language])
    || Object.values(trial.input).some((count) => count > model.inputBudget.limit)) throw new Error(CALIBRATION.ERROR.INPUT);
  return trial;
}
