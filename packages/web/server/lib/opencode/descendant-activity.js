// A successful status snapshot omits idle sessions. Child membership is read
// from the same kernel identity; a failed read never means an empty subtree.
const MAX_DEPTH = 8;
const ACTIVE = new Set(['busy', 'retry']);

export const readDescendantActivity = async (kernelOperations, sessionId, directory, statuses, identity = kernelOperations.captureIdentity()) => {
  if (identity.generation !== 'oc2') return false;
  const initial = kernelOperations.captureIdentity();
  if (initial.generation !== identity.generation || initial.endpoint !== identity.endpoint || initial.epoch !== identity.epoch) return null;
  const pending = [{ id: sessionId, depth: 0 }];
  const seen = new Set([sessionId]);
  try {
    while (pending.length > 0) {
      const { id, depth } = pending.pop();
      const children = (await kernelOperations.listChildren({ sessionID: id, directory })).data;
      const current = kernelOperations.captureIdentity();
      if (current.generation !== identity.generation || current.endpoint !== identity.endpoint || current.epoch !== identity.epoch) return null;
      if (!Array.isArray(children)) return null;
      for (const child of children) {
        if (!child.id || seen.has(child.id)) continue;
        seen.add(child.id);
        if (ACTIVE.has(statuses[child.id]?.type)) return true;
        if (depth + 1 < MAX_DEPTH) pending.push({ id: child.id, depth: depth + 1 });
      }
    }
    return false;
  } catch {
    return null;
  }
};
