import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyForkInheritance } from './fork-inheritance.js';
import { readObjectiveForFork, removeObjectiveForFork, writeObjective } from '../session-goal/objectives.js';

const fork = { id: 'ses_fork', metadata: { openchamber: {
  btwSessionID: 'ses_btw', reviewSessionID: 'ses_review', personal: true,
  goal: { id: 'goal_1', status: 'active', objective: '', objectiveFile: true },
} } };

let profile;
let previousDataDir;

beforeEach(async () => {
  previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-fork-test-'));
  process.env.OPENCHAMBER_DATA_DIR = profile;
  await writeObjective('ses_source', 'Finish the inherited work');
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
  else process.env.OPENCHAMBER_DATA_DIR = previousDataDir;
  if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected test profile path');
  await fs.rm(profile, { recursive: true, force: true });
});

const deps = (writeMetadata) => ({ sourceSessionID: 'ses_source', fork,
  readObjective: readObjectiveForFork, readGoalID: async () => 'goal_1',
  writeObjective, removeObjective: removeObjectiveForFork, writeMetadata,
  assertCurrent: () => {},
});

describe('OC2 server fork inheritance', () => {
  it('copies the goal file and repairs links before dispatch', async () => {
    let patch;
    await applyForkInheritance(deps(async (_id, value) => { patch = value; }));
    expect(await readObjectiveForFork('ses_fork')).toBe('Finish the inherited work');
    expect(patch).toEqual({ openchamber: {
      btwSessionID: null, reviewSessionID: null,
      goal: { status: 'paused', statusReason: 'paused in fork' },
    } });
  });

  it('inlines the objective when the fork file cannot be written', async () => {
    let patch;
    await applyForkInheritance({ ...deps(async (_id, value) => { patch = value; }),
      writeObjective: async () => { throw new Error('disk full'); } });
    expect(await readObjectiveForFork('ses_fork')).toBeNull();
    expect(patch.openchamber.goal).toMatchObject({ objective: 'Finish the inherited work', objectiveFile: false });
  });

  it('reports metadata failure and removes a copied objective file', async () => {
    await expect(applyForkInheritance(deps(async () => { throw new Error('metadata rejected'); })))
      .rejects.toThrow('metadata rejected');
    expect(await readObjectiveForFork('ses_fork')).toBeNull();
  });

  it('does not dispatch a fork whose file-backed source objective is missing', async () => {
    await removeObjectiveForFork('ses_source');
    await expect(applyForkInheritance(deps(async () => { throw new Error('metadata must not run'); })))
      .rejects.toThrow('objective is unavailable');
    expect(await readObjectiveForFork('ses_fork')).toBeNull();
  });

  it('does not write after the captured runtime retires', async () => {
    let current = true;
    const input = deps(async () => { throw new Error('metadata must not run'); });
    await expect(applyForkInheritance({ ...input,
      readObjective: async (sessionID) => { const value = await readObjectiveForFork(sessionID); current = false; return value; },
      assertCurrent: () => { if (!current) throw new Error('runtime changed'); },
    })).rejects.toThrow('runtime changed');
    expect(await readObjectiveForFork('ses_fork')).toBeNull();
  });
});
