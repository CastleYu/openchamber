import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AGENT_FILE_ERROR, AGENT_OPERATION, AGENT_PACKET_STATE, AGENT_PACKET_STORAGE } from '../../packages/web/server/lib/agent/constants.js';
import { agentArtifactManifestSchema, verifyAgentArtifacts } from '../../packages/web/server/lib/agent/artifacts.js';
import { createAgentPacketWorkspace } from '../../packages/web/server/lib/agent/packet-workspace.js';
import { assembleAdapter, AssemblyError } from './adapter-assembly.mjs';
import { createFixtureChecks } from './fixture-checks.mjs';
import { runFixtureProcess, FixtureProcessError, PROCESS } from './fixture-process.mjs';
import { readLocalJSON } from './read-input.mjs';
import { PACKET_PLAN } from './packet-plan.mjs';

export const PACKET_COMMAND = Object.freeze({ INVALID: 'invalid-arguments', SETUP: 'packet-check-unavailable',
  PROTECTED: 'protected-kit-changed', PROGRESS: 'progress', CHECK: 'semantic-fixtures', JSON: '--json' });
const operationSchema = z.enum(Object.values(AGENT_OPERATION));
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Host command. Protected digest comes from the owner, never the candidate. */
export async function runPacketCommand(args, output) {
  const jsonMode = args.includes(PACKET_COMMAND.JSON);
  const fail = (error) => {
    output(jsonMode ? JSON.stringify({ ok: false, error }) : error);
    return 1;
  };
  let values;
  try {
    ({ values } = parseArgs({ args, options: { workspace: { type: 'string' }, operation: { type: 'string' },
      node: { type: 'string' }, 'kit-digest': { type: 'string' }, timeout: { type: 'string' },
      json: { type: 'boolean' }, quiet: { type: 'boolean' } }, allowPositionals: false }));
    if (!values.workspace || !values.node || !operationSchema.safeParse(values.operation).success
      || !digestSchema.safeParse(values['kit-digest']).success
      || (values.timeout && !/^\d+$/.test(values.timeout))) return fail(PACKET_COMMAND.INVALID);
  } catch { return fail(PACKET_COMMAND.INVALID); }
  try {
    const root = path.resolve(values.workspace);
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(root) !== root) return fail(PACKET_COMMAND.SETUP);
    const protectedDirectory = path.join(root, PACKET_PLAN.DIRECTORY.PROTECTED);
    const manifest = agentArtifactManifestSchema.parse(await readLocalJSON(path.join(root, PACKET_PLAN.DIRECTORY.CONTROL, PACKET_PLAN.FILE.MANIFEST)));
    if (manifest.artifactDigest !== values['kit-digest']) return fail(PACKET_COMMAND.PROTECTED);
    try { await verifyAgentArtifacts({ directory: protectedDirectory, manifest }); }
    catch { return fail(PACKET_COMMAND.PROTECTED); }
    const definition = await readLocalJSON(path.join(protectedDirectory, values.operation, PACKET_PLAN.FILE.FIXTURES));
    if (definition.operation !== values.operation) return fail(PACKET_COMMAND.SETUP);
    const cases = createFixtureChecks(definition, async () => null).map(({ id }) => id);
    const progressDirectory = path.join(root, PACKET_COMMAND.PROGRESS);
    try { await fs.mkdir(progressDirectory, { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE }); }
    catch (error) { if (error.code !== AGENT_FILE_ERROR.EXISTS) throw error; }
    let fixtures = [];
    const check = { id: PACKET_COMMAND.CHECK, run: async (sources) => {
      fixtures = cases.map((id) => ({ id, passed: false }));
      try {
        const built = await assembleAdapter(sources.map(({ text }) => ({ operation: values.operation, text })));
        const options = { definition, source: built.source, nodePath: values.node };
        if (values.timeout) options.timeoutMs = Number(values.timeout);
        const result = await runFixtureProcess(options);
        fixtures = result.checks;
        return fixtures.length === cases.length && fixtures.every((item, index) => item.id === cases[index] && item.passed);
      } catch (error) {
        if (error instanceof AssemblyError || (error instanceof FixtureProcessError
          && [PROCESS.CODE.TIMEOUT, PROCESS.CODE.OUTPUT, PROCESS.CODE.EXIT].includes(error.code))) return false;
        throw error;
      }
    } };
    const runner = createAgentPacketWorkspace({ protectedDirectory, manifest, progressDirectory,
      packets: [{ operation: values.operation, directory: path.join(root, PACKET_PLAN.DIRECTORY.CANDIDATE, values.operation),
        files: [PACKET_PLAN.FILE.HANDLER], dependsOn: [], checks: [check] }] });
    const result = await runner.run(values.operation);
    const report = { ok: result.state === AGENT_PACKET_STATE.PASSED, ...result, fixtures };
    output(jsonMode ? JSON.stringify(report) : `${report.state} operation:${report.operation} failures:${report.failures}`);
    return report.ok ? 0 : 1;
  } catch { return fail(PACKET_COMMAND.SETUP); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPacketCommand(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}
