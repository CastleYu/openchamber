import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '@/lib/runtime-url';
import { opencodeClient } from './client';
import { fetchUsageStats, resolveUsageProjectID } from './session-stats';
import { OpenCodeRuntimeChangedError, OpenCodeRuntimeError } from './runtime';

const previous = getRuntimeUrlResolver();
const report = {
  range: { from: 10, to: 20 }, sessions: 2, subagents: 1, prompts: 3, steps: 4,
  tokens: { input: 5, output: 6, reasoning: 7, cache: { read: 8, write: 9 } },
  cost: 0.5, tools: { calls: 0, succeeded: 0, failed: 0, unfinished: 0 },
  activeDays: 1, streak: 1, activity: [{ date: '2026-09-26', steps: 4 }], models: [],
};

beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://stats.test' });
  opencodeClient.reconnectToRuntimeBaseUrl();
});

afterEach(() => {
  setRuntimeUrlResolver(previous);
  opencodeClient.reconnectToRuntimeBaseUrl();
});

describe('OC2 usage stats SDK boundary', () => {
  test('rejects OC1 and unknown before any request', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: report }));
    try {
      await expect(fetchUsageStats({ timezone: 'UTC' })).rejects.toThrow(OpenCodeRuntimeError);
      opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://stats.test', epoch: 1, version: '1.18.32' });
      await expect(fetchUsageStats({ timezone: 'UTC' })).rejects.toThrow(OpenCodeRuntimeError);
      await expect(resolveUsageProjectID('/repo')).rejects.toThrow(OpenCodeRuntimeError);
      expect(fetch.mock.calls.length).toBe(0);
    } finally {
      fetch.mockRestore();
    }
  });

  test('uses typed session.stats query and maps the 2.0.16 report', async () => {
    opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://stats.test', epoch: 2, version: '2.0.16' });
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: report }));
    try {
      const result = await fetchUsageStats({ from: 10, to: 20, projectID: 'prj_1', timezone: 'Asia/Shanghai' });
      const request = new Request(fetch.mock.calls[0][0], fetch.mock.calls[0][1]);
      expect(new URL(request.url).pathname).toBe('/api/experimental/session/stats');
      const query = new URL(request.url).searchParams;
      expect(Object.fromEntries(query)).toEqual({ from: '10', to: '20', project: 'prj_1', timezone: 'Asia/Shanghai', tools: 'none' });
      expect(result.tokens).toEqual({ input: 5, output: 6, reasoning: 7, cacheRead: 8, cacheWrite: 9, total: 35 });
      expect(result.sessions).toBe(2);
    } finally {
      fetch.mockRestore();
    }
  });

  test('rejects a report from the previous epoch', async () => {
    opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://stats.test', epoch: 3, version: '2.0.16' });
    let resolve: (response: Response) => void = () => undefined;
    const response = new Promise<Response>((done) => { resolve = done; });
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(() => response);
    try {
      const pending = fetchUsageStats({ timezone: 'UTC' });
      opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://stats.test', epoch: 4, version: '2.0.16' });
      resolve(Response.json({ data: report }));
      await expect(pending).rejects.toThrow(OpenCodeRuntimeChangedError);
    } finally {
      fetch.mockRestore();
    }
  });
});
