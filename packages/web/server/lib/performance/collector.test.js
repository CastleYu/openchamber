import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createCollector, registerPerformanceRoutes } from './collector.js';
import { PerformanceFailure, PerformanceStage, queryFailure } from './diagnostics.js';

const row = (pid, parent, memory, cpu = 0, birth = 'first') => ({ pid, parent, name: 'process', memory, cpu, birth });

test('debug keeps exact totals above 4 GiB and a bounded list from the shared sample', async () => {
  const rows = [row(1, 0, 4 * 1024 ** 3 + 4096), row(2, 1, 3 * 1024 ** 3), row(3, 0, 999)];
  rows[0].privateBytes = 5 * 1024 ** 3;
  let count = 0;
  const collector = createCollector({ root: 1, debug: true, read: async () => { count++; return rows; } });
  const [panel, debug] = await Promise.all([collector.read(), collector.readDebug()]);
  assert.equal(count, 1);
  assert.equal(debug.sample.timestamp, panel.timestamp);
  assert.equal(panel.memory, 7 * 1024 ** 3 + 4096);
  assert.equal(debug.sample.memory, panel.memory);
  assert.equal(debug.sample.processCount, 2);
  assert.deepEqual(debug.topProcesses, panel.processes);
  assert.equal(debug.queriedProcesses, undefined);
  assert.equal(debug.sample.processes, undefined);
  assert(debug.runtime.memory.rss > 0);
  assert.equal(debug.runtime.heap, undefined);
  assert.equal(debug.runtime.versions, undefined);
  const many = createCollector({ root: 1, debug: true, read: async () => Array.from({ length: 227 }, (_, i) => row(i + 1, i ? 1 : 0, i + 1)) });
  const summary = await many.readDebug();
  assert.equal(summary.topProcesses.length, 10);
  assert.equal(summary.omittedProcesses, 217);
  assert.equal(summary.sample.processCount, 227);
  assert.equal(summary.topProcesses[0].pid, 227);
  await assert.rejects(createCollector().readDebug(), /disabled/);
});

test('HTTP debug gate, snapshot parity and collection failure', async () => {
  for (const debug of [false, true]) {
    let time = 10000;
    let fail = false;
    const collector = createCollector({ root: 1, debug, now: () => time, read: async () => {
      if (fail) throw new Error('denied');
      return [row(1, 0, 100)];
    } });
    const app = express();
    registerPerformanceRoutes(app, { debug, collector });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/system/performance`;
    try {
      const response = await fetch(`${url}/debug`);
      assert.equal(response.status, debug ? 200 : 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      if (debug) {
        const detail = await response.json();
        const panel = await (await fetch(url)).json();
        assert.equal(detail.sample.timestamp, panel.timestamp);
        assert.equal(detail.sample.memory, panel.memory);
        time += 5000;
        fail = true;
        assert.equal((await fetch(`${url}/debug`)).status, 503);
        assert.equal((await fetch(url)).status, 503);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test('sums descendants once, retains reparented children, rejects reused PIDs', async () => {
  let time = 10000;
  let rows = [row(1, 0, 10), row(2, 1, 20), row(3, 2, 30), row(4, 0, 999)];
  const collector = createCollector({ root: 1, cores: 2, now: () => time, read: async () => rows });
  const first = await collector.read();
  assert.equal(first.memory, 60);
  assert.equal(first.cpu, null);
  time += 5000;
  rows = [row(1, 0, 10, 1), row(2, 0, 20, 2), row(3, 2, 30, 3), row(4, 0, 999)];
  assert.equal((await collector.read()).cpu, 60);
  time += 5000;
  rows = [row(1, 0, 10, 2), row(2, 0, 999, 0, 'reused')];
  assert.equal((await collector.read()).memory, 10);
});

test('shares in-flight and recent samples; failure is not an empty snapshot', async () => {
  let count = 0;
  let time = 10000;
  let fail = false;
  const collector = createCollector({ root: 1, now: () => time, read: async () => {
    count += 1;
    if (fail) throw new Error('denied');
    return [row(1, 0, 10)];
  } });
  const [a, b] = await Promise.all([collector.read(), collector.read()]);
  assert.equal(a, b);
  await collector.read();
  assert.equal(count, 1);
  time += 5000;
  fail = true;
  await assert.rejects(collector.read(), PerformanceFailure);
  fail = false;
  assert.equal((await collector.read()).memory, 10);
});

test('failure logs correlate retries and recovery without command or stderr contents', async () => {
  let time = 10000;
  let fail = true;
  const logs = [];
  const collector = createCollector({ root: 1, now: () => time, log: (entry) => logs.push(entry), read: async () => {
    if (fail) throw queryFailure({ code: 1, stderr: 'secret command OC_PERF|open|42|5 private path' });
    return [row(1, 0, 10)];
  } });
  await assert.rejects(collector.read(), PerformanceFailure);
  await assert.rejects(collector.read(), PerformanceFailure);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].stage, PerformanceStage.Query);
  assert.equal(logs[0].nativeCode, 5);
  assert.equal(JSON.stringify(logs).includes('secret'), false);
  time += 60000;
  await assert.rejects(collector.read(), PerformanceFailure);
  assert.equal(logs[1].diagnosticId, logs[0].diagnosticId);
  fail = false;
  await collector.read();
  assert.equal(logs[2].event, 'recovered');
  assert.equal(logs[2].failures, 3);
  assert.equal(logs[2].diagnosticId, logs[0].diagnosticId);
});
