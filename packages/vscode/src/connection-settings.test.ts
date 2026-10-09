import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CONNECTION_MODE, OPENCODE_CONNECTION } from '../../web/server/lib/opencode/connection.js';
import { createConnectionSettings, serializeSettingsWrite, writeSettingsAtomic } from './connection-settings';
import { createVSCodeConnectionRuntime } from './connection-runtime.js';

const first = { version: 1 as const, confirmed: true as const, mode: CONNECTION_MODE.EXTERNAL, endpoint: 'https://first.example.test' };
const second = { ...first, endpoint: 'https://second.example.test' };

test('connection commits preserve ordinary settings and the previous confirmed target', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-connection-settings-'));
  try {
    const file = path.join(dir, 'settings.json');
    const store = createConnectionSettings(file);
    assert.deepEqual(store.read(), {});
    assert.equal(await store.previous(), null);
    await fs.writeFile(file, JSON.stringify({ theme: 'dark' }));
    await store.save(first);
    assert.equal(await store.previous(), null);
    await store.save(second);
    assert.deepEqual(await store.previous(), first);
    assert.deepEqual(store.read(), { theme: 'dark', [OPENCODE_CONNECTION.SETTING]: second });
    assert.deepEqual((await fs.readdir(dir)).sort(), [OPENCODE_CONNECTION.BACKUP, 'settings.json'].sort());
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('malformed settings and malformed saved connections fail without replacing either file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-connection-invalid-'));
  try {
    const file = path.join(dir, 'settings.json');
    const store = createConnectionSettings(file);
    await store.save(first);
    const backup = await fs.readFile(path.join(dir, OPENCODE_CONNECTION.BACKUP), 'utf8');
    for (const text of ['{broken', JSON.stringify({ [OPENCODE_CONNECTION.SETTING]: { mode: 'guessed' } })]) {
      await fs.writeFile(file, text);
      await assert.rejects(store.save(second));
      assert.equal(await fs.readFile(file, 'utf8'), text);
      assert.equal(await fs.readFile(path.join(dir, OPENCODE_CONNECTION.BACKUP), 'utf8'), backup);
    }
    await fs.writeFile(path.join(dir, OPENCODE_CONNECTION.BACKUP), '{broken');
    await assert.rejects(store.previous());
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('failed atomic replacement preserves the destination and removes its temporary file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-connection-write-'));
  try {
    const dest = path.join(dir, 'settings.json');
    await fs.mkdir(dest);
    await fs.writeFile(path.join(dest, 'keep'), 'original');
    await assert.rejects(writeSettingsAtomic(dest, '{}'));
    assert.equal(await fs.readFile(path.join(dest, 'keep'), 'utf8'), 'original');
    assert.deepEqual(await fs.readdir(dir), ['settings.json']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('ordinary writes and connection commits serialize and recover after a rejected write', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-connection-order-'));
  try {
    const file = path.join(dir, 'settings.json');
    const store = createConnectionSettings(file);
    await store.save(first);
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ordinary = serializeSettingsWrite(async () => {
      const current = store.read();
      await gate;
      await writeSettingsAtomic(file, JSON.stringify({ ...current, theme: 'light' }));
    });
    const commit = store.save(second);
    release();
    await Promise.all([ordinary, commit]);
    assert.deepEqual(store.read(), { theme: 'light', [OPENCODE_CONNECTION.SETTING]: second });
    assert.deepEqual(await store.previous(), first);
    await assert.rejects(serializeSettingsWrite(async () => { throw new Error('fixture rejected'); }));
    await store.save(first);
    assert.deepEqual(await store.previous(), second);
    assert.equal(store.read().theme, 'light');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('extension-host activity cannot claim browser queues are empty', async () => {
  const unused = () => { throw new Error('Inactive inspection must not resolve or mutate a connection'); };
  const reject = async () => unused();
  const runtime = createVSCodeConnectionRuntime({
    resolveBinary: unused, resolveLaunchSpec: unused, stat: reject, getEnv: unused,
    getRuntime: unused, getHeaders: unused, getOwner: unused,
    readSettings: unused, readPrevious: reject, saveConnection: reject,
    getConfigured: unused, replace: reject,
    getDirectories: () => ['C:/Work'],
    getState: () => ({ ready: false, transitioning: false, external: false }),
  });
  const result = await runtime.request({ method: 'GET', path: OPENCODE_CONNECTION.ACTIVITY_ROUTE });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    state: 'inactive',
    scope: { coverage: 'configured-directories', busy: 'configured-directories', directories: ['C:/Work'] },
    busy: { state: 'unknown', observedCount: 0 },
    permissions: { state: 'unknown', observedCount: 0 },
    questions: { state: 'unknown', observedCount: 0 },
    queue: { state: 'unknown', observedCount: 0 },
    clients: { state: 'unknown', observedCount: 0 },
  });
});
