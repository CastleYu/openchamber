import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { opencodeClient } from './client';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '../runtime-url';

const previous = getRuntimeUrlResolver();

beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://facade.test' });
  opencodeClient.reconnectToRuntimeBaseUrl();
  opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://facade.test', epoch: 1, version: '2.0.16' });
});

afterEach(() => {
  setRuntimeUrlResolver(previous);
  opencodeClient.reconnectToRuntimeBaseUrl();
});

describe('bound OC2 facade', () => {
  test('keeps the complete provider/model catalog and effective config', async () => {
    const provider = { id: 'p', name: 'Provider', models: { m: { id: 'm' } }, custom: { nested: true } };
    const model = { id: 'p/m', modelID: 'm', providerID: 'p', modalities: { input: ['text', 'image'], output: ['text'] }, cost: { input: 1, output: 2 }, variants: { fast: { maxTokens: 4096 } } };
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/integration') return Response.json({ data: [] });
      if (path === '/api/provider') return Response.json({ data: [provider] });
      if (path === '/api/model') return Response.json({ data: [model] });
      if (path === '/api/model/default') return Response.json({ data: model });
      if (path === '/api/config') return Response.json([
        { type: 'document', info: { agents: { base: { model: 'p/m' } } } },
        { type: 'document', info: { agents: { local: { model: 'p/m' } } } },
      ]);
      throw new Error(`Unexpected ${path}`);
    });
    try {
      const catalog = await opencodeClient.getProviderCatalog('/repo');
      expect(catalog.generation).toBe('oc2');
      if (catalog.generation === 'oc2') {
        expect(catalog.providers[0]).toEqual(provider);
        expect(catalog.models[0]).toEqual(model);
        expect(catalog.default).toEqual({ id: 'm', providerID: 'p' });
      }
      const config = await opencodeClient.getTaggedConfig('/repo');
      expect(config.generation).toBe('oc2');
      if (config.generation === 'oc2') expect(Object.keys(config.value.agents ?? {})).toEqual(['base', 'local']);
    } finally {
      fetch.mockRestore();
    }
  });

  test('waits for OC2 plugin activation before model and agent catalogs', async () => {
    const requests: string[] = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      if (path === '/api/integration') return Response.json({ data: [] });
      if (path === '/api/provider') return Response.json({ data: [{ id: 'fixture' }] });
      if (path === '/api/model') return Response.json({ data: [{ providerID: 'fixture', modelID: 'm' }] });
      if (path === '/api/model/default') return Response.json({ data: null });
      if (path === '/api/agent') return Response.json({ data: [{ id: 'build', name: 'Build' }] });
      throw new Error(`Unexpected ${path}`);
    });
    try {
      const catalog = await opencodeClient.getProviderCatalog('/repo');
      expect(catalog.generation).toBe('oc2');
      const agents = await opencodeClient.listTaggedAgents('/repo');
      expect(agents.generation).toBe('oc2');
      expect(requests[0]).toBe('/api/integration');
      expect(requests.slice(1, 4).sort()).toEqual(['/api/model', '/api/model/default', '/api/provider']);
      expect(requests.slice(4)).toEqual(['/api/integration', '/api/agent']);
    } finally {
      fetch.mockRestore();
    }
  });

  test('stops an OC2 catalog read when the runtime changes during plugin activation', async () => {
    const requests: string[] = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      if (path === '/api/integration') {
        opencodeClient.bindRuntime({ generation: 'oc2', endpoint: 'https://facade.test', epoch: 2, version: '2.0.16' });
        return Response.json({ data: [] });
      }
      throw new Error(`Unexpected ${path}`);
    });
    try {
      await expect(opencodeClient.getProviderCatalog('/repo')).rejects.toThrow('runtime changed');
      expect(requests).toEqual(['/api/integration']);
    } finally {
      fetch.mockRestore();
    }
  });

  test('does not turn a failed OC2 activation barrier into an empty catalog', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ error: 'activation failed' }, { status: 500 }));
    try {
      await expect(opencodeClient.getProviderCatalog('/repo')).rejects.toThrow();
    } finally {
      fetch.mockRestore();
    }
  });

  test('sends selection, synthetic context, and prompt through distinct OC2 routes', async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push({ path, body: await request.json() });
      if (path.endsWith('/model') || path.endsWith('/agent')) return new Response(null, { status: 204 });
      if (path.endsWith('/synthetic')) return Response.json({ data: { id: 'in_1' } });
      if (path.endsWith('/prompt')) return Response.json({ data: { id: 'in_2' } });
      throw new Error(`Unexpected ${path}`);
    });
    try {
      const id = await opencodeClient.sendMessage({
        id: 'ses_1', providerID: 'p', modelID: 'm', variant: 'fast', agent: 'build',
        text: 'hello', prefaceText: 'context', prefaceTextSynthetic: true, messageId: 'msg_1', directory: '/repo',
      });
      expect(id).toBe('msg_1');
      expect(requests.map(({ path }) => path)).toEqual([
        '/api/session/ses_1/model', '/api/session/ses_1/agent',
        '/api/session/ses_1/synthetic', '/api/session/ses_1/prompt',
      ]);
      expect(requests[0].body).toEqual({ model: { providerID: 'p', id: 'm', variant: 'fast' } });
      expect(requests[2].body).toMatchObject({ text: 'context', resume: false });
      expect(requests[3].body).toMatchObject({ id: 'msg_1', text: 'hello' });
    } finally {
      fetch.mockRestore();
    }
  });

  test('keeps form answers structured on the OC2 form route', async () => {
    const sent: Array<{ path: string; body: { choice: string; note: string } }> = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      sent.push({ path: new URL(request.url).pathname, body: await request.json() });
      return new Response(null, { status: 204 });
    });
    try {
      const answer = { choice: 'keep', note: 'explain' };
      await opencodeClient.replyToForm('ses_1', 'form_1', answer, '/repo');
      expect(sent[0]).toEqual({ path: '/api/session/ses_1/form/form_1/reply', body: { answer } });
    } finally {
      fetch.mockRestore();
    }
  });

  test('runs OC2 shell after selecting model and agent, with completion left to events', async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      requests.push({ path, body: await request.json() });
      return new Response(null, { status: 204 });
    });
    try {
      expect(await opencodeClient.shellSession({ sessionId: 'ses_1', directory: '/repo',
        command: 'pwd', agent: 'build', model: { providerID: 'p', modelID: 'm' }, messageId: 'msg_1' })).toBeUndefined();
      expect(requests).toEqual([
        { path: '/api/session/ses_1/model', body: { model: { providerID: 'p', id: 'm' } } },
        { path: '/api/session/ses_1/agent', body: { agent: 'build' } },
        { path: '/api/session/ses_1/shell', body: { id: 'msg_1', command: 'pwd' } },
      ]);
    } finally { fetch.mockRestore(); }
  });

  test('compacts OC2 through model selection and the compact admission route', async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      const body = await request.text();
      requests.push({ path, body: body ? JSON.parse(body) : null });
      return path.endsWith('/compact')
        ? Response.json({ data: { id: 'in_1', sessionID: 'ses_1', time: { created: 1 }, type: 'compaction', payload: {}, delivery: 'queue' } })
        : new Response(null, { status: 204 });
    });
    try {
      expect(await opencodeClient.summarizeSession('ses_1', 'p', 'm', '/repo')).toBe(true);
      expect(requests).toEqual([
        { path: '/api/session/ses_1/model', body: { model: { providerID: 'p', id: 'm' } } },
        { path: '/api/session/ses_1/compact', body: {} },
      ]);
    } finally { fetch.mockRestore(); }
  });

  test('maps OC2 file.find entries and refuses malformed file search success', async () => {
    const requests: Request[] = [];
    let invalidNext = false;
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (invalidNext) return Response.json({ wrong: true });
      return Response.json({ location: { directory: '/repo' }, data: [{ path: 'src/index.ts', type: 'file' }] });
    });
    try {
      expect(await opencodeClient.searchFiles('index', { directory: '/repo', type: 'file', limit: 5 })).toEqual([
        { name: 'index.ts', path: '/repo/src/index.ts', relativePath: 'src/index.ts', extension: 'ts' },
      ]);
      const url = new URL(requests[0].url);
      expect(url.pathname).toBe('/api/fs/find');
      expect(url.searchParams.get('query')).toBe('index');
      expect(url.searchParams.get('type')).toBe('file');
      expect(url.searchParams.get('limit')).toBe('5');
      expect(url.searchParams.get('location[directory]')).toBe('/repo');
      expect(requests[0].headers.get('x-opencode-directory')).toBe('%2Frepo');
      invalidNext = true;
      await expect(opencodeClient.searchFiles('index', { directory: '/repo' })).rejects.toThrow();
    } finally { fetch.mockRestore(); }
  });

  test('routes OC2 VCS and move while gating removed todo and LSP operations', async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      const body = await request.text();
      requests.push({ method: request.method, path, body: body ? JSON.parse(body) : null });
      if (path.endsWith('/move')) return new Response(null, { status: 204 });
      if (path === '/api/vcs') return Response.json({ location: { directory: '/repo' },
        data: { branch: { current: 'feature', default: 'main' } } });
      throw new Error(`Unexpected ${path}`);
    });
    try {
      await expect(opencodeClient.getSessionTodos('ses_1')).rejects.toThrow('session.todo');
      await expect(opencodeClient.getLspStatus('/repo')).rejects.toThrow('LSP status');
      expect(requests).toHaveLength(0);
      expect(await opencodeClient.getVcs('/repo')).toEqual({ branch: 'feature', defaultBranch: 'main' });
      await opencodeClient.moveSession('ses_1', '/other');
      expect(requests).toEqual([
        { method: 'GET', path: '/api/vcs', body: null },
        { method: 'POST', path: '/api/session/ses_1/move', body: { directory: '/other' } },
      ]);
    } finally { fetch.mockRestore(); }
  });

  test('updates OC2 metadata through the owned merge route and retains other namespaces', async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      const entry = { method: request.method, path };
      if (request.method === 'POST') requests.push({ ...entry, body: await request.json() });
      else requests.push(entry);
      if (path.endsWith('/metadata')) return Response.json({ metadata: { other: { keep: true }, feature: { new: true } } });
      if (path.endsWith('/ses_1')) return Response.json({ data: {
        id: 'ses_1', projectID: 'p', location: { directory: '/repo' }, title: 'Test',
        cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 2 }, metadata: { other: { keep: true }, feature: { new: true } },
      } });
      throw new Error(`Unexpected ${path}`);
    });
    try {
      const result = await opencodeClient.updateSession('ses_1', { metadata: { feature: null } }, '/repo');
      expect(result.metadata?.other).toEqual({ keep: true });
      expect(requests).toHaveLength(2);
      expect(requests[0]).toEqual({
        method: 'POST', path: '/api/openchamber/sessions/ses_1/metadata',
        body: { patch: { feature: null }, directory: '/repo' },
      });
      expect(requests[1]).toMatchObject({ method: 'GET', path: '/api/session/ses_1' });
    } finally {
      fetch.mockRestore();
    }
  });
});

