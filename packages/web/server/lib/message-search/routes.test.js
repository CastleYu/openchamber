import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createMessageSearchRuntime } from './runtime.js';
import { registerMessageSearchRoutes } from './routes.js';

const files = [];
afterEach(() => {
  for (const directory of files.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const server = (generation, enabled) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-message-search-http-'));
  files.push(dataDir);
  const hub = {
    subscribeEvent: () => () => {},
    subscribeStatus: () => () => {},
    isConnected: () => false,
  };
  const runtime = createMessageSearchRuntime({
    dataDir,
    buildOpenCodeUrl: () => 'http://127.0.0.1:1/',
    getOpenCodeAuthHeaders: () => ({}),
    globalEventHub: hub,
    getRuntime: () => ({ generation, endpoint: 'http://local', epoch: 1 }),
    readSettings: async () => ({ enabled, reasoning: false }),
  });
  const app = express();
  registerMessageSearchRoutes(app, { messageSearchRuntime: runtime });
  return { app, runtime, dataDir };
};

describe('message search HTTP boundary', () => {
  it.each([['oc1', true], ['oc2', false]])('keeps %s search unavailable with saved enabled=%s', async (generation, enabled) => {
    const { app, runtime, dataDir } = server(generation, enabled);
    expect((await request(app).get('/api/openchamber/message-search/status')).body.state).toBe('off');
    const response = await request(app).get('/api/openchamber/message-search?q=hello');
    expect(response.status).toBe(503);
    expect(fs.existsSync(path.join(dataDir, 'message-search.sqlite'))).toBe(false);
    await runtime.stop();
  });

  it('answers an OC2 query and rebuilds its derived file through HTTP', async () => {
    const { app, runtime, dataDir } = server('oc2', true);
    expect((await request(app).get('/api/openchamber/message-search/status')).body.state).toBe('on');
    const query = await request(app).get('/api/openchamber/message-search?q=hello');
    expect(query.status).toBe(200);
    expect(query.body).toMatchObject({ status: 'ok', hits: [] });
    const rebuilt = await request(app).delete('/api/openchamber/message-search/index');
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.state).toBe('on');
    expect(fs.existsSync(path.join(dataDir, 'message-search.sqlite'))).toBe(true);
    await runtime.stop();
  });
});
