import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createAcpRuntime } from './runtime.js';
import { registerAcpRoutes } from './routes.js';
import express from 'express';

const fixture = fileURLToPath(new URL('./fixtures/parity-agent.mjs', import.meta.url));
const selection = (scenario = 'parity') => ({ command: process.execPath, args: [fixture, scenario], cwd: process.cwd() });
const setup = async (t, scenario) => {
  const folder = await mkdtemp(join(tmpdir(), 'acp-parity-'));
  const storagePath = join(folder, 'sessions.json');
  const runtime = createAcpRuntime({ storagePath });
  t.after(async () => { await runtime.stop(); await rm(folder, { recursive: true, force: true }); });
  await runtime.start(selection(scenario));
  return { runtime, storagePath };
};
const completed = (runtime) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error('Prompt did not complete')); }, 5000);
  const off = runtime.subscribe((event) => { if (event.type === 'status' && event.outcome === 'completed') { clearTimeout(timer); off(); resolve(); } });
});

test('Windows scoped discovery uses native cwd and preserves agent history cwd', { skip: process.platform !== 'win32' }, async (t) => {
  const { runtime, storagePath } = await setup(t, 'native-list');
  const scope = `${process.cwd().replaceAll('\\', '/').replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`)}/`;
  const list = await runtime.discover(scope);
  assert.deepEqual(list.map((item) => item.id), ['external-a']);
  assert.equal(list[0].directory, scope);
  const messages = await runtime.open('external-a');
  assert.deepEqual(messages.map((item) => item.info.role), ['user', 'assistant']);
  assert.equal(messages[0].parts[0].text, 'history question');
  const saved = JSON.parse(await readFile(storagePath, 'utf8'));
  const [entry] = Object.values(saved.partitions).flat();
  assert.equal(entry.agentCwd, process.cwd().replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`));
  assert.equal(entry.session.directory, scope);
});

test('two projects, paginated discovery, full replay, controls and restart resume', async (t) => {
  const { runtime, storagePath } = await setup(t);
  const projectA = join(process.cwd(), 'project-a');
  const projectB = join(process.cwd(), 'project-b');
  const a = await runtime.createSession({ directory: projectA });
  const b = await runtime.createSession({ directory: projectB });
  await Promise.all([runtime.updateSession(a.id, { metadata: { workspace: 'A' } }), runtime.updateSession(b.id, { metadata: { workspace: 'B' } })]);
  assert.deepEqual(runtime.commands(projectA).map((item) => item.name), ['review']);
  assert.equal((await runtime.controls(a.id)).configOptions.length, 1);
  let done = completed(runtime);
  await runtime.prompt({ sessionID: a.id, messageID: 'a', text: '/review exact words' }); await done;
  assert.match(runtime.messages(a.id)[1].parts[0].text, /\/review exact words/);
  const list = await runtime.discover(projectA);
  assert.equal(list.length, 3);
  const events = []; runtime.subscribe((value) => events.push(value));
  const [messages, initialControls] = await Promise.all([runtime.open('external-a'), runtime.controls('external-a')]);
  assert.equal(initialControls.usage.used, 42);
  assert.deepEqual(messages.map((item) => item.info.role), ['user', 'assistant']);
  assert.equal(messages[0].parts[0].text, 'history question');
  assert.equal(messages[1].parts.find((item) => item.type === 'text').text, 'history answer');
  const tool = messages[1].parts.find((item) => item.type === 'tool');
  assert.equal(tool.state.status, 'completed');
  assert.equal(tool.state.metadata.diffs[0].oldText, 'before');
  assert.equal(events.filter((item) => item.type === 'transcript-refresh').length, 1);
  assert.equal(events.some((item) => item.type === 'part-upsert'), false);
  await runtime.open('external-a');
  assert.equal(runtime.messages('external-a').length, 2);
  await runtime.updateSession('external-a', { title: 'My title', metadata: { tag: 'saved' }, time: { archived: 100 } });
  const config = await runtime.setConfig('external-a', 'model', 'large');
  assert.equal(config.configOptions.length, 2);
  assert.equal(config.usage.used, 70);
  assert.equal(runtime.session('external-a').title, 'My title');
  assert.ok(events.some((item) => item.type === 'session-refresh'));
  await runtime.stop(); await runtime.start(selection());
  assert.equal(runtime.session('external-a').time.archived, 100);
  assert.equal(runtime.session('external-a').metadata.tag, 'saved');
  await runtime.open('external-a');
  assert.equal(runtime.messages('external-a').length, 2);
  done = completed(runtime);
  await runtime.prompt({ sessionID: 'external-a', messageID: 'continued', text: 'continue' }); await done;
  assert.equal(runtime.messages('external-a').length, 4);
  await runtime.updateSession('external-a', { time: { archived: null } });
  assert.equal(runtime.session('external-a').time.archived, undefined);
  await runtime.stop();
  const saved = JSON.parse(await readFile(storagePath, 'utf8'));
  assert.equal(saved.sessions, undefined);
  const entries = Object.values(saved.partitions).flat();
  assert.equal(entries.find((item) => item.session.id === a.id).agentCwd, projectA);
  assert.equal(entries.find((item) => item.session.id === b.id).agentCwd, projectB);
  assert.equal(entries.find((item) => item.session.id === a.id).session.metadata.workspace, 'A');
  assert.equal(entries.find((item) => item.session.id === b.id).session.metadata.workspace, 'B');
});

