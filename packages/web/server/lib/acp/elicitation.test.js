import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAcpRuntime } from './runtime.js';
import { createElicitations, elicitationSchema, fieldsFor, validateAnswer } from './elicitation.js';
import { registerAcpRoutes } from './routes.js';

const fixture = fileURLToPath(new URL('./fixtures/elicitation-agent.mjs', import.meta.url));
const answer = { name: 'Ada', count: 3, ready: false, colors: ['blue'], strategy: 'safe' };
const until = (runtime, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error('ACP event not received')); }, 5000);
  const off = runtime.subscribe((event) => { if (predicate(event)) { clearTimeout(timer); off(); resolve(event); } });
});
const setup = async (t) => {
  const runtime = createAcpRuntime();
  await runtime.start({ command: process.execPath, args: [fixture], cwd: process.cwd() });
  t.after(() => runtime.stop());
  return { runtime, session: await runtime.createSession({ directory: process.cwd() }) };
};

test('blocked prompt form validates on the server, accepts exact typed values and closes once', async (t) => {
  const { runtime, session } = await setup(t);
  const events = []; runtime.subscribe((event) => events.push(event));
  const asked = until(runtime, (event) => event.type === 'input-created');
  await runtime.prompt({ sessionID: session.id, messageID: 'one', text: 'form' });
  const { request } = await asked;
  assert.equal(request.value.agent, 'Fixture Agent');
  assert.equal(runtime.statuses()[session.id].type, 'busy');
  assert.equal(runtime.inputs()[0].value.fields[0].default, 'Sam');
  assert.deepEqual(runtime.inputs('/unrelated'), []);
  for (const invalid of [{ ...answer, count: 9 }, { ...answer, count: 1.5 }, { ...answer, colors: ['pink'] }, { ...answer, strategy: 'other' }, { ...answer, extra: 'x' }, {}]) await assert.rejects(runtime.replyInput(request.value.id, { action: 'accept', content: invalid }));
  assert.equal(runtime.inputs().length, 1);
  const done = until(runtime, (event) => event.type === 'status' && event.outcome === 'completed');
  await runtime.replyInput(request.value.id, { action: 'accept', content: answer });
  await done;
  assert.deepEqual(runtime.inputs(), []);
  assert.equal(events.filter((event) => event.type === 'form-closed').length, 1);
  assert.deepEqual(JSON.parse(runtime.messages(session.id)[1].parts[0].text).content, answer);
  await assert.rejects(runtime.replyInput(request.value.id, { action: 'accept', content: answer }), /no longer pending/);
});

for (const action of ['decline', 'cancel']) test(`${action} unblocks a session form without submitting content`, async (t) => {
  const { runtime, session } = await setup(t);
  const asked = until(runtime, (event) => event.type === 'input-created');
  await runtime.prompt({ sessionID: session.id, messageID: 'one', text: 'form' });
  const { request } = await asked;
  const done = until(runtime, (event) => event.type === 'status' && event.outcome);
  if (action === 'cancel') await runtime.cancel(session.id);
  else await runtime.replyInput(request.value.id, { action, content: answer });
  await done;
  assert.deepEqual(runtime.inputs(), []);
  assert.deepEqual(JSON.parse(runtime.messages(session.id)[1].parts[0].text), { action });
});

test('accepted URL waits for completion and duplicate/unknown completions do not close twice', async (t) => {
  const { runtime, session } = await setup(t);
  const events = []; runtime.subscribe((event) => events.push(event));
  const asked = until(runtime, (event) => event.type === 'input-created');
  await runtime.prompt({ sessionID: session.id, messageID: 'one', text: 'wait-url' });
  const { request } = await asked;
  await runtime.replyInput(request.value.id, { action: 'accept' });
  assert.equal(runtime.inputs()[0].value.state, 'waiting');
  await assert.rejects(runtime.replyInput(request.value.id, { action: 'accept' }), /no longer pending/);
  await runtime.cancel(session.id);
  assert.deepEqual(runtime.inputs(), []);
  assert.equal(events.filter((event) => event.type === 'form-closed').length, 1);
});

for (const method of ['form', 'url']) test(`request-scoped ${method} authentication requires no conversation and completes once`, async (t) => {
  const { runtime } = await setup(t);
  const events = []; runtime.subscribe((event) => events.push(event));
  const asked = until(runtime, (event) => event.type === 'connection-inputs' && event.inputs.length);
  const authenticated = runtime.authenticate(method, runtime.info().epoch);
  const { inputs: [request] } = await asked;
  assert.equal(request.scope, 'request');
  assert.equal(request.sessionID, undefined);
  assert.deepEqual(runtime.inputs(), []);
  const response = { action: 'accept' };
  if (method === 'form') response.content = answer;
  await runtime.replyInput(request.id, response);
  await authenticated;
  assert.deepEqual(runtime.connectionInputs(), []);
  assert.equal(events.filter((event) => event.type === 'connection-inputs' && event.inputs.length === 0).length, 1);
});

