import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPermissionModesStore } from './modes-store.js';

describe('OC2 permission mode storage', () => {
  it('round-trips modes without touching the legacy settings record', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'permission-modes-'));
    try {
      const store = createPermissionModesStore({ dataDir });
      expect(await store.read()).toEqual({ sessions: {}, revision: 0 });
      await store.write({ sessions: { root: 'safety', child: 'ask' }, revision: 1 });
      expect(await store.read()).toEqual({ sessions: { root: 'safety', child: 'ask' }, revision: 1 });
      expect((await fs.readdir(dataDir)).sort()).toEqual(['permission-modes.json']);
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it('reports malformed saved policy instead of treating it as empty', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'permission-modes-'));
    try {
      await fs.writeFile(path.join(dataDir, 'permission-modes.json'), '{"version":1,"sessions":{"root":"invalid"},"revision":2}');
      const store = createPermissionModesStore({ dataDir });
      await expect(store.read()).rejects.toThrow(/Invalid permission-modes.json/);
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
});
