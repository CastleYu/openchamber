import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createOpenChamberSessionService } from './routes.js';

it('serializes cold concurrent archives through one store for the selected scope', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc2-cold-archive-'));
  const identity = { generation: 'oc2', endpoint: 'http://kernel.test', epoch: 1 };
  const service = createOpenChamberSessionService({ dataDir,
    kernelOperations: { captureIdentity: () => identity } });
  try {
    const results = await Promise.all([
      service.archive({ ids: ['a'], archivedAt: 100 }),
      service.archive({ ids: ['b'], archivedAt: 200 }),
      service.archive({ ids: ['c'], archivedAt: 300 }),
    ]);
    expect(results.map((result) => result.failedIds)).toEqual([[], [], []]);
    expect(await service.getArchivedSessions()).toEqual({ a: 100, b: 200, c: 300 });
    expect(JSON.parse(await fs.readFile(path.join(dataDir, 'sessions-archive.json'), 'utf8')))
      .toEqual({ a: 100, b: 200, c: 300 });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
