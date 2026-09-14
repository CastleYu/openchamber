import { getRuntimeKey } from '@/lib/runtime-switch';
import { z } from 'zod';
import { isVSCodeRuntime } from '@/lib/desktop';
import { runtimeFetch } from '@/lib/runtime-fetch';

import { normalizeReferencePath } from './fileReferenceParser';

const FILE_REFERENCE_STAT_CONCURRENCY = 4;
const FILE_REFERENCE_STAT_CACHE_MAX = 1000;
const VSCODE_FILE_REFERENCE_STAT_CACHE_MAX = 200;
const referenceStat = z.object({ exists: z.boolean().optional(), isDirectory: z.boolean().optional() });

const FILE_REFERENCE_STAT_CACHE = new Map<string, Promise<'file' | 'folder' | false>>();
let activeFileReferenceStatCount = 0;
const pendingFileReferenceStats: Array<() => void> = [];

const getFileReferenceStatCacheMax = (): number => (
  isVSCodeRuntime() ? VSCODE_FILE_REFERENCE_STAT_CACHE_MAX : FILE_REFERENCE_STAT_CACHE_MAX
);

// NUL cannot occur in a real path, so a directory-qualified key cannot collide
// with a differently scoped entry.
const statCacheKey = (directory: string, normalizedPath: string): string => `${getRuntimeKey()}\u0000${directory}\u0000${normalizedPath}`;

export const fileReferenceKind = (resolvedPath: string, effectiveDirectory: string, outside = false): Promise<'file' | 'folder' | false> => {
  const normalizedPath = normalizeReferencePath(resolvedPath);
  if (!normalizedPath) {
    return Promise.resolve(false);
  }

  const cacheKey = statCacheKey(effectiveDirectory, normalizedPath) + (outside ? '\u0000outside' : '');
  const cached = FILE_REFERENCE_STAT_CACHE.get(cacheKey);
  if (cached) {
    FILE_REFERENCE_STAT_CACHE.delete(cacheKey);
    FILE_REFERENCE_STAT_CACHE.set(cacheKey, cached);
    return cached;
  }

  const request = new Promise<'file' | 'folder' | false>((resolve) => {
    const run = () => {
      activeFileReferenceStatCount += 1;
      const route = outside ? '/api/fs/directory-stat' : '/api/fs/stat';
      void runtimeFetch(`${route}?path=${encodeURIComponent(normalizedPath)}&optional=true`, {
        method: 'GET',
        cache: 'no-store',
        // The stat route resolves the workspace from this header. Without it
        // the server falls back to the browsed lastDirectory, which rejects
        // session-local files with 400 whenever the two directories differ.
        headers: effectiveDirectory ? { 'x-opencode-directory': effectiveDirectory } : undefined,
      })
        .then(async (response) => {
          if (!response.ok) {
            resolve(outside && (response.status === 400 || response.status === 404) ? 'file' : false);
            return;
          }
          const payload = referenceStat.parse(await response.json());
          resolve(payload.exists === false ? false : payload.isDirectory ? 'folder' : 'file');
        })
        .catch(() => resolve(false))
        .finally(() => {
          activeFileReferenceStatCount = Math.max(0, activeFileReferenceStatCount - 1);
          pendingFileReferenceStats.shift()?.();
        });
    };

    if (activeFileReferenceStatCount < FILE_REFERENCE_STAT_CONCURRENCY) {
      run();
      return;
    }

    pendingFileReferenceStats.push(run);
  });

  const maxCacheEntries = getFileReferenceStatCacheMax();
  while (FILE_REFERENCE_STAT_CACHE.size >= maxCacheEntries) {
    const oldest = FILE_REFERENCE_STAT_CACHE.keys().next().value;
    if (typeof oldest !== 'string') {
      break;
    }
    FILE_REFERENCE_STAT_CACHE.delete(oldest);
  }
  FILE_REFERENCE_STAT_CACHE.set(cacheKey, request);
  return request;
};

export const fileReferenceExists = async (path: string, directory: string): Promise<boolean> => Boolean(await fileReferenceKind(path, directory));
