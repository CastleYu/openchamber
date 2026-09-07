import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerLogsRoutes } from './routes.js';
import { createRuntimeLog } from './runtime-log.js';

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-logs-routes-'));

describe('logs routes', () => {
  let dataDir;
  let runtimeLog;
  let server;
  let base;
  let nowMs;

  beforeEach(async () => {
    dataDir = makeTempDir();
    nowMs = Date.parse('2026-03-04T05:06:07.000Z');
    runtimeLog = createRuntimeLog({ dataDir, now: () => new Date(nowMs) });
    const app = express();
    registerLogsRoutes(app, { runtimeLog });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const readLines = (relative) => (
    fs.readFileSync(path.join(dataDir, 'logs', relative), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  );

  describe('POST /api/logs/mcp-diagnostics', () => {
    it('records a valid diagnostic into the runtime log', async () => {
      const response = await fetch(`${base}/api/logs/mcp-diagnostics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'db', directory: '/repo', error: 'Connection closed', source: 'connect', at: nowMs }),
      });
      expect(await response.json()).toEqual({ recorded: true });

      const [entry] = readLines('openchamber-2026-03-04.log');
      expect(entry.scope).toBe('mcp');
      expect(entry.event).toBe('diagnostic');
      expect(entry.server).toBe('db');
      expect(entry.directory).toBe('/repo');
      expect(entry.source).toBe('connect');
      expect(entry.error).toBe('Connection closed');
      expect(entry.level).toBe('error');
    });

    it('rejects malformed payloads', async () => {
      for (const body of [
        { name: '', error: 'boom', source: 'connect' },
        { name: 'db', error: '', source: 'connect' },
        { name: 'db', error: 'boom', source: 'somewhere' },
        { name: 'db', error: 'boom' },
        'not-an-object',
      ]) {
        const response = await fetch(`${base}/api/logs/mcp-diagnostics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(400);
      }
      expect(fs.existsSync(path.join(dataDir, 'logs'))).toBe(false);
    });

    it('suppresses the same failure repeated within the window', async () => {
      const send = () => fetch(`${base}/api/logs/mcp-diagnostics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'db', directory: '/repo', error: 'Connection closed', source: 'status', at: nowMs }),
      }).then((response) => response.json());

      expect(await send()).toEqual({ recorded: true });
      expect(await send()).toEqual({ recorded: false });

      const lines = readLines('openchamber-2026-03-04.log');
      expect(lines).toHaveLength(1);
    });

    it('records the same failure again after the suppress window', async () => {
      const sendAt = (at) => fetch(`${base}/api/logs/mcp-diagnostics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'db', directory: '/repo', error: 'Connection closed', source: 'status', at }),
      }).then((response) => response.json());

      expect(await sendAt(nowMs)).toEqual({ recorded: true });
      expect(await sendAt(nowMs + 31_000)).toEqual({ recorded: true });

      expect(readLines('openchamber-2026-03-04.log')).toHaveLength(2);
    });
  });

  describe('GET /api/logs/info', () => {
    it('reports the directory and file list', async () => {
      await runtimeLog.append('info', ['hello']);

      const response = await fetch(`${base}/api/logs/info`);
      const info = await response.json();
      expect(info.directory).toBe(path.join(dataDir, 'logs'));
      expect(info.files).toHaveLength(1);
      expect(info.files[0].name).toBe('openchamber-2026-03-04.log');
      expect(info.files[0].size).toBeGreaterThan(0);
    });
  });

  describe('GET /api/logs/download', () => {
    it('downloads the latest file by default with attachment headers', async () => {
      await runtimeLog.append('info', ['latest content']);

      const response = await fetch(`${base}/api/logs/download`);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(response.headers.get('content-disposition')).toContain('openchamber-2026-03-04.log');
      expect(await response.text()).toContain('latest content');
    });

    it('downloads a specific file by name', async () => {
      await runtimeLog.append('info', ['first']);
      const response = await fetch(`${base}/api/logs/download?file=openchamber-2026-03-04.log`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('first');
    });

    it('rejects traversal and unknown files', async () => {
      const traversal = await fetch(`${base}/api/logs/download?file=../settings.json`);
      expect(traversal.status).toBe(400);

      const missing = await fetch(`${base}/api/logs/download?file=openchamber-1999-01-01.log`);
      expect(missing.status).toBe(500);
    });

    it('answers 404 when no log files exist', async () => {
      const response = await fetch(`${base}/api/logs/download`);
      expect(response.status).toBe(404);
    });
  });
});
