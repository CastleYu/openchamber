import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { windowsProcessQuery } from './windows-processes.js';
import { PerformanceFailure, PerformanceStage, queryFailure } from './diagnostics.js';

const exec = promisify(execFile);
const INTERVAL = 5000;
const DEBUG_PROCESS_LIMIT = 10;
const ROUTES = { sample: '/api/system/performance', debug: '/api/system/performance/debug' };
const nonnegative = z.number().nonnegative();
const rowSchema = z.object({
  pid: z.coerce.number().int().positive(), parent: z.coerce.number().int().nonnegative(),
  name: z.string(), birth: z.string(), memory: z.coerce.number().nonnegative(), cpu: z.coerce.number().nonnegative(),
  peakWorkingSet: nonnegative.optional(), privateBytes: nonnegative.optional(),
  pagefileBytes: nonnegative.optional(), peakPagefileBytes: nonnegative.optional(),
  pageFaults: nonnegative.optional(), kernelSeconds: nonnegative.optional(), userSeconds: nonnegative.optional(),
});

async function readProcesses(root, tracked) {
  const options = { windowsHide: true, timeout: 10000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' };
  if (process.platform === 'win32') {
    const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const command = Buffer.from(windowsProcessQuery(root, tracked), 'utf16le').toString('base64');
    let stdout;
    try { ({ stdout } = await exec(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], options)); }
    catch (error) { throw queryFailure(error); }
    let decoded;
    try { decoded = JSON.parse(stdout); }
    catch { throw new PerformanceFailure(PerformanceStage.Json, { bytes: Buffer.byteLength(stdout) }); }
    const parsed = z.array(rowSchema).safeParse(decoded);
    if (!parsed.success) throw new PerformanceFailure(PerformanceStage.Schema, { issues: parsed.error.issues.length });
    return parsed.data;
  }
  const query = exec('ps', ['-axo', 'pid=,ppid=,rss=,time=,lstart=,comm='], options);
  const { stdout } = await query;
  return stdout.trim().split('\n').map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.-]+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/);
    if (!match) throw new Error('Invalid process snapshot');
    const [, pid, parent, rss, time, birth, name] = match;
    const [days, clock] = time.includes('-') ? time.split('-') : ['0', time];
    const cpu = clock.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) + Number(days) * 86400;
    return rowSchema.parse({ pid, parent, memory: Number(rss) * 1024, cpu, birth, name: path.basename(name) });
  }).filter((row) => row.pid !== query.child.pid);
}

