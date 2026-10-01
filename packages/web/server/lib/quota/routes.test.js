import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { registerQuotaRoutes } from './routes.js';

describe('quota route runtime scope', () => {
  const setup = () => {
    const app = express();
    let identity = { generation: 'oc2', endpoint: 'http://local', epoch: 1 };
    const fetchQuotaForProvider = vi.fn(async () => ({ ok: true }));
    registerQuotaRoutes(app, {
      getQuotaProviders: async () => ({ fetchQuotaForProvider }),
      getKernelRuntime: () => identity,
    });
    return { app, fetchQuotaForProvider, setIdentity: (next) => { identity = next; } };
  };

  it('passes the captured generation and epoch to the provider registry', async () => {
    const { app, fetchQuotaForProvider } = setup();
    const response = await request(app).get('/api/quota/openrouter');
    expect(response.status).toBe(200);
    expect(fetchQuotaForProvider).toHaveBeenCalledWith('openrouter', { generation: 'oc2', endpoint: 'http://local', epoch: 1 });
  });

  it('rejects unresolved generation and a result from a previous runtime', async () => {
    const { app, fetchQuotaForProvider, setIdentity } = setup();
    setIdentity({ generation: 'unknown', endpoint: null, epoch: 2 });
    expect((await request(app).get('/api/quota/openrouter')).status).toBe(503);
    expect(fetchQuotaForProvider).not.toHaveBeenCalled();
    setIdentity({ generation: 'oc1', endpoint: 'http://local', epoch: 3 });
    fetchQuotaForProvider.mockImplementationOnce(async () => {
      setIdentity({ generation: 'oc2', endpoint: 'http://local', epoch: 4 });
      return { ok: true };
    });
    expect((await request(app).get('/api/quota/openrouter')).status).toBe(409);
  });
});