test('OC1 paging keeps inclusive archive query and decreasing numeric cursor', async () => {
  opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://facade.test', epoch: 2, version: '1.18.32' });
  const requests: string[] = [];
  const row = (id: string, updated: number) => ({
    id, slug: id, version: '1.18.32', projectID: 'p', directory: '/repo', title: id,
    time: { created: 1, updated },
  });
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url.search);
    if (!url.searchParams.has('cursor')) return Response.json([row('one', 10)], { headers: { 'x-next-cursor': '10' } });
    return Response.json([row('two', 9)], { headers: { 'x-next-cursor': '10' } });
  });
  try {
    const first = await opencodeClient.listSessionsPage({ global: true, archived: true, roots: true, limit: 1 });
    expect(first.sessions.map((value) => value.id)).toEqual(['one']);
    expect(first.cursor.next).toBe('10');
    const second = await opencodeClient.listSessionsPage({ global: true, archived: true, roots: true, limit: 1, cursor: first.cursor.next });
    expect(second.sessions.map((value) => value.id)).toEqual(['two']);
    expect(second.cursor.next).toBeUndefined();
    expect(requests[0]).toContain('archived=true');
    expect(requests[0]).toContain('roots=true');
    expect(requests[1]).toContain('cursor=10');
  } finally {
    fetch.mockRestore();
  }
});

