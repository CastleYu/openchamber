import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { transfer, registerFileProtocol, releaseTransfers } from './file-transfers.mjs';

test('download stays unreadable until complete; exact bytes survive native save', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'oc-transfer-test-'));
  const target = path.join(folder, 'copy.bin');
  const native = { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: target }) }, shell: { openPath: async () => '' } };
  let serve;
  registerFileProtocol({ handle: (_scheme, handler) => { serve = handler; } }, { fetch: async url => new Response(await readFile(new URL(url))) });
  const owner = 123;
  try {
    const id = await transfer('desktop_file_begin', { name: '测试.bin' }, owner, native);
    assert.equal((await serve({ url: `openchamber-file://asset/${id}` })).status, 404);
    await assert.rejects(transfer('desktop_file_chunk', { id, bytes: new Uint8Array([1]) }, 456, native));
    await transfer('desktop_file_chunk', { id, bytes: new Uint8Array([0, 255, 128]) }, owner, native);
    await assert.rejects(transfer('desktop_file_finish', { id, size: 4 }, owner, native));
    const url = await transfer('desktop_file_finish', { id, size: 3 }, owner, native);
    assert.deepEqual(new Uint8Array(await (await serve({ url })).arrayBuffer()), new Uint8Array([0, 255, 128]));
    await writeFile(target, 'old content');
    assert.equal(await transfer('desktop_file_save', { id }, owner, native), true);
    assert.deepEqual(await readFile(target), Buffer.from([0, 255, 128]));
    await transfer('desktop_file_release', { id }, owner, native);
    await transfer('desktop_file_release', { id }, owner, native);
    assert.equal((await serve({ url })).status, 404);
  } finally { await releaseTransfers(owner); await rm(folder, { recursive: true, force: true }); }
});

test('cancel removes partial transfer and rejects oversized chunks', async () => {
  const id = await transfer('desktop_file_begin', { name: '../safe.txt' }, 124, {});
  await assert.rejects(transfer('desktop_file_chunk', { id, bytes: new Uint8Array(1048577) }, 124, {}));
  await transfer('desktop_file_release', { id }, 124, {});
  await assert.rejects(transfer('desktop_file_finish', { id, size: 0 }, 124, {}));
});

test('dot-only names remain ordinary files inside the transfer directory', async () => {
  const id = await transfer('desktop_file_begin', { name: '.. ' }, 125, {});
  try {
    const url = await transfer('desktop_file_finish', { id, size: 0 }, 125, {});
    assert.equal(url, `openchamber-file://asset/${id}`);
  } finally { await releaseTransfers(125); }
});

test('closed windows reject new transfers and missing completed files return 404', async () => {
  await assert.rejects(transfer('desktop_file_begin', { name: 'closed.bin' }, 126, {
    window: { isDestroyed: () => true },
  }), /window closed/);
  const id = await transfer('desktop_file_begin', { name: 'missing.bin' }, 126, {});
  let serve;
  registerFileProtocol({ handle: (_scheme, handler) => { serve = handler; } }, {
    fetch: async () => { throw new Error('ERR_FILE_NOT_FOUND'); },
  });
  try {
    const url = await transfer('desktop_file_finish', { id, size: 0 }, 126, {});
    assert.equal((await serve({ url })).status, 404);
    assert.equal((await serve({ url: 'bad url' })).status, 400);
    assert.equal((await serve({ url: `openchamber-file://other/${id}` })).status, 404);
  } finally { await releaseTransfers(126); }
});

test('serializes concurrent chunks and finish, and rejects commands queued after release', async () => {
  const owner = 127;
  const id = await transfer('desktop_file_begin', { name: 'ordered.bin' }, owner, {});
  let serve;
  registerFileProtocol({ handle: (_scheme, handler) => { serve = handler; } }, { fetch: async url => new Response(await readFile(new URL(url))) });
  try {
    const results = await Promise.all([
      transfer('desktop_file_chunk', { id, bytes: new Uint8Array([1, 2]) }, owner, {}),
      transfer('desktop_file_chunk', { id, bytes: new Uint8Array([3, 4]) }, owner, {}),
      transfer('desktop_file_finish', { id, size: 4 }, owner, {}),
    ]);
    assert.deepEqual(new Uint8Array(await (await serve({ url: results[2] })).arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
    const disposed = await Promise.allSettled([
      transfer('desktop_file_release', { id }, owner, {}),
      transfer('desktop_file_open', { id }, owner, { shell: { openPath: () => assert.fail('released file opened') } }),
      transfer('desktop_file_release', { id }, owner, {}),
    ]);
    assert.deepEqual(disposed.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
  } finally { await releaseTransfers(owner); }
});

test('requires a valid exact size and cleans up even after a rejected operation', async () => {
  const owner = 128;
  const id = await transfer('desktop_file_begin', { name: 'empty.bin' }, owner, {});
  for (const size of [undefined, NaN, Infinity, -1, 0.5, 1]) {
    await assert.rejects(transfer('desktop_file_finish', { id, size }, owner, {}), /Incomplete/);
  }
  await transfer('desktop_file_finish', { id, size: 0 }, owner, {});
  await releaseTransfers(owner);
  await assert.rejects(transfer('desktop_file_open', { id }, owner, {}), /Unknown/);
});
