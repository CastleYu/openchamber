import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createCollector } from './collector.js';
import { windowsProcessQuery } from './windows-processes.js';

test('rejects nonnumeric process identities before building a shell command', () => {
  assert.throws(() => windowsProcessQuery('1; exit', []), /identity/);
  assert.throws(() => windowsProcessQuery(1, [NaN]), /identity/);
});

test('native Windows sampler tracks descendants across parent exit and excludes its helper', {
  skip: process.platform !== 'win32', timeout: 20000,
}, async () => {
  const fixture = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const leaf = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true, windowsHide: true });
    leaf.unref();
    process.send(leaf.pid);
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const [leaf] = await once(fixture, 'message');
  try {
    let clock = Date.now();
    const collector = createCollector({ now: () => clock, debug: true });
    const first = await collector.read();
    assert(first.processes.some((row) => row.pid === fixture.pid));
    assert(first.processes.some((row) => row.pid === leaf));
    assert(!first.processes.some((row) => row.name.toLowerCase() === 'powershell.exe'));
    assert(first.memory > 0);
    const detail = await collector.readDebug();
    assert.equal(detail.schemaVersion, 2);
    assert.equal(detail.sample.memory, first.memory);
    assert.equal(detail.sample.processCount, first.processes.length);
    assert.equal('queriedProcesses' in detail, false);
    assert(detail.topProcesses.length <= 10);
    const exited = once(fixture, 'exit');
    fixture.kill();
    await exited;
    clock += 5000;
    const second = await collector.read();
    assert(!second.processes.some((row) => row.pid === fixture.pid));
    assert(second.processes.some((row) => row.pid === leaf));
    assert(Number.isFinite(second.cpu));
  } finally {
    fixture.kill();
    try { process.kill(leaf); } catch { /* The fixture may already have exited. */ }
    await delay(50);
  }
});
