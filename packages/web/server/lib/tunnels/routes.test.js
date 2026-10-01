import { describe, expect, it } from 'vitest';

import { createTunnelRoutesRuntime } from './routes.js';

describe('enterprise tunnel boundary', () => {
  it('refuses startup and HTTP starts before touching tunnel state', async () => {
    const previous = process.env.OPENCHAMBER_ENTERPRISE_MODE;
    process.env.OPENCHAMBER_ENTERPRISE_MODE = '1';
    let starts = 0;
    let settingsReads = 0;
    try {
      const runtime = createTunnelRoutesRuntime({
        tunnelService: { start: async () => { starts += 1; return { publicUrl: 'https://example.com' }; } },
        readSettingsFromDiskMigrated: async () => { settingsReads += 1; return {}; },
        TUNNEL_PROVIDER_CLOUDFLARE: 'cloudflare',
        TUNNEL_MODE_MANAGED_REMOTE: 'managed-remote',
      });
      await expect(runtime.startTunnelWithNormalizedRequest({ provider: 'cloudflare', mode: 'quick' }))
        .rejects.toMatchObject({ code: 'enterprise_mode' });
      const routes = new Map();
      runtime.registerRoutes({
        get: (path, handler) => routes.set(`GET ${path}`, handler),
        post: (path, handler) => routes.set(`POST ${path}`, handler),
        put: (path, handler) => routes.set(`PUT ${path}`, handler),
      });
      let status = 200;
      let body;
      await routes.get('POST /api/openchamber/tunnel/start')({ body: {} }, {
        status(code) { status = code; return this; },
        json(value) { body = value; return this; },
      });
      expect(status).toBe(403);
      expect(body.code).toBe('enterprise_mode');
      expect(starts).toBe(0);
      expect(settingsReads).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.OPENCHAMBER_ENTERPRISE_MODE;
      else process.env.OPENCHAMBER_ENTERPRISE_MODE = previous;
    }
  });
});

describe('public tunnel UI password boundary', () => {
  it('blocks direct and HTTP starts before touching the fake tunnel process', async () => {
    const previous = process.env.OPENCHAMBER_ENTERPRISE_MODE;
    process.env.OPENCHAMBER_ENTERPRISE_MODE = '0';
    let starts = 0;
    let settingsReads = 0;
    try {
      const runtime = createTunnelRoutesRuntime({
        tunnelService: { start: async () => { starts += 1; return { publicUrl: 'https://example.com' }; } },
        readSettingsFromDiskMigrated: async () => { settingsReads += 1; return {}; },
      });
      await expect(runtime.startTunnelWithNormalizedRequest({ provider: 'ngrok', mode: 'quick' }))
        .rejects.toMatchObject({ code: 'ui_password_required' });
      const routes = new Map();
      runtime.registerRoutes({
        get: (path, handler) => routes.set(`GET ${path}`, handler),
        post: (path, handler) => routes.set(`POST ${path}`, handler),
        put: (path, handler) => routes.set(`PUT ${path}`, handler),
      });
      let status = 200;
      let body;
      await routes.get('POST /api/openchamber/tunnel/start')({ body: {} }, {
        status(code) { status = code; return this; },
        json(value) { body = value; return this; },
      });
      expect(status).toBe(403);
      expect(body.code).toBe('ui_password_required');
      expect(starts).toBe(0);
      expect(settingsReads).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.OPENCHAMBER_ENTERPRISE_MODE;
      else process.env.OPENCHAMBER_ENTERPRISE_MODE = previous;
    }
  });

  it('allows a configured server to start a fake tunnel', async () => {
    const previous = process.env.OPENCHAMBER_ENTERPRISE_MODE;
    process.env.OPENCHAMBER_ENTERPRISE_MODE = '0';
    let starts = 0;
    try {
      const runtime = createTunnelRoutesRuntime({
        uiPasswordConfigured: true,
        tunnelService: {
          start: async () => {
            starts += 1;
            return { publicUrl: 'https://example.com', activeMode: 'quick', provider: 'ngrok' };
          },
        },
        TUNNEL_PROVIDER_CLOUDFLARE: 'cloudflare',
        TUNNEL_MODE_MANAGED_REMOTE: 'managed-remote',
      });
      const result = await runtime.startTunnelWithNormalizedRequest({ provider: 'ngrok', mode: 'quick' });
      expect(result.publicUrl).toBe('https://example.com');
      expect(starts).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.OPENCHAMBER_ENTERPRISE_MODE;
      else process.env.OPENCHAMBER_ENTERPRISE_MODE = previous;
    }
  });
});
