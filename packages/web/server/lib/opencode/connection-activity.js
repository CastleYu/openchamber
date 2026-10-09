import { OPENCODE_GENERATION } from './compatibility.js';
import { OpenCodeConnectionError } from './connection.js';

const STATE = Object.freeze({ KNOWN: 'known', UNKNOWN: 'unknown', ACTIVE: 'active', INACTIVE: 'inactive', TRANSITIONING: 'transitioning' });
const SCOPE = Object.freeze({ DIRECTORIES: 'configured-directories', GLOBAL: 'global' });
const sameOwner = (left, right) => left.generation === right.generation && left.profile === right.profile
  && left.endpoint === right.endpoint && left.epoch === right.epoch;
const unknown = (observedCount = 0) => ({ state: STATE.UNKNOWN, observedCount });
const known = count => ({ state: STATE.KNOWN, count });

// Inspection is evidence for confirmation, never a switch authorization.
export const createConnectionActivity = ({ kernelOperations, queue, getDirectories, getState }) => {
  const inspect = async () => {
    const before = getState();
    const identity = before.ready && !before.transitioning ? kernelOperations.captureIdentity() : null;
    await queue.load();
    const queued = queue.snapshot();
    const directories = [...new Set([...(await getDirectories()),
      ...queued.sessions.map(session => session.directory)].filter(Boolean))];
    const report = {
      state: before.transitioning ? STATE.TRANSITIONING : before.ready ? STATE.ACTIVE : STATE.INACTIVE,
      scope: { coverage: SCOPE.DIRECTORIES, busy: identity?.generation === OPENCODE_GENERATION.OC2 ? SCOPE.GLOBAL : SCOPE.DIRECTORIES, directories },
      busy: unknown(), permissions: unknown(), questions: unknown(),
      queue: { ...known(queued.sessions.reduce((count, session) => count + session.items.length, 0)),
        sending: queued.sessions.filter(session => session.sendingId !== null).length, revision: queued.revision },
      clients: unknown(),
    };
    if (identity && !before.transitioning) {
      const summarize = async (read, scopes, project) => {
        const results = await Promise.allSettled(scopes.map(directory => read({ directory, signal: AbortSignal.timeout(15000) })));
        const ids = new Set();
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          if (!sameOwner(identity, result.value)) throw new OpenCodeConnectionError('Connection changed during activity inspection', 409);
          for (const id of project(result.value.data)) ids.add(id);
        }
        return scopes.length > 0 && results.every(result => result.status === 'fulfilled') ? known(ids.size) : unknown(ids.size);
      };
      [report.busy, report.permissions, report.questions] = await Promise.all([
        summarize(kernelOperations.listActiveStatuses, identity.generation === OPENCODE_GENERATION.OC2 ? [undefined] : directories,
          data => Object.entries(data).filter(([, status]) => status.type !== 'idle').map(([id]) => id)),
        summarize(kernelOperations.listPendingPermissions, directories, data => data.map(item => item.id)),
        summarize(kernelOperations.listPendingQuestions, directories, data => data.map(item => item.id)),
      ]);
      let current;
      try { current = kernelOperations.captureIdentity(); }
      catch { throw new OpenCodeConnectionError('Connection changed during activity inspection', 409); }
      if (!sameOwner(identity, current)) throw new OpenCodeConnectionError('Connection changed during activity inspection', 409);
    }
    const after = getState();
    if (before.ready !== after.ready || before.transitioning !== after.transitioning || queue.snapshot().revision !== queued.revision) {
      throw new OpenCodeConnectionError('Connection activity changed during inspection', 409);
    }
    return report;
  };
  return { inspect };
};
