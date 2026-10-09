import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

assert(process.argv[2], 'Pass a fixture root containing bin/opencode.exe');
const root = path.resolve(process.argv[2]);
const exe = path.join(root, 'bin/opencode.exe');
const exeSha256 = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
assert.equal(exeSha256, 'dc9c7a2f97101329459fc46500913cc0c9d6514c39a6820fc720423ad04823b4', 'Use the verified official Windows x64 1.2.27 executable');
const out = fs.mkdtempSync(path.join(root, 'conversation-'));
const dirs = ['a', 'b'].map(name => { const dir = path.join(out, name); fs.mkdirSync(dir); return dir; });
for (const dir of dirs) {
  const git = args => { const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); };
  git(['init', '-q']); fs.writeFileSync(path.join(dir, 'probe.txt'), 'before\n'); git(['add', 'probe.txt']);
  git(['-c', 'user.name=Legacy Probe', '-c', 'user.email=legacy-probe@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'isolated fixture']);
}
const captures = [], calls = [], events = [], sockets = new Set();
let held = 0;
const modelServer = http.createServer(async (req, res) => {
  let raw = ''; for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  const lastUser = body.messages.findLast(message => message.role === 'user');
  const marker = JSON.stringify(lastUser?.content ?? '');
  const afterTool = body.messages.at(-1)?.role === 'tool';
  calls.push({ path: req.url, marker, afterTool, tools: body.tools?.map(tool => tool.function.name) });
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'chatcmpl-isolated', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  chunk({ role: 'assistant' });
  if (marker.includes('LEGACY_HOLD')) { held++; chunk({ content: 'Waiting' }); return; }
  let tool;
  if (!afterTool && marker.includes('LEGACY_PERMISSION')) tool = ['bash', { command: 'echo LEGACY_APPROVED', description: 'Echo isolated probe' }];
  if (!afterTool && marker.includes('LEGACY_QUESTION')) tool = ['question', { questions: [{ question: 'Choose probe answer', header: 'Probe', options: [{ label: 'Yes', description: 'Continue probe' }, { label: 'No', description: 'Stop probe' }] }] }];
  if (!afterTool && marker.includes('LEGACY_EDIT')) tool = ['edit', { filePath: path.join(dirs[0], 'created.txt'), oldString: '', newString: 'after\n' }];
  if (tool) {
    const eventOffset = events.length;
    chunk({ content: 'Preparing controlled tool.' });
    await until(() => events.slice(eventOffset).some(item => item.payload.type === 'message.part.updated' && item.payload.properties.part.type === 'step-start'), 'tool step snapshot');
    chunk({ tool_calls: [{ index: 0, id: `call_${calls.length}`, type: 'function', function: { name: tool[0], arguments: JSON.stringify(tool[1]) } }] }); chunk({}, 'tool_calls');
  } else { chunk({ content: 'LEGACY_' }); chunk({ content: 'COMPLETED' }); chunk({}, 'stop'); }
  res.end('data: [DONE]\n\n');
});
modelServer.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
const modelPort = modelServer.address().port;
const env = {};
for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
for (const [key, dir] of Object.entries({ XDG_DATA_HOME: 'data', XDG_CONFIG_HOME: 'config', XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state', OPENCODE_TEST_HOME: 'home', TEMP: 'temp', TMP: 'temp', APPDATA: 'appdata', LOCALAPPDATA: 'localappdata', USERPROFILE: 'home' })) { env[key] = path.join(out, dir); fs.mkdirSync(env[key], { recursive: true }); }
for (const key of ['OPENCODE_DISABLE_AUTOUPDATE', 'OPENCODE_DISABLE_DEFAULT_PLUGINS', 'OPENCODE_DISABLE_MODELS_FETCH', 'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_DISABLE_EXTERNAL_SKILLS', 'OPENCODE_DISABLE_CLAUDE_CODE', 'OPENCODE_DISABLE_LSP_DOWNLOAD']) env[key] = 'true';
env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ model: 'legacy-probe/probe', small_model: 'legacy-probe/probe', provider: { 'legacy-probe': { npm: '@ai-sdk/openai-compatible', options: { baseURL: `http://127.0.0.1:${modelPort}/v1`, apiKey: 'isolated-test-only' }, models: { probe: { name: 'Controlled probe', limit: { context: 64000, output: 4096 } } } } } });
env.OPENCODE_SERVER_PASSWORD = crypto.randomBytes(24).toString('hex');
const portSocket = http.createServer(); await new Promise(resolve => portSocket.listen(0, '127.0.0.1', resolve)); const port = portSocket.address().port; await new Promise(resolve => portSocket.close(resolve));
const child = spawn(exe, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: dirs[0], env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const log = fs.createWriteStream(path.join(out, 'server.log')); child.stdout.pipe(log); child.stderr.pipe(log);
const endpoint = `http://127.0.0.1:${port}`;
const auth = `Basic ${Buffer.from(`opencode:${env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
const sanitize = value => JSON.parse(JSON.stringify(value).replaceAll(out.replaceAll('\\', '\\\\'), '<isolated-root>'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(method, route, body, dir = dirs[0]) {
  const response = await fetch(`${endpoint}${route}`, { method, headers: { Authorization: auth, 'content-type': 'application/json', 'x-opencode-directory': dir }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await response.text(); let result; try { result = JSON.parse(text); } catch { result = text; }
  captures.push({ method, path: route, directory: dir === dirs[0] ? 'a' : 'b', request: body, status: response.status, response: sanitize(result) });
  assert.equal(response.status, 200, `${route}: ${JSON.stringify(result)}`); return result;
}
async function until(check, label) { for (let i = 0; i < 100; i++) { const value = await check(); if (value) return value; await sleep(100); } throw new Error(`Timed out: ${label}`); }
const streams = [];
async function stream(dir) {
  const ctl = new AbortController(); const response = await fetch(`${endpoint}/event`, { headers: { Authorization: auth, 'x-opencode-directory': dir }, signal: ctl.signal }); assert.equal(response.status, 200);
  const reader = response.body.getReader(); let buffer = ''; const entry = { dir, ctl, ended: false };
  entry.done = (async () => { try { while (true) { const part = await reader.read(); if (part.done) break; buffer += new TextDecoder().decode(part.value); let index; while ((index = buffer.indexOf('\n\n')) >= 0) { const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2); const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n'); if (data) events.push({ directory: dir === dirs[0] ? 'a' : 'b', payload: sanitize(JSON.parse(data)) }); } } } catch (error) { if (!ctl.signal.aborted) entry.error = String(error); } finally { entry.ended = true; } })();
  streams.push(entry); return entry;
}
const input = marker => ({ agent: 'build', model: { providerID: 'legacy-probe', modelID: 'probe' }, parts: [{ type: 'text', text: marker }] });
async function session(dir = dirs[0], permission = []) { return request('POST', '/session', { title: 'Controlled Legacy conversation', permission }, dir); }
try {
  await until(async () => { try { return (await fetch(`${endpoint}/global/health`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(500) })).ok; } catch { return false; } }, 'startup');
  assert.deepEqual(await request('GET', '/global/health'), { healthy: true, version: '1.2.27' });
  const aStream = await stream(dirs[0]); const bStream = await stream(dirs[1]);
  const text = await session(); const answer = await request('POST', `/session/${text.id}/message`, input('LEGACY_TEXT')); assert.equal(answer.info.role, 'assistant'); assert.equal(answer.info.finish, 'stop'); assert(answer.parts.some(part => part.type === 'text' && part.text === 'LEGACY_COMPLETED'));
  const history = await request('GET', `/session/${text.id}/message`); assert.equal(history.length, 2);
  const asyncSession = await session();
  const asyncResponse = await fetch(`${endpoint}/session/${asyncSession.id}/prompt_async`, { method: 'POST', headers: { Authorization: auth, 'content-type': 'application/json', 'x-opencode-directory': dirs[0] }, body: JSON.stringify(input('LEGACY_TEXT')), signal: AbortSignal.timeout(10000) });
  assert.equal(asyncResponse.status, 204); assert.equal(await asyncResponse.text(), '');
  captures.push({ method: 'POST', path: `/session/${asyncSession.id}/prompt_async`, directory: 'a', request: input('LEGACY_TEXT'), status: 204, response: null });
  await until(async () => (await request('GET', `/session/${asyncSession.id}/message`)).some(message => message.info.role === 'assistant' && message.info.finish === 'stop' && message.parts.some(part => part.type === 'text' && part.text === 'LEGACY_COMPLETED')), 'async completed history');
  const perm = await session(dirs[0], [{ permission: 'bash', pattern: '*', action: 'ask' }]); const pendingPerm = request('POST', `/session/${perm.id}/message`, input('LEGACY_PERMISSION'));
  const permission = await until(async () => (await request('GET', '/permission')).find(item => item.sessionID === perm.id), 'permission');
  assert.equal(await request('POST', `/permission/${permission.id}/reply`, { reply: 'once' }), true); const permAnswer = await pendingPerm; assert.match(JSON.stringify(permAnswer), /LEGACY_COMPLETED/);
  const questionSession = await session(); const pendingQuestion = request('POST', `/session/${questionSession.id}/message`, input('LEGACY_QUESTION'));
  const question = await until(async () => (await request('GET', '/question')).find(item => item.sessionID === questionSession.id), 'question');
  assert.equal(await request('POST', `/question/${question.id}/reply`, { answers: [['Yes']] }), true); assert.match(JSON.stringify(await pendingQuestion), /LEGACY_COMPLETED/);
  const editSession = await session(); assert.match(JSON.stringify(await request('POST', `/session/${editSession.id}/message`, input('LEGACY_EDIT'))), /LEGACY_COMPLETED/);
  const diff = await request('GET', `/session/${editSession.id}/diff`); assert.equal(fs.readFileSync(path.join(dirs[0], 'created.txt'), 'utf8'), 'after\n');
  if (diff.length) { assert.equal(diff[0].file, 'created.txt'); assert.equal(diff[0].before, ''); assert.equal(diff[0].after, 'after\n'); assert.equal(diff[0].additions, 1); }
  const stop = await session(); const pendingStop = request('POST', `/session/${stop.id}/message`, input('LEGACY_HOLD')); await until(() => held > 0, 'model hold'); assert.equal(await request('POST', `/session/${stop.id}/abort`), true); assert.equal((await pendingStop).info.error.name, 'MessageAbortedError');
  assert(events.some(item => item.payload.type === 'message.part.delta')); assert(events.some(item => item.payload.type === 'permission.asked')); assert(events.some(item => item.payload.type === 'question.asked'));
  const b = await session(dirs[1], [{ permission: 'bash', pattern: '*', action: 'ask' }]); const pendingB = request('POST', `/session/${b.id}/message`, input('LEGACY_PERMISSION'), dirs[1]);
  const bPermission = await until(async () => (await request('GET', '/permission', undefined, dirs[1])).find(item => item.sessionID === b.id), 'B permission');
  await request('POST', '/instance/dispose'); await sleep(250); assert(!bStream.ended, 'B stream ended during A disposal');
  assert((await request('GET', '/permission', undefined, dirs[1])).some(item => item.id === bPermission.id));
  assert.equal(await request('POST', `/permission/${bPermission.id}/reply`, { reply: 'once' }, dirs[1]), true); assert.match(JSON.stringify(await pendingB), /LEGACY_COMPLETED/);
  await until(() => events.some(item => item.directory === 'b' && item.payload.type === 'permission.replied' && item.payload.properties.requestID === bPermission.id), 'B existing stream');
  assert.equal((await request('GET', `/session/${text.id}/message`)).length, 2);
  assert(aStream.ended || events.some(item => item.directory === 'a' && item.payload.type === 'server.instance.disposed'));
  const summary = { output: out, exeSha256, requests: captures.length, events: events.length, modelCalls: calls.length, checks: ['text', 'history', 'async-acceptance-and-completion', 'permission', 'question', 'file-write', 'stop', 'stream', 'directory-disposal'], nonemptyDiff: diff.length > 0 };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  for (const entry of streams) entry.ctl.abort(); await Promise.all(streams.map(entry => entry.done));
  child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)]); log.end();
  for (const socket of sockets) socket.destroy(); await new Promise(resolve => modelServer.close(resolve));
  fs.writeFileSync(path.join(out, 'fixtures.json'), JSON.stringify({ requests: captures, events, modelCalls: sanitize(calls) }, null, 2));
}
