import { z } from 'zod';

const namespaceSchema = z.looseObject({
  btwSessionID: z.unknown().optional(), reviewSessionID: z.unknown().optional(),
  kind: z.unknown().optional(), goal: z.unknown().optional(),
});
const metadataSchema = z.looseObject({ openchamber: namespaceSchema });
const goalSchema = z.looseObject({ id: z.string().min(1), status: z.string(),
  objectiveFile: z.literal(true), objective: z.string().optional() });
const activeGoalSchema = z.looseObject({ id: z.string().min(1), status: z.literal('active') });

const namespaceOf = (metadata) => metadataSchema.safeParse(metadata).data?.openchamber ?? null;
const fileGoal = (metadata) => goalSchema.safeParse(namespaceOf(metadata)?.goal).data ?? null;
export const forkGoalID = (metadata) => z.looseObject({ id: z.string().min(1) })
  .safeParse(namespaceOf(metadata)?.goal).data?.id ?? null;

/** RFC 7386 patch for fields copied from the source but owned by that source. */
export const sourceOwnedLinksPatch = (metadata, goalID) => {
  const namespace = namespaceOf(metadata);
  if (!namespace) return null;
  const patch = {};
  for (const key of ['btwSessionID', 'reviewSessionID']) {
    if (key in namespace) patch[key] = null;
  }
  if (namespace.kind === 'btw') {
    for (const key of ['kind', 'originalSessionID', 'btwBoundaryMessageID']) {
      if (key in namespace) patch[key] = null;
    }
  }
  const activeGoal = activeGoalSchema.safeParse(namespace.goal).data;
  if (activeGoal && (goalID === undefined || activeGoal.id === goalID)) {
    patch.goal = { status: 'paused', statusReason: 'paused in fork' };
  }
  return Object.keys(patch).length ? patch : null;
};

/** Repair an OC2 fork before dispatching its first prompt. Errors remain partial-fork failures. */
export const applyForkInheritance = async ({ sourceSessionID, fork, readObjective, readGoalID,
  writeObjective, removeObjective, writeMetadata, assertCurrent }) => {
  const goal = fileGoal(fork.metadata);
  let inlineObjective = null;
  let objectiveWritten = false;
  let currentGoalID = goal?.id;
  if (goal) {
    assertCurrent();
    const content = await readObjective(sourceSessionID);
    assertCurrent();
    const objective = content ?? goal.objective;
    if (!objective) throw new Error('Fork source goal objective is unavailable');
    currentGoalID = await readGoalID(fork.id);
    assertCurrent();
    if (currentGoalID === goal.id) {
      try {
        await writeObjective(fork.id, objective);
        objectiveWritten = true;
      } catch {
        assertCurrent();
        inlineObjective = objective;
      }
      assertCurrent();
    }
  }

  const patch = sourceOwnedLinksPatch(fork.metadata, currentGoalID === goal?.id ? goal?.id : null) ?? {};
  if (inlineObjective !== null) patch.goal = { ...patch.goal, objective: inlineObjective, objectiveFile: false };
  if (!Object.keys(patch).length) return;
  try {
    assertCurrent();
    await writeMetadata(fork.id, { openchamber: patch });
    assertCurrent();
  } catch (error) {
    if (objectiveWritten) {
      try { await removeObjective(fork.id); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Fork metadata repair and objective cleanup failed'); }
    }
    throw error;
  }
};
