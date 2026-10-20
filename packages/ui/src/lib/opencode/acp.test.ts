import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { AcpClient } from './acp';
import { opencodeClient } from './client';
import { OpenCodeRuntimeChangedError } from './runtime';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '../runtime-url';
import { z } from 'zod';

const previous = getRuntimeUrlResolver();
const session = { id: 's/1', projectID: '/repo', directory: '/repo', title: 'Saved', time: { created: 1, updated: 2 }, metadata: { tag: 'local' } };
const controls = {
  configOptions: [{ id: 'model', name: 'Model', type: 'select', currentValue: 'small', options: [{ group: 'models', name: 'Models', options: [{ value: 'small', name: 'Small' }] }] }],
  commands: [{ name: 'undo', description: 'Agent-owned undo', input: null }],
  usage: { used: 1250, size: 32000, cost: { amount: 0.2, currency: 'USD' } },
  capabilities: { load: true, resume: true, delete: false },
};

beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://acp.test' });
  opencodeClient.reconnectToRuntimeBaseUrl();
  opencodeClient.bindRuntime({ generation: 'acp', endpoint: 'acp:test', epoch: 1, version: null });
});
afterEach(() => { setRuntimeUrlResolver(previous); opencodeClient.reconnectToRuntimeBaseUrl(); });

