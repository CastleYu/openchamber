import { z } from 'zod';
import { canUseElectronDesktopIPC, invokeDesktop, isDesktopLocalOriginActive } from '@openchamber/ui/lib/desktop';
import { runtimeFetch } from '@openchamber/ui/lib/runtime-fetch';
import { acquireRuntimeUrlAuthToken, refreshRuntimeUrlAuthToken } from '@openchamber/ui/lib/runtime-auth';
import { getRuntimeUrlResolver } from '@openchamber/ui/lib/runtime-url';
import { getRuntimeApiBaseUrl, getRuntimeKey } from '@openchamber/ui/lib/runtime-switch';
import type { FileAsset, FileTransferOptions } from '@openchamber/ui/lib/api/types';

const Command = {
  begin: 'desktop_file_begin', chunk: 'desktop_file_chunk', finish: 'desktop_file_finish',
  release: 'desktop_file_release', open: 'desktop_file_open', save: 'desktop_file_save',
  openPath: 'desktop_open_path', reveal: 'desktop_reveal_path', app: 'desktop_open_file_in_app',
};
const CHUNK_SIZE = 1024 * 1024;

const checkTransfer = (runtimeKey: string, signal?: AbortSignal) => {
  signal?.throwIfAborted();
  if (runtimeKey !== getRuntimeKey()) throw new DOMException('File runtime changed', 'AbortError');
};

export async function loadAsset(path: string, options: FileTransferOptions = {}, forceCopy = false): Promise<FileAsset> {
  const runtimeKey = getRuntimeKey();
  checkTransfer(runtimeKey, options.signal);
  const query = { path, directory: options.directory, allowOutsideWorkspace: options.allowOutsideWorkspace };
  if (!forceCopy && isDesktopLocalOriginActive()) {
    const base = getRuntimeApiBaseUrl();
    const release = acquireRuntimeUrlAuthToken(base);
    try {
      await refreshRuntimeUrlAuthToken(base);
      checkTransfer(runtimeKey, options.signal);
      return { url: getRuntimeUrlResolver().authenticatedAsset('/api/fs/raw', query), dispose: release };
    } catch (error) { release(); throw error; }
  }
  const native = canUseElectronDesktopIPC();
  const response = await runtimeFetch('/api/fs/raw', { query, signal: options.signal, headers: options.directory ? { 'x-opencode-directory': options.directory } : undefined });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`File download failed (${response.status})`);
  }
  const length = response.headers.get('content-length');
  const total = length ? Number(length) : undefined;
  const reader = response.body.getReader();
  let id: string | undefined;
  const chunks: BlobPart[] = [];
  let received = 0;
  try {
    checkTransfer(runtimeKey, options.signal);
    if (native) id = z.string().parse(await invokeDesktop(Command.begin, { name: path.replace(/\\/g, '/').split('/').pop() }));
    while (true) {
      checkTransfer(runtimeKey, options.signal);
      const next = await reader.read();
      checkTransfer(runtimeKey, options.signal);
      if (next.done) break;
      received += next.value.length;
      if (id) {
        for (let offset = 0; offset < next.value.length; offset += CHUNK_SIZE) {
          checkTransfer(runtimeKey, options.signal);
          await invokeDesktop(Command.chunk, { id, bytes: next.value.slice(offset, offset + CHUNK_SIZE) });
        }
      } else chunks.push(new Uint8Array(next.value));
      options.onProgress?.(received, total);
    }
    checkTransfer(runtimeKey, options.signal);
    if (total !== undefined && received !== total) throw new Error('Incomplete file download');
    if (id) {
      const url = z.string().parse(await invokeDesktop(Command.finish, { id, size: total ?? received }));
      checkTransfer(runtimeKey, options.signal);
      return { url, id, dispose: () => { void invokeDesktop(Command.release, { id }).catch(() => {}); } };
    }
    const url = URL.createObjectURL(new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' }));
    return { url, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (id) await invokeDesktop(Command.release, { id }).catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export async function openNative(path: string, options: FileTransferOptions & { app?: { id: string; appName: string }; reveal?: boolean } = {}) {
  const runtimeKey = getRuntimeKey();
  checkTransfer(runtimeKey, options.signal);
  if (!canUseElectronDesktopIPC()) throw new Error('Native file opening is unavailable');
  if (isDesktopLocalOriginActive()) {
    if (options.reveal) await invokeDesktop(Command.reveal, { path });
    else if (options.app) await invokeDesktop(Command.app, { filePath: path, appId: options.app.id, appName: options.app.appName });
    else await invokeDesktop(Command.openPath, { path });
    return;
  }
  if (options.reveal || options.app) throw new Error('This action requires a local file');
  const asset = await loadAsset(path, options, true);
  // Keep externally opened copies for the lifetime of this window.
  try {
    checkTransfer(runtimeKey, options.signal);
    await invokeDesktop(Command.open, { id: asset.id });
  }
  catch (error) { asset.dispose(); throw error; }
}

export async function saveNative(path: string, options: FileTransferOptions & { content?: string } = {}) {
  const runtimeKey = getRuntimeKey();
  checkTransfer(runtimeKey, options.signal);
  if (!canUseElectronDesktopIPC()) throw new Error('Native save is unavailable');
  let asset: FileAsset;
  if (options.content !== undefined) {
    const id = z.string().parse(await invokeDesktop(Command.begin, { name: path.replace(/\\/g, '/').split('/').pop() }));
    try {
      const bytes = new TextEncoder().encode(options.content);
      for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
        checkTransfer(runtimeKey, options.signal);
        await invokeDesktop(Command.chunk, { id, bytes: bytes.slice(offset, offset + CHUNK_SIZE) });
      }
      checkTransfer(runtimeKey, options.signal);
      const url = z.string().parse(await invokeDesktop(Command.finish, { id, size: bytes.length }));
      asset = { id, url, dispose: () => { void invokeDesktop(Command.release, { id }).catch(() => {}); } };
    } catch (error) { await invokeDesktop(Command.release, { id }).catch(() => {}); throw error; }
  } else asset = await loadAsset(path, options, true);
  try {
    checkTransfer(runtimeKey, options.signal);
    return z.boolean().parse(await invokeDesktop(Command.save, { id: asset.id }));
  }
  finally { asset.dispose(); }
}
