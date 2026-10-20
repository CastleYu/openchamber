import { createInterface } from 'node:readline';

const scenario = process.argv[2];
const send = (value) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...value })}\n`);
const reply = (id, result) => send({ id, result });
const update = (value) => send({ method: 'session/update', params: { sessionId: 'session-1', update: value } });
let promptID;
const finish = (stopReason = 'end_turn') => reply(promptID, { stopReason });
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  switch (request.method) {
    case 'initialize':
      if (JSON.stringify(request.params.clientCapabilities) !== JSON.stringify({ fs: { readTextFile: true, writeTextFile: true }, terminal: true, elicitation: { form: {}, url: {} } })) throw new Error('Unexpected client capabilities advertised');
      if (scenario === 'malformed') { process.stdout.write('not json\n'); break; }
      reply(request.id, { protocolVersion: 1, agentInfo: { name: 'fixture', version: scenario === 'lifecycle' ? String(process.pid) : '1' }, agentCapabilities: { loadSession: scenario !== 'no-load' }, authMethods: [] });
      break;
    case 'session/new':
      if (!request.params.cwd || request.params.mcpServers.length) throw new Error('Invalid new session');
      reply(request.id, { sessionId: 'session-1' });
      break;
    case 'session/load':
      if (request.params.sessionId !== 'session-1') throw new Error('Unexpected restored session');
      update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Hello' } });
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'replayed history' } });
      reply(request.id, {});
      break;
    case 'session/prompt':
      promptID = request.id;
      if (scenario === 'exit') { process.exit(7); break; }
      if (scenario === 'error') { send({ id: request.id, error: { code: -32000, message: 'fixture failure' } }); break; }
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } });
      update({ sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Read file', kind: 'read', status: 'in_progress', rawInput: ['file.txt'], content: [] });
      if (scenario === 'permission' || scenario === 'cancel') {
        send({ id: 'approval', method: 'session/request_permission', params: { sessionId: 'session-1', toolCall: { toolCallId: 'tool-1', title: 'Read file' }, options: [{ optionId: 'yes-exact', name: 'Allow this read', kind: 'allow_once' }, { optionId: 'no-exact', name: 'Reject this read', kind: 'reject_once' }] } });
      } else {
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello ' } });
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } });
        finish();
      }
      break;
    case 'session/cancel': finish('cancelled'); break;
    default:
      if (request.id === 'approval') {
        if (request.result.outcome.outcome === 'cancelled') break;
        if (request.result.outcome.optionId !== 'yes-exact') throw new Error('Wrong option id');
        update({ sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'file content' } }, { type: 'diff', path: 'file.txt', oldText: null, newText: 'new content' }] });
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'approved' } });
        finish();
      }
  }
});
