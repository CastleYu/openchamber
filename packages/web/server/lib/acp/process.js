import { spawn, execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { delimiter, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const BATCH = new Set(['.bat', '.cmd']);
const META = /([()%!^"`<>&|;, *?\[\]])/g;
const escape = (value) => value.replace(META, '^$1');
// Preserve the argument through both cmd parsing and the executable's argv parser.
const quote = (value) => escape(`"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`);
const envValue = (env, name) => process.platform === 'win32'
  ? env[Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase()) ?? name]
  : env[name];

const locate = async (command, cwd, env) => {
  const explicit = /[\\/]/.test(command);
  const folders = explicit ? [''] : [cwd, ...(envValue(env, 'PATH') ?? '').split(delimiter)];
  const extensions = extname(command) ? [''] : ['', ...(envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';')];
  for (const folder of folders) {
    for (const extension of extensions) {
      const candidate = explicit ? resolve(cwd, command + extension) : resolve(cwd, folder.replace(/^"|"$/g, ''), command + extension);
      try { if ((await stat(candidate)).isFile()) return candidate; }
      catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    }
  }
  throw new Error('ACP command was not found (ENOENT). Select an existing executable or BAT/CMD file, or add it to PATH.');
};

/** Only Windows batch commands require cmd; executable launches stay direct. */
export const spawnAcp = async ({ command, args, cwd, env = process.env, detached = false }) => {
  const options = { cwd, env, detached, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false };
  if (process.platform !== 'win32') return spawn(command, args, options);
  const target = await locate(command, cwd, env);
  if (!BATCH.has(extname(target).toLowerCase())) return spawn(target, args, options);
  if ([target, ...args].some((value) => /[\r\n\0]/.test(value))) throw new Error('ACP BAT/CMD paths and arguments must not contain line breaks or NUL characters.');
  // Batch parameters are parsed again when the script forwards them with %*.
  const line = `${escape(target)} ${args.map((value) => escape(quote(value))).join(' ')}`;
  return spawn(envValue(env, 'ComSpec') || join(envValue(env, 'SystemRoot') || 'C:\\Windows', 'System32', 'cmd.exe'),
    ['/d', '/s', '/v:off', '/c', `"${line}"`], { ...options, windowsVerbatimArguments: true });
};

/** Keep the wrapper alive until Windows has found and terminated its descendants. */
export const terminateAcp = async (child) => {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32') { child.kill(); return; }
  try {
    await exec(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) throw new Error(`Cannot stop ACP process tree (${error.code ?? 'unknown'}).`);
  }
};
