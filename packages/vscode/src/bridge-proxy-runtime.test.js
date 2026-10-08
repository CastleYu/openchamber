import { describe, expect, it, mock } from 'bun:test';
import { AGENT_ERROR, AGENT_ROUTE } from '../../web/server/lib/agent/constants.js';

const { handleProxyBridgeMessage } = await import('./bridge-proxy-runtime');

const createDeps = () => ({
  tryHandleLocalFsProxy: mock(() => Promise.resolve(null)),
  buildUnavailableApiResponse: mock(() => ({ status: 503, headers: {}, bodyText: '' })),
  sanitizeForwardHeaders: mock((headers) => headers || {}),
  collectHeaders: mock(() => ({})),
  base64EncodeUtf8: mock((text) => Buffer.from(text, 'utf8').toString('base64')),
});

describe('bridge proxy runtime', () => {
  it('refuses owned agent routes at the extension host before local or OpenCode forwarding', async () => {
    const deps = createDeps();
    for (const path of [AGENT_ROUTE.PREFIX, AGENT_ROUTE.RUNTIME, AGENT_ROUTE.DISPATCH, AGENT_ROUTE.SELECTION,
      '/agent-backend/runtime', '/api/x/../agent-backend/runtime', '/api/%61gent-backend/dispatch']) {
      const response = await handleProxyBridgeMessage(
        { id: path, type: 'api:proxy', payload: { method: 'POST', path } }, undefined, deps,
      );
      expect(response?.data).toMatchObject({ status: 501 });
      expect(JSON.parse(response?.data.bodyText)).toEqual({ error: AGENT_ERROR.UNSUPPORTED_RUNTIME });
    }
    expect(deps.tryHandleLocalFsProxy).not.toHaveBeenCalled();
    expect(deps.buildUnavailableApiResponse).not.toHaveBeenCalled();
  });

  it('blocks OC1 and OC2 provider connections in enterprise mode before proxying', async () => {
    const previous = process.env.OPENCHAMBER_ENTERPRISE_MODE;
    process.env.OPENCHAMBER_ENTERPRISE_MODE = '1';
    try {
      const deps = createDeps();
      for (const [method, path] of [
        ['PUT', '/api/auth/openai'],
        ['POST', '/api/provider/openai/oauth/authorize'],
        ['POST', '/api/provider/openai/oauth/callback'],
        ['POST', '/api/integration/example/connect'],
      ]) {
        const response = await handleProxyBridgeMessage({ id: path, type: 'api:proxy', payload: { method, path } }, undefined, deps);
        expect(response?.data?.status).toBe(403);
      }
      expect(deps.tryHandleLocalFsProxy).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.OPENCHAMBER_ENTERPRISE_MODE;
      else process.env.OPENCHAMBER_ENTERPRISE_MODE = previous;
    }
  });

  it('does not buffer SSE endpoints through the generic API proxy', async () => {
    const deps = createDeps();

    const response = await handleProxyBridgeMessage(
      { id: '1', type: 'api:proxy', payload: { method: 'GET', path: '/global/event?lastEventId=evt-1' } },
      undefined,
      deps,
    );

    expect(response?.success).toBe(true);
    expect(response?.data).toMatchObject({
      status: 400,
      headers: { 'content-type': 'application/json' },
      bodyText: JSON.stringify({ error: 'SSE requests must use api:sse:start' }),
    });
    expect(deps.tryHandleLocalFsProxy).not.toHaveBeenCalled();
    expect(deps.buildUnavailableApiResponse).not.toHaveBeenCalled();
  });

  it('never returns stored provider credentials to the webview', async () => {
    for (const path of ['/api/credential', '/API//%63redential/', '/api/x/../credential']) {
      const response = await handleProxyBridgeMessage(
        { id: path, type: 'api:proxy', payload: { method: 'GET', path } },
        undefined,
        createDeps(),
      );
      expect(response?.data).toMatchObject({ status: 403 });
      expect(JSON.parse(response?.data.bodyText).code).toBe('credential_list_refused');
    }
  });

  it('blocks credential writes in enterprise mode', async () => {
    const previous = process.env.OPENCHAMBER_ENTERPRISE_MODE;
    process.env.OPENCHAMBER_ENTERPRISE_MODE = '1';
    try {
      const response = await handleProxyBridgeMessage(
        { id: 'credential-write', type: 'api:proxy', payload: { method: 'POST', path: '/api/credential' } },
        undefined,
        createDeps(),
      );
      expect(response?.data).toMatchObject({ status: 403 });
      expect(JSON.parse(response?.data.bodyText).code).toBe('enterprise_mode');
    } finally {
      if (previous === undefined) delete process.env.OPENCHAMBER_ENTERPRISE_MODE;
      else process.env.OPENCHAMBER_ENTERPRISE_MODE = previous;
    }
  });
});
