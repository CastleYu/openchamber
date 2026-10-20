import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http2';
import { WebSocketServer } from 'ws';
import { createAcpRuntime } from './runtime.js';

const wait = (runtime, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error('Missing ACP fact')); }, 5000);
  const off = runtime.subscribe((event) => { if (predicate(event)) { clearTimeout(timer); off(); resolve(event); } });
});
const fixture = async (t, transport, resume = false) => {
  const calls = [];
  let send;
  let pending;
  let deleted = false;
  const handle = (value) => {
    calls.push(value);
    const result = (body) => send({ jsonrpc: '2.0', id: value.id, result: body }, value.params?.sessionId);
    if (value.method === 'initialize') {
      const agentCapabilities = { loadSession: true };
      if (resume) agentCapabilities.sessionCapabilities = { resume: {} };
      return { jsonrpc: '2.0', id: value.id, result: { protocolVersion: 1, agentInfo: { name: 'remote', version: 'test' }, agentCapabilities } };
    }
    if (value.method === 'session/new') result({ sessionId: 'remote-session' });
    if (value.method === 'session/load' || value.method === 'session/resume') send({ jsonrpc: '2.0', id: value.id, result: {} });
    if (value.method === 'session/prompt') {
      pending = value;
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'remote-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'remote text' } } } }, 'remote-session');
      send({ jsonrpc: '2.0', id: 900, method: 'session/request_permission', params: { sessionId: 'remote-session', toolCall: { toolCallId: 'read' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }] } }, 'remote-session');
    }
    if (value.id === 900 && value.result?.outcome.outcome === 'selected') send({ jsonrpc: '2.0', id: pending.id, result: { stopReason: 'end_turn' } }, 'remote-session');
    if (value.method === 'session/cancel') send({ jsonrpc: '2.0', id: pending.id, result: { stopReason: 'cancelled' } }, 'remote-session');
  };
  let server;
  let drop;
  if (transport === 'websocket') {
    server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    server.on('connection', (socket) => {
      send = (value) => socket.send(JSON.stringify(value));
      drop = () => socket.terminate();
      socket.on('message', (data) => { const init = handle(JSON.parse(data.toString())); if (init) send(init); });
    });
  } else {
    server = createServer();
    const streams = new Map();
    const queue = new Map();
    const peers = new Set();
    server.on('session', (peer) => { peers.add(peer); peer.on('close', () => peers.delete(peer)); });
    drop = () => { for (const peer of peers) peer.destroy(); };
    send = (value, id = '') => {
      const data = `data: ${JSON.stringify(value)}\r\n\r\n`;
      if (streams.has(id)) streams.get(id).write(data);
      else queue.set(id, [...(queue.get(id) ?? []), data]);
    };
    server.on('stream', (stream, headers) => {
      const method = headers[':method'];
      const id = headers['acp-session-id'] ?? '';
      if (method === 'GET') {
        assert.equal(headers['acp-connection-id'], 'connection-1');
        streams.set(id, stream);
        stream.once('close', () => { if (streams.get(id) === stream) streams.delete(id); });
        stream.respond({ ':status': 200, 'content-type': 'text/event-stream' });
        for (const data of queue.get(id) ?? []) stream.write(data);
        queue.delete(id);
        return;
      }
      if (method === 'DELETE') { deleted = true; stream.respond({ ':status': 204 }); stream.end(); return; }
      let body = '';
      stream.setEncoding('utf8'); stream.on('data', (data) => { body += data; });
      stream.on('end', () => {
        const value = JSON.parse(body);
        if (value.method === 'session/load' || value.method === 'session/resume') assert.equal(id, '');
        else if (value.method?.startsWith('session/') && value.params?.sessionId) assert.equal(id, value.params.sessionId);
        if (value.id === 900) assert.equal(id, 'remote-session');
        const init = handle(value);
        stream.respond(init ? { ':status': 200, 'content-type': 'application/json', 'acp-connection-id': 'connection-1' } : { ':status': 202 });
        stream.end(init ? JSON.stringify(init) : undefined);
      });
    });
    server.listen(0, '127.0.0.1');
  }
  await new Promise((resolve) => server.once('listening', resolve));
  const runtime = createAcpRuntime();
  t.after(async () => { await runtime.stop(); drop?.(); await new Promise((resolve) => server.close(resolve)); });
  const url = `${transport === 'http' ? 'http' : 'ws'}://127.0.0.1:${server.address().port}/acp`;
  await runtime.start({ mode: 'acp-server', transport, url, cwd: '/remote/project' });
  return { runtime, calls, drop, deleted: () => deleted, restart: () => runtime.start({ mode: 'acp-server', transport, url, cwd: '/remote/project' }) };
};