describe('ACP domain operations', () => {
  test('rename, metadata, archive and removal use ACP routes with full fidelity', async () => {
    const requests: Array<{ path: string; body: string | null }> = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      requests.push({ path: new URL(request.url).pathname, body: request.method === 'POST' ? await request.text() : null });
      return Response.json(request.url.endsWith('/delete') ? true : session);
    });
    try {
      const patch = { title: 'Renamed', metadata: { tag: 'local' }, time: { archived: 0 } };
      expect((await opencodeClient.updateSession(session.id, patch)).metadata).toEqual({ tag: 'local' });
      expect(await opencodeClient.deleteSession(session.id)).toBe(true);
      expect(requests).toEqual([
        { path: '/api/acp/sessions/s%2F1/update', body: JSON.stringify(patch) },
        { path: '/api/acp/sessions/s%2F1/delete', body: '{}' },
      ]);
    } finally { fetch.mockRestore(); }
  });

  test('configuration replaces dependent choices and preserves supplied usage and nullable command input', async () => {
    const replacement = { ...controls, configOptions: [{ id: 'reasoning', name: 'Reasoning', type: 'select', currentValue: 'high', options: [{ value: 'high', name: 'High' }] }] };
    const requests: string[] = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === 'POST') requests.push(await request.text());
      return Response.json(request.url.endsWith('/config') ? replacement : controls);
    });
    try {
      expect(await opencodeClient.getAcpControls(session.id)).toEqual(controls);
      expect((await opencodeClient.setAcpConfig(session.id, 'model', 'large')).configOptions).toEqual(replacement.configOptions);
      expect(requests).toEqual(['{"configId":"model","value":"large"}']);
    } finally { fetch.mockRestore(); }
  });

  test('malformed or failed authoritative controls do not become empty success', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ...controls, usage: { used: 'invalid', size: 10 } }));
    try {
      await expect(opencodeClient.getAcpControls(session.id)).rejects.toThrow();
      fetch.mockResolvedValue(Response.json({ error: 'offline' }, { status: 503 }));
      await expect(opencodeClient.getAcpControls(session.id)).rejects.toThrow('503');
    } finally { fetch.mockRestore(); }
  });

  test('runtime switching rejects an old controls response', async () => {
    let resolve: (response: Response) => void = () => {};
    const response = new Promise<Response>((done) => { resolve = done; });
    const fetch = spyOn(globalThis, 'fetch');
    fetch.mockImplementation(() => response);
    try {
      const pending = opencodeClient.getAcpControls(session.id);
      opencodeClient.bindRuntime({ generation: 'acp', endpoint: 'acp:other', epoch: 2, version: null });
      resolve(Response.json(controls));
      await expect(pending).rejects.toThrow(OpenCodeRuntimeChangedError);
    } finally { fetch.mockRestore(); }
  });

  test('literal slash commands reach ACP prompt before supplemental context', async () => {
    let text = '';
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      expect(new URL(request.url).pathname).toBe('/api/acp/prompt');
      const body = z.object({ text: z.string() }).parse(await request.json());
      text = body.text;
      return Response.json({ messageID: 'user' });
    });
    try {
      await opencodeClient.sendMessage({ id: session.id, providerID: '', modelID: '', text: '/undo  exact spacing', prefaceText: 'Project context', messageId: 'user' });
      expect(text).toBe('/undo  exact spacing\n\nProject context');
    } finally { fetch.mockRestore(); }
  });

  test('refresh, deletion and transcript replay facts pass the SSE domain boundary', async () => {
    const facts = ['session-refresh', 'session-delete', 'transcript-refresh'].map((type) => ({ type, sessionID: session.id, directory: '/repo', eventID: type }));
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(facts.map((fact) => `data: ${JSON.stringify(fact)}\n\n`).join('')));
    try {
      const events = [];
      for await (const event of new AcpClient().events(new AbortController().signal)) events.push(event);
      expect(events).toEqual(facts);
    } finally { fetch.mockRestore(); }
  });

  test('completed tool diffs survive both transcript and event parsing', async () => {
    const metadata = { acp: true, diffs: [{ type: 'diff', path: 'file.txt', oldText: null, newText: 'added' }] };
    const part = { id: 'tool', sessionID: session.id, messageID: 'assistant', type: 'tool', callID: 'call', tool: 'edit', state: { status: 'completed', input: {}, title: 'Edit', output: 'added', metadata, time: { start: 1, end: 2 } } };
    const fact = { type: 'part-upsert', part, eventID: 'tool-diff' };
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).endsWith('/events')
      ? new Response(`data: ${JSON.stringify(fact)}\n\n`)
      : Response.json([{ info: { id: 'assistant', sessionID: session.id, role: 'assistant', agent: 'agent', providerID: 'acp', modelID: 'agent', time: { created: 1 } }, parts: [part] }]));
    try {
      const client = new AcpClient();
      expect((await client.messages(session.id))[0]?.parts[0]).toEqual(part);
      const events = [];
      for await (const event of client.events(new AbortController().signal)) events.push(event);
      expect(events).toEqual([fact]);
    } finally { fetch.mockRestore(); }
  });

  test('streamed terminal output and plan todos survive transcript and SSE parsing', async () => {
    const running = { id: 'terminal', sessionID: session.id, messageID: 'assistant', type: 'tool', callID: 'run', tool: 'execute', state: { status: 'running', input: {}, metadata: { acp: true, output: 'bounded live output', diffs: [{ type: 'diff', path: 'file', oldText: 'old', newText: 'new' }] }, time: { start: 1 } } };
    const plan = { id: 'plan', sessionID: session.id, messageID: 'assistant', type: 'tool', callID: 'plan', tool: 'todowrite', state: { status: 'completed', input: { todos: [{ content: 'Verify', status: 'in_progress', priority: 'high' }] }, output: '', time: { start: 1, end: 2 } } };
    const parts = [running, plan];
    const facts = parts.map((part) => ({ type: 'part-upsert', part, eventID: part.id }));
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).endsWith('/events')
      ? new Response(facts.map((fact) => `data: ${JSON.stringify(fact)}\n\n`).join(''))
      : Response.json([{ info: { id: 'assistant', sessionID: session.id, role: 'assistant', agent: 'agent', providerID: 'acp', modelID: 'agent', time: { created: 1 } }, parts }]));
    try {
      const client = new AcpClient();
      expect((await client.messages(session.id))[0]?.parts).toEqual(parts);
      const events = [];
      for await (const event of client.events(new AbortController().signal)) events.push(event);
      expect(events).toEqual(facts);
    } finally { fetch.mockRestore(); }
  });
});
