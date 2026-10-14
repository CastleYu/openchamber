import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAcpRuntime } from './runtime.js';
import { registerAcpRoutes } from './routes.js';

const fixture = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
const selection = (scenario) => ({ command: process.execPath, args: [fixture, scenario], cwd: process.cwd() });
const setup = async (t, scenario = 'text', storagePath, cleanup = () => {}) => {
  const runtime = createAcpRuntime({ storagePath });
  t.after(async () => { await runtime.stop(); await cleanup(); });
  await runtime.start(selection(scenario));
  const events = [];
  runtime.subscribe((event) => events.push(event));
  return { runtime, events, session: await runtime.createSession({ directory: process.cwd() }) };
};
const until = (runtime, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error('Expected ACP event did not arrive')); }, 5000);
  const off = runtime.subscribe((event) => { if (predicate(event)) { clearTimeout(timer); off(); resolve(event); } });
});

test('stdio initialize, new, streaming text and thought project domain facts', async (t) => {
  const { runtime, events, session } = await setup(t);
  const done = until(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
  await runtime.prompt({ sessionID: session.id, messageID: 'user-1', text: 'Hello' });
  await done;
  assert.equal(runtime.descriptor().generation, 'acp');
  const messages = runtime.messages(session.id);
  assert.equal(messages[0].info.id, 'user-1');
  assert.ok(messages[1].info.time.created > messages[0].info.time.created);
  assert.equal(messages[1].parts.find((part) => part.type === 'text').text, 'hello world');
  assert.equal(messages[1].parts.find((part) => part.type === 'reasoning').text, 'thinking');
  assert.ok(events.some((event) => event.type === 'part-delta' && event.delta === 'world'));
});

test('permission preserves exact options and tools accept ACP content arrays and JSON input', async (t) => {
  const { runtime, session } = await setup(t, 'permission');
  const asked = until(runtime, (event) => event.type === 'permission-asked');
  await runtime.prompt({ sessionID: session.id, messageID: 'user-1', text: 'Read' });
  const { request } = await asked;
  assert.equal(request.value.options[0].name, 'Allow this read');
  assert.throws(() => runtime.reply(request.value.id, 'once'), /Invalid ACP permission option/);
  const done = until(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
  runtime.reply(request.value.id, 'yes-exact');
  await done;
  const tool = runtime.messages(session.id)[1].parts.find((part) => part.type === 'tool');
  assert.deepEqual(tool.state.input, { value: ['file.txt'] });
  assert.equal(tool.state.status, 'completed');
  assert.match(tool.state.output, /file content\nfile.txt\nnew content/);
  assert.deepEqual(runtime.permissions(), []);
});

test('cancel resolves permission as cancelled and interrupts the prompt', async (t) => {
  const { runtime, session } = await setup(t, 'cancel');
  const asked = until(runtime, (event) => event.type === 'permission-asked');
  await runtime.prompt({ sessionID: session.id, messageID: 'user-1', text: 'Read' });
  await asked;
  const done = until(runtime, (event) => event.type === 'status' && event.outcome === 'interrupted');
  await runtime.cancel(session.id);
  await done;
  assert.deepEqual(runtime.permissions(), []);
  assert.equal(runtime.statuses()[session.id].type, 'idle');
});

for (const scenario of ['error', 'exit']) test(`agent ${scenario} fails a prompt visibly`, async (t) => {
  const { runtime, session } = await setup(t, scenario);
  const done = until(runtime, (event) => event.type === 'status' && event.outcome === 'failed');
  await runtime.prompt({ sessionID: session.id, messageID: 'user-1', text: 'Fail' });
  const event = await done;
  assert.match(event.error.message, scenario === 'error' ? /fixture failure/ : /exited/);
});

test('invalid command and malformed stdout never fall back to another agent', async (t) => {
  const runtime = createAcpRuntime();
  t.after(() => runtime.stop());
  await assert.rejects(runtime.start({ command: join(tmpdir(), 'missing-acp-command'), args: [], cwd: process.cwd() }), /ENOENT/);
  assert.equal(runtime.descriptor().endpoint, null);
  await assert.rejects(runtime.start(selection('malformed')), /Invalid ACP message/);
  assert.equal(runtime.descriptor().generation, 'unreachable');
});

test('stop waits for the agent to exit before its working directory is removed', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'openchamber-acp-stop-'));
  const runtime = createAcpRuntime();
  t.after(async () => { await runtime.stop(); await rm(folder, { recursive: true, force: true }); });
  await runtime.start({ ...selection('lifecycle'), cwd: folder });
  const pid = Number(runtime.info().agentInfo.version);
  assert.equal(process.kill(pid, 0), true);
  await runtime.stop();
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await rm(folder, { recursive: true });
});

