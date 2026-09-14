import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readZipDirectory } from './zip-directory.js';

test('ZIP listing reads central entries without extracting members', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'oc-zip-test-'));
  try {
    const name = Buffer.from('目录/测试.txt');
    const entry = Buffer.alloc(46 + name.length);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(0x800, 8);
    entry.writeUInt32LE(10, 20); entry.writeUInt32LE(100, 24); entry.writeUInt16LE(name.length, 28); name.copy(entry, 46);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(entry.length, 12);
    const file = path.join(folder, 'sample.zip');
    await writeFile(file, Buffer.concat([entry, end]));
    assert.deepEqual(await readZipDirectory(file), [{ name: '目录/测试.txt', size: 100, compressedSize: 10, directory: false }]);
    assert.deepEqual(await readdir(folder), ['sample.zip']);
    await writeFile(file, Buffer.from('broken zip'));
    await assert.rejects(readZipDirectory(file));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