for (const scenario of ['parity', 'local-delete']) test(`${scenario}: removal remains hidden through discovery and restart`, async (t) => {
  const { runtime } = await setup(t, scenario);
  await runtime.discover(process.cwd());
  await runtime.deleteSession('external-a');
  assert.throws(() => runtime.session('external-a'), /not found/);
  assert.equal((await runtime.discover(process.cwd())).some((item) => item.id === 'external-a'), false);
  await runtime.stop(); await runtime.start(selection(scenario));
  assert.equal((await runtime.discover(process.cwd())).some((item) => item.id === 'external-a'), false);
});

test('incomplete listing and failed replay preserve visible records and transcript', async (t) => {
  const { runtime } = await setup(t, 'list-fail');
  const session = await runtime.createSession({ directory: process.cwd() });
  await assert.rejects(runtime.discover(process.cwd()), /fixture failure/);
  assert.deepEqual(runtime.sessions().map((item) => item.id), [session.id]);
  await runtime.start(selection('load-fail'));
  await runtime.discover(process.cwd());
  const events = []; runtime.subscribe((event) => events.push(event));
  await assert.rejects(runtime.open('external-a'), /fixture failure/);
  assert.deepEqual(runtime.messages('external-a'), []);
  assert.equal(events.some((item) => item.type === 'transcript-refresh'), false);
  assert.equal(events.some((item) => item.type === 'part-upsert'), false);
  const created = await runtime.createSession({ directory: process.cwd() });
  const done = completed(runtime);
  await runtime.prompt({ sessionID: created.id, messageID: 'retain', text: 'original local history' }); await done;
  const original = structuredClone(runtime.messages(created.id));
  await runtime.stop(); await runtime.start(selection('load-fail'));
  await assert.rejects(runtime.open(created.id), /fixture failure/);
  assert.deepEqual(runtime.messages(created.id), original);
});

test('failed persistence rolls back metadata, replay and local removal', async (t) => {
  const { runtime, storagePath } = await setup(t, 'local-delete');
  await runtime.discover(process.cwd());
  await mkdir(`${storagePath}.tmp`);
  await assert.rejects(runtime.updateSession('external-a', { title: 'unsaved' }));
  assert.equal(runtime.session('external-a').title, 'external-a');
  await assert.rejects(runtime.open('external-a'));
  assert.deepEqual(runtime.messages('external-a'), []);
  await assert.rejects(runtime.deleteSession('external-a'));
  assert.equal(runtime.session('external-a').id, 'external-a');
  await rm(`${storagePath}.tmp`, { recursive: true });
  await runtime.open('external-a');
  assert.equal(runtime.messages('external-a').length, 2);
});

test('same JSON preserves connection partitions with colliding IDs across process restart', async (t) => {
  const { runtime, storagePath } = await setup(t, 'parity');
  await runtime.discover(process.cwd());
  await runtime.updateSession('external-a', { title: 'first connection' });
  await runtime.start(selection('local-delete'));
  assert.deepEqual(runtime.sessions(), []);
  await runtime.discover(process.cwd());
  await runtime.updateSession('external-a', { title: 'second connection' });
  await runtime.start(selection('parity'));
  assert.equal(runtime.session('external-a').title, 'first connection');
  await runtime.stop();
  const restarted = createAcpRuntime({ storagePath });
  t.after(() => restarted.stop());
  await restarted.start(selection('local-delete'));
  assert.equal(restarted.session('external-a').title, 'second connection');
  await restarted.start(selection('parity'));
  assert.equal(restarted.session('external-a').title, 'first connection');
});

