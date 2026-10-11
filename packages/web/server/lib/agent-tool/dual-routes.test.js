import express from 'express';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { AGENT_FAMILY } from '../agent/constants.js';
import { OPENCODE_PROFILE } from '../opencode/compatibility.js';
import { registerDualAgentToolRoutes } from './dual-routes.js';

it('dispatches only the active generation callback and rejects unknown runtime', async () => {
  let generation = 'oc1';
  const legacy = { registerRoutes: vi.fn((router) => router.post('/api/openchamber/agent-tool', (_req, res) => res.json({ kernel: 'oc1' }))) };
  const current = { registerRoutes: vi.fn((router) => router.post('/api/openchamber/agent-tool', (_req, res) => res.json({ kernel: 'oc2' }))) };
  const app = express();
  registerDualAgentToolRoutes(app, express, { legacy, current, getKernelRuntime: () => ({ generation }) });
  expect((await request(app).post('/api/openchamber/agent-tool').expect(200)).body.kernel).toBe('oc1');
  generation = 'oc2';
  expect((await request(app).post('/api/openchamber/agent-tool').expect(200)).body.kernel).toBe('oc2');
  generation = 'unknown';
  await request(app).post('/api/openchamber/agent-tool').expect(503);
  expect(legacy.registerRoutes).toHaveBeenCalledTimes(1);
  expect(current.registerRoutes).toHaveBeenCalledTimes(1);
});

it.each([
  { family: AGENT_FAMILY.CAGENT, profile: OPENCODE_PROFILE.OC2 },
  { family: AGENT_FAMILY.OPENCODE, profile: OPENCODE_PROFILE.LEGACY },
])('refuses generated tool callbacks for $family/$profile before action work', async ({ family, profile }) => {
  const actions = [];
  const runtime = { registerRoutes: (router) => router.post('/api/openchamber/agent-tool', (_req, res) => {
    actions.push('executed');
    res.json({ success: true });
  }) };
  const app = express();
  registerDualAgentToolRoutes(app, express, {
    legacy: runtime, current: runtime,
    getKernelRuntime: () => ({ generation: 'oc2', profile }),
    getBackendSelection: () => ({ family, revision: 1 }),
  });
  await request(app).post('/api/openchamber/agent-tool').expect(501);
  expect(actions).toHaveLength(0);
});