for (const transport of ['websocket', 'http']) {
  test(`${transport}: negotiated resume restores saved history at the connection setup boundary`, async (t) => {
    const { runtime, calls, restart } = await fixture(t, transport, true);
    const session = await runtime.createSession({ directory: process.cwd() });
    await runtime.stop(); await restart();
    await runtime.open(session.id);
    const resume = calls.find((value) => value.method === 'session/resume');
    assert.equal(resume.params.cwd, '/remote/project');
    assert.equal(calls.some((value) => value.method === 'session/load'), false);
    const asked = wait(runtime, (event) => event.type === 'permission-asked');
    await runtime.prompt({ sessionID: session.id, messageID: 'after-resume', text: 'continue' });
    const permission = await asked;
    const done = wait(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
    await runtime.reply(permission.request.value.id, 'allow'); await done;
  });
  test(`${transport}: remote initialize, cwd, streaming, permission, cancellation and owned disconnect`, async (t) => {
    const { runtime, calls, deleted, restart } = await fixture(t, transport);
    assert.equal(runtime.directory(), process.cwd());
    const session = await runtime.createSession({ directory: process.cwd() });
    assert.equal(calls.find((call) => call.method === 'session/new').params.cwd, '/remote/project');
    assert.equal(session.directory, process.cwd());
    await assert.rejects(runtime.prompt({ sessionID: session.id, messageID: 'bad', text: '', files: [{ url: 'file:///local.txt' }] }), /Local file/);
    const asked = wait(runtime, (event) => event.type === 'permission-asked');
    await runtime.prompt({ sessionID: session.id, messageID: 'one', text: 'hello' });
    const permission = await asked;
    const done = wait(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
    await runtime.reply(permission.request.value.id, 'allow');
    await done;
    assert.equal(runtime.messages(session.id)[1].parts[0].text, 'remote text');
    const second = wait(runtime, (event) => event.type === 'permission-asked');
    await runtime.prompt({ sessionID: session.id, messageID: 'two', text: 'cancel' });
    await second;
    const cancelled = wait(runtime, (event) => event.type === 'status' && event.outcome === 'interrupted');
    await runtime.cancel(session.id); await cancelled;
    await runtime.stop(); await restart();
    const resumed = wait(runtime, (event) => event.type === 'permission-asked');
    await runtime.prompt({ sessionID: session.id, messageID: 'three', text: 'resume' });
    const third = await resumed;
    assert.equal(calls.find((call) => call.method === 'session/load').params.cwd, '/remote/project');
    const resumedDone = wait(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
    await runtime.reply(third.request.value.id, 'allow'); await resumedDone;
    await runtime.stop();
    assert.equal(runtime.descriptor().generation, 'unreachable');
    if (transport === 'http') assert.equal(deleted(), true);
  });
  test(`${transport}: server disconnect fails a live prompt and clears permissions`, async (t) => {
    const { runtime, drop } = await fixture(t, transport);
    const session = await runtime.createSession({ directory: process.cwd() });
    const asked = wait(runtime, (event) => event.type === 'permission-asked');
    await runtime.prompt({ sessionID: session.id, messageID: 'one', text: 'hello' }); await asked;
    const failed = wait(runtime, (event) => event.type === 'status' && event.outcome === 'failed');
    drop(); await failed;
    assert.equal(runtime.descriptor().generation, 'unreachable');
    assert.deepEqual(runtime.permissions(), []);
  });
}
