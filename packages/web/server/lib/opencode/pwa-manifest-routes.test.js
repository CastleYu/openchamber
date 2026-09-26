import { describe, expect, it } from 'vitest';
import { registerPwaManifestRoute } from './pwa-manifest-routes.js';
import { createKernelOperations } from './kernel-operations.js';

const createResponse = () => ({
  headers: new Map(),
  contentType: '',
  body: '',
  setHeader(name, value) {
    this.headers.set(name, value);
    return this;
  },
  type(value) {
    this.contentType = value;
    return this;
  },
  send(value) {
    this.body = value;
    return this;
  },
});

describe('PWA manifest route', () => {
  it('does not fall back to unrelated global session shortcuts for scoped manifests', async () => {
    const routes = new Map();
    const app = {
      get(route, handler) {
        routes.set(route, handler);
      },
    };
    const fetchCalls = [];
    const identity = { generation: 'oc1', endpoint: 'https://opencode.fixture', epoch: 1 };
    const kernelOperations = {
      captureIdentity: () => identity,
      listSessions: async ({ directory }) => {
        fetchCalls.push(directory);
        const sessions = directory
        ? []
        : [
            {
              id: 'other-session',
              title: 'Other project',
              directory: '/workspace/other',
              time: { updated: 2 },
            },
          ];
        return { ...identity, data: { items: sessions, cursor: {} } };
      },
    };

      registerPwaManifestRoute(app, {
        resolveProjectDirectory: async () => ({ directory: '/workspace/app' }),
        kernelOperations,
        readSettingsFromDiskMigrated: async () => ({}),
        normalizePwaAppName: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
        normalizePwaOrientation: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
      });

      const handler = routes.get('/manifest.webmanifest');
      const res = createResponse();
      await handler({ query: {} }, res);

      const manifest = JSON.parse(res.body);
      expect(fetchCalls).toEqual(['/workspace/app', undefined]);
      expect(manifest.shortcuts).toEqual([
        {
          name: 'Appearance Settings',
          short_name: 'Settings',
          description: 'Open appearance settings',
          url: '/?settings=appearance',
          icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
        },
      ]);
  });

  it('includes child session shortcuts for root-scoped manifests', async () => {
    const routes = new Map();
    const app = {
      get(route, handler) {
        routes.set(route, handler);
      },
    };
    const fetchCalls = [];
    const identity = { generation: 'oc1', endpoint: 'https://opencode.fixture', epoch: 1 };
    const kernelOperations = {
      captureIdentity: () => identity,
      listSessions: async ({ directory }) => {
        fetchCalls.push(directory);
        return { ...identity, data: { items: [
          {
            id: 'root-child',
            title: 'Root child',
            directory: '/workspace/app',
            time: { updated: 2 },
          },
        ], cursor: {} } };
      },
    };

      registerPwaManifestRoute(app, {
        resolveProjectDirectory: async () => ({ directory: '/' }),
        kernelOperations,
        readSettingsFromDiskMigrated: async () => ({}),
        normalizePwaAppName: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
        normalizePwaOrientation: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
      });

      const handler = routes.get('/manifest.webmanifest');
      const res = createResponse();
      await handler({ query: {} }, res);

      const manifest = JSON.parse(res.body);
      expect(fetchCalls).toEqual(['/']);
      expect(manifest.shortcuts).toContainEqual({
        name: 'Root child',
        short_name: 'Root child',
        description: 'Open recent session',
        url: '/?session=root-child',
        icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
      });
  });

  it.each(['oc1', 'oc2'])('reads %s recent sessions through its real HTTP page contract', async (generation) => {
    const routes = new Map();
    const app = { get: (route, handler) => routes.set(route, handler) };
    const requests = [];
    const endpoint = 'https://opencode.fixture';
    const row = (id, updated) => generation === 'oc1'
      ? { id, slug: id, projectID: 'p', directory: '/workspace/app', version: '1.18.32', title: id,
        time: { created: 1, updated } }
      : { id, projectID: 'p', location: { directory: '/workspace/app' }, title: id,
        time: { created: 1, updated } };
    const kernelOperations = createKernelOperations({
      getRuntime: () => ({ generation, endpoint, epoch: 1 }),
      getHeaders: () => ({ Authorization: 'Bearer fixture' }),
      fetchImpl: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        requests.push({ path: url.pathname, search: url.searchParams,
          headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)) });
        if (generation === 'oc1') return Response.json([row('legacy', 3)]);
        return Response.json(url.searchParams.has('cursor')
          ? { data: [row('second', 4)], cursor: { previous: null, next: null } }
          : { data: [row('first', 2)], cursor: { previous: null, next: 'page_two' } });
      },
    });
    registerPwaManifestRoute(app, {
      resolveProjectDirectory: async () => ({ directory: '/workspace/app' }), kernelOperations,
      readSettingsFromDiskMigrated: async () => ({}),
      normalizePwaAppName: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
      normalizePwaOrientation: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
    });
    const res = createResponse();
    await routes.get('/manifest.webmanifest')({ query: {} }, res);
    const shortcuts = JSON.parse(res.body).shortcuts.filter((item) => item.description === 'Open recent session');
    expect(shortcuts.map((item) => item.name)).toEqual(generation === 'oc1' ? ['legacy'] : ['second', 'first']);
    expect(requests.map((item) => item.path)).toEqual(generation === 'oc1'
      ? ['/session'] : ['/api/session', '/api/session']);
    expect(requests[0].search.get('directory')).toBe('/workspace/app');
    if (generation === 'oc2') {
      expect(requests[1].search.get('cursor')).toBe('page_two');
      expect(requests.every((item) => item.headers.get('x-opencode-directory') === '%2Fworkspace%2Fapp')).toBe(true);
    }
  });

  it('drops a stale page and does not cache a failed read as an empty manifest', async () => {
    const routes = new Map();
    const app = { get: (route, handler) => routes.set(route, handler) };
    const endpoint = 'https://opencode.fixture';
    let epoch = 1;
    let reads = 0;
    const kernelOperations = createKernelOperations({
      getRuntime: () => ({ generation: 'oc2', endpoint, epoch }), getHeaders: () => ({}),
      fetchImpl: async () => {
        reads += 1;
        if (reads === 1) { epoch = 2; return Response.json({ data: [], cursor: {} }); }
        return Response.json({ data: [{ id: 'fresh', location: { directory: '/workspace/app' }, title: 'Fresh',
          time: { created: 1, updated: 2 } }], cursor: {} });
      },
    });
    registerPwaManifestRoute(app, {
      resolveProjectDirectory: async () => ({ directory: '/workspace/app' }), kernelOperations,
      readSettingsFromDiskMigrated: async () => ({}),
      normalizePwaAppName: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
      normalizePwaOrientation: (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback,
    });
    const handler = routes.get('/manifest.webmanifest');
    const stale = createResponse();
    await handler({ query: {} }, stale);
    expect(JSON.parse(stale.body).shortcuts.filter((item) => item.description === 'Open recent session')).toEqual([]);
    const fresh = createResponse();
    await handler({ query: {} }, fresh);
    expect(JSON.parse(fresh.body).shortcuts).toContainEqual(expect.objectContaining({ name: 'Fresh' }));
    expect(reads).toBe(2);
  });
});
