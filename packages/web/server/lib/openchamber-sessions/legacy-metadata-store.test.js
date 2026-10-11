import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createLegacyMetadataStore } from './legacy-metadata-store.js';

const dirs = [];
const makeDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-legacy-metadata-'));
  dirs.push(dir);
  return dir;
};
const fileFor = (dir, scope) => path.join(dir, 'legacy-session-metadata', `${crypto.createHash('sha256').update(scope).digest('hex')}.json`);

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('createLegacyMetadataStore', () => {
  it('round trips merged, deleted, and replaced metadata across restarts', async () => {
    const dataDir = makeDir();
    const first = createLegacyMetadataStore({ dataDir });
    await first.patch('managed', 'ses_1', { keep: true, nested: { a: 1, b: 2 } });
    await first.patch('managed', 'ses_1', { nested: { a: null, c: 3 } });
    expect(await first.read('managed', 'ses_1')).toEqual({ keep: true, nested: { b: 2, c: 3 } });
    await first.patch('managed', 'ses_1', { final: true }, { replace: true });
    expect(await createLegacyMetadataStore({ dataDir }).read('managed', 'ses_1')).toEqual({ final: true });
  });

  it('isolates scopes and leaves OC2 and root metadata files untouched', async () => {
    const dataDir = makeDir();
    fs.writeFileSync(path.join(dataDir, 'sessions-metadata.json'), '{"oc2":{"untouched":true}}');
    const store = createLegacyMetadataStore({ dataDir });
    await store.patch('managed', 'same', { from: 'managed' });
    await store.patch('external:http://one', 'same', { from: 'external' });
    expect(await store.read('managed', 'same')).toEqual({ from: 'managed' });
    expect(await store.read('external:http://one', 'same')).toEqual({ from: 'external' });
    expect(fs.readFileSync(path.join(dataDir, 'sessions-metadata.json'), 'utf8')).toBe('{"oc2":{"untouched":true}}');
  });

  it('preserves both concurrent cold patches', async () => {
    const dataDir = makeDir();
    const store = createLegacyMetadataStore({ dataDir });
    await Promise.all([
      store.patch('managed', 'ses_1', { a: 1 }),
      store.patch('managed', 'ses_2', { b: 2 }),
    ]);
    const disk = JSON.parse(fs.readFileSync(fileFor(dataDir, 'managed'), 'utf8'));
    expect(disk).toEqual({ ses_1: { a: 1 }, ses_2: { b: 2 } });
  });

  it('throws on malformed files and read failures instead of returning empty', async () => {
    const dataDir = makeDir();
    fs.mkdirSync(path.dirname(fileFor(dataDir, 'bad')), { recursive: true });
    fs.writeFileSync(fileFor(dataDir, 'bad'), '{');
    await expect(createLegacyMetadataStore({ dataDir }).read('bad', 'ses')).rejects.toThrow('malformed');
    const fsPromises = { ...fs.promises, readFile: async () => { throw new Error('denied'); } };
    await expect(createLegacyMetadataStore({ dataDir, fsPromises }).read('read-fail', 'ses')).rejects.toThrow('denied');
  });

  it('keeps disk and memory on write or rename failure and cleans temporary files', async () => {
    const dataDir = makeDir();
    const store = createLegacyMetadataStore({ dataDir });
    await store.patch('managed', 'ses', { prior: true });
    const file = fileFor(dataDir, 'managed');
    const diskBefore = fs.readFileSync(file, 'utf8');
    const failWrite = { ...fs.promises, writeFile: async () => { throw new Error('write failed'); } };
    await expect(createLegacyMetadataStore({ dataDir, fsPromises: failWrite }).patch('managed', 'ses', { bad: true })).rejects.toThrow('write failed');
    const failRename = { ...fs.promises, rename: async () => { throw new Error('rename failed'); } };
    await expect(createLegacyMetadataStore({ dataDir, fsPromises: failRename }).patch('managed', 'ses', { bad: true })).rejects.toThrow('rename failed');
    expect(fs.readFileSync(file, 'utf8')).toBe(diskBefore);
    expect(await store.read('managed', 'ses')).toEqual({ prior: true });
    expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
  });

  it('does not rename or update memory after retirement check fails before commit', async () => {
    const dataDir = makeDir();
    const store = createLegacyMetadataStore({ dataDir });
    await store.patch('managed', 'ses', { prior: true });
    const file = fileFor(dataDir, 'managed');
    const diskBefore = fs.readFileSync(file, 'utf8');
    let checks = 0;
    await expect(store.patch('managed', 'ses', { next: true }, {
      check: () => { checks += 1; if (checks === 4) throw new Error('retired'); },
    })).rejects.toThrow('retired');
    expect(fs.readFileSync(file, 'utf8')).toBe(diskBefore);
    expect(await store.read('managed', 'ses')).toEqual({ prior: true });
    expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
  });
});
