import type { opencodeClient } from '@/lib/opencode/client';
import type { ModelRef, Session } from '@/lib/opencode/model';
import { getMultiRunMembership, withMultiRunMembership, type MultiRunIdentity } from './identity';

export type MultiRunSessionApi = Pick<typeof opencodeClient, 'createSession' | 'getSession' | 'updateSession' | 'deleteSession'>;
export type MultiRunGeneration = 'oc1' | 'oc2';

/** Bind the server-assigned ID before dispatch. A fork inherits this ID and cannot join. */
export async function createMultiRunSession(
  api: MultiRunSessionApi,
  input: {
    title: string;
    directory: string;
    generation: MultiRunGeneration;
    identity: Omit<MultiRunIdentity, 'key'>;
    selection?: { model?: ModelRef; agent?: string };
  },
  assertCurrent: () => void,
): Promise<Session> {
  assertCurrent();
  const pending = { ...input.identity, version: 1 as const, sessionID: null };
  const created = await api.createSession({
    title: input.title,
    metadata: withMultiRunMembership({}, pending),
    ...(input.generation === 'oc2' ? input.selection : undefined),
  }, input.directory);

  try {
    assertCurrent();
    const bound = { ...pending, sessionID: created.id };
    // OC1 replaces metadata, so read the new session and retain every field
    // written since creation. OC2's metadata route applies a merge patch:
    // send only the marker so concurrent fields stay under server ownership.
    const metadata = input.generation === 'oc1'
      ? withMultiRunMembership(await api.getSession(created.id, input.directory), bound)
      : withMultiRunMembership({}, bound);
    assertCurrent();
    const updated = await api.updateSession(created.id, { metadata }, input.directory);
    assertCurrent();
    if (updated.id !== created.id || !getMultiRunMembership(updated)) {
      throw new Error('Multi-run membership was not saved');
    }
    return updated;
  } catch (error) {
    // A switched runtime must never receive cleanup for the old session.
    assertCurrent();
    try {
      await api.deleteSession(created.id, input.directory);
    } catch {
      console.warn('[MultiRun] Could not remove an undispatched session after membership failure');
    }
    throw error;
  }
}
