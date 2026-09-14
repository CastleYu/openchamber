import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createResourceModes, registerResourceModeRoutes, resourceModes } from './resource-modes.js';

test('resource reports serialize revisions, share directory identity, and preserve other active clients', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-resource-modes-'));
  try {
    const service = createResourceModes();
    const file = path.join(dir, 'resource-modes.json');
    assert.equal(await service.publish({ client: 'a', revision: 0, directories: [] }), false);
    await service.start(file);
    await service.publish({ client: 'a', revision: 2, directories: [{ directory: 'c:\\repo\\', mode: 'idle' }] });
    await service.publish({ client: 'a', revision: 1, directories: [{ directory: 'C:/repo', mode: 'focused' }] });
    let entries = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].activeUntil, 0);
    await service.publish({ client: 'b', revision: 1, directories: [{ directory: 'C:/repo', mode: 'background' }] });
    entries = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(entries.length, 1);
    assert(entries[0].activeUntil > Date.now());
    assert(entries[0].idleUntil > Date.now());
    assert.equal((await fs.readFile(file, 'utf8')).includes('repo'), false);
    await service.start(file);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('expired active clients no longer prevent an idle lease', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-resource-expiry-'));
  try {
    const service = createResourceModes();
    const file = path.join(dir, 'resource-modes.json');
    await service.start(file);
    await service.publish({ client: 'a', revision: 1, directories: [{ directory: '/repo', mode: 'focused' }] });
    context.mock.timers.tick(90001);
    await service.publish({ client: 'b', revision: 1, directories: [{ directory: '/repo', mode: 'idle' }] });
    const [entry] = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(entry.activeUntil, 0);
    assert(entry.idleUntil > Date.now());
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('HTTP route parses its own JSON body without a global parser', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-resource-http-'));
  const app = express();
  registerResourceModeRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const file = path.join(dir, 'resource-modes.json');
    await resourceModes.start(file);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/system/project-resources`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: randomUUID(), revision: 1, directories: [{ directory: '/fixture', mode: 'idle' }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
