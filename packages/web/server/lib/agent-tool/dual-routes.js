import { OPENCODE_GENERATION } from '../opencode/compatibility.js';
import { createOpenCodeFamilyGuard } from '../opencode/family-guard.js';

export const registerDualAgentToolRoutes = (app, express, { legacy, current, getKernelRuntime, getBackendSelection }) => {
  const legacyRouter = express.Router();
  const currentRouter = express.Router();
  legacy.registerRoutes(legacyRouter, express);
  current.registerRoutes(currentRouter, express);
  const admit = createOpenCodeFamilyGuard(getBackendSelection, getKernelRuntime);
  app.use((req, res, next) => {
    if (req.path !== '/api/openchamber/agent-tool') return next();
    return admit(req, res, () => {
      const generation = getKernelRuntime().generation;
      if (generation === OPENCODE_GENERATION.OC1) return legacyRouter(req, res, next);
      if (generation === OPENCODE_GENERATION.OC2) return currentRouter(req, res, next);
      return res.status(503).json({ error: 'OpenCode generation is not ready' });
    });
  });
};
