import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';

const responseSchema = z.object({ content: z.string().min(1) });
const url = (sessionId: string): string => `/api/goals/objective/${encodeURIComponent(sessionId)}`;

/** A failed write can fall back to inline fork metadata. */
export async function writeGoalObjectiveFile(sessionId: string, content: string): Promise<boolean> {
  try {
    const response = await runtimeFetch(url(sessionId), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Existing goal deletion is best effort, as before. */
export function deleteGoalObjectiveFile(sessionId: string): void {
  void runtimeFetch(url(sessionId), { method: 'DELETE' }).catch(() => undefined);
}

/** Display tolerates an unavailable objective. */
export async function fetchGoalObjectiveContent(sessionId: string): Promise<string | null> {
  try {
    return await readGoalObjectiveForFork(sessionId);
  } catch {
    return null;
  }
}

/** Fork repair must distinguish a missing file from a failed read. */
export async function readGoalObjectiveForFork(sessionId: string): Promise<string | null> {
  const response = await runtimeFetch(url(sessionId));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Goal objective read failed (${response.status})`);
  return responseSchema.parse(await response.json()).content;
}

/** Rollback cleanup reports failure instead of concealing a stranded file. */
export async function removeGoalObjectiveForFork(sessionId: string): Promise<void> {
  const response = await runtimeFetch(url(sessionId), { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Goal objective cleanup failed (${response.status})`);
}
