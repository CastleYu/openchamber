import { expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerOpenChamberRoutes } from './openchamber-routes.js';

it('denies direct HTTP install before any process or filesystem dependency is used', async () => {
  const app = express();
  registerOpenChamberRoutes(app, {});
  const response = await request(app).post('/api/openchamber/update-install');
  expect(response.status).toBe(403);
  expect(response.body.error).toContain('Personal builds only notify');
});
