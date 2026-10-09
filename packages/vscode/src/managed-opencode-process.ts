import path from 'node:path';
import { spawnOwnedProcess } from './owned-process';
import { registerManagedProcess, unregisterManagedProcess } from './opencodeProcessRegistry';

// OC1 and OC2 emit different exact readiness prefixes.
const READY_PREFIXES = Object.freeze(['opencode server listening', 'server listening']);

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
const CMD_LIMIT = 8191;

// A batch wrapper reparses %*. Protect both parser passes; CALL adds an unsafe
// third expansion and must not be used for a confirmed argument vector.
export function resolveManagedLaunch(binary: string, args: string[]) {
  if (process.platform !== 'win32' || !['.cmd', '.bat'].includes(path.extname(binary).toLowerCase())) return { binary, args };
  if ([binary, ...args].some(value => /[\r\n]/.test(value))) throw new Error('Windows batch connections cannot represent line breaks');
  const escaped = args.map(value => {
    const quoted = '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/g, '$1$1') + '"';
    return quoted.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
  });
  const command = '"' + binary.replace(CMD_META, '^$1') + ' ' + escaped.join(' ') + '"';
  if (command.length > CMD_LIMIT) throw new Error('Windows batch connection exceeds the command-line limit');
  return { binary: process.env.ComSpec || 'cmd.exe', args: ['/d', '/v:off', '/s', '/c', command], windowsVerbatimArguments: true };
}

export function spawnManagedOpenCodeProcess(
  binary: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; port: number; timeoutMs: number; signal: AbortSignal; sourceBinary: string; appBundleHint: string },
) {
  options.signal.throwIfAborted();
  const launch = resolveManagedLaunch(binary, args);
  const owned = spawnOwnedProcess(launch.binary, launch.args, { cwd: options.cwd, env: options.env, windowsVerbatimArguments: launch.windowsVerbatimArguments });
  const registration = registerManagedProcess({
    pid: owned.child.pid, ownerPid: process.pid, port: options.port, binary: options.sourceBinary, runtime: 'vscode',
  });
  let closing: Promise<void> | null = null;
  const close = () => {
    if (!closing) closing = (async () => {
      await registration;
      await owned.terminate();
      await unregisterManagedProcess(owned.child.pid);
    })().catch((error) => { closing = null; throw error; });
    return closing;
  };
  let url: string | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    let stdout = '';
    let outputBytes = 0;
    let settled = false;
    const capture = (chunk: Buffer) => { outputBytes += chunk.length; };
    const startupError = (message: string) => new Error(`${message} Binary used: ${options.sourceBinary}.${options.appBundleHint} Startup output bytes received: ${outputBytes}.`);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      owned.child.stdout.off('data', onStdout);
      owned.child.stderr.off('data', capture);
      // Continue draining after readiness without retaining server output.
      owned.child.stdout.resume();
      owned.child.stderr.resume();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(new Error('OpenCode startup cancelled'));
    const onStdout = (chunk: Buffer) => {
      capture(chunk);
      stdout += chunk.toString();
      const lines = stdout.split('\n');
      stdout = (lines.pop() ?? '').slice(-32 * 1024);
      for (const line of lines) {
        if (!READY_PREFIXES.some(prefix => line.startsWith(prefix))) continue;
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
        if (!match) { finish(startupError('Failed to parse server URL.')); return; }
        url = match[1];
        finish();
        return;
      }
    };
    const timer = setTimeout(() => finish(startupError(`Timeout waiting for server to start after ${options.timeoutMs}ms.`)), options.timeoutMs);
    owned.child.stdout.on('data', onStdout);
    owned.child.stderr.on('data', capture);
    void owned.closed.then((exit) => finish(exit.error ?? startupError(`OpenCode process exited before serving with code ${exit.code}, signal ${exit.signal}.`)));
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) onAbort();
  }).catch(async (error) => {
    await close();
    throw error;
  });
  return { get url() { return url; }, ready, close };
}
