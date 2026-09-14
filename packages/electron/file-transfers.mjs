import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { replaceFileWithRetry } from './windows-file-replace.mjs';

export const FILE_PROTOCOL = 'openchamber-file';
const entries = new Map();
const MAX_CHUNK = 1024 * 1024;

export async function transfer(command, args, owner, { dialog, shell, window }) {
  if (command === 'desktop_file_begin') {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-file-'));
    const name = path.basename(String(args.name || 'file')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
    const target = path.join(folder, name || 'file');
    const id = randomUUID();
    let handle;
    try {
      handle = await fs.open(target + '.part', 'wx');
      if (window?.isDestroyed()) throw new Error('File transfer window closed');
      entries.set(id, { owner, target, folder, handle, size: 0, ready: false, pending: Promise.resolve() });
      return id;
    } catch (error) {
      await handle?.close();
      await fs.rm(folder, { recursive: true, force: true });
      throw error;
    }
  }
  const entry = entries.get(args.id);
  if (!entry && command === 'desktop_file_release') return null;
  if (!entry || entry.owner !== owner) throw new Error('Unknown file transfer');
  return queueTransfer(entry, () => {
    if (entries.get(args.id) !== entry) {
      if (command === 'desktop_file_release') return null;
      throw new Error('Unknown file transfer');
    }
    return transferEntry(command, args, entry, { dialog, shell, window });
  });
}

function queueTransfer(entry, action) {
  const pending = entry.pending.then(action);
  // A failed operation must still allow the owner's cleanup to run.
  entry.pending = pending.catch(() => {});
  return pending;
}

async function transferEntry(command, args, entry, { dialog, shell, window }) {
  if (command === 'desktop_file_chunk') {
    if (entry.ready || !(args.bytes instanceof Uint8Array) || args.bytes.length > MAX_CHUNK) throw new Error('Invalid file chunk');
    await entry.handle.writeFile(args.bytes);
    entry.size += args.bytes.length;
    return null;
  }
  if (command === 'desktop_file_finish') {
    if (entry.ready || !Number.isSafeInteger(args.size) || args.size < 0 || entry.size !== args.size) throw new Error('Incomplete file transfer');
    await entry.handle.close();
    entry.handle = null;
    await replaceFileWithRetry(entry.target + '.part', entry.target);
    entry.ready = true;
    return `${FILE_PROTOCOL}://asset/${args.id}`;
  }
  if (command === 'desktop_file_release') {
    await releaseTransfer(args.id, entry);
    return null;
  }
  if (!entry.ready) throw new Error('File is still downloading');
  if (command === 'desktop_file_open') {
    const error = await shell.openPath(entry.target);
    if (error) throw new Error(error);
    return null;
  }
  if (command === 'desktop_file_save') {
    const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(entry.target) });
    if (result.canceled || !result.filePath) return false;
    const temp = result.filePath + '.' + randomUUID() + '.part';
    try {
      await fs.copyFile(entry.target, temp);
      await replaceFileWithRetry(temp, result.filePath);
    } finally {
      await fs.rm(temp, { force: true });
    }
    return true;
  }
  throw new Error('Unknown file operation');
}

export function registerFileProtocol(protocol, net) {
  protocol.handle(FILE_PROTOCOL, async (request) => {
    let url;
    try { url = new URL(request.url); }
    catch { return new Response(null, { status: 400 }); }
    if (url.host !== 'asset') return new Response(null, { status: 404 });
    const entry = entries.get(url.pathname.slice(1));
    if (!entry?.ready) return new Response(null, { status: 404 });
    try {
      return await net.fetch(pathToFileURL(entry.target).toString(), { headers: request.headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

async function releaseTransfer(id, entry) {
  await entry.handle?.close();
  entry.handle = null;
  await fs.rm(entry.folder, { recursive: true, force: true });
  entries.delete(id);
}

export async function releaseTransfers(owner) {
  const results = await Promise.allSettled([...entries]
    .filter(([, entry]) => entry.owner === owner)
    .map(([id, entry]) => queueTransfer(entry, () => releaseTransfer(id, entry))));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, 'File transfer cleanup failed');
}
