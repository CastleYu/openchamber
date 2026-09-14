// Managed OpenCode process registry + orphan reaper.
//
// OpenChamber spawns the OpenCode server as an EXTERNAL child binary (on Unix
// with `detached: true`, so it leads its own process group). That binary can
// therefore outlive its parent if the parent is hard-killed/crashes/`Ctrl+C`ed
// before graceful teardown runs — leaving an orphaned `opencode serve` that
// then contends on the shared SQLite DB and slows everything down.
//
// We cannot tie an arbitrary external binary to the parent's death portably
// (Electron's `utilityProcess` would, but it only runs JS entrypoints, not a
// standalone binary). So we use the same pattern OpenCode's own CLI daemon uses
// for its detached server: an on-disk record of the pids WE spawned, plus a
// startup reaper that kills ONLY our own, verified, genuinely-orphaned
// processes — never a process a live instance (another desktop window, a VS
// Code host, the user's standalone `opencode`) is actively using.
//
// Storage: ONE FILE PER SPAWNED PROCESS in a registry directory, named
// `<childPid>.json`. Multiple runtimes (web/desktop/VS Code) and multiple
// windows all run concurrently; a single shared JSON file would be corrupted by
// the read-modify-write race (last writer wins, clobbering another instance's
// entry). Per-process files mean every instance only ever writes/deletes its
// OWN file, so there is no write contention at all.
//
// Safety model (why this never kills the wrong thing):
//   1. The reaper only ever considers pids THIS product recorded. The user's
//      standalone CLI server, the official desktop app, and the TUI are never
//      recorded, so they are never even candidates.
//   2. Before killing, it re-verifies the live pid is still an `opencode serve`
//      matching the recorded port (guards against the OS recycling a dead pid
//      onto an unrelated process).
//   3. On Windows, a dead recorded root is checked for newer MCP descendants
//      whose command identifies the managed tool chain before those descendants
//      are reaped. A live owner, an unknown command, or an unknown start time is
//      left alone.
//   4. It kills only when the spawning owner is provably gone — the child has
//      been reparented to init/pid 1, or the recorded owner pid is dead. A
//      child still owned by a live instance is left untouched.
//
// All filesystem and child-process operations here are ASYNCHRONOUS. The web
// server runs in-process inside the Electron main event loop (and other hosts),
// so any `spawnSync`/`*Sync` FS call blocks the single event loop — which also
// serves UI asset requests and realtime SSE traffic. The startup reaper can
// iterate several registry entries and, on Windows, each one spawns `tasklist`
// (100-500ms) and possibly `taskkill`; doing that synchronously stalls the
// whole process and is what caused the 1.13.3 `openchamber-ui://` lag
// regression (#1841). `execFile`/`fsp.*` keep the event loop responsive while
// the reaper waits on the kernel.
//
// The VS Code extension cannot import this module (it does not bundle the web
// package); it carries a parity implementation that reads/writes the SAME dir.

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const defaultExecFileAsync = promisify(execFile);

const WINDOWS_PROCESS_QUERY = [
  '$ErrorActionPreference = "Stop"',
  'Get-CimInstance -ClassName Win32_Process',
  '| Select-Object ProcessId, ParentProcessId, Name, @{Name="CreationDate";Expression={$_.CreationDate.ToUniversalTime().ToString("o")}}, CommandLine',
  '| ConvertTo-Json -Compress',
].join(' ');
const WINDOWS_PROCESS_QUERY_TIMEOUT_MS = 5000;
const WINDOWS_MANAGED_DESCENDANT_PATTERN = /(?:mcp|opencode|node(?:\.exe)?|python(?:\.exe)?|npm(?:\.cmd)?|npx(?:\.cmd)?|codegraph|background-process|bgpm)/i;

const resolveRegistryDir = () => {
  const override = process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), '.config', 'openchamber', 'managed-opencode');
};

const entryFilePath = (pid) => path.join(resolveRegistryDir(), `${pid}.json`);

