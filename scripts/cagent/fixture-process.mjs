import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createFixtureChecks, fixtureSchema } from './fixture-checks.mjs';

export const PROCESS = Object.freeze({
  CODE: Object.freeze({ SETUP: 'fixture-process-setup', INPUT: 'fixture-process-input', TIMEOUT: 'fixture-process-timeout', OUTPUT: 'fixture-process-output', EXIT: 'fixture-process-exit' }),
  MAX_INPUT: 1024 * 1024,
  MAX_OUTPUT: 64 * 1024,
  DEFAULT_TIMEOUT: 5000,
  MIN_TIMEOUT: 10,
  MAX_TIMEOUT: 30000,
  WORKER: fileURLToPath(new URL('./fixture-worker.mjs', import.meta.url)),
  ENV: Object.freeze(['SystemRoot', 'WINDIR']), SIGNAL: 'SIGKILL',
});
export const fixtureTaskSchema = z.object({ definition: fixtureSchema,
  source: z.string().min(1).refine((text) => Buffer.byteLength(text) <= PROCESS.MAX_INPUT),
}).strict();
const resultSchema = z.object({ checks: z.array(z.object({ id: z.string(), passed: z.boolean() }).strict()).min(1).max(64) }).strict();
const readySchema = z.object({ ready: z.literal(true) }).strict();

export class FixtureProcessError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const fail = (code) => { throw new FixtureProcessError(code); };

export async function runFixtureProcess({ definition, source, nodePath, timeoutMs = PROCESS.DEFAULT_TIMEOUT }) {
  const parsed = fixtureTaskSchema.safeParse({ definition, source });
  if (!parsed.success || !z.string().refine(path.isAbsolute).safeParse(nodePath).success || !Number.isInteger(timeoutMs)
    || timeoutMs < PROCESS.MIN_TIMEOUT || timeoutMs > PROCESS.MAX_TIMEOUT) fail(PROCESS.CODE.INPUT);
  try { createFixtureChecks(parsed.data.definition, async () => null); }
  catch { fail(PROCESS.CODE.INPUT); }
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const node = await realpath(nodePath).catch(() => fail(PROCESS.CODE.SETUP));
  const modules = await realpath(path.join(repo, 'node_modules')).catch(() => null);
  const task = JSON.stringify(parsed.data);
  if (Buffer.byteLength(task) > PROCESS.MAX_INPUT) fail(PROCESS.CODE.INPUT);
  const args = [
    '--permission', `--allow-fs-read=${repo}`,
  ];
  if (modules) args.push(`--allow-fs-read=${modules}`);
  args.push(PROCESS.WORKER);
  const env = process.platform === 'win32'
    ? Object.fromEntries(PROCESS.ENV.filter((key) => process.env[key]).map((key) => [key, process.env[key]]))
    : {};
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(node, args, { cwd: repo, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { reject(new FixtureProcessError(PROCESS.CODE.SETUP)); return; }
    const out = [];
    let bytes = 0;
    let overflow = false;
    let timedOut = false;
    let spawnError = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(PROCESS.SIGNAL); }, timeoutMs);
    const collect = (chunk) => {
      bytes += chunk.length;
      if (bytes > PROCESS.MAX_OUTPUT) { if (!overflow) child.kill(PROCESS.SIGNAL); overflow = true; return; }
      out.push(chunk);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > PROCESS.MAX_OUTPUT && !overflow) { overflow = true; child.kill(PROCESS.SIGNAL); }
    });
    child.stdin.on('error', () => { spawnError = true; child.kill(PROCESS.SIGNAL); });
    child.on('error', () => { spawnError = true; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (spawnError) { reject(new FixtureProcessError(PROCESS.CODE.SETUP)); return; }
      if (timedOut) { reject(new FixtureProcessError(PROCESS.CODE.TIMEOUT)); return; }
      if (overflow) { reject(new FixtureProcessError(PROCESS.CODE.OUTPUT)); return; }
      const frames = Buffer.concat(out).toString('utf8').trim().split('\n');
      let ready;
      try { ready = readySchema.safeParse(JSON.parse(frames[0])).success; }
      catch { ready = false; }
      if (!ready) { reject(new FixtureProcessError(PROCESS.CODE.SETUP)); return; }
      if (code !== 0) { reject(new FixtureProcessError(PROCESS.CODE.EXIT)); return; }
      try {
        if (frames.length !== 2) throw new Error(PROCESS.CODE.OUTPUT);
        const result = resultSchema.parse(JSON.parse(frames[1]));
        const cases = parsed.data.definition.cases;
        if (result.checks.length !== cases.length || result.checks.some((item, index) => item.id !== cases[index].id)) throw new Error(PROCESS.CODE.OUTPUT);
        resolve(result);
      } catch { reject(new FixtureProcessError(PROCESS.CODE.OUTPUT)); }
    });
    child.stdin.end(task);
  });
}
