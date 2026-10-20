import { createInterface } from 'node:readline';

const pending = new Map();
let sequence = 1000;
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const result = (id, value) => send({ id, result: value });
const schema = { type: 'object', properties: { name: { type: 'string', minLength: 2, default: 'Sam' }, count: { type: 'integer', minimum: 1, maximum: 3, default: 2 }, ready: { type: 'boolean', default: false }, colors: { type: 'array', minItems: 1, items: { anyOf: [{ const: 'red', title: 'Red' }, { const: 'blue', title: 'Blue' }] }, default: ['red'] }, strategy: { type: 'string', oneOf: [{ const: 'safe', title: 'Safe' }, { const: 'fast', title: 'Fast' }], default: 'safe' } }, required: ['name', 'count', 'ready', 'colors', 'strategy'] };
const elicit = (request, mode, scope) => {
  const id = ++sequence;
  const params = { ...scope, mode, message: 'Choose an approach', ...(mode === 'form' ? { requestedSchema: schema } : { elicitationId: `url-${id}`, url: 'https://login.example.test/authorize?state=opaque' }) };
  pending.set(id, { request, params });
  send({ id, method: 'elicitation/create', params });
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const value = JSON.parse(line);
  if (!value.method) {
    const item = pending.get(value.id);
    if (!item) return;
    pending.delete(value.id);
    if (item.params.mode === 'url' && value.result?.action === 'accept' && item.request.params.prompt?.[0]?.text !== 'wait-url') {
      send({ method: 'elicitation/complete', params: { elicitationId: item.params.elicitationId } });
      send({ method: 'elicitation/complete', params: { elicitationId: item.params.elicitationId } });
    }
    if (item.request.method === 'authenticate') result(item.request.id, {});
    else if (item.request.params.prompt[0].text !== 'wait-url') {
      send({ method: 'session/update', params: { sessionId: item.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(value.result ?? value.error) } } } });
      result(item.request.id, { stopReason: 'end_turn' });
    }
    return;
  }
  if (value.method === 'initialize') {
    if (!value.params.clientCapabilities.elicitation?.form || !value.params.clientCapabilities.elicitation?.url) process.exit(9);
    result(value.id, { protocolVersion: 1, agentInfo: { name: 'fixture', title: 'Fixture Agent', version: '1' }, agentCapabilities: {}, authMethods: [{ id: 'form', name: 'Profile' }, { id: 'url', name: 'Browser', type: 'agent' }, { id: 'fail', name: 'Retry', type: 'agent' }, { id: 'terminal', name: 'CLI', type: 'terminal' }] });
  } else if (value.method === 'session/new') result(value.id, { sessionId: 'session-one' });
  else if (value.method === 'session/prompt') {
    const text = value.params.prompt[0].text;
    if (text === 'exit') { process.exit(1); return; }
    elicit(value, text.includes('url') ? 'url' : 'form', { sessionId: value.params.sessionId });
    if (text === 'exit-form') setTimeout(() => process.exit(1), 40);
  } else if (value.method === 'authenticate') {
    if (value.params.methodId === 'fail') send({ id: value.id, error: { code: -32000, message: 'Login failed, retry' } });
    else elicit(value, value.params.methodId, { requestId: value.id });
  } else if (value.method === 'session/cancel') {
    for (const item of pending.values()) if (item.params.sessionId === value.params.sessionId) result(item.request.id, { stopReason: 'cancelled' });
    // An accepted URL has no pending JSON-RPC callback but still owns this prompt.
    send({ method: 'elicitation/complete', params: { elicitationId: 'unknown' } });
  }
});
