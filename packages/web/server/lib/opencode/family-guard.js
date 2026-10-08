import { AGENT_ERROR, AGENT_FAMILY } from '../agent/constants.js';

export const createOpenCodeFamilyGuard = (
  getBackendSelection = () => ({ family: AGENT_FAMILY.OPENCODE, revision: 0 }),
) => (_req, res, next) => {
  if (getBackendSelection().family === AGENT_FAMILY.OPENCODE) return next();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(501).json({ error: AGENT_ERROR.UNMIGRATED });
};
