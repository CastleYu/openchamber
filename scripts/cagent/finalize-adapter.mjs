import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AGENT_ADAPTER, AGENT_ARTIFACT, AGENT_EXTENSION, AGENT_FILE_ERROR, AGENT_FILE_MODE, AGENT_OPERATION, AGENT_PACKET_ERROR, AGENT_PACKET_STATE, AGENT_PACKET_STORAGE, AGENT_SUPPORT } from '../../packages/web/server/lib/agent/constants.js';
import { extensionActionIDSchema, extensionManifestSchema } from '../../packages/web/server/lib/agent/extensions.js';
import { agentArtifactDigest, agentArtifactManifestSchema, verifyAgentArtifacts } from '../../packages/web/server/lib/agent/artifacts.js';
import { createAgentPacketWorkspace } from '../../packages/web/server/lib/agent/packet-workspace.js';
import { assembleAdapter, AssemblyError } from './adapter-assembly.mjs';
import { createFixtureChecks, fixtureSchema } from './fixture-checks.mjs';
import { runFixtureProcess, FixtureProcessError, PROCESS } from './fixture-process.mjs';
import { readLocalJSON } from './read-input.mjs';
import { PACKET_PLAN } from './packet-plan.mjs';

export const FINALIZE = Object.freeze({ INVALID: 'invalid-arguments', SETUP: 'finalize-unavailable', PROTECTED: 'protected-kit-changed',
  CANDIDATE: 'candidate-failed', OUTPUT: 'output-unavailable', ACTIVATION: 'unavailable', CHECK: 'semantic-fixtures',
  PROGRESS: 'progress', MAX: Object.keys(AGENT_OPERATION).length, JSON: '--json', INCOMPLETE: 'artifact-incomplete' });
const operations = Object.values(AGENT_OPERATION);
const opSchema = z.enum(operations);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const registrationSchema = z.object({
  operations: z.array(z.object({ operation: opSchema, directory: z.string(), entry: z.literal(PACKET_PLAN.FILE.HANDLER), factory: z.literal('createOperation') }).strict()).max(FINALIZE.MAX),
  extensions: z.array(z.object({ actionID: extensionActionIDSchema, manifest: extensionManifestSchema, directory: z.string(),
    entry: z.literal(PACKET_PLAN.FILE.HANDLER), factory: z.literal('createExtension') }).strict()).max(AGENT_EXTENSION.MAX_ACTIONS).default([]),
  capabilities: z.record(opSchema, z.object({ state: z.literal(AGENT_SUPPORT.UNVERIFIED), evidence: z.array(z.never()).max(0) }).strict()),
}).strict().superRefine((value, context) => {
  if (Object.keys(value.capabilities).length !== FINALIZE.MAX || operations.some((operation) => !Object.hasOwn(value.capabilities, operation))) {
    context.addIssue({ code: 'custom', message: 'invalid capabilities' });
  }
  if (value.operations.length + value.extensions.length === 0
    || new Set(value.extensions.map((row) => row.actionID)).size !== value.extensions.length
    || value.extensions.some((row) => row.actionID !== row.manifest.actionID
      || row.directory !== `${PACKET_PLAN.DIRECTORY.CANDIDATE}/${row.actionID}`)) context.addIssue({ code: 'custom', message: 'invalid extensions' });
});
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const overlaps = (a, b) => { const rel = path.relative(a, b); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
const overlap = (a, b) => overlaps(a, b) || overlaps(b, a);
const canonicalDir = async (name) => {
  const resolved = path.resolve(name); const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(resolved) !== resolved) throw new Error();
  return resolved;
};
const prepareOutput = async (out, workspace) => {
  const target = path.resolve(out); const parent = await canonicalDir(path.dirname(target));
  if (target === parent || overlap(target, workspace)) throw new Error();
  try { await fs.lstat(target); throw new Error(); }
  catch (error) { if (error.code !== AGENT_FILE_ERROR.MISSING) throw error; }
  return target;
};
const supportedProcessFailure = (error) => error instanceof AssemblyError || error instanceof FixtureProcessError
  && [PROCESS.CODE.TIMEOUT, PROCESS.CODE.OUTPUT, PROCESS.CODE.EXIT].includes(error.code);