test('failed authentication can retry, terminal type and stale epoch cannot call authenticate', async (t) => {
  const { runtime } = await setup(t);
  assert.throws(() => runtime.authenticate('terminal'), /CLI/);
  assert.throws(() => runtime.authenticate('form', runtime.info().epoch - 1), /changed/);
  await assert.rejects(runtime.authenticate('fail'), /Login failed/);
  await assert.rejects(runtime.authenticate('fail'), /Login failed/);
  assert.deepEqual(runtime.connectionInputs(), []);
});

test('connection failure cleans session input once and rejects stale replies', async (t) => {
  const { runtime, session } = await setup(t);
  const events = []; runtime.subscribe((event) => events.push(event));
  const asked = until(runtime, (event) => event.type === 'input-created');
  const failed = until(runtime, (event) => event.type === 'status' && event.outcome === 'failed');
  await runtime.prompt({ sessionID: session.id, messageID: 'one', text: 'exit-form' });
  const { request } = await asked;
  await failed;
  assert.deepEqual(runtime.inputs(), []);
  assert.equal(events.filter((event) => event.type === 'form-closed').length, 1);
  assert.throws(() => runtime.replyInput(request.value.id, { action: 'accept', content: answer }), /closed|connected|exited/);
});

test('schemas reject invalid scopes, unsafe URLs, nested objects and credential fields', () => {
  const url = { mode: 'url', sessionId: 'one', message: 'Login', url: 'https://example.test', elicitationId: 'one' };
  for (const value of [{ ...url, mode: undefined }, { ...url, requestId: 1 }, { ...url, sessionId: undefined }, { ...url, url: 'javascript:alert(1)' }, { ...url, url: 'https://secret:password@example.test' }]) assert.equal(elicitationSchema.safeParse(value).success, false);
  assert.equal(elicitationSchema.safeParse({ mode: 'form', sessionId: 'one', message: 'Data', requestedSchema: { type: 'object', properties: { nested: { type: 'object' } } } }).success, false);
  assert.throws(() => fieldsFor({ properties: { api_key: { type: 'string' } } }), /Credentials/);
  assert.throws(() => validateAnswer([{ key: 'email', type: 'string', format: 'email', minLength: 20, maxLength: 25, required: true }], { email: 'a@b.co' }), /Invalid/);
  assert.throws(() => validateAnswer([{ key: 'email', type: 'string', format: 'email', maxLength: 6, required: true }], { email: 'long@example.test' }), /Invalid/);
});

test('reply write failure preserves retry and connection clear removes accepted URL state', async () => {
  const events = []; let failed = true; let epoch = 1;
  const elicitations = createElicitations({ write: async () => { if (failed) throw new Error('send failed'); }, emit: (event) => events.push(event), record: () => ({ session: { directory: '/repo' } }), agent: () => 'Fixture', epoch: () => epoch, hasRequest: () => true });
  elicitations.create(10, { mode: 'url', requestId: 1, message: 'Login', url: 'https://example.test', elicitationId: 'flow' });
  const [request] = elicitations.global();
  await assert.rejects(elicitations.reply(request.id, { action: 'accept' }), /send failed/);
  assert.equal(elicitations.global()[0].state, 'pending');
  epoch += 1;
  await assert.rejects(elicitations.reply(request.id, { action: 'accept' }), /no longer pending/);
  epoch -= 1; failed = false;
  await elicitations.reply(request.id, { action: 'accept' });
  assert.equal(elicitations.global()[0].state, 'waiting');
  elicitations.complete({ elicitationId: 'unknown' });
  elicitations.complete({ elicitationId: 'flow' });
  elicitations.complete({ elicitationId: 'flow' });
  assert.equal(events.filter((event) => event.inputs.length === 0).length, 1);
});

test('HTTP snapshot and SSE recover a blocked form with its original request ID', async (t) => {
  const { runtime, session } = await setup(t);
  const asked = until(runtime, (event) => event.type === 'input-created');
  await runtime.prompt({ sessionID: session.id, messageID: 'one', text: 'form' });
  const { request } = await asked;
  const app = express(); registerAcpRoutes(app, { express, runtime });
  const server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}/api/acp`;
  assert.equal((await (await fetch(`${base}/inputs`)).json())[0].value.id, request.value.id);
  const abort = new AbortController();
  const stream = await fetch(`${base}/events`, { signal: abort.signal });
  const reader = stream.body.getReader(); const decoder = new TextDecoder(); let data = '';
  while (!data.includes('input-created')) data += decoder.decode((await reader.read()).value);
  assert.ok(data.includes(request.value.id)); abort.abort(); await reader.cancel().catch(() => {});
  const invalid = await fetch(`${base}/inputs/${encodeURIComponent(request.value.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept', content: {} }) });
  assert.equal(invalid.status, 409); assert.equal(runtime.inputs().length, 1);
});
