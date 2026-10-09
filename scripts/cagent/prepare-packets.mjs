import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildPacketPlan, PacketPlanError, PACKET_PLAN } from './packet-plan.mjs';
import { MappingError } from './mapping-intake.mjs';
import { readLocalJSON } from './read-input.mjs';
import { AGENT_FILE_ERROR, AGENT_FILE_MODE, AGENT_PACKET_STORAGE } from '../../packages/web/server/lib/agent/constants.js';

export const PREPARE_COMMAND = Object.freeze({
  JSON: '--json', INVALID: 'invalid-arguments', INPUT: 'mapping-input-unavailable', FAILED: 'packet-preparation-failed',
  EXISTS: 'workspace-exists', BOUNDARY: 'workspace-boundary', INCOMPLETE: 'workspace-incomplete',
  MANIFEST: `${PACKET_PLAN.DIRECTORY.CONTROL}/${PACKET_PLAN.FILE.MANIFEST}`, ACTIVATION: 'unavailable', CHECK_SCOPE: PACKET_PLAN.CHECK.SCOPE,
  PENDING: `${PACKET_PLAN.DIRECTORY.CONTROL}/${PACKET_PLAN.FILE.MANIFEST}.pending`,
});

class PreparationError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Creates a fresh tree. Existing work is never overwritten or deleted. */
const materialize = async (plan, name) => {
  const root = path.resolve(name);
  const parent = path.dirname(root);
  const stat = await fs.lstat(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(parent) !== parent) {
    throw new PreparationError(PREPARE_COMMAND.BOUNDARY);
  }
  try {
    await fs.mkdir(root, { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE });
  } catch (error) {
    if (error.code === AGENT_FILE_ERROR.EXISTS) throw new PreparationError(PREPARE_COMMAND.EXISTS);
    throw error;
  }
  try {
    const manifest = plan.files.get(PREPARE_COMMAND.MANIFEST);
    if (!manifest) throw new PreparationError(PREPARE_COMMAND.INCOMPLETE);
    for (const [relative, text] of plan.files) {
      if (relative === PREPARE_COMMAND.MANIFEST) continue;
      const target = path.join(root, ...relative.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true, mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE });
      await fs.writeFile(target, text, { encoding: 'utf8', flag: AGENT_FILE_MODE.EXCLUSIVE, mode: AGENT_FILE_MODE.OWNER_READ_WRITE });
    }
    const manifestPath = path.join(root, PREPARE_COMMAND.MANIFEST);
    await fs.mkdir(path.dirname(manifestPath), { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE });
    const pendingPath = path.join(root, PREPARE_COMMAND.PENDING);
    await fs.writeFile(pendingPath, manifest,
      { encoding: 'utf8', flag: AGENT_FILE_MODE.EXCLUSIVE, mode: AGENT_FILE_MODE.OWNER_READ_WRITE });
    await fs.rename(pendingPath, manifestPath);
  } catch {
    throw new PreparationError(PREPARE_COMMAND.INCOMPLETE);
  }
};

/** Preparation only. No candidate code, transport or approval port is invoked. */
export async function runPrepareCommand(args, output) {
  const jsonMode = args.includes(PREPARE_COMMAND.JSON);
  const fail = (code, details = null) => {
    output(jsonMode ? JSON.stringify({ ok: false, error: code, details }) : code);
    return 1;
  };
  let values;
  try {
    ({ values } = parseArgs({ args, options: {
      catalog: { type: 'string' }, mapping: { type: 'string' }, out: { type: 'string' }, fixtures: { type: 'string' },
      json: { type: 'boolean' }, quiet: { type: 'boolean' },
    }, allowPositionals: false }));
    if (!values.catalog || !values.mapping || !values.out) return fail(PREPARE_COMMAND.INVALID);
  } catch {
    return fail(PREPARE_COMMAND.INVALID);
  }
  let sources;
  try { sources = await Promise.all([readLocalJSON(values.catalog), readLocalJSON(values.mapping),
    values.fixtures ? readLocalJSON(values.fixtures) : undefined]); }
  catch { return fail(PREPARE_COMMAND.INPUT); }
  try {
    const plan = buildPacketPlan(...sources);
    await materialize(plan, values.out);
    const report = { ok: true, packets: plan.packets.length, files: plan.files.size, digest: plan.digest,
      activation: PREPARE_COMMAND.ACTIVATION, checkScope: plan.packets[0].checkScope };
    output(jsonMode ? JSON.stringify(report) : `packets prepared count:${report.packets} digest:${report.digest} activation:${report.activation} checks:${report.checkScope}`);
    return 0;
  } catch (error) {
    if (error instanceof MappingError) return fail(error.code, error.details);
    if (error instanceof PacketPlanError || error instanceof PreparationError) return fail(error.code);
    return fail(PREPARE_COMMAND.FAILED);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPrepareCommand(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}
