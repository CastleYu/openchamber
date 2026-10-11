import express from 'express';
import { OPENCODE_PROFILE } from './compatibility.js';
import { createLegacySessionApi } from './legacy-session-api.js';

const ROUTE = Object.freeze({ CREATE: '/api/session', UPDATE: '/api/session/:sessionID' });

export const createLegacySessionHttp = (options) => {
  const api = createLegacySessionApi(options);
  const handle = async (req, res, next) => {
    if (options.getRuntime().profile !== OPENCODE_PROFILE.LEGACY) return next();
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort); res.once('close', abort);
    try {
      const result = await api.request({ method: req.method, route: req.path.replace(/^\/api(?=\/|$)/, ''),
        body: req.body, query: req.query, directory: req.get('x-opencode-directory'), signal: controller.signal });
      if (!controller.signal.aborted) return res.status(result.status).json(result.body);
    } finally {
      req.off('aborted', abort); res.off('close', abort);
    }
  };
  const register = (app) => {
    app.post(ROUTE.CREATE, express.json(), handle);
    app.patch(ROUTE.UPDATE, express.json(), handle);
  };
  return { accepts: api.accepts, overlay: api.overlay, register };
};
