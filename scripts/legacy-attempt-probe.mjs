import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createMessageQueueRuntime } from '../packages/web/server/lib/message-queue/runtime.js';
import { createKernelOperations } from '../packages/web/server/lib/opencode/kernel-operations.js';

// Isolated contract evidence, with no real model, credentials, Git or downloads.
assert(process.argv[2], 'Pass the existing fixture root containing bin/opencode.exe');
const root = path.resolve(process.argv[2]);
const exe = path.join(root, 'bin/opencode.exe');
const digest = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
assert.equal(digest, 'dc9c7a2f97101329459fc46500913cc0c9d6514c39a6820fc720423ad04823b4');
const scratch = fs.mkdtempSync(path.join(root, 'attempt-probe-'));
const project = path.join(scratch, 'project'); fs.mkdirSync(project);
const events = [], calls = [], releases = new Map(), sockets = new Set(), streams = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 150; i++) { const result = await check(); if (result) return result; await delay(100); }
  throw new Error('Timed out: ' + label);
}
const model = http.createServer(async (req, res) => {
  try {
    let raw = ''; for await (const data of req) raw += data;
    const body = JSON.parse(raw);
    const marker = JSON.stringify(body.messages.findLast(message => message.role === 'user')?.content ?? '');
    const afterTool = body.messages.at(-1)?.role === 'tool';
    const mode = ['TEXT', 'LOST', 'TOOL', 'ABORT'].find(name => marker.includes('ATTEMPT_' + name));
    assert(mode, 'Unknown controlled model request');
    calls.push({ mode, afterTool });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({ id: 'chatcmpl-attempt', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
    chunk({ role: 'assistant', content: 'Controlled response. ' });
    if (mode === 'LOST' || mode === 'ABORT' || mode === 'TOOL' && afterTool) await new Promise(resolve => releases.set(mode, resolve));
    if (mode === 'TOOL' && !afterTool) {
      chunk({ tool_calls: [{ index: 0, id: 'call_question', type: 'function', function: { name: 'question', arguments: JSON.stringify({ questions: [{ question: 'Continue controlled probe?', header: 'Probe', options: [{ label: 'Yes', description: 'Continue' }] }] }) } }] });
      chunk({}, 'tool_calls');
    } else { chunk({ content: 'ATTEMPT_DONE' }); chunk({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
});
model.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
for (const [key, name] of Object.entries({ XDG_DATA_HOME: 'data', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state', OPENCODE_TEST_HOME: 'home', TEMP: 'temp', TMP: 'temp', APPDATA: 'appdata', LOCALAPPDATA: 'localappdata', USERPROFILE: 'home' })) {
  env[key] = path.join(scratch, name); fs.mkdirSync(env[key], { recursive: true });
}
for (const key of ['OPENCODE_DISABLE_AUTOUPDATE', 'OPENCODE_DISABLE_DEFAULT_PLUGINS', 'OPENCODE_DISABLE_MODELS_FETCH', 'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_DISABLE_EXTERNAL_SKILLS', 'OPENCODE_DISABLE_CLAUDE_CODE', 'OPENCODE_DISABLE_LSP_DOWNLOAD']) env[key] = 'true';
env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: 'attempt-probe/probe', small_model: 'attempt-probe/probe', provider: { 'attempt-probe': { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:' + model.address().port + '/v1', apiKey: 'isolated-only' }, models: { probe: { name: 'Controlled attempt probe', limit: { context: 64000, output: 4096 } } } } } });
env.OPENCODE_SERVER_PASSWORD = crypto.randomBytes(24).toString('hex');
const portSocket = http.createServer(); await new Promise(resolve => portSocket.listen(0, '127.0.0.1', resolve));
const port = portSocket.address().port; await new Promise(resolve => portSocket.close(resolve));
const child = spawn(exe, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: project, env, windowsHide: true, stdio: 'ignore' });
const endpoint = 'http://127.0.0.1:' + port;
const auth = 'Basic ' + Buffer.from('opencode:' + env.OPENCODE_SERVER_PASSWORD).toString('base64');
const headers = { Authorization: auth, 'content-type': 'application/json', 'x-opencode-directory': project };
async function request(method, route, body, signal = AbortSignal.timeout(20000)) {
  const res = await fetch(endpoint + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  const text = await res.text(); assert(res.ok, route + ': HTTP ' + res.status);
  return text ? JSON.parse(text) : null;
}
// Match the existing client ID layout; UUIDs do not preserve upstream ordering.
const messageID = () => 'msg_' + (BigInt(Date.now()) * 4096n + 1n).toString(16).padStart(12, '0').slice(-12) + crypto.randomBytes(7).toString('hex');
const input = (mode, id) => ({ messageID: id, agent: 'build', model: { providerID: 'attempt-probe', modelID: 'probe' }, parts: [{ type: 'text', text: 'ATTEMPT_' + mode }] });
const info = value => ({ id: value.id, sessionID: value.sessionID, role: value.role, parentID: value.parentID, finish: value.finish, time: value.time, error: value.error?.name, summary: value.summary });
const history = id => request('GET', '/session/' + id + '/message');
const terminal = (list, parent) => list.find(entry => entry.info.role === 'assistant' && entry.info.parentID === parent && entry.info.time.completed && entry.info.finish === 'stop' && !entry.info.error);
const results = [], queueResults = [];
let queueEvent = () => {};
let queue;
let failed;
try {
  await until(async () => { try { return (await request('GET', '/global/health')).version === '1.2.27'; } catch { return false; } }, 'startup');
  const controller = new AbortController();
  const response = await fetch(endpoint + '/event', { headers, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const done = (async () => { let buffer = ''; try { for (;;) { const part = await reader.read(); if (part.done) break; buffer += decoder.decode(part.value, { stream: true }); let end; while ((end = buffer.indexOf('\n\n')) >= 0) { const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2); const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n'); if (!data) continue; const event = JSON.parse(data); queueEvent({ payload: event, directory: project }); if (event.type === 'message.updated') events.push({ ordinal: events.length, info: info(event.properties.info) }); } } } catch (error) { if (!controller.signal.aborted) throw error; } })();
  streams.push({ controller, done });
  for (const mode of ['TEXT', 'LOST', 'TOOL', 'ABORT']) {
    const session = await request('POST', '/session', { title: 'Controlled ' + mode });
    const id = messageID();
    let pending, lost;
    if (mode === 'LOST') {
      const ctl = new AbortController();
      pending = request('POST', '/session/' + session.id + '/message', input(mode, id), ctl.signal).catch(error => error.name);
      await until(() => releases.has(mode), 'held sync request');
      ctl.abort(); lost = await pending; assert.equal(lost, 'AbortError');
    } else await request('POST', '/session/' + session.id + '/prompt_async', input(mode, id));
    const stored = await until(async () => { try { return await request('GET', '/session/' + session.id + '/message/' + id); } catch { return null; } }, 'exact user lookup');
    assert.equal(stored.info.id, id); assert.equal(stored.info.role, 'user');
    let intermediate;
    if (mode === 'TOOL') {
      const asked = await until(async () => (await request('GET', '/question')).find(entry => entry.sessionID === session.id), 'question');
      await request('POST', '/question/' + asked.id + '/reply', { answers: [['Yes']] });
      await until(() => releases.has(mode), 'tool follow-up hold');
      intermediate = (await history(session.id)).filter(entry => entry.info.role === 'assistant').map(entry => info(entry.info));
      assert(intermediate.some(entry => entry.parentID === id && entry.finish === 'tool-calls' && entry.time.completed));
      assert(!terminal(await history(session.id), id), 'Tool completion is not final');
    }
    if (mode === 'ABORT') { await until(() => releases.has(mode), 'abort hold'); await request('POST', '/session/' + session.id + '/abort'); }
    releases.get(mode)?.(); releases.delete(mode);
    const final = mode === 'ABORT'
      ? await until(async () => (await history(session.id)).find(entry => entry.info.parentID === id && entry.info.error?.name === 'MessageAbortedError'), 'correlated abort')
      : await until(async () => terminal(await history(session.id), id), 'correlated completion');
    assert.equal(final.info.sessionID, session.id);
    assert(id < final.info.id, 'Caller ID must sort before its assistant');
    await until(() => events.some(event => event.info.id === final.info.id && event.info.time?.completed), 'completed event');
    await until(async () => { const state = (await request('GET', '/session/status'))[session.id]; return !state || state.type === 'idle'; }, 'authoritative idle after terminal');
    results.push({ mode, user: info(stored.info), final: info(final.info), intermediate, lostResponse: lost, idleVerified: true, correlatedEvents: events.filter(event => event.info.parentID === id) });
  }
  let loseResponse = false;
  const descriptor = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint, epoch: 1 };
  const operations = createKernelOperations({ getRuntime: () => descriptor, getHeaders: () => ({ Authorization: auth }),
    fetchImpl: async (url, init) => {
      const response = await fetch(url, init);
      if (loseResponse && new URL(url instanceof Request ? url.url : url).pathname.endsWith('/prompt_async')) {
        loseResponse = false;
        throw new Error('Controlled loss after upstream acceptance');
      }
      return response;
    } });
  const queueDir = path.join(scratch, 'queue');
  queue = createMessageQueueRuntime({ kernelOperations: operations, getQueueTarget: async () => 'a'.repeat(64), dataDir: queueDir,
    globalEventHub: { subscribeEvent(handler) { queueEvent = handler; return () => { queueEvent = () => {}; }; }, subscribeStatus() { return () => {}; } },
    dispatchQuietMs: 10, abortHoldMs: 0 });
  const stopQueue = queue.start();
  for (const mode of ['TEXT', 'LOST', 'TOOL', 'ABORT']) {
    const session = await request('POST', '/session', { title: 'Queue ' + mode });
    loseResponse = mode === 'LOST';
    await queue.enqueue(session.id, project, { content: 'ATTEMPT_' + mode, text: 'ATTEMPT_' + mode, attachments: [], sendConfig: { providerID: 'attempt-probe', modelID: 'probe' } });
    if (mode === 'LOST' || mode === 'ABORT') await until(() => releases.has(mode), 'queue model hold');
    if (mode === 'LOST') await until(() => queue.sessionSnapshot(session.id).items[0]?.attempt?.state === 'unknown', 'queue preserves response loss');
    if (mode === 'TOOL') {
      const asked = await until(async () => (await request('GET', '/question')).find(entry => entry.sessionID === session.id), 'queue question');
      await request('POST', '/question/' + asked.id + '/reply', { answers: [['Yes']] });
      await until(() => releases.has(mode), 'queue tool follow-up hold');
      assert.equal(queue.sessionSnapshot(session.id).items[0]?.attempt?.state, 'accepted', 'Intermediate tool completion must not finish queue attempt');
    }
    if (mode === 'ABORT') await request('POST', '/session/' + session.id + '/abort');
    releases.get(mode)?.(); releases.delete(mode);
    const expected = mode === 'ABORT' ? 'failed' : 'completed';
    const item = await until(() => { const item = queue.sessionSnapshot(session.id).items[0]; return item?.attempt?.state === expected ? item : null; }, 'queue ' + expected);
    assert(!('messageID' in item.attempt), 'Private message ID must not expand public projection');
    await queue.flush();
    const stored = JSON.parse(fs.readFileSync(path.join(queueDir, 'message-queue.json'), 'utf8')).sessions[session.id].items[0];
    assert.equal(stored.attempt.state, expected); assert(stored.attempt.messageID);
    const user = await request('GET', '/session/' + session.id + '/message/' + stored.attempt.messageID);
    assert.equal(user.info.role, 'user');
    queueResults.push({ mode, attempt: stored.attempt, publicAttempt: item.attempt, persisted: true });
  }
  stopQueue(); await queue.flush();
  await delay(200);
  assert.equal(calls.length, 10, 'No queue replay or extra model invocation after final stop');
} catch (error) { failed = error; }
finally {
  queue?.stop();
  if (queue) await queue.flush();
  for (const release of releases.values()) release();
  for (const stream of streams) stream.controller.abort();
  await Promise.allSettled(streams.map(stream => stream.done));
  if (child.exitCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill();
    await Promise.race([exited, delay(5000)]);
  }
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => model.close(resolve));
  const cleaned = child.exitCode !== null || child.signalCode !== null;
  // Delete only this invocation's scratch tree, after its exact child has exited.
  assert.equal(path.dirname(path.resolve(scratch)), root);
  if (cleaned) fs.rmSync(scratch, { recursive: true, force: true });
  const evidence = { date: new Date().toISOString(), executableSha256: digest, version: '1.2.27', kind: 'official executable with controlled loopback model and production queue/kernel operations', results, queueResults, calls, scratchRemoved: cleaned, error: failed?.message };
  fs.writeFileSync(path.join(root, '..', 'int05-legacy-attempt-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ cases: results.length, queueCases: queueResults.length, scratchRemoved: cleaned, error: failed?.message }));
}
if (failed) throw failed;
