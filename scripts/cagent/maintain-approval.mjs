import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AGENT_FAMILY, AGENT_SUPPORT } from '../../packages/web/server/lib/agent/constants.js';
import { agentArtifactManifestSchema, verifyAgentArtifacts } from '../../packages/web/server/lib/agent/artifacts.js';
import { createAgentApprovalWriter } from '../../packages/web/server/lib/agent/approval-writer.js';
import { agentApprovalSchema } from '../../packages/web/server/lib/agent/schemas.js';
import { readLocalJSON } from './read-input.mjs';

const COMMAND = Object.freeze({
  INVALID: 'invalid-arguments', INPUT: 'review-input-unavailable', REVIEW: 'invalid-maintainer-review',
  ARTIFACT: 'review-artifact-mismatch', STORAGE: 'approval-storage-unavailable',
});

/** Maintainer decision only. Never executes candidate code or establishes live API evidence. */
export async function runMaintainApproval(args, output) {
  const json = args.includes('--json');
  const fail = (error) => { output(json ? JSON.stringify({ ok: false, error }) : error); return 1; };
  let values;
  try {
    ({ values } = parseArgs({ args, options: {
      approve: { type: 'boolean' }, revoke: { type: 'boolean' }, directory: { type: 'string' },
      review: { type: 'string' }, artifact: { type: 'string' }, manifest: { type: 'string' }, digest: { type: 'string' },
      connection: { type: 'string' }, json: { type: 'boolean' }, quiet: { type: 'boolean' },
    }, allowPositionals: false }));
    if (!values.directory || Boolean(values.approve) === Boolean(values.revoke)) return fail(COMMAND.INVALID);
    if (values.revoke ? (!values.connection || values.review || values.artifact || values.manifest || values.digest)
      : (!values.review || !values.artifact || !values.manifest || !/^[a-f0-9]{64}$/.test(values.digest ?? '') || values.connection)) return fail(COMMAND.INVALID);
  } catch { return fail(COMMAND.INVALID); }
  if (values.revoke) {
    try {
      const removed = createAgentApprovalWriter({ directory: values.directory }).revoke({ family: AGENT_FAMILY.CAGENT, connectionID: values.connection });
      output(json ? JSON.stringify({ ok: true, action: 'revoke', removed }) : `approval revoked removed:${removed}`);
      return 0;
    } catch { return fail(COMMAND.STORAGE); }
  }
  let inputs;
  try { inputs = await Promise.all([readLocalJSON(values.review), readLocalJSON(values.manifest)]); }
  catch { return fail(COMMAND.INPUT); }
  let review;
  let manifest;
  try {
    review = agentApprovalSchema.parse(inputs[0]);
    manifest = agentArtifactManifestSchema.parse(inputs[1]);
    const rows = [...review.operations, ...(review.extensions ?? [])];
    if (review.family !== AGENT_FAMILY.CAGENT || rows.length === 0
      || rows.some((row) => row.state !== AGENT_SUPPORT.SUPPORTED && row.state !== AGENT_SUPPORT.ADAPTED)) return fail(COMMAND.REVIEW);
  } catch { return fail(COMMAND.REVIEW); }
  try {
    if (manifest.artifactDigest !== values.digest || review.artifactDigest !== values.digest) return fail(COMMAND.ARTIFACT);
    await verifyAgentArtifacts({ directory: values.artifact, manifest });
  } catch { return fail(COMMAND.ARTIFACT); }
  try { createAgentApprovalWriter({ directory: values.directory }).write(review); }
  catch { return fail(COMMAND.STORAGE); }
  const report = { ok: true, action: 'approve', operations: review.operations.length, extensions: review.extensions?.length ?? 0,
    evidenceScope: 'maintainer-reviewed', activation: 'host-gated' };
  output(json ? JSON.stringify(report) : `approval recorded operations:${report.operations} extensions:${report.extensions} activation:host-gated`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runMaintainApproval(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}
