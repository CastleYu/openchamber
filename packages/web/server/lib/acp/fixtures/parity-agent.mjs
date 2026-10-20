import { createInterface } from 'node:readline';

const scenario = process.argv[2] ?? 'parity';
let count = 0;
let pending;
const removed = new Set();
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const update = (sessionId, value) => send({ method: 'session/update', params: { sessionId, update: value } });
const choices = (value = 'small') => [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: value, options: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }] }, ...(value === 'large' ? [{ id: 'reasoning', name: 'Reasoning', type: 'select', currentValue: 'high', options: [{ value: 'high', name: 'High' }] }] : [])];
createInterface({ input: process.stdin }).on('line', (line) => {
  const value = JSON.parse(line);
  const id = value.params?.sessionId;
  const reply = (result) => send({ id: value.id, result });
  const error = () => send({ id: value.id, error: { code: -32000, message: 'fixture failure' } });
  if (value.method === 'initialize') return reply({ protocolVersion: 1, agentInfo: { name: 'parity', version: '1' }, agentCapabilities: { loadSession: scenario !== 'resume-only', sessionCapabilities: { list: {}, resume: scenario === 'load-only' || scenario === 'load-fail' ? null : {}, delete: scenario === 'local-delete' ? null : {}, close: null }, promptCapabilities: { embeddedContext: true, audio: true } } });
  if (value.method === 'session/new') {
    const sessionId = `new-${++count}`;
    update(sessionId, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'review', description: 'Review changes', input: null }] });
    return reply({ sessionId, configOptions: [...choices(), { type: 'boolean', id: 'future', name: 'Future', currentValue: true }], modes: null });
  }
  if (value.method === 'session/list') {
    if (scenario === 'native-list') {
      if (value.params.cwd !== process.cwd()) return error();
      return reply({ sessions: [
        { sessionId: 'external-a', cwd: process.cwd().replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`) },
        { sessionId: 'other-project', cwd: `${process.cwd()}-other` },
      ] });
    }
    if (scenario === 'list-fail' && value.params.cursor) return error();
    const sessionId = value.params.cursor ? 'external-b' : 'external-a';
    return reply({ sessions: removed.has(sessionId) ? [] : [{ sessionId, cwd: value.params.cwd ?? process.cwd(), title: sessionId, updatedAt: '2026-10-14T00:00:00Z' }], nextCursor: value.params.cursor ? null : 'page-two' });
  }
  if (value.method === 'session/load') {
    update(id, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'history question' } });
    update(id, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'history thought' } });
    update(id, { sessionUpdate: 'tool_call', toolCallId: 'edit', kind: 'edit', title: 'Edit file', status: 'in_progress', rawInput: { path: 'x' } });
    update(id, { sessionUpdate: 'tool_call_update', toolCallId: 'edit', status: 'completed', content: [{ type: 'diff', path: 'x', oldText: 'before', newText: 'after' }] });
    update(id, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'history answer' } });
    update(id, { sessionUpdate: 'usage_update', used: 42, size: 1000, cost: { amount: 0.02, currency: 'USD' } });
    update(id, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'review', description: 'Review changes', input: { hint: 'scope' } }] });
    if (scenario === 'load-fail') return error();
    return reply({ configOptions: choices() });
  }
  if (value.method === 'session/resume') return reply({ configOptions: choices(), modes: null });
  if (value.method === 'session/delete') { removed.add(id); return reply({}); }
  if (value.method === 'session/set_config_option') {
    update(id, { sessionUpdate: 'config_option_update', configOptions: choices(value.params.value) });
    update(id, { sessionUpdate: 'usage_update', used: 70, size: 1000 });
    update(id, { sessionUpdate: 'session_info_update', title: 'agent title' });
    update(id, { sessionUpdate: 'session_info_update', title: null, updatedAt: null });
    reply({ configOptions: choices(value.params.value) });
    if (pending) { send({ id: pending, result: { stopReason: 'end_turn' } }); pending = null; }
    return;
  }
  if (value.method === 'session/prompt') {
    update(id, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(value.params) } });
    if (scenario === 'busy') { pending = value.id; return; }
    return reply({ stopReason: 'end_turn' });
  }
});