const isPidAlive = (pid) => {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = process exists but we lack permission to signal it → still alive.
    return error?.code === 'EPERM';
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const commandIdentifiesOurServer = (command, entry) => {
  if (typeof command !== 'string') return false;
  const lower = command.toLowerCase();
  if (!lower.includes('opencode') || !lower.includes('serve')) return false;
  // Tie to the exact server we registered when we know its port, so a recycled
  // pid running a *different* opencode server is never mistaken for ours.
  if (Number.isInteger(entry.port) && !command.includes(String(entry.port))) return false;
  return true;
};

/**
 * Build the registry API over injectable filesystem and child-process
 * dependencies. Production callers use the default instance exported below;
 * tests pass their own `fs`/`execFileAsync` instead of mocking node builtins.
 */
export const createManagedProcessRegistry = ({ fs = fsp, execFileAsync = defaultExecFileAsync } = {}) => {
  const writeEntryFile = async (entry) => {
    const dir = resolveRegistryDir();
    try {
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${entry.pid}.json`);
      const tmp = `${filePath}.tmp-${process.pid}`;
      await fs.writeFile(tmp, JSON.stringify(entry, null, 2));
      await fs.rename(tmp, filePath);
    } catch {
      // Best-effort: a failed registry write must never break spawn/shutdown.
    }
  };

  const readAllEntries = async () => {
    const dir = resolveRegistryDir();
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names.filter((value) => value.endsWith('.json'))) {
      const filePath = path.join(dir, name);
      try {
        const entry = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (entry && Number.isInteger(entry.pid)) {
          out.push({ entry, filePath });
        } else {
          await fs.rm(filePath, { force: true });
        }
      } catch {
        // Corrupt/partial file — drop it.
        try {
          await fs.rm(filePath, { force: true });
        } catch {
          // ignore
        }
      }
    }
    return out;
  };

  /** Record an OpenCode process WE spawned so a future run can reap it if orphaned. */
  const registerManagedProcess = async ({ pid, ownerPid, port, binary, runtime, startedAt = new Date().toISOString() } = {}) => {
    if (!Number.isInteger(pid)) return;
    await writeEntryFile({
      pid,
      ownerPid: Number.isInteger(ownerPid) ? ownerPid : process.pid,
      port: Number.isInteger(port) ? port : null,
      binary: typeof binary === 'string' ? binary : null,
      runtime: typeof runtime === 'string' ? runtime : 'web',
      startedAt,
    });
  };

  /** Drop a pid from the registry (after we have killed/closed it ourselves). */
  const unregisterManagedProcess = async (pid) => {
    if (!Number.isInteger(pid)) return;
    try {
      if (process.platform === 'win32') {
        // A root exit is not evidence that its MCP descendants exited. Keep
        // the record on unavailable or incomplete cleanup for the next run.
        const entry = JSON.parse(await fs.readFile(entryFilePath(pid), 'utf8'));
        const rows = await readWindowsProcessTree();
        if (!rows || rows.some((row) => row.pid === pid || row.parentPid === pid) || findWindowsManagedDescendants(rows, entry).length > 0) return;
      }
      await fs.rm(entryFilePath(pid), { force: true });
    } catch {
      // Best-effort: dropping a missing file is not an error.
    }
  };

  // Returns { ppid, command } for a live pid on Unix, or null if it can't be read.
  const readUnixProcInfo = async (pid) => {
    try {
      const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'ppid=,command='], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      });
      const line = (stdout || '').trim();
      if (!line) return null;
      const match = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!match) return null;
      return { ppid: Number.parseInt(match[1], 10), command: match[2] };
    } catch {
      return null;
    }
  };

  // Windows image name for a pid (e.g. "opencode.exe"), or null.
  const readWindowsImageName = async (pid) => {
    try {
      const { stdout } = await execFileAsync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      });
      return (stdout || '').trim() || null;
    } catch {
      return null;
    }
  };

  const readWindowsProcessTree = async () => {
    try {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        WINDOWS_PROCESS_QUERY,
      ], {
        encoding: 'utf8',
        timeout: WINDOWS_PROCESS_QUERY_TIMEOUT_MS,
        windowsHide: true,
      });
      const parsed = JSON.parse((stdout || '').trim() || '[]');
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.filter((row) => row && Number.isInteger(Number(row.ProcessId)))
        .map((row) => ({
          pid: Number(row.ProcessId),
          parentPid: Number(row.ParentProcessId),
          name: row.Name == null ? '' : String(row.Name),
          creationDate: row.CreationDate == null ? '' : String(row.CreationDate),
          commandLine: row.CommandLine == null ? '' : String(row.CommandLine),
        }));
    } catch {
      return null;
    }
  };

  const parseProcessDate = (value) => {
    const text = String(value || '').trim();
    if (!text) return null;
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return parsed;
    const serialized = text.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
    if (serialized) return Number(serialized[1]);
    const dmtf = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (!dmtf) return null;
    return Date.UTC(
      Number(dmtf[1]), Number(dmtf[2]) - 1, Number(dmtf[3]),
      Number(dmtf[4]), Number(dmtf[5]), Number(dmtf[6]),
    );
  };

  const findWindowsManagedDescendants = (rows, entry) => {
    const startedAt = parseProcessDate(entry.startedAt);
    if (startedAt === null) return [];

    const byParent = new Map();
    for (const row of rows) {
      const children = byParent.get(row.parentPid) || [];
      children.push(row);
      byParent.set(row.parentPid, children);
    }

    const descendants = [];
    const pending = [...(byParent.get(entry.pid) || [])];
    const visited = new Set([entry.pid]);
    while (pending.length > 0) {
      const row = pending.shift();
      if (!row || visited.has(row.pid)) continue;
      visited.add(row.pid);
      descendants.push(row);
      pending.push(...(byParent.get(row.pid) || []));
    }

    const candidates = descendants.filter((row) => {
      const createdAt = parseProcessDate(row.creationDate);
      const command = `${row.name} ${row.commandLine}`;
      return createdAt !== null
        && createdAt >= startedAt
        && WINDOWS_MANAGED_DESCENDANT_PATTERN.test(command);
    });
    const candidatePids = new Set(candidates.map((row) => row.pid));
    return candidates.filter((row) => !candidatePids.has(row.parentPid));
  };

  const reapWindowsManagedDescendants = async (entry, { log }) => {
    const rows = await readWindowsProcessTree();
    if (!rows) {
      log?.(`[lifecycle] orphan descendant scan failed pid=${entry.pid}`);
      throw new Error('Managed descendant snapshot unavailable');
    }
    const roots = findWindowsManagedDescendants(rows, entry);
    log?.(`[lifecycle] orphan descendant scan pid=${entry.pid} candidates=${roots.length}`);
    for (const row of roots) {
      await killOrphan(row.pid);
      log?.(`[lifecycle] reaped orphaned managed descendant pid=${row.pid} root=${entry.pid}`);
    }
    return roots.length;
  };

  const killOrphan = async (pid) => {
    if (process.platform === 'win32') {
      try {
        await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 5000,
          windowsHide: true,
        });
      } catch {
        // Best-effort: a failed kill is not fatal (startup reaper is a backstop).
      }
      if (isPidAlive(pid)) throw new Error('Managed process still running');
      return;
    }

    const signalTree = (signal) => {
      try {
        process.kill(-pid, signal);
      } catch {
        // process group may already be gone
      }
      try {
        process.kill(pid, signal);
      } catch {
        // pid may already be gone
      }
    };

    signalTree('SIGTERM');
    for (let waited = 0; waited < 1500 && isPidAlive(pid); waited += 150) {
      await sleep(150);
    }
    if (isPidAlive(pid)) {
      signalTree('SIGKILL');
      await sleep(300);
    }
  };

  // Decide+act on a single registry entry. Returns true if it was reaped.
  const processEntry = async (entry, { log }) => {
    const ownerGone = Number.isInteger(entry.ownerPid) && !isPidAlive(entry.ownerPid);
    const startedAt = parseProcessDate(entry.startedAt);

    if (!isPidAlive(entry.pid)) {
      if (process.platform === 'win32' && ownerGone && startedAt !== null) {
        const descendantsReaped = await reapWindowsManagedDescendants(entry, { log });
        if (descendantsReaped > 0) return true;
      }
      log?.(`[lifecycle] managed OpenCode root absent pid=${entry.pid} ownerGone=${ownerGone}`);
      return false;
    }

    if (process.platform === 'win32') {
      const image = await readWindowsImageName(entry.pid);
      const looksLikeOpencode = typeof image === 'string' && image.toLowerCase().includes('opencode');
      // Windows lacks reliable reparent-to-1 semantics (job objects usually kill
      // children with the parent), so we reap only when the owner is provably dead
      // AND the image still looks like opencode.
      if (looksLikeOpencode && ownerGone) {
        await killOrphan(entry.pid);
        log?.(`[lifecycle] reaped orphaned OpenCode pid=${entry.pid} owner=${entry.ownerPid}`);
        return true;
      }
      return false;
    }

    const info = await readUnixProcInfo(entry.pid);
    // Can't verify identity (or it's not our server) → leave it alone.
    if (!info || !commandIdentifiesOurServer(info.command, entry)) return false;

    const orphaned = info.ppid === 1 || ownerGone;
    if (!orphaned) return false; // still owned by a live instance

    await killOrphan(entry.pid);
    log?.(`[lifecycle] reaped orphaned OpenCode pid=${entry.pid} ownerGone=${ownerGone} reparented=${info.ppid === 1}`);
    return true;
  };

  /**
   * Kill any genuinely-orphaned OpenCode processes WE previously spawned, and
   * prune their registry files. Safe to call at startup before spawning a new
   * server. Returns { inspected, reaped }.
   */
  const reapOrphanedProcesses = async ({ log } = {}) => {
    const records = await readAllEntries();
    if (records.length === 0) return { inspected: 0, reaped: 0 };

    let reaped = 0;
    for (const { entry, filePath } of records) {
      let drop = false;
      try {
        const wasReaped = await processEntry(entry, { log });
        if (wasReaped) reaped += 1;
        // Drop the file when the process is gone (reaped now, or already dead);
        // keep it only while the process is still alive and owned by a live owner.
        const ownerAlive = Number.isInteger(entry.ownerPid) && isPidAlive(entry.ownerPid);
        drop = wasReaped || (!isPidAlive(entry.pid) && !ownerAlive);
      } catch (error) {
        log?.(`[lifecycle] reap check failed for pid ${entry.pid}: ${error?.message ?? error}`);
      }
      if (drop) {
        try {
          await fs.rm(filePath, { force: true });
        } catch {
          // best-effort
        }
      }
    }

    return { inspected: records.length, reaped };
  };

  return { registerManagedProcess, unregisterManagedProcess, reapOrphanedProcesses };
};

const defaultRegistry = createManagedProcessRegistry();

export const registerManagedProcess = defaultRegistry.registerManagedProcess;
export const unregisterManagedProcess = defaultRegistry.unregisterManagedProcess;
export const reapOrphanedProcesses = defaultRegistry.reapOrphanedProcesses;
