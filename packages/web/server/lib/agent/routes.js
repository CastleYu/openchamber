import express from 'express';
import { z } from 'zod';

import { AGENT_ERROR, AGENT_ROUTE } from './constants.js';
import { AgentAttemptError } from './attempts.js';
import { AgentDispatchError } from './dispatcher.js';
import { agentIdentitySchema, agentOperationSchema } from './schemas.js';

const requestSchema = z.object({
  operation: agentOperationSchema,
  identity: agentIdentitySchema,
  input: z.json(),
}).strict();
const attemptSchema = z.object({ identity: agentIdentitySchema, requestID: z.string().min(1) }).strict();
const statuses = Object.freeze({
  [AGENT_ERROR.INVALID_INPUT]: 400,
  [AGENT_ERROR.UNKNOWN_OPERATION]: 400,
  [AGENT_ERROR.UNAUTHORIZED]: 403,
  [AGENT_ERROR.CHANGED]: 409,
  [AGENT_ERROR.UNKNOWN_OUTCOME]: 409,
  [AGENT_ERROR.UNVERIFIED]: 501,
  [AGENT_ERROR.UNSUPPORTED]: 501,
  [AGENT_ERROR.UNACCEPTED]: 501,
  [AGENT_ERROR.MISSING_HANDLER]: 501,
  [AGENT_ERROR.UNAVAILABLE]: 503,
  [AGENT_ERROR.INVALID_RESPONSE]: 502,
  [AGENT_ERROR.WRITE_UNAVAILABLE]: 503,
  [AGENT_ERROR.ATTEMPT_EXISTS]: 409,
  [AGENT_ERROR.ATTEMPT_STORAGE]: 503,
  [AGENT_ERROR.ATTEMPT_CORRUPT]: 503,
});

const failure = (res, error) => {
  // Adapter exceptions can contain wire payloads, paths or credentials.
  // Only host-owned refusal codes may leave this boundary.
  const code = (error instanceof AgentDispatchError || error instanceof AgentAttemptError) && Object.hasOwn(statuses, error.code)
    ? error.code : AGENT_ERROR.BACKEND_FAILED;
  return res.status(statuses[code] ?? 502).json({ error: code });
};

/** Mount after the host's API authentication gate and before the OpenCode proxy. */
export const registerAgentRoutes = (app, { dispatcher }) => {
  app.get(AGENT_ROUTE.RUNTIME, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = agentIdentitySchema.parse(dispatcher.captureIdentity());
      return res.json({ identity });
    } catch (error) {
      return failure(res, error);
    }
  });

  app.post(AGENT_ROUTE.DISPATCH, express.json({ limit: '64kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const request = requestSchema.safeParse(req.body);
    if (!request.success) return res.status(400).json({ error: AGENT_ERROR.INVALID_INPUT });
    const { operation, input, identity } = request.data;
    try {
      return res.json(await dispatcher.dispatch(operation, input, identity));
    } catch (error) {
      return failure(res, error);
    }
  });

  app.post(AGENT_ROUTE.ATTEMPT, express.json({ limit: '64kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = attemptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: AGENT_ERROR.INVALID_INPUT });
    try {
      return res.json(await dispatcher.readAttempt(parsed.data.identity, parsed.data.requestID));
    } catch (error) {
      return failure(res, error);
    }
  });

  // Misspelled paths and wrong methods belong to this protocol, never OpenCode.
  app.use(AGENT_ROUTE.PREFIX, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: AGENT_ERROR.UNKNOWN_ROUTE });
  });
  app.use(AGENT_ROUTE.PREFIX, (_error, _req, res, _next) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: AGENT_ERROR.INVALID_INPUT });
  });
};
