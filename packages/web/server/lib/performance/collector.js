import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const exec = promisify(execFile);
const INTERVAL = 5000;
const rowSchema = z.object({
  pid: z.coerce.number().int().positive(), parent: z.coerce.number().int().nonnegative(),
  name: z.string(), birth: z.string(), memory: z.coerce.number().nonnegative(), cpu: z.coerce.number().nonnegative(),
});
const windowsQuery = `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; parent=$_.ParentProcessId; name=$_.Name; birth=[string]$_.CreationDate; memory=[double]$_.WorkingSetSize; cpu=([double]$_.KernelModeTime+[double]$_.UserModeTime)/10000000 } } | Where-Object { $_.pid -gt 0 -and $_.pid -ne $PID }) | ConvertTo-Json -Compress`;

async function readProcesses() {
  const options = { windowsHide: true, timeout: 10000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' };
  if (process.platform === 'win32') {
    const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const { stdout } = await exec(shell, ['-NoProfile', '-NonInteractive', '-Command', windowsQuery], options);
    return z.array(rowSchema).parse(JSON.parse(stdout));
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
export function createCollector({ read = readProcesses, root = process.pid, now = Date.now, cores = os.cpus().length } = {}) {
  let previous = new Map();
  let sampledAt = 0;
  let snapshot;
  let pending;
  async function sample() {
    const rows = await read();
    const timestamp = now();
    const byParent = new Map();
    for (const row of rows) {
      if (!byParent.has(row.parent)) byParent.set(row.parent, []);
      byParent.get(row.parent).push(row);
    }
    const owner = rows.find((row) => row.pid === root);
    if (!owner) throw new Error('Root process unavailable');
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
    return snapshot;
  }
  return {
    read() {
      if (pending) return pending;
      if (snapshot && now() - sampledAt < INTERVAL) return Promise.resolve(snapshot);
      pending = sample().finally(() => { pending = undefined; });
      return pending;
    },
  };
}

export function registerPerformanceRoutes(app) {
  const collector = createCollector();
  app.get('/api/system/performance', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await collector.read());
    } catch {
      res.status(503).json({ error: 'Process metrics unavailable' });
    }
  });
}
