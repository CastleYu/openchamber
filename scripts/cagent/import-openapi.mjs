import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compileOpenAPI, OpenAPIError } from './openapi-catalog.mjs';
import { catalogDigest } from './mapping-intake.mjs';
import { readLocalJSON } from './read-input.mjs';

export const IMPORT = Object.freeze({ INVALID: 'invalid-arguments', INPUT: 'openapi-input-unavailable',
  EXISTS: 'openapi-output-exists', BOUNDARY: 'openapi-output-boundary', INCOMPLETE: 'openapi-output-incomplete',
  FILE: Object.freeze({ CATALOG: 'catalog.json', DOCUMENTS: 'documents.json', REPORT: 'report.json' }) });

/** Local import only. Fresh output never overwrites existing API evidence. */
export async function runImportOpenAPI(args, output) {
  const json = args.includes('--json');
  const fail = (error) => { output(json ? JSON.stringify({ ok: false, error }) : error); return 1; };
  let values;
  try {
    ({ values } = parseArgs({ args, options: { source: { type: 'string' }, review: { type: 'string' }, out: { type: 'string' },
      json: { type: 'boolean' }, quiet: { type: 'boolean' } }, allowPositionals: false }));
    if (!values.source || !values.review || !values.out) return fail(IMPORT.INVALID);
  } catch { return fail(IMPORT.INVALID); }
  let inputs;
  try { inputs = await Promise.all([readLocalJSON(values.source), readLocalJSON(values.review)]); }
  catch { return fail(IMPORT.INPUT); }
  let plan;
  try { plan = compileOpenAPI(...inputs); }
  catch (error) { return fail(error instanceof OpenAPIError ? error.code : IMPORT.INPUT); }
  const root = path.resolve(values.out);
  try {
    const parent = path.dirname(root);
    const stat = await fs.lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(parent) !== parent) return fail(IMPORT.BOUNDARY);
    await fs.mkdir(root, { mode: 0o700 });
  } catch (error) { return fail(error.code === 'EEXIST' ? IMPORT.EXISTS : IMPORT.BOUNDARY); }
  const report = { ok: true, endpoints: plan.catalog.endpoints.length, digest: catalogDigest(plan.catalog), activation: 'unavailable' };
  try {
    for (const [name, value] of [[IMPORT.FILE.CATALOG, plan.catalog], [IMPORT.FILE.DOCUMENTS, plan.documents], [IMPORT.FILE.REPORT, report]]) {
      await fs.writeFile(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
  } catch { return fail(IMPORT.INCOMPLETE); }
  output(json ? JSON.stringify(report) : `OpenAPI imported endpoints:${report.endpoints} digest:${report.digest} activation:${report.activation}`);
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runImportOpenAPI(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}
