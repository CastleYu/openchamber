import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

type ProcessExit = { code: number | null; signal: NodeJS.Signals | null; error: Error | null };


type WindowsTermination = {
  child: ChildProcess;
  pid: number;
  deadline: number;
  resolve: () => void;
  reject: (error: Error) => void;
};
const windowsBudgetMs = 5000;
let pendingWindows: WindowsTermination[] = [];
let windowsRunning = false;
let windowsScheduled = false;

function scheduleWindowsTermination() {
  if (windowsRunning || windowsScheduled || pendingWindows.length === 0) return;
  windowsScheduled = true;
  setImmediate(flushWindowsTermination);
}

function flushWindowsTermination() {
  windowsScheduled = false;
  const pending = pendingWindows;
  pendingWindows = [];
  const batch: WindowsTermination[] = [];
  for (const entry of pending) {
    if (entry.child.exitCode !== null || entry.child.signalCode !== null) entry.resolve();
    else if (entry.deadline - performance.now() < 1) entry.reject(new Error('Owned process termination exceeded its Windows budget'));
    else batch.push(entry);
  }
  if (batch.length === 0) { scheduleWindowsTermination(); return; }
  const timeout = Math.floor(Math.min(...batch.map(entry => entry.deadline - performance.now())));
  if (timeout < 1) {
    for (const entry of batch) entry.reject(new Error('Owned process termination exceeded its Windows budget'));
    scheduleWindowsTermination();
    return;
  }
  windowsRunning = true;
  const finish = (error: Error | null) => {
    windowsRunning = false;
    for (const entry of batch) {
      if (error && entry.child.exitCode === null && entry.child.signalCode === null) entry.reject(error);
      else entry.resolve();
    }
    scheduleWindowsTermination();
  };
  // Keep parents alive while Windows enumerates their descendants. Requests
  // arriving during this invocation share the next batch and retain their budget.
  try {
    execFile('taskkill', [...batch.flatMap(entry => ['/PID', String(entry.pid)]), '/T', '/F'],
      { windowsHide: true, timeout }, finish);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    finish(error);
  }
}

function terminateWindows(child: ChildProcess, pid: number) {
  return new Promise<void>((resolve, reject) => {
    pendingWindows.push({ child, pid, deadline: performance.now() + windowsBudgetMs, resolve, reject });
    scheduleWindowsTermination();
  });
}

// Each background command gets its own POSIX group. Never signal the extension
// host's group, which can also contain unrelated extensions and editor work.
export function spawnOwnedProcess(binary: string, args: string[], options: Pick<SpawnOptions, 'cwd' | 'env' | 'windowsVerbatimArguments'>) {
  const child = spawn(binary, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let spawnError: Error | null = null;
  const closed = new Promise<ProcessExit>((resolve) => {
    child.once('error', (error) => { spawnError = error; });
    child.once('close', (code, signal) => resolve({ code, signal, error: spawnError }));
  });
  const waitForClose = async (timeoutMs: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        closed.then(() => true),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const signalGroup = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
  };
  let termination: Promise<void> | null = null;
  const terminate = () => {
    if (termination) return termination;
    termination = (async () => {
      if (!child.pid) { await closed; return; }
      if (process.platform === 'win32') {
        if (child.exitCode === null && child.signalCode === null) {
          await terminateWindows(child, child.pid);
        }
      } else {
        signalGroup('SIGTERM');
        await waitForClose(1000);
        // A parent can exit while a tool ignores SIGTERM or holds its pipes.
        signalGroup('SIGKILL');
      }
      if (!await waitForClose(1000)) throw new Error('Owned process did not close after termination');
    })().catch((error) => { termination = null; throw error; });
    return termination;
  };
  return { child, closed, terminate };
}
