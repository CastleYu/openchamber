import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';

import { createFileOpenRequester } from './file-open.js';

const file = { isFile: () => true, size: 42 };

describe('createFileOpenRequester', () => {
  it('resolves a relative path against the session directory and tells the clients', async () => {
    const directory = path.resolve('repo');
    const target = path.join(directory, 'out', 'report.csv');
    const emit = vi.fn(() => 2);
    const stat = vi.fn(async () => file);
    const requester = createFileOpenRequester({ emit, stat });

    const result = await requester.request({ path: 'out/report.csv', directory, sessionId: 'ses_1' });

    expect(stat).toHaveBeenCalledWith(target);
    expect(emit).toHaveBeenCalledWith({ path: target, directory, sessionId: 'ses_1' });
    expect(result).toEqual({ path: target, size: 42, opened: true });
  });

  it('keeps an absolute path outside the project, which is where screenshots and recordings often land', async () => {
    const target = path.join(os.tmpdir(), 'shot.png');
    const directory = path.resolve('repo');
    const emit = vi.fn(() => 1);
    const requester = createFileOpenRequester({ emit, stat: async () => file });

    const result = await requester.request({ path: target, directory, sessionId: null });

    expect(result.path).toBe(target);
    expect(emit).toHaveBeenCalledWith({ path: target, directory, sessionId: null });
  });

  it('refuses a relative path when no directory is known, instead of guessing one', async () => {
    const requester = createFileOpenRequester({ emit: () => 1, stat: async () => file });
    await expect(requester.request({ path: 'report.csv', directory: null, sessionId: null }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('reports a missing file and a directory before asking anyone to open them', async () => {
    const emit = vi.fn(() => 1);
    const missing = createFileOpenRequester({
      emit,
      stat: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    });
    await expect(missing.request({ path: '/repo/gone.png', directory: '/repo' }))
      .rejects.toMatchObject({ statusCode: 404 });

    const folder = createFileOpenRequester({ emit, stat: async () => ({ isFile: () => false, size: 0 }) });
    await expect(folder.request({ path: '/repo/src', directory: '/repo' }))
      .rejects.toMatchObject({ statusCode: 400 });

    expect(emit).not.toHaveBeenCalled();
  });

  it('fails with 503 when no client is connected rather than claiming the file was shown', async () => {
    const requester = createFileOpenRequester({ emit: () => 0, stat: async () => file });
    await expect(requester.request({ path: '/repo/a.png', directory: '/repo' }))
      .rejects.toMatchObject({ statusCode: 503 });
  });
});
