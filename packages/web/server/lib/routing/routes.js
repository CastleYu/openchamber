/**
 * `/api/routing` — configuration and the Jev key. Normal authenticated
 * OpenChamber routes: do not add them to browser URL-token allowlists.
 *
 * `/api/session/:id/{prompt_async,prompt,command}` — the rewrite that turns
 * `openchamber/auto` into a real model before the generic OpenCode proxy
 * forwards the request. Registered ahead of the proxy; it parses the JSON body
 * only while Auto can actually be selected, so a build without the flag pays
 * nothing on the send path.
 */
import express from 'express';
import { isRoutingFeatureAvailable } from './feature-flag.js';
import { isAutoModel } from './defaults.js';

const AUTO_SESSION_PATHS = [
  '/api/session/:sessionId/prompt_async',
  '/api/session/:sessionId/prompt',
  '/api/session/:sessionId/command',
];
const CURRENT_SEND_PATHS = ['/api/session/:sessionId/prompt', '/api/session/:sessionId/command'];
const generationOf = (runtime) => runtime.generation?.() ?? 'oc1';

const sendError = (res, error) => {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  res.status(status).json({ error: error?.message ?? 'Routing request failed' });
};

export function registerRoutingRoutes(app, runtime) {
  const unavailable = (res) => res.status(404).json({ error: 'Routing is not available in this build' });

  app.get('/api/routing', async (_req, res) => {
    try {
      const state = await runtime.describe();
      if (!state.available) return unavailable(res);
      res.json({ ...state, heldPermissions: runtime.heldPermissions() });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put('/api/routing', express.json({ limit: '256kb' }), async (req, res) => {
    if (generationOf(runtime) === 'oc1' && !isRoutingFeatureAvailable()) return unavailable(res);
    try {
      res.json(await runtime.updateConfig(req.body?.config));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put('/api/routing/token', express.json({ limit: '16kb' }), async (req, res) => {
    if (generationOf(runtime) === 'oc1' && !isRoutingFeatureAvailable()) return unavailable(res);
    try {
      res.json(await runtime.setToken(req.body?.token));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/routing/token', async (_req, res) => {
    if (generationOf(runtime) === 'oc1' && !isRoutingFeatureAvailable()) return unavailable(res);
    try {
      res.json(await runtime.clearToken());
    } catch (error) {
      sendError(res, error);
    }
  });
}

export function registerRoutingPromptRewrite(app, runtime) {
  const parseJson = express.json({ limit: '50mb' });
  const withParsedBody = (handler) => (req, res, next) => {
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.includes('application/json')) return next();
    parseJson(req, res, (parseError) => parseError ? next(parseError) : handler(req, res, next));
  };
  const directoryOf = (req) => {
    const url = new URL(req.url, 'http://localhost');
    const raw = url.searchParams.get('directory') || req.get('x-opencode-directory') || undefined;
    if (!raw) return undefined;
    try { return decodeURIComponent(raw); } catch { return raw; }
  };

  app.post('/api/session', withParsedBody((req, _res, next) => {
    if (generationOf(runtime) === 'oc2' && isAutoModel(req.body?.model)) delete req.body.model;
    next();
  }));

  app.post('/api/session/:sessionId/model', withParsedBody((req, res, next) => {
    if (generationOf(runtime) !== 'oc2') return next();
    if (runtime.noteModelSelection(req.params.sessionId, req.body?.model, directoryOf(req))) return res.status(204).end();
    next();
  }));

  app.post(CURRENT_SEND_PATHS, (req, res, next) => {
    if (generationOf(runtime) !== 'oc2' || !runtime.isAutoSession(req.params.sessionId)) return next();
    withParsedBody((parsedReq, parsedRes, parsedNext) => {
      runtime.routeSend({ sessionId: parsedReq.params.sessionId, directory: directoryOf(parsedReq), body: parsedReq.body })
        .then(() => parsedNext()).catch((error) => sendError(parsedRes, error));
    })(req, res, next);
  });

  app.post(AUTO_SESSION_PATHS, (req, res, next) => {
    if (generationOf(runtime) !== 'oc1') return next();
    if (!isRoutingFeatureAvailable()) return next();
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.includes('application/json')) return next();
    parseJson(req, res, (parseError) => {
      if (parseError) return next(parseError);
      const directory = directoryOf(req);
      runtime.resolvePromptBody(req.body, { sessionId: req.params.sessionId, directory })
        .then(() => next())
        .catch((error) => sendError(res, error));
    });
  });
}
