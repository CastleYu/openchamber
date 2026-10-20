import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createAcpRuntime } from './runtime.js';

const fixture = fileURLToPath(new URL('./fixtures/callback-agent.mjs', import.meta.url));
const wait = (runtime, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error('Missing callback runtime fact')); }, 10000);
  const off = runtime.subscribe((event) => { if (predicate(event)) { clearTimeout(timer); off(); resolve(event); } });
});
const setup = async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'acp-wiring-'));
  const storagePath = join(folder, 'sessions.json');
  const runtime = createAcpRuntime({ storagePath });
  const config = { command: process.execPath, args: [fixture], cwd: folder };
  t.after(async () => { await runtime.stop(); await rm(folder, { recursive: true, force: true }); });
  await runtime.start(config);
  return { folder, storagePath, runtime, config };
};

test('stdio callbacks validate requests, project bounded terminal output and replace active/replayed plans', async (t) => {
  const { folder, runtime, storagePath, config } = await setup(t);
  const project = join(folder, 'project'); await mkdir(project);
  const session = await runtime.createSession({ directory: project });
  const events = []; runtime.subscribe((event) => events.push(event));
  const done = wait(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
  await runtime.prompt({ sessionID: session.id, messageID: 'normal', text: 'normal' }); await done;
  const assistant = runtime.messages(session.id)[1];
  const report = JSON.parse(assistant.parts.find((part) => part.type === 'text').text);
  assert.deepEqual(report.capabilities.fs, { readTextFile: true, writeTextFile: true });
  assert.equal(report.capabilities.terminal, true);
  assert.deepEqual(report.capabilities.elicitation, { form: {}, url: {} });
  assert.equal(report.invalid, -32602); assert.equal(report.permission, -32602); assert.equal(report.outside, -32603);
  assert.equal(report.read.content, 'second\n');
  assert.equal(await readFile(join(project, 'callback.txt'), 'utf8'), 'file callback ✓\nsecond\n');
  const tool = assistant.parts.find((part) => part.callID === 'terminal');
  assert.match(tool.state.output, /first\nsecond ✓/);
  assert.equal(tool.state.output.includes('changed.txt'), false);
  assert.equal(tool.state.metadata.acp, true);
  assert.equal(tool.state.metadata.diffs[0].oldText, 'old');
  assert.equal(tool.state.metadata.output, undefined);
  assert.ok(events.some((event) => event.type === 'part-upsert' && event.part.state?.status === 'running' && event.part.state.metadata.output.includes('second ✓')));
  assert.ok(events.some((event) => event.type === 'part-upsert' && event.part.state?.status === 'running' && event.part.state.metadata.acp === true));
  const plans = assistant.parts.filter((part) => part.tool === 'todowrite');
  assert.equal(plans.length, 1); assert.equal(plans[0].state.input.todos[0].status, 'completed');
  const planEvents = events.filter((event) => event.type === 'part-upsert' && event.part.tool === 'todowrite');
  assert.equal(planEvents.length, 2); assert.equal(planEvents[0].part.id, planEvents[1].part.id);
  await runtime.stop();
  assert.match(await readFile(storagePath, 'utf8'), /second ✓/);
  await runtime.start(config); await runtime.open(session.id);
  const replayed = runtime.messages(session.id)[1].parts;
  assert.equal(replayed.length, 1); assert.equal(replayed[0].tool, 'todowrite');
  assert.equal(replayed[0].state.input.todos[0].status, 'completed');
});

for (const action of ['cancel', 'disconnect', 'switch']) test(`${action} releases owned terminal children`, async (t) => {
  const { folder, runtime, config } = await setup(t);
  const session = await runtime.createSession({ directory: folder });
  const output = wait(runtime, (event) => event.type === 'part-upsert' && event.part.callID === 'terminal' && /^\d+/.test(event.part.state.metadata?.output ?? ''));
  await runtime.prompt({ sessionID: session.id, messageID: action, text: action === 'disconnect' ? 'disconnect' : 'hold' });
  const event = await output;
  const pid = Number(/^\d+/.exec(event.part.state.metadata.output)[0]);
  if (action === 'cancel') await runtime.cancel(session.id);
  else if (action === 'switch') await runtime.start(config);
  else { if (runtime.descriptor().generation !== 'unreachable') await wait(runtime, (event) => event.type === 'connection-inputs' && Boolean(event.error)); await runtime.stop(); }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  if (action !== 'disconnect') assert.equal(runtime.descriptor().generation, 'acp');
});

test('remote mappings scope discovery and keep restored cwd across mapping edits without callbacks', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'acp-remote-wiring-'));
  const runtime = createAcpRuntime({ storagePath: join(folder, 'sessions.json') });
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const calls = [];
  let count = 0;
  server.on('connection', (socket) => socket.on('message', (data) => {
    const value = JSON.parse(data.toString()); calls.push(value);
    const reply = (result) => socket.send(JSON.stringify({ jsonrpc: '2.0', id: value.id, result }));
    if (value.method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } } });
    if (value.method === 'session/new') reply({ sessionId: `remote-${++count}` });
    if (value.method === 'session/load') reply({});
    if (value.method === 'session/list') {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'local-callback', method: 'fs/read_text_file', params: { sessionId: 'remote-1', path: join(folder, 'secret') } }));
      reply({ sessions: [{ sessionId: `discovered-${value.params.cwd}`, cwd: value.params.cwd }, { sessionId: 'wrong-root', cwd: '/unrelated' }] });
    }
  }));
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await runtime.stop(); await new Promise((resolve) => server.close(resolve)); await rm(folder, { recursive: true, force: true }); });
  const a = join(folder, 'A'), b = join(folder, 'B'), other = join(folder, 'unmapped');
  const config = { mode: 'acp-server', transport: 'websocket', url: `ws://127.0.0.1:${server.address().port}/acp`, cwd: '/default', projectMappings: [{ directory: a, cwd: '/remote/a' }, { directory: b, cwd: '/remote/b' }] };
  await runtime.start(config);
  const first = await runtime.createSession({ directory: a });
  await runtime.createSession({ directory: b }); await runtime.createSession({ directory: other });
  assert.deepEqual(calls.filter((value) => value.method === 'session/new').map((value) => value.params.cwd), ['/remote/a', '/remote/b', '/default']);
  for (const scope of [a, b, other]) { const result = await runtime.discover(scope); assert.equal(result.length, 2); assert.ok(result.every((value) => value.directory === scope)); }
  assert.deepEqual(calls.filter((value) => value.method === 'session/list').map((value) => value.params.cwd), ['/remote/a', '/remote/b', '/default']);
  assert.equal(runtime.sessions().some((value) => value.id === 'wrong-root'), false);
  await runtime.start({ ...config, projectMappings: [{ directory: a, cwd: '/remote/new-a' }, { directory: b, cwd: '/remote/b' }] });
  assert.equal(runtime.session(first.id).directory, a);
  await runtime.open(first.id);
  assert.equal(calls.find((value) => value.method === 'session/load').params.cwd, '/remote/a');
  await runtime.createSession({ directory: a });
  assert.equal(calls.filter((value) => value.method === 'session/new').at(-1).params.cwd, '/remote/new-a');
  assert.ok(calls.filter((value) => value.method === 'initialize').every((value) => value.params.clientCapabilities.fs === undefined && value.params.clientCapabilities.terminal === undefined));
  assert.ok(calls.some((value) => value.id === 'local-callback' && value.error?.code === -32601));
});