test('OC1 shell, summarize, and file search retain their legacy request and response shapes', async () => {
  opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://facade.test', epoch: 2, version: '1.18.32' });
  const requests: Array<{ path: string; body: unknown; search: URLSearchParams }> = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = await request.text();
    requests.push({ path: url.pathname, search: url.searchParams, body: body ? JSON.parse(body) : null });
    if (url.pathname.endsWith('/shell')) return Response.json({ info: {
      id: 'msg_1', sessionID: 'ses_1', role: 'assistant', parentID: 'msg_u', time: { created: 1, completed: 2 },
      modelID: 'm', providerID: 'p', mode: 'build', path: { cwd: '/repo', root: '/repo' }, cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }, parts: [{ id: 'part_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'text', text: 'output' }] });
    if (url.pathname.endsWith('/summarize')) return Response.json(true);
    if (url.pathname === '/api/find/file') return Response.json(['src/index.ts']);
    throw new Error(`Unexpected ${url.pathname}`);
  });
  try {
    const shell = await opencodeClient.shellSession({ sessionId: 'ses_1', directory: '/repo',
      command: 'pwd', agent: 'build', model: { providerID: 'p', modelID: 'm' }, messageId: 'msg_1' });
    expect(shell?.info.id).toBe('msg_1');
    expect(shell?.parts[0]).toMatchObject({ type: 'text', text: 'output' });
    expect(await opencodeClient.summarizeSession('ses_1', 'p', 'm', '/repo')).toBe(true);
    expect(await opencodeClient.searchFiles('index', { directory: '/repo', type: 'file', limit: 5 })).toEqual([
      { name: 'index.ts', path: '/repo/src/index.ts', relativePath: 'src/index.ts', extension: 'ts' },
    ]);
    expect(requests.map((item) => item.path)).toEqual([
      '/api/session/ses_1/shell', '/api/session/ses_1/summarize', '/api/find/file',
    ]);
    expect(requests[0].body).toMatchObject({ messageID: 'msg_1', agent: 'build',
      model: { providerID: 'p', modelID: 'm' }, command: 'pwd' });
    expect(requests[1].body).toMatchObject({ providerID: 'p', modelID: 'm' });
    expect(requests[2].search.get('dirs')).toBe('false');
  } finally { fetch.mockRestore(); }
});

test('OC1 keeps native todo, LSP, and VCS reads', async () => {
  opencodeClient.bindRuntime({ generation: 'oc1', endpoint: 'https://facade.test', epoch: 2, version: '1.18.32' });
  const paths: string[] = [];
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(new Request(input, init).url).pathname;
    paths.push(path);
    if (path.endsWith('/todo')) return Response.json([{ id: 'todo_1', content: 'Keep', status: 'pending', priority: 'medium' }]);
    if (path.includes('/lsp')) return Response.json([]);
    if (path.endsWith('/vcs')) return Response.json({ branch: 'legacy', default_branch: 'main' });
    throw new Error(`Unexpected ${path}`);
  });
  try {
    expect(await opencodeClient.getSessionTodos('ses_1')).toEqual([
      { id: 'todo_1', content: 'Keep', status: 'pending', priority: 'medium' },
    ]);
    expect(await opencodeClient.getLspStatus('/repo')).toEqual([]);
    expect(await opencodeClient.getVcs('/repo')).toEqual({ branch: 'legacy', defaultBranch: 'main' });
    expect(paths).toEqual(['/api/session/ses_1/todo', '/api/lsp', '/api/vcs']);
  } finally { fetch.mockRestore(); }
});
