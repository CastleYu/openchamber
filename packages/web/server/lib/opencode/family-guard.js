import { AGENT_ERROR, AGENT_FAMILY } from '../agent/constants.js';
import { OPENCODE_PROFILE } from './compatibility.js';

export const createOpenCodeFamilyGuard = (
  getBackendSelection = () => ({ family: AGENT_FAMILY.OPENCODE, revision: 0 }),
  getKernelRuntime = () => null,
) => (_req, res, next) => {
  if (getBackendSelection().family !== AGENT_FAMILY.OPENCODE) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(501).json({ error: AGENT_ERROR.UNMIGRATED });
  }
  if (getKernelRuntime()?.profile === OPENCODE_PROFILE.LEGACY) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(501).json({ error: AGENT_ERROR.UNACCEPTED, profile: OPENCODE_PROFILE.LEGACY });
  }
  return next();
};
