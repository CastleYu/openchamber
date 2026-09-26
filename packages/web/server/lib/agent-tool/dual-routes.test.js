import express from 'express';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { registerDualAgentToolRoutes } from './dual-routes.js';

it('dispatches only the active generation callback and rejects unknown runtime', async () => {
  let generation = 'oc1';
  const legacy = { registerRoutes: vi.fn((router) => router.post('/api/openchamber/agent-tool', (_req, res) => res.json({ kernel: 'oc1' }))) };
  const current = { registerRoutes: vi.fn((router) => router.post('/api/openchamber/agent-tool', (_req, res) => res.json({ kernel: 'oc2' }))) };
  const app = express();
  registerDualAgentToolRoutes(app, express, { legacy, current, getGeneration: () => generation });
  expect((await request(app).post('/api/openchamber/agent-tool').expect(200)).body.kernel).toBe('oc1');
  generation = 'oc2';
  expect((await request(app).post('/api/openchamber/agent-tool').expect(200)).body.kernel).toBe('oc2');
  generation = 'unknown';
  await request(app).post('/api/openchamber/agent-tool').expect(503);
  expect(legacy.registerRoutes).toHaveBeenCalledTimes(1);
  expect(current.registerRoutes).toHaveBeenCalledTimes(1);
});
