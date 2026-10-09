import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCalibrationPlan, checkCalibrationAnswer, CALIBRATION } from './calibration.mjs';
import { runCalibrationCommand } from './calibrate.mjs';

const model = { version: 1, id: 'synthetic', build: 'r1', language: 'en', execution: 'scripted',
  inputBudget: { unit: 'bytes', limit: 8000, method: 'utf8' } };
const trial = { version: 1, modelID: model.id, modelBuild: model.build, language: model.language,
  input: { mapping: 400, codec: 600, gap: 400 }, elapsedMs: 0, interventions: 0 };
const mapping = { method: 'GET', path: '/training/records', query: { space: 'workspaceID', record: 'sessionID' },
  result: { id: 'record', workspaceID: 'space' } };
const gap = { operation: 'interruptSession', missing: 'confirmed-cancellation', section: 'training.cancel-gap',
  question: 'Please supply documented cancellation and confirmation semantics.' };
const codec = `const API = Object.freeze({ PATH: '/training/status', ID: 'record', PHASE: 'phase' });
const STATE = Object.freeze({ 0: 'idle', 1: 'busy', 2: 'waiting', UNKNOWN: 'unknown' });
export function createOperation(context) { return async (input, identity, control) => {
  const response = await context.request({ method: 'GET', path: API.PATH,
    query: { space: input.workspaceID, record: input.sessionID } }, identity, control);
  return { sessionID: response.body[API.ID], state: STATE[response.body[API.PHASE]] ?? STATE.UNKNOWN };
}; }
`;
const run = async (args) => {
  const lines = [];
  const code = await runCalibrationCommand([...args, '--json'], (line) => lines.push(line));
  assert.equal(lines.length, 1);
  return { code, report: JSON.parse(lines[0]) };
};
async function workspace(root) {
  const out = path.join(root, 'workspace');
  const modelFile = path.join(root, 'model.json');
  const trialFile = path.join(root, 'trial.json');
  await fs.writeFile(modelFile, JSON.stringify(model));
  await fs.writeFile(trialFile, JSON.stringify(trial));
  const prepared = await run(['--prepare', '--out', out, '--model-record', modelFile]);
  assert.equal(prepared.code, 0);
  assert.equal(prepared.report.activation, 'unavailable');
  const check = () => run(['--check', '--workspace', out, '--kit-digest', prepared.report.digest,
    '--node', process.env.CAGENT_TEST_NODE, '--trial-record', trialFile]);
  const answer = async (task, value) => fs.writeFile(path.join(out, 'candidate', CALIBRATION.OPERATIONS[task],
    task === 'codec' ? 'handler.mjs' : 'answer.json'), task === 'codec' ? value : JSON.stringify(value));
  return { out, trialFile, check, answer };
}

test('calibration freezes repeatable synthetic inputs and rejects guessed answers and oversized token budgets', () => {
  const first = buildCalibrationPlan(model);
  assert.deepEqual(first.manifest, buildCalibrationPlan(model).manifest);
  assert.equal(first.definition.cases.length, 5);
  assert.equal(checkCalibrationAnswer('mapping', JSON.stringify(mapping)), true);
  assert.equal(checkCalibrationAnswer('gap', JSON.stringify({ ...gap, endpoint: '/guess' })), false);
  assert.equal(checkCalibrationAnswer('unknown', JSON.stringify(gap)), false);
  assert.throws(() => buildCalibrationPlan({ ...model, inputBudget: { unit: 'tokens', limit: 8001, method: 'tokenizer' } }));
});

for (const [name, answers, assignment, code] of [
  ['all tasks pass', { mapping, codec, gap }, 'bounded-codec', 0],
  ['codec fails', { mapping, gap }, 'declarative-only', 1],
  ['evidence gap fails', { mapping, codec }, 'maintainer-assisted', 1],
]) {
  test(`native calibration assigns ${assignment} when ${name}`, async () => {
    assert.ok(process.env.CAGENT_TEST_NODE);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-calibration-'));
    try {
      const kit = await workspace(root);
      for (const [task, value] of Object.entries(answers)) await kit.answer(task, value);
      const checked = await kit.check();
      assert.equal(checked.code, code);
      assert.equal(checked.report.assignment, assignment);
      assert.equal(checked.report.activation, 'unavailable');
      assert.equal(checked.report.acceptance, 'authoring-calibration-only');
      assert.equal(checked.report.measurementAuthority, 'maintainer-record');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}

test('trial mismatch and protected edits fail before consuming a candidate attempt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-calibration-owner-'));
  try {
    const kit = await workspace(root);
    await fs.writeFile(kit.trialFile, JSON.stringify({ ...trial, modelBuild: 'wrong' }));
    assert.equal((await kit.check()).report.error, 'calibration-input-unavailable');
    await assert.rejects(fs.access(path.join(kit.out, 'progress')));
    await fs.writeFile(kit.trialFile, JSON.stringify(trial));
    await fs.appendFile(path.join(kit.out, 'protected', 'model.json'), ' ');
    assert.equal((await kit.check()).report.error, 'protected-kit-changed');
    await assert.rejects(fs.access(path.join(kit.out, 'progress')));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('native correction ceiling survives reopening and refuses a later good candidate', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-calibration-budget-'));
  try {
    const kit = await workspace(root);
    for (let count = 0; count < 3; count++) assert.equal((await kit.check()).code, 1);
    for (const [task, value] of Object.entries({ mapping, codec, gap })) await kit.answer(task, value);
    const checked = await kit.check();
    assert.equal(checked.report.assignment, 'maintainer-assisted');
    assert.equal(checked.report.results.mapping.state, 'blocked');
    assert.equal(checked.report.results.mapping.failures, 3);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('invalid CLI flags emit one fixed failure without prompts', async () => {
  assert.deepEqual(await run(['--prepare', '--check']), { code: 1, report: { ok: false, error: 'invalid-arguments' } });
});

test('swallowed transport failures and out-of-scope files cannot earn codec admission', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-calibration-refusal-'));
  try {
    const kit = await workspace(root);
    await kit.answer('mapping', mapping);
    await kit.answer('gap', gap);
    await kit.answer('codec', codec.replace('}, identity, control);',
      "}, identity, control).catch(() => ({ body: { record: 'training-session', phase: 99 } }));"));
    assert.equal((await kit.check()).report.assignment, 'declarative-only');
    await fs.writeFile(path.join(kit.out, 'candidate/getSessionStatus/extra.mjs'), 'export const extra = true;');
    assert.equal((await kit.check()).report.assignment, 'maintainer-assisted');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
