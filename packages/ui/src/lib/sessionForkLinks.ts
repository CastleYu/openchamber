import { z } from 'zod';
import type { JsonValue, Metadata, Session } from '@/lib/opencode/model';
import { getSessionGoal } from '@/lib/sessionGoalMetadata';

const MetadataRecordSchema = z.record(z.string(), z.json());

const asRecord = (value: JsonValue | undefined): Metadata | null => {
  const parsed = MetadataRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** Source-owned keys removed from the fork; everything else is kept as copied. */
export function withoutSourceOwnedLinks(metadata: Metadata, forkGoalID?: string): Metadata {
  const namespace = asRecord(metadata.openchamber);
  if (!namespace) return metadata;
  const next: Metadata = { ...namespace };
  delete next.btwSessionID;
  delete next.reviewSessionID;
  if (next.kind === 'btw') {
    delete next.kind;
    delete next.originalSessionID;
    delete next.btwBoundaryMessageID;
  }
  // A fork usually tries another path; it must not pursue the source's goal in
  // parallel, so an active goal arrives paused and the user resumes it.
  const goal = asRecord(next.goal);
  const pausedGoal = goal?.status === 'active' && (forkGoalID === undefined || goal.id === forkGoalID);
  if (goal && pausedGoal) {
    next.goal = { ...goal, status: 'paused', statusReason: 'paused in fork' };
  }
  if (!pausedGoal && Object.keys(next).length === Object.keys(namespace).length) return metadata;
  const result: Metadata = { ...metadata };
  if (Object.keys(next).length > 0) {
    result.openchamber = next;
  } else {
    delete result.openchamber;
  }
  return result;
}

const withInlineObjective = (metadata: Metadata, goalId: string, objective: string): Metadata => {
  const namespace = asRecord(metadata.openchamber);
  const goal = namespace ? asRecord(namespace.goal) : null;
  if (!namespace || !goal || goal.id !== goalId) return metadata;
  return { ...metadata, openchamber: { ...namespace, goal: { ...goal, objective, objectiveFile: false } } };
};

export interface ForkInheritanceDeps {
  readObjective: (sessionId: string) => Promise<string | null>;
  readGoalId: (sessionId: string) => Promise<string | null>;
  writeObjective: (sessionId: string, content: string) => Promise<boolean>;
  removeObjective: (sessionId: string) => Promise<void>;
  patchMetadata: (sessionId: string, updater: (metadata: Metadata) => Metadata) => Promise<Session>;
}

/** Repair the new fork before it is opened; failure leaves the caller to roll it back. */
export async function applyForkInheritance(sourceSessionId: string, fork: Session, deps: ForkInheritanceDeps): Promise<Session> {
  const goal = getSessionGoal(fork);
  let inlineObjective: string | null = null;
  let objectiveWritten = false;
  if (goal?.objectiveFile) {
    const content = await deps.readObjective(sourceSessionId);
    const objective = content ?? goal.objective;
    if (!objective) throw new Error('Fork source goal objective is unavailable');
    if (await deps.readGoalId(fork.id) === goal.id) {
      objectiveWritten = await deps.writeObjective(fork.id, objective);
      if (!objectiveWritten) inlineObjective = objective;
    }
  }

  const original = fork.metadata ?? {};
  if (withoutSourceOwnedLinks(original, goal?.id) === original && inlineObjective === null) return fork;
  try {
    return await deps.patchMetadata(fork.id, (metadata) => {
      const cleaned = withoutSourceOwnedLinks(metadata, goal?.id);
      return goal && inlineObjective !== null ? withInlineObjective(cleaned, goal.id, inlineObjective) : cleaned;
    });
  } catch (error) {
    if (objectiveWritten) {
      try { await deps.removeObjective(fork.id); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Fork metadata repair and objective cleanup failed'); }
    }
    throw error;
  }
}