test('legacy transcript migrates losslessly and resume-only agent can continue', async (t) => {
  const { runtime, storagePath } = await setup(t, 'resume-only');
  await runtime.stop();
  const config = selection('resume-only');
  const identity = createHash('sha256').update(JSON.stringify([config.command, config.args])).digest('hex');
  const legacy = { session: { id: 'legacy', directory: process.cwd(), title: 'Legacy', metadata: { retained: true }, time: { created: 1, updated: 2 } }, messages: [{ info: { id: 'old', role: 'user', sessionID: 'legacy', time: { created: 1 } }, parts: [{ id: 'part', type: 'text', text: 'original' }] }], status: { type: 'idle' } };
  await writeFile(storagePath, JSON.stringify({ identity, sessions: [legacy] }));
  const restarted = createAcpRuntime({ storagePath }); t.after(() => restarted.stop());
  await restarted.start(config);
  assert.equal(restarted.session('legacy').readOnly, false);
  assert.equal((await restarted.open('legacy'))[0].parts[0].text, 'original');
  assert.equal(restarted.session('legacy').metadata.retained, true);
  const done = completed(restarted);
  await restarted.prompt({ sessionID: 'legacy', messageID: 'next', text: 'continue' }); await done;
  assert.equal(restarted.messages('legacy').length, 3);
  await restarted.stop();
  const saved = JSON.parse(await readFile(storagePath, 'utf8'));
  assert.equal(saved.partitions[identity][0].messages[0].parts[0].text, 'original');
});

test('negotiated text and audio attachments preserve file parts and exact ACP content', async (t) => {
  const { runtime } = await setup(t);
  const session = await runtime.createSession({ directory: process.cwd() });
  const done = completed(runtime);
  await runtime.prompt({ sessionID: session.id, messageID: 'attachments', text: 'read', files: [{ url: 'data:text/plain;base64,aGVsbG8=', filename: 'note.txt' }, { url: 'data:audio/wav;base64,eA==', filename: 'sound.wav' }] }); await done;
  assert.equal(runtime.messages(session.id)[0].parts.filter((item) => item.type === 'file').length, 2);
  const response = JSON.parse(runtime.messages(session.id)[1].parts[0].text);
  assert.equal(response.prompt[1].resource.text, 'hello');
  assert.equal(response.prompt[2].type, 'audio');
});

test('busy config update keeps the active session owner and prompt returns to idle', async (t) => {
  const { runtime } = await setup(t, 'busy');
  const session = await runtime.createSession({ directory: process.cwd() });
  const done = completed(runtime);
  await runtime.prompt({ sessionID: session.id, messageID: 'busy', text: 'wait for config' });
  assert.equal(runtime.statuses()[session.id].type, 'busy');
  await assert.rejects(runtime.deleteSession(session.id), /already running/);
  await assert.rejects(runtime.updateSession(session.id, { title: 'blocked' }), /already running/);
  await runtime.setConfig(session.id, 'model', 'large');
  await done;
  assert.equal(runtime.statuses()[session.id].type, 'idle');
  assert.equal((await runtime.controls(session.id)).configOptions[0].currentValue, 'large');
  assert.equal(runtime.messages(session.id)[1].info.finish, 'end_turn');
});

test('domain HTTP routes discover, open, update, configure and remove without implicit sessions', async (t) => {
  const { runtime } = await setup(t);
  const app = express(); registerAcpRoutes(app, { express, runtime });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/acp`;
  assert.deepEqual(await (await fetch(`${base}/commands`)).json(), []);
  assert.equal(runtime.sessions().length, 0);
  const response = await fetch(`${base}/sessions?directory=${encodeURIComponent(process.cwd())}`);
  assert.equal(response.status, 200); assert.equal((await response.json()).length, 2);
  const messages = await (await fetch(`${base}/sessions/external-a/messages`)).json();
  assert.equal(messages.length, 2);
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const updated = await (await post('/sessions/external-a/update', { title: 'Route title', metadata: { source: 'http' } })).json();
  assert.equal(updated.title, 'Route title');
  const controls = await (await post('/sessions/external-a/config', { configId: 'model', value: 'large' })).json();
  assert.equal(controls.configOptions.length, 2);
  assert.equal(controls.capabilities.load, true);
  assert.equal((await post('/sessions/external-a/config', { configId: 3 })).status, 400);
  assert.equal(await (await post('/sessions/external-a/delete', {})).json(), true);
  assert.equal((await fetch(`${base}/sessions/external-a`)).status, 409);
});

test('switching connection rejects an in-flight restoration before it can publish old history', async (t) => {
  const { runtime } = await setup(t, 'load-only');
  await runtime.discover(process.cwd());
  const restored = assert.rejects(runtime.open('external-a'), /closed|changed/);
  await runtime.start(selection('local-delete'));
  await restored;
  await runtime.discover(process.cwd());
  assert.deepEqual(runtime.messages('external-a'), []);
});
