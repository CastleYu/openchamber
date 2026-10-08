import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildContractPages, CONTRACT_REFERENCE } from './contract-pages.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const COMMAND = Object.freeze({ JSON: '--json', INVALID: 'invalid-arguments', STALE: 'reference-stale', FAILED: 'reference-generation-failed' });

const inventory = async (root, relative) => {
  const names = [];
  let entries;
  try { entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }); }
  catch { return names; }
  for (const entry of entries) {
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) names.push(...await inventory(root, name));
    else names.push(name);
  }
  return names;
};

/** Fixed repository outputs. No prompts, API calls, candidate execution or activation. */
export async function runContractCommand(args, root, output) {
  let jsonMode = args.includes(COMMAND.JSON);
  try {
    const { values } = parseArgs({ args, options: {
      write: { type: 'boolean' }, check: { type: 'boolean' }, json: { type: 'boolean' }, quiet: { type: 'boolean' },
    }, allowPositionals: false });
    jsonMode = Boolean(values.json);
    if (values.write && values.check) throw new Error(COMMAND.INVALID);
    const { files, digest } = buildContractPages();
    let mismatches = 0;
    for (const [name, text] of files) {
      const target = path.join(root, name);
      if (values.write) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, text, 'utf8');
      } else {
        try { if (await fs.readFile(target, 'utf8') !== text) mismatches += 1; }
        catch { mismatches += 1; }
      }
    }
    for (const directory of [CONTRACT_REFERENCE.EN, CONTRACT_REFERENCE.ZH]) {
      mismatches += (await inventory(root, directory)).filter((name) => !files.has(name)).length;
    }
    const ok = mismatches === 0;
    const report = { ok, mode: values.write ? 'write' : 'check', files: files.size, digest, mismatches, error: ok ? null : COMMAND.STALE };
    output(jsonMode ? JSON.stringify(report) : `${report.mode} ${ok ? 'passed' : 'failed'} files:${files.size} mismatches:${mismatches} digest:${digest}`);
    return ok ? 0 : 1;
  } catch {
    const report = { ok: false, error: COMMAND.FAILED };
    output(jsonMode ? JSON.stringify(report) : COMMAND.FAILED);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runContractCommand(process.argv.slice(2), ROOT, (line) => process.stdout.write(`${line}\n`));
}
