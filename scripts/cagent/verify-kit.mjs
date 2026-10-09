import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { agentArtifactManifestSchema, verifyAgentArtifacts } from '../../packages/web/server/lib/agent/artifacts.js';
import { readLocalJSON } from './read-input.mjs';

const COMMAND = Object.freeze({ JSON: '--json', INVALID: 'invalid-arguments', FAILED: 'kit-verification-failed' });

/** The expected digest is supplied independently by the kit owner. */
export async function runVerifyKit(args, output) {
  const json = args.includes(COMMAND.JSON);
  const report = (value) => output(json ? JSON.stringify(value) : value.ok ? `kit verified digest:${value.digest}` : value.error);
  let values;
  try {
    ({ values } = parseArgs({ args, options: { kit: { type: 'string' }, digest: { type: 'string' }, json: { type: 'boolean' }, quiet: { type: 'boolean' } }, allowPositionals: false }));
    if (!values.kit || !/^[a-f0-9]{64}$/.test(values.digest ?? '')) throw new Error(COMMAND.INVALID);
  } catch { report({ ok: false, error: COMMAND.INVALID }); return 1; }
  try {
    const root = path.resolve(values.kit);
    const manifest = agentArtifactManifestSchema.parse(await readLocalJSON(path.join(root, 'control/manifest.json')));
    if (manifest.artifactDigest !== values.digest) throw new Error(COMMAND.FAILED);
    await verifyAgentArtifacts({ directory: path.join(root, 'protected'), manifest });
    report({ ok: true, digest: values.digest, files: manifest.files.length, activation: 'unavailable' });
    return 0;
  } catch { report({ ok: false, error: COMMAND.FAILED }); return 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runVerifyKit(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}
