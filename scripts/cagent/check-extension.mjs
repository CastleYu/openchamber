import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { extensionManifestSchema, parseExtensionInput, parseExtensionResult } from '../../packages/web/server/lib/agent/extensions.js';
import { readLocalJSON } from './read-input.mjs';
import { compileExtensions } from './extension-mapping.mjs';

const COMMAND = Object.freeze({ INVALID: 'invalid-arguments', INPUT: 'extension-input-unavailable', FAILED: 'invalid-extension-contract' });
/** Structural checks only. Adapter effects, permissions and live acceptance are separate host gates. */
export async function runCheckExtension(args, output) {
  const json = args.includes('--json');
  const fail = (error) => { output(json ? JSON.stringify({ ok: false, error }) : error); return 1; };
  let values;
  try {
    ({ values } = parseArgs({ args, options: { manifest: { type: 'string' }, input: { type: 'string' }, result: { type: 'string' },
      catalog: { type: 'string' }, mapping: { type: 'string' }, manifests: { type: 'string' },
      json: { type: 'boolean' }, quiet: { type: 'boolean' } }, allowPositionals: false }));
    const inventory = values.catalog || values.mapping || values.manifests;
    if (inventory ? (!values.catalog || !values.mapping || !values.manifests || values.manifest || values.input || values.result) : !values.manifest) return fail(COMMAND.INVALID);
  } catch { return fail(COMMAND.INVALID); }
  let inputs;
  try { inputs = values.manifests
    ? await Promise.all([readLocalJSON(values.catalog), readLocalJSON(values.mapping), readLocalJSON(values.manifests)])
    : await Promise.all([readLocalJSON(values.manifest), values.input ? readLocalJSON(values.input) : undefined,
      values.result ? readLocalJSON(values.result) : undefined]); }
  catch { return fail(COMMAND.INPUT); }
  try {
    if (values.manifests) {
      const coverage = compileExtensions(...inputs);
      output(json ? JSON.stringify({ ok: true, checkScope: 'inventory-and-structure-only', coverage })
        : `extensions checked actions:${coverage.actions.length} checks:inventory-and-structure-only activation:unavailable`);
      return 0;
    }
    const manifest = extensionManifestSchema.parse(inputs[0]);
    if (values.input) parseExtensionInput(manifest, inputs[1]);
    if (values.result) parseExtensionResult(manifest, inputs[2]);
    const report = { ok: true, actionID: manifest.actionID, inputChecked: Boolean(values.input), resultChecked: Boolean(values.result),
      checkScope: 'structural-only', activation: 'unavailable' };
    output(json ? JSON.stringify(report) : `extension checked action:${report.actionID} checks:structural-only activation:unavailable`);
    return 0;
  } catch { return fail(COMMAND.FAILED); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCheckExtension(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}
