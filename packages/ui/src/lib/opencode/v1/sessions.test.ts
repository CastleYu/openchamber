import { describe, expect, test } from 'bun:test';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import { V1SessionOperations } from './sessions';

describe('OC1 session adapter', () => {
  test('keeps old SDK path, directory, and message query', async () => {
    const requests: Array<{ method: string; path: string; body: string }> = [];
    const client = createOpencodeClient({
      baseUrl: 'http://localhost:4099',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        requests.push({ method: request.method, path: `${url.pathname}${url.search}`, body: await request.text() });
        if (url.pathname.endsWith('/message')) return Response.json([]);
        return Response.json([{ id: 'ses_1', directory: '/work' }]);
      },
    });
    const sessions = new V1SessionOperations(client);

    expect(await sessions.list({ directory: '/work' })).toHaveLength(1);
    expect(await sessions.messages('ses_1', 4, { directory: '/work' })).toEqual([]);
    expect(requests).toEqual([
      { method: 'GET', path: '/session?directory=%2Fwork', body: '' },
      { method: 'GET', path: '/session/ses_1/message?directory=%2Fwork&limit=4', body: '' },
    ]);
  });

  test('does not turn failed reads into empty success', async () => {
    const client = createOpencodeClient({
      baseUrl: 'http://localhost:4099',
      fetch: async () => Response.json({ name: 'Failure', data: { message: 'unavailable' } }, { status: 503 }),
    });
    await expect(new V1SessionOperations(client).list({ directory: '/work' })).rejects.toThrow('session.list failed');
  });

  test('keeps OC1 create and update fields without inventing archive null writes', async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const client = createOpencodeClient({
      baseUrl: 'http://localhost:4099',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        requests.push({ method: request.method, path: `${url.pathname}${url.search}`, body: await request.json() });
        return Response.json({ id: 'ses_1', directory: '/work' });
      },
    });
    const sessions = new V1SessionOperations(client);

    await sessions.create({ parentID: 'ses_parent', title: 'Child', metadata: { pinned: true } }, { directory: '/work' });
    await sessions.update('ses_1', { title: 'Renamed', time: { archived: null } }, { directory: '/work' });
    expect(requests).toEqual([
      { method: 'POST', path: '/session?directory=%2Fwork', body: { parentID: 'ses_parent', title: 'Child', metadata: { pinned: true } } },
      { method: 'PATCH', path: '/session/ses_1?directory=%2Fwork', body: { title: 'Renamed' } },
    ]);
  });
});