// Demand-driven sampling shared by all windows; no background timer.
export function createCollector({ read = readProcesses, root = process.pid, now = Date.now, cores = os.cpus().length, debug = false,
  log = (entry) => console.warn('[performance]', JSON.stringify(entry)),
} = {}) {
  let previous = new Map();
  let sampledAt = 0;
  let snapshot;
  let pending;
  let diagnostics;
  let failure;
  let failures = 0;
  let lastLog = 0;
  const logInterval = 60000;
  async function sample() {
    const startedAt = now();
    const rows = await read(root, [...previous.keys()]);
    const timestamp = now();
    const byParent = new Map();
    for (const row of rows) {
      if (!byParent.has(row.parent)) byParent.set(row.parent, []);
      byParent.get(row.parent).push(row);
    }
    const owner = rows.find((row) => row.pid === root);
    if (!owner) throw new PerformanceFailure(PerformanceStage.Root);
    const selected = new Map([[root, owner]]);
    for (const row of rows) {
      if (previous.get(row.pid)?.birth === row.birth) selected.set(row.pid, row);
    }
    const queue = [...selected.values()];
    for (let index = 0; index < queue.length; index += 1) {
      for (const child of byParent.get(queue[index].pid) || []) {
        if (selected.has(child.pid)) continue;
        selected.set(child.pid, child);
        queue.push(child);
      }
    }
    const elapsed = (timestamp - sampledAt) / 1000;
    const processes = [...selected.values()].map((row) => {
      const old = previous.get(row.pid);
      const cpu = old?.birth === row.birth && elapsed > 0
        ? Math.max(0, (row.cpu - old.cpu) / elapsed / cores * 100) : null;
      return { pid: row.pid, parent: row.parent, name: row.name, memory: row.memory, cpu };
    }).sort((a, b) => b.memory - a.memory);
    previous = selected;
    sampledAt = timestamp;
    snapshot = {
      timestamp, root, cores, interval: INTERVAL,
      memory: processes.reduce((sum, row) => sum + row.memory, 0),
      cpu: processes.every((row) => row.cpu !== null) ? processes.reduce((sum, row) => sum + row.cpu, 0) : null,
      processes,
    };
    if (debug) {
      const { processes: allProcesses, ...totals } = snapshot;
      diagnostics = {
        schemaVersion: 2,
        sample: { ...totals, processCount: allProcesses.length },
        collection: { durationMs: timestamp - startedAt },
        units: { memory: 'bytes', cpu: 'percent-of-all-logical-cores' },
        memoryKind: process.platform === 'win32' ? 'working-set' : 'rss',
        sharedPagesMayBeCountedMultipleTimes: true,
        topProcesses: allProcesses.slice(0, DEBUG_PROCESS_LIMIT),
        omittedProcesses: Math.max(0, allProcesses.length - DEBUG_PROCESS_LIMIT),
        runtime: {
          pid: process.pid, version: process.env.OPENCHAMBER_DESKTOP_VERSION || null,
          uptimeSeconds: process.uptime(), memory: process.memoryUsage(),
        },
        system: { totalMemory: os.totalmem(), freeMemory: os.freemem() },
      };
    }
    return snapshot;
  }
  return {
    read() {
      if (pending) return pending;
      if (snapshot && now() - sampledAt < INTERVAL) return Promise.resolve(snapshot);
      const started = now();
      pending = sample().then((result) => {
        if (failure) log({ event: 'recovered', diagnosticId: failure.diagnosticId, failures, durationMs: now() - started, processes: result.processes.length, root });
        failure = undefined;
        failures = 0;
        return result;
      }).catch((error) => {
        const next = error instanceof PerformanceFailure ? error : new PerformanceFailure(PerformanceStage.Aggregate);
        const same = failure?.stage === next.stage && JSON.stringify(failure.detail) === JSON.stringify(next.detail);
        failures += 1;
        if (same) next.diagnosticId = failure.diagnosticId;
        if (!same || now() - lastLog >= logInterval) {
          log({ event: 'failed', diagnosticId: next.diagnosticId, stage: next.stage, ...next.detail,
            failures, durationMs: now() - started, root, tracked: previous.size,
            platform: process.platform, node: process.versions.node, version: process.env.OPENCHAMBER_DESKTOP_VERSION || null });
          lastLog = now();
        }
        failure = next;
        throw next;
      }).finally(() => { pending = undefined; });
      return pending;
    },
    async readDebug() {
      if (!debug) throw new Error('Performance diagnostics disabled');
      await this.read();
      return diagnostics;
    },
  };
}

export function registerPerformanceRoutes(app, { debug = process.env.OPENCHAMBER_PERFORMANCE_DEBUG === '1', collector = createCollector({ debug }) } = {}) {
  app.get(ROUTES.sample, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await collector.read());
    } catch (error) {
      res.status(503).json({ error: 'Process metrics unavailable', diagnosticId: error instanceof PerformanceFailure ? error.diagnosticId : undefined });
    }
  });
  app.get(ROUTES.debug, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!debug) return res.status(404).json({ error: 'Performance diagnostics disabled' });
    try {
      res.json(await collector.readDebug());
    } catch (error) {
      res.status(503).json({ error: 'Process metrics unavailable', diagnosticId: error instanceof PerformanceFailure ? error.diagnosticId : undefined });
    }
  });
}