export async function runFinalizeCommand(args, output) {
  const jsonMode = args.includes(FINALIZE.JSON);
  const emit = (value) => output(jsonMode ? JSON.stringify(value) : value.ok
    ? `adapter finalized operations:${value.operations} activation:${FINALIZE.ACTIVATION}` : value.error);
  const fail = (error, operation = null) => { emit({ ok: false, error, failedOperation: operation }); return 1; };
  let values;
  try {
    ({ values } = parseArgs({ args, options: { workspace: { type: 'string' }, 'kit-digest': { type: 'string' }, node: { type: 'string' }, out: { type: 'string' }, timeout: { type: 'string' }, json: { type: 'boolean' }, quiet: { type: 'boolean' } }, allowPositionals: false }));
    if (!values.workspace || !values['kit-digest'] || !values.node || !values.out || !digestSchema.safeParse(values['kit-digest']).success
      || !path.isAbsolute(values.node) || (values.timeout !== undefined && !/^\d+$/.test(values.timeout))) return fail(FINALIZE.INVALID);
  } catch { return fail(FINALIZE.INVALID); }

  let workspace; let out; let manifest; let registration;
  try {
    workspace = await canonicalDir(values.workspace);
    out = await prepareOutput(values.out, workspace);
    manifest = agentArtifactManifestSchema.parse(await readLocalJSON(path.join(workspace, PACKET_PLAN.DIRECTORY.CONTROL, PACKET_PLAN.FILE.MANIFEST)));
    if (manifest.artifactDigest !== values['kit-digest']) return fail(FINALIZE.PROTECTED);
    try { await verifyAgentArtifacts({ directory: path.join(workspace, PACKET_PLAN.DIRECTORY.PROTECTED), manifest }); }
    catch { return fail(FINALIZE.PROTECTED); }
    registration = registrationSchema.parse(await readLocalJSON(path.join(workspace, PACKET_PLAN.DIRECTORY.PROTECTED, PACKET_PLAN.FILE.REGISTRATION)));
    if (new Set(registration.operations.map((row) => row.operation)).size !== registration.operations.length
      || registration.operations.some((row) => row.directory !== `${PACKET_PLAN.DIRECTORY.CANDIDATE}/${row.operation}`)
      || operations.some((op) => registration.capabilities[op]?.state !== AGENT_SUPPORT.UNVERIFIED)) return fail(FINALIZE.SETUP);
  } catch { return fail(FINALIZE.SETUP); }

  const protectedDirectory = path.join(workspace, PACKET_PLAN.DIRECTORY.PROTECTED);
  const definitions = new Map();
  const candidateDigests = {};
  const fixtureResults = {};
  const captured = new Map();
  const packets = [];
  try {
    const registered = [...registration.operations.map((row) => ({ operation: row.operation })),
      ...registration.extensions.map((row) => ({ operation: row.actionID, manifest: row.manifest }))];
    for (const row of registered) {
      const operation = row.operation;
      const definition = fixtureSchema.parse(await readLocalJSON(path.join(protectedDirectory, operation, PACKET_PLAN.FILE.FIXTURES)));
      if ('operation' in definition ? definition.operation !== operation || Object.hasOwn(row, 'manifest')
        : definition.actionID !== operation || !isDeepStrictEqual(definition.manifest, row.manifest)) throw new Error();
      const ids = createFixtureChecks(definition, async () => null).map(({ id }) => id);
      definitions.set(operation, definition); fixtureResults[operation] = ids.map((id) => ({ id, passed: false }));
      const check = { id: FINALIZE.CHECK, run: async (sources) => {
        try {
          const built = 'operation' in definition
            ? await assembleAdapter(sources.map(({ text }) => ({ operation, text })))
            : await assembleAdapter([], sources.map(({ text }) => ({ manifest: definition.manifest, text })));
          const options = { definition, source: built.source, nodePath: values.node };
          if (values.timeout !== undefined) options.timeoutMs = Number(values.timeout);
          const result = await runFixtureProcess(options); fixtureResults[operation] = result.checks;
          if (result.checks.every((item, index) => item.id === ids[index] && item.passed)) captured.set(operation, sources[0].text);
          return result.checks.length === ids.length && result.checks.every((item, index) => item.id === ids[index] && item.passed);
        } catch (error) { if (supportedProcessFailure(error)) return false; throw error; }
      } };
      packets.push({ operation, directory: path.join(workspace, PACKET_PLAN.DIRECTORY.CANDIDATE, operation), files: [PACKET_PLAN.FILE.HANDLER], dependsOn: [], checks: [check] });
    }
  } catch { return fail(FINALIZE.SETUP); }

  try { await fs.mkdir(path.join(workspace, FINALIZE.PROGRESS), { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE }); }
  catch (error) { if (error.code !== AGENT_FILE_ERROR.EXISTS) return fail(FINALIZE.SETUP); }
  let runner;
  try { runner = createAgentPacketWorkspace({ protectedDirectory, manifest, progressDirectory: path.join(workspace, FINALIZE.PROGRESS), packets }); }
  catch { return fail(FINALIZE.SETUP); }
  const registered = [...registration.operations.map(({ operation }) => operation), ...registration.extensions.map(({ actionID }) => actionID)];
  for (const operation of registered) {
    const result = await runner.run(operation);
    if (result.state !== AGENT_PACKET_STATE.PASSED) return fail(result.reason === AGENT_PACKET_ERROR.CHECK || result.reason === AGENT_PACKET_ERROR.LIMIT
      ? FINALIZE.CANDIDATE : FINALIZE.SETUP, operation);
    candidateDigests[operation] = result.candidateDigest;
  }
  let writing = false;
  try {
    const built = await assembleAdapter(registration.operations.map(({ operation }) => ({ operation, text: captured.get(operation) })),
      registration.extensions.map(({ actionID, manifest }) => ({ manifest, text: captured.get(actionID) })));
    for (const operation of registered) {
      const options = { definition: definitions.get(operation), source: built.source, nodePath: values.node };
      if (values.timeout !== undefined) options.timeoutMs = Number(values.timeout);
      const result = await runFixtureProcess(options); fixtureResults[operation] = result.checks;
      if (!result.checks.every((item) => item.passed)) return fail(FINALIZE.CANDIDATE, operation);
    }
    await verifyAgentArtifacts({ directory: protectedDirectory, manifest });
    const artifactBytes = Buffer.from(built.source);
    const artifactRecord = { path: AGENT_ADAPTER.ENTRY, bytes: artifactBytes.length, digest: hash(artifactBytes) };
    const artifactDigest = agentArtifactDigest([artifactRecord]);
    const manifestBytes = Buffer.from(`${JSON.stringify({ version: AGENT_ARTIFACT.VERSION, artifactDigest, files: [artifactRecord] }, null, 2)}\n`);
    const report = { version: 1, sourceKitDigest: manifest.artifactDigest, artifactDigest,
      candidateDigests, fixtures: fixtureResults, support: Object.fromEntries([...operations, ...registration.extensions.map(({ actionID }) => actionID)].map((op) => [op, AGENT_SUPPORT.UNVERIFIED])), activation: FINALIZE.ACTIVATION };
    await prepareOutput(out, workspace);
    await fs.mkdir(out, { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE });
    writing = true;
    await fs.mkdir(path.join(out, 'artifact'), { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE });
    await fs.mkdir(path.join(out, 'control'), { mode: AGENT_PACKET_STORAGE.DIRECTORY_MODE });
    await fs.writeFile(path.join(out, 'artifact', AGENT_ADAPTER.ENTRY), artifactBytes, { flag: AGENT_FILE_MODE.EXCLUSIVE, mode: AGENT_FILE_MODE.OWNER_READ_WRITE });
    await fs.writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: AGENT_FILE_MODE.EXCLUSIVE, mode: AGENT_FILE_MODE.OWNER_READ_WRITE });
    const pending = path.join(out, 'control', `${PACKET_PLAN.FILE.MANIFEST}.pending`);
    await fs.writeFile(pending, manifestBytes, { flag: AGENT_FILE_MODE.EXCLUSIVE, mode: AGENT_FILE_MODE.OWNER_READ_WRITE });
    await fs.rename(pending, path.join(out, 'control', PACKET_PLAN.FILE.MANIFEST));
    emit({ ok: true, operations: registration.operations.length, extensions: registration.extensions.length, artifactDigest, activation: FINALIZE.ACTIVATION }); return 0;
  } catch (error) {
    if (writing) return fail(FINALIZE.INCOMPLETE);
    if (supportedProcessFailure(error)) return fail(FINALIZE.CANDIDATE);
    return fail(FINALIZE.SETUP);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runFinalizeCommand(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}
