import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createSessionStorageScopes } from './storage-scope.js';

const dirs = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

it('pins existing root OC2 files to the first scope and restores each external scope on switch back', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc2-scope-'));
  dirs.push(dataDir);
  await fs.writeFile(path.join(dataDir, 'sessions-archive.json'), '{"ses_old":1700}');
  await fs.writeFile(path.join(dataDir, 'sessions-metadata.json'), '{"ses_old":{"openchamber":{"goal":1}}}');
  const scopes = createSessionStorageScopes({ dataDir });
  const first = await scopes.directory('external:https://one.example/api');
  const second = await scopes.directory('external:https://two.example/api');
  expect(first).toBe(dataDir);
  expect(second).not.toBe(first);
  expect(await fs.readFile(path.join(first, 'sessions-archive.json'), 'utf8')).toContain('ses_old');
  expect(await fs.stat(path.join(first, 'sessions-metadata.json'))).toBeDefined();
  expect(await scopes.directory('external:https://one.example/api')).toBe(first);
  expect(await createSessionStorageScopes({ dataDir }).directory('external:https://two.example/api')).toBe(second);
  expect(JSON.parse(await fs.readFile(scopes.ownerPath, 'utf8')).scope).toBe('external:https://one.example/api');
});

it('keeps managed storage stable when its dynamic server port changes', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc2-scope-'));
  dirs.push(dataDir);
  const scopes = createSessionStorageScopes({ dataDir });
  expect(await scopes.directory('managed')).toBe(dataDir);
  expect(await createSessionStorageScopes({ dataDir }).directory('managed')).toBe(dataDir);
});
