import { createInterface } from 'node:readline';
import { join } from 'node:path';

let sequence = 10000;
let count = 0;
let capabilities;
const sessions = new Map();
const pending = new Map();
const prompts = new Map();
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const request = (method, params) => new Promise((resolve) => { const id = ++sequence; pending.set(id, resolve); send({ id, method, params }); });
const update = (sessionId, update) => send({ method: 'session/update', params: { sessionId, update } });
const text = (sessionId, value) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(value) } });
const prompt = async (value) => {
  const sessionId = value.params.sessionId;
  const params = { sessionId };
  const command = value.params.prompt[0].text;
  if (command === 'normal') {
    const invalid = await request('fs/read_text_file', params);
    const permission = await request('session/request_permission', { sessionId, options: [] });
    const outside = await request('fs/read_text_file', { ...params, path: join(sessions.get(sessionId), '..', 'outside.txt') });
    const path = join(sessions.get(sessionId), 'callback.txt');
    await request('fs/write_text_file', { ...params, path, content: 'file callback ✓\nsecond\n' });
    const read = await request('fs/read_text_file', { ...params, path, line: 2, limit: 1 });
    text(sessionId, { capabilities, invalid: invalid.error?.code, permission: permission.error?.code, outside: outside.error?.code, read: read.result });
  }
  const script = command === 'normal'
    ? 'process.stdout.write("first\\n"); setTimeout(() => process.stdout.write("second ✓\\n"), 50)'
    : 'process.stdout.write(String(process.pid)); setInterval(() => {}, 1000)';
  const created = await request('terminal/create', { ...params, command: process.execPath, args: ['-e', script], outputByteLimit: 128 });
  if (!created.result) throw new Error(JSON.stringify(created));
  const terminalId = created.result.terminalId;
  update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'terminal', kind: 'execute', status: 'in_progress', title: 'Terminal', content: [{ type: 'terminal', terminalId }, { type: 'diff', path: 'changed.txt', oldText: 'old', newText: 'new' }] });
  if (command !== 'normal') {
    let output;
    do { await new Promise((resolve) => setTimeout(resolve, 10)); output = await request('terminal/output', { ...params, terminalId }); } while (!output.result?.output);
    text(sessionId, { terminalId, output: output.result?.output });
    prompts.set(sessionId, value.id);
    if (command === 'disconnect') process.exit(0);
    return;
  }
  await request('terminal/wait_for_exit', { ...params, terminalId });
  update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'terminal', status: 'completed' });
  await request('terminal/release', { ...params, terminalId });
  update(sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Verify callbacks', status: 'in_progress', priority: 'high' }] });
  update(sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Verify callbacks', status: 'completed', priority: 'high' }] });
  send({ id: value.id, result: { stopReason: 'end_turn' } });
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const value = JSON.parse(line);
  if (pending.has(value.id)) { pending.get(value.id)(value); pending.delete(value.id); return; }
  const reply = (result) => send({ id: value.id, result });
  if (value.method === 'initialize') { capabilities = value.params.clientCapabilities; reply({ protocolVersion: 1, agentInfo: { name: 'callbacks', version: '1' }, agentCapabilities: { loadSession: true } }); }
  if (value.method === 'session/new') { const id = `session-${++count}`; sessions.set(id, value.params.cwd); reply({ sessionId: id }); }
  if (value.method === 'session/load') {
    sessions.set(value.params.sessionId, value.params.cwd);
    update(value.params.sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Replayed plan' } });
    update(value.params.sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Replay todo', status: 'pending', priority: 'low' }] });
    update(value.params.sessionId, { sessionUpdate: 'plan', entries: [{ content: 'Replay todo', status: 'completed', priority: 'low' }] });
    reply({});
  }
  if (value.method === 'session/prompt') void prompt(value).catch((error) => send({ id: value.id, error: { code: -32603, message: error.message } }));
  if (value.method === 'session/cancel') { const id = prompts.get(value.params.sessionId); if (id) send({ id, result: { stopReason: 'cancelled' } }); }
});