test('saved sessions stay read-only when loadSession is unavailable', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'openchamber-acp-'));
  const { runtime, session } = await setup(t, 'no-load', join(folder, 'sessions.json'), () => rm(folder, { recursive: true, force: true }));
  await runtime.stop();
  await runtime.start(selection('no-load'));
  assert.equal(runtime.session(session.id).readOnly, true);
  await assert.rejects(runtime.prompt({ sessionID: session.id, messageID: 'u', text: 'Resume' }), /cannot resume/);
});

test('reconnect snapshot gives every fact a unique event id', async (t) => {
  const { runtime, session } = await setup(t);
  const done = until(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
  await runtime.prompt({ sessionID: session.id, messageID: 'u', text: 'Hello' });
  await done;
  const app = express();
  registerAcpRoutes(app, { express, runtime });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/acp/events`, { signal: controller.signal });
  const reader = response.body.getReader();
  const { value } = await reader.read();
  const facts = new TextDecoder().decode(value).split('\n\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)));
  controller.abort();
  assert.ok(facts.length >= 7);
  assert.equal(new Set(facts.map((fact) => fact.eventID)).size, facts.length);
});

test('negotiated loadSession resumes the saved session without replay duplicates', async (t) => {
  const { runtime, session } = await setup(t);
  const completed = () => until(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
  let done = completed();
  await runtime.prompt({ sessionID: session.id, messageID: 'first', text: 'Hello' });
  await done;
  await runtime.stop();
  await runtime.start(selection('text'));
  done = completed();
  await runtime.prompt({ sessionID: session.id, messageID: 'second', text: 'Continue' });
  await done;
  assert.equal(runtime.sessions().length, 1);
  assert.equal(runtime.messages(session.id).length, 4);
  assert.ok(!JSON.stringify(runtime.messages(session.id)).includes('replayed history'));
});

test('unsupported attachment is rejected before transcript changes', async (t) => {
  const { runtime, session } = await setup(t);
  await assert.rejects(runtime.prompt({ sessionID: session.id, messageID: 'u', text: 'Image', files: [{ url: 'data:image/png;base64,eA==' }] }), /does not support this attachment/);
  assert.equal(runtime.messages(session.id).length, 0);
});

test('accepted file links are canonical transcript parts', async (t) => {
  const { runtime, events, session } = await setup(t);
  const done = until(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
  await runtime.prompt({ sessionID: session.id, messageID: 'with-file', text: 'Read', files: [{ url: 'file:///file.txt', filename: 'file.txt' }] });
  await done;
  const parts = runtime.messages(session.id)[0].parts;
  assert.deepEqual(parts.map((part) => part.id), ['with-file:text:0', 'with-file:file:0']);
  assert.equal(parts[1].url, 'file:///file.txt');
  assert.ok(events.some((event) => event.type === 'part-upsert' && event.part.id === 'with-file:file:0'));
});

test('a failed transcript save rolls back the unsent turn and later saves recover', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'openchamber-acp-save-'));
  const storagePath = join(folder, 'sessions.json');
  const { runtime, events, session } = await setup(t, 'text', storagePath, () => rm(folder, { recursive: true, force: true }));
  await mkdir(`${storagePath}.tmp`);
  await assert.rejects(runtime.prompt({ sessionID: session.id, messageID: 'unsent', text: 'Fail save' }));
  assert.equal(runtime.statuses()[session.id].type, 'idle');
  assert.equal(runtime.descriptor().generation, 'acp');
  assert.deepEqual(runtime.messages(session.id), []);
  assert.equal(events.some((event) => event.type === 'message-upsert'), false);
  assert.ok(events.some((event) => event.type === 'status' && event.outcome === 'failed'));
  await rm(`${storagePath}.tmp`, { recursive: true });
  const done = until(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
  await runtime.prompt({ sessionID: session.id, messageID: 'retry', text: 'Saved' });
  await done;
  await runtime.stop();
  const saved = JSON.parse(await readFile(storagePath, 'utf8'));
  assert.equal(saved.sessions[0].messages.length, 2);
  assert.equal(saved.sessions[0].messages[0].info.id, 'retry');
  assert.equal(saved.sessions[0].messages[1].info.finish, 'end_turn');
});
