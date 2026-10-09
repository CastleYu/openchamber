import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AGENT_FILE_ERROR, AGENT_FILE_MODE, AGENT_PACKET_STORAGE, AGENT_PACKET_ERROR, AGENT_PACKET_STATE } from '../../packages/web/server/lib/agent/constants.js';
import { agentArtifactManifestSchema, verifyAgentArtifacts } from '../../packages/web/server/lib/agent/artifacts.js';
import { createAgentPacketWorkspace } from '../../packages/web/server/lib/agent/packet-workspace.js';
import { buildCalibrationPlan, checkCalibrationAnswer, calibrationAssignment, validateCalibrationTrial, CALIBRATION } from './calibration.mjs';
import { assembleAdapter, AssemblyError } from './adapter-assembly.mjs';
import { runFixtureProcess, FixtureProcessError, PROCESS } from './fixture-process.mjs';
import { readLocalJSON } from './read-input.mjs';

const COMMAND = Object.freeze({ JSON: '--json', ACTIVATION: 'unavailable', PROTECTED: 'protected', CANDIDATE: 'candidate', PROGRESS: 'progress', CONTROL: 'control' });
const contains = (root, name) => { const relative = path.relative(root, name); return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const canonical = async (name) => {
  const resolved = path.resolve(name);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(resolved) !== resolved) throw new Error(CALIBRATION.ERROR.SETUP);
  return resolved;
};
const writePlan = async (plan, root) => {
  await canonical(path.dirname(root));
  try { await fs.mkdir(root, { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE }); }
  catch (error) { if (error.code === AGENT_FILE_ERROR.EXISTS) throw new Error(CALIBRATION.ERROR.EXISTS); throw error; }
  try {
    for (const [relative, text] of plan.files) {
      const name = path.join(root, relative);
      await fs.mkdir(path.dirname(name), { recursive: true, mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE });
      await fs.writeFile(name, text, { flag: AGENT_FILE_MODE.EXCLUSIVE, mode: AGENT_FILE_MODE.OWNER_READ_WRITE });
    }
    const control = path.join(root, COMMAND.CONTROL);
    await fs.mkdir(control, { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE });
    const pending = path.join(control, `${CALIBRATION.FILE.MANIFEST}.pending`);
    await fs.writeFile(pending, `${JSON.stringify(plan.manifest, null, 2)}\n`, { flag: AGENT_FILE_MODE.EXCLUSIVE, mode: AGENT_FILE_MODE.OWNER_READ_WRITE });
    await fs.rename(pending, path.join(control, CALIBRATION.FILE.MANIFEST));
  } catch { throw new Error(CALIBRATION.ERROR.INCOMPLETE); }
};

