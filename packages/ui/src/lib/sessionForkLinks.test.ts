import { expect, test } from 'bun:test';
import type { Session } from '@/lib/opencode/model';
import { applyForkInheritance, type ForkInheritanceDeps } from './sessionForkLinks';

const fork: Session = {
  id: 'ses_fork', projectID: 'prj', directory: '/repo', title: 'Fork', time: { created: 1, updated: 1 },
  metadata: { openchamber: {
    btwSessionID: 'ses_source_btw', reviewSessionID: 'ses_source_review', personal: true,
    goal: { id: 'goal_1', status: 'active', objective: '', objectiveFile: true },
  } },
};

function setup() {
  const calls: string[] = [];
  let written = true;
  let goalId = 'goal_1';
  let patchFails = false;
  const deps: ForkInheritanceDeps = {
    readObjective: async () => { calls.push('read'); return 'Finish the work'; },
    readGoalId: async () => { calls.push('goal'); return goalId; },
    writeObjective: async () => { calls.push('write'); return written; },
    removeObjective: async () => { calls.push('remove'); },
    patchMetadata: async (_id, update) => {
      calls.push('patch');
      if (patchFails) throw new Error('metadata failed');
      const metadata = goalId === 'goal_1' ? fork.metadata ?? {} : { openchamber: {
        btwSessionID: 'ses_source_btw', reviewSessionID: 'ses_source_review', personal: true,
        goal: { id: 'goal_new', status: 'active', objective: 'New goal', objectiveFile: false },
      } };
      return { ...fork, metadata: update(metadata) };
    },
  };
  return { deps, calls, failWrite: () => { written = false; }, changeGoal: () => { goalId = 'goal_new'; }, failPatch: () => { patchFails = true; } };
}

test('copies a file-backed goal and pauses it while removing source links', async () => {
  const ctx = setup();
  const updated = await applyForkInheritance('ses_source', fork, ctx.deps);
  expect(ctx.calls).toEqual(['read', 'goal', 'write', 'patch']);
  expect(updated.metadata?.openchamber).toEqual({ personal: true,
    goal: { id: 'goal_1', status: 'paused', statusReason: 'paused in fork', objective: '', objectiveFile: true },
  });
});

test('a failed file write keeps the objective inline in the new fork', async () => {
  const ctx = setup();
  ctx.failWrite();
  const updated = await applyForkInheritance('ses_source', fork, ctx.deps);
  expect(updated.metadata?.openchamber).toEqual({ personal: true,
    goal: { id: 'goal_1', status: 'paused', statusReason: 'paused in fork', objective: 'Finish the work', objectiveFile: false },
  });
});

test('metadata failure cleans the newly copied file and rejects for caller rollback', async () => {
  const ctx = setup();
  ctx.failPatch();
  await expect(applyForkInheritance('ses_source', fork, ctx.deps)).rejects.toThrow('metadata failed');
  expect(ctx.calls).toEqual(['read', 'goal', 'write', 'patch', 'remove']);
});

test('a missing file-backed source objective fails before opening the fork', async () => {
  const ctx = setup();
  ctx.deps.readObjective = async () => null;
  await expect(applyForkInheritance('ses_source', fork, ctx.deps)).rejects.toThrow('objective is unavailable');
  expect(ctx.calls).toEqual([]);
});

test('a newer fork goal is never overwritten by the source objective', async () => {
  const ctx = setup();
  ctx.changeGoal();
  const updated = await applyForkInheritance('ses_source', fork, ctx.deps);
  expect(ctx.calls).toEqual(['read', 'goal', 'patch']);
  expect(updated.metadata?.openchamber).toEqual({ personal: true,
    goal: { id: 'goal_new', status: 'active', objective: 'New goal', objectiveFile: false },
  });
});
