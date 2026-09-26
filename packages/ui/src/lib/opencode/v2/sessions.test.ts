import { describe, expect, test } from 'bun:test';
import { OpenCode, type SessionInfo } from '@opencode/client';
import { OpenCodeRuntimeBinding } from '../runtime';
import { V2SessionOperations } from './sessions';

const session: SessionInfo = {
  id: 'ses_1', projectID: 'prj_1', location: { directory: '/work' },
  title: 'Test', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
};

const bind = () => {
  const binding = new OpenCodeRuntimeBinding();
  binding.set({ generation: 'oc2', endpoint: 'http://localhost:4099', epoch: 1, version: '2.0.16' });
  return binding;
};

describe('OC2 session adapter', () => {
  test('uses /api cursor pages and projects wire sessions without fabricating absent fields', async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const client = OpenCode.make({
      baseUrl: 'http://localhost:4099',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        requests.push({ method: request.method, path: `${url.pathname}${url.search}` });
        return Response.json({ data: [session], cursor: { previous: null, next: 'next-page' } });
      },
    });
    const sessions = new V2SessionOperations(() => client, bind());

    const page = await sessions.listPage({ limit: 4, cursor: 'start' }, { directory: '/work' });
    expect(page.sessions[0]).toEqual({
      id: 'ses_1', projectID: 'prj_1', directory: '/work', title: 'Test', cost: 0,
      tokens: session.tokens, time: { created: 1, updated: 2 },
    });
    expect(page.cursor).toEqual({ next: 'next-page' });
    expect(requests).toEqual([{ method: 'GET', path: '/api/session?limit=4&directory=%2Fwork&cursor=start' }]);
  });

  test('projects inline message parts and stops paging on a short final page', async () => {
    const client = OpenCode.make({
      baseUrl: 'http://localhost:4099',
      fetch: async () => Response.json({
        data: [{ id: 'msg_1', type: 'user', time: { created: 1 }, text: 'hello' }],
        cursor: { previous: null, next: 'unneeded' },
      }),
    });
    const page = await new V2SessionOperations(() => client, bind()).messages('ses_1', { limit: 2 });
    expect(page.items[0].info).toMatchObject({ id: 'msg_1', sessionID: 'ses_1', role: 'user' });
    expect(page.items[0].parts).toHaveLength(1);
    expect(page.cursor.next).toBeUndefined();
  });

  test('sends prompt to OC2 admission route with its delivery and signal', async () => {
    const requests: Array<{ path: string; method: string; body: unknown; signal: AbortSignal }> = [];
    const client = OpenCode.make({
      baseUrl: 'http://localhost:4099',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({ path: new URL(request.url).pathname, method: request.method, body: await request.json(), signal: request.signal });
        return Response.json({ data: { id: 'in_1', sessionID: 'ses_1', type: 'user', time: { created: 1 }, payload: { text: 'hello' }, delivery: 'steer' } });
      },
    });
    const controller = new AbortController();
    const result = await new V2SessionOperations(() => client, bind()).prompt(
      { sessionID: 'ses_1', text: 'hello', delivery: 'steer' }, { signal: controller.signal },
    );
    expect(result.id).toBe('in_1');
    expect(requests[0]).toMatchObject({ path: '/api/session/ses_1/prompt', method: 'POST', body: { text: 'hello', delivery: 'steer' } });
    expect(requests[0].signal.aborted).toBe(false);
  });

  test('keeps command, interrupt, and staged revert as distinct OC2 operations', async () => {
    const requests: Array<{ method: string; path: string; body: string }> = [];
    const client = OpenCode.make({
      baseUrl: 'http://localhost:4099',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({ method: request.method, path: new URL(request.url).pathname, body: await request.text() });
        const path = new URL(request.url).pathname;
        if (path.endsWith('/command') || path.endsWith('/revert/commit')) return new Response(null, { status: 204 });
        if (path.endsWith('/interrupt')) return Response.json({ interrupted: true });
        return Response.json({ data: { messageID: 'msg_1' } });
      },
    });
    const sessions = new V2SessionOperations(() => client, bind());

    await sessions.command({ sessionID: 'ses_1', name: 'test', text: 'hello' });
    expect(await sessions.interrupt('ses_1')).toEqual({ interrupted: true });
    expect(await sessions.stageRevert({ sessionID: 'ses_1', messageID: 'msg_1', files: true })).toEqual({ messageID: 'msg_1' });
    await sessions.commitRevert('ses_1');
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /api/session/ses_1/command',
      'POST /api/session/ses_1/interrupt',
      'POST /api/session/ses_1/revert/stage',
      'POST /api/session/ses_1/revert/commit',
    ]);
    expect(JSON.parse(requests[2].body)).toEqual({ messageID: 'msg_1', files: true });
  });
});