/** Owner command. Neither the model record nor trial measurements come from candidate authority. */
export async function runCalibrationCommand(args, output) {
  const json = args.includes(COMMAND.JSON);
  const fail = (error) => { output(json ? JSON.stringify({ ok: false, error }) : error); return 1; };
  let values;
  try {
    ({ values } = parseArgs({ args, options: { prepare: { type: 'boolean' }, check: { type: 'boolean' },
      out: { type: 'string' }, 'model-record': { type: 'string' }, workspace: { type: 'string' },
      'kit-digest': { type: 'string' }, node: { type: 'string' }, 'trial-record': { type: 'string' },
      json: { type: 'boolean' }, quiet: { type: 'boolean' } }, allowPositionals: false }));
    if (Boolean(values.prepare) === Boolean(values.check)) return fail(CALIBRATION.ERROR.INVALID);
    if (values.prepare && (!values.out || !values['model-record'] || values.workspace || values['kit-digest'] || values.node || values['trial-record'])) return fail(CALIBRATION.ERROR.INVALID);
    if (values.check && (!values.workspace || !/^[a-f0-9]{64}$/.test(values['kit-digest'] ?? '') || !values.node || !path.isAbsolute(values.node)
      || !values['trial-record'] || values.out || values['model-record'])) return fail(CALIBRATION.ERROR.INVALID);
  } catch { return fail(CALIBRATION.ERROR.INVALID); }
  if (values.prepare) {
    let plan;
    try { plan = buildCalibrationPlan(await readLocalJSON(values['model-record'])); }
    catch { return fail(CALIBRATION.ERROR.INPUT); }
    try { await writePlan(plan, path.resolve(values.out)); }
    catch (error) { return fail([CALIBRATION.ERROR.EXISTS, CALIBRATION.ERROR.INCOMPLETE].includes(error.message) ? error.message : CALIBRATION.ERROR.SETUP); }
    const report = { ok: true, mode: 'prepare', digest: plan.manifest.artifactDigest, tasks: 3, activation: COMMAND.ACTIVATION };
    output(json ? JSON.stringify(report) : `calibration prepared digest:${report.digest}`);
    return 0;
  }
  try {
    const root = await canonical(values.workspace);
    const protectedDirectory = path.join(root, COMMAND.PROTECTED);
    const manifest = agentArtifactManifestSchema.parse(await readLocalJSON(path.join(root, COMMAND.CONTROL, CALIBRATION.FILE.MANIFEST)));
    if (manifest.artifactDigest !== values['kit-digest']) return fail(CALIBRATION.ERROR.PROTECTED);
    try { await verifyAgentArtifacts({ directory: protectedDirectory, manifest }); }
    catch { return fail(CALIBRATION.ERROR.PROTECTED); }
    const plan = buildCalibrationPlan(await readLocalJSON(path.join(protectedDirectory, CALIBRATION.FILE.MODEL)));
    if (plan.manifest.artifactDigest !== manifest.artifactDigest) return fail(CALIBRATION.ERROR.PROTECTED);
    const trialPath = await fs.realpath(path.resolve(values['trial-record']));
    if (contains(root, trialPath)) return fail(CALIBRATION.ERROR.INPUT);
    let trial;
    try { trial = validateCalibrationTrial(plan.model, await readLocalJSON(trialPath)); }
    catch { return fail(CALIBRATION.ERROR.INPUT); }
    const progressDirectory = path.join(root, COMMAND.PROGRESS);
    try { await fs.mkdir(progressDirectory, { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE }); }
    catch (error) { if (error.code !== AGENT_FILE_ERROR.EXISTS) throw error; }
    const packets = Object.values(CALIBRATION.TASK).map((task) => ({ operation: CALIBRATION.OPERATIONS[task],
      directory: path.join(root, COMMAND.CANDIDATE, CALIBRATION.OPERATIONS[task]),
      files: [task === CALIBRATION.TASK.CODEC ? CALIBRATION.FILE.CODEC : CALIBRATION.FILE.MAPPING], dependsOn: [],
      checks: [{ id: CALIBRATION.CHECK, run: async (sources) => {
        if (task !== CALIBRATION.TASK.CODEC) return checkCalibrationAnswer(task, sources[0].text);
        try {
          const built = await assembleAdapter([{ operation: CALIBRATION.OPERATIONS.codec, text: sources[0].text }]);
          const result = await runFixtureProcess({ definition: plan.definition, source: built.source, nodePath: values.node });
          return result.checks.every((check) => check.passed);
        } catch (error) {
          if (error instanceof AssemblyError || error instanceof FixtureProcessError
            && [PROCESS.CODE.TIMEOUT, PROCESS.CODE.OUTPUT, PROCESS.CODE.EXIT].includes(error.code)) return false;
          throw error;
        }
      } }],
    }));
    const runner = createAgentPacketWorkspace({ protectedDirectory, manifest, progressDirectory, packets });
    const results = {};
    const started = performance.now();
    for (const task of Object.values(CALIBRATION.TASK)) {
      const result = await runner.run(CALIBRATION.OPERATIONS[task]);
      if ([AGENT_PACKET_ERROR.SETUP, AGENT_PACKET_ERROR.STORAGE, AGENT_PACKET_ERROR.BUSY, AGENT_PACKET_ERROR.INPUT, AGENT_PACKET_ERROR.PROTECTED].includes(result.reason)) return fail(CALIBRATION.ERROR.SETUP);
      results[task] = result;
    }
    const ok = Object.values(results).every((item) => item.state === AGENT_PACKET_STATE.PASSED);
    const report = { ok, mode: 'check', assignment: calibrationAssignment(results), activation: COMMAND.ACTIVATION,
      kitDigest: manifest.artifactDigest, model: plan.model, trial, checkElapsedMs: Math.round(performance.now() - started),
      results, measurementAuthority: 'maintainer-record', acceptance: 'authoring-calibration-only' };
    output(json ? JSON.stringify(report) : `calibration ${ok ? 'passed' : 'limited'} assignment:${report.assignment}`);
    return ok ? 0 : 1;
  } catch { return fail(CALIBRATION.ERROR.SETUP); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCalibrationCommand(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}
