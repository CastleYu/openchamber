import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compileMapping, MappingError } from './mapping-intake.mjs';
import { LOCAL_INPUT, readLocalJSON } from './read-input.mjs';

export const MAPPING_COMMAND = Object.freeze({
  JSON: '--json', MAX_BYTES: LOCAL_INPUT.MAX_BYTES, INVALID: 'invalid-arguments', INPUT: 'mapping-input-unavailable',
  FAILED: 'mapping-check-failed',
});

/** Read-only intake command. It grants no execution, evidence acceptance or activation. */
export async function runMappingCommand(args, output) {
  const jsonMode = args.includes(MAPPING_COMMAND.JSON);
  let values;
  try {
    ({ values } = parseArgs({ args, options: {
      catalog: { type: 'string' }, mapping: { type: 'string' },
      json: { type: 'boolean' }, quiet: { type: 'boolean' },
    }, allowPositionals: false }));
    if (!values.catalog || !values.mapping) throw new Error(MAPPING_COMMAND.INVALID);
  } catch {
    output(jsonMode ? JSON.stringify({ ok: false, error: MAPPING_COMMAND.INVALID }) : MAPPING_COMMAND.INVALID);
    return 1;
  }
  let sources;
  try {
    sources = await Promise.all([readLocalJSON(values.catalog), readLocalJSON(values.mapping)]);
  } catch {
    output(jsonMode ? JSON.stringify({ ok: false, error: MAPPING_COMMAND.INPUT }) : MAPPING_COMMAND.INPUT);
    return 1;
  }
  try {
    const coverage = compileMapping(...sources);
    const report = { ok: true, coverage };
    output(jsonMode ? JSON.stringify(report) : `mapping check passed digest:${coverage.digest} activation:unavailable`);
    return 0;
  } catch (error) {
    const code = error instanceof MappingError ? error.code : MAPPING_COMMAND.FAILED;
    const details = error instanceof MappingError ? error.details : null;
    output(jsonMode ? JSON.stringify({ ok: false, error: code, details }) : `${code}${details ? ` check:${details.check} operation:${details.operation ?? 'none'} next:${details.nextAction}` : ''}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runMappingCommand(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}
