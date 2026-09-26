export const registerDualAgentToolRoutes = (app, express, { legacy, current, getGeneration }) => {
  const legacyRouter = express.Router();
  const currentRouter = express.Router();
  legacy.registerRoutes(legacyRouter, express);
  current.registerRoutes(currentRouter, express);
  app.use((req, res, next) => {
    if (req.path !== '/api/openchamber/agent-tool') return next();
    const generation = getGeneration();
    if (generation === 'oc1') return legacyRouter(req, res, next);
    if (generation === 'oc2') return currentRouter(req, res, next);
    return res.status(503).json({ error: 'OpenCode generation is not ready' });
  });
};
