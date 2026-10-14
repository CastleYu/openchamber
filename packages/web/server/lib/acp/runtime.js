import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ACP_SERVER_MODE, serverSchema, openServerTransport } from './server-transport.js';

const METHOD = Object.freeze({
  INITIALIZE: 'initialize', NEW: 'session/new', LOAD: 'session/load',
  PROMPT: 'session/prompt', CANCEL: 'session/cancel', UPDATE: 'session/update',
  PERMISSION: 'session/request_permission', AUTH: 'authenticate', MODE: 'session/set_mode',
});
const optionSchema = z.object({ optionId: z.string(), name: z.string(), kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']) });
const contentSchema = z.object({ type: z.string(), text: z.string().optional(), uri: z.string().optional(), mimeType: z.string().optional(), data: z.string().optional() });
const toolContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), content: contentSchema }),
  z.object({ type: z.literal('diff'), path: z.string(), oldText: z.string().nullable().optional(), newText: z.string() }),
]);
const inputSchema = z.record(z.string(), z.json());
const updateSchema = z.object({
  sessionUpdate: z.string(), content: z.union([contentSchema, z.array(toolContentSchema)]).optional(), toolCallId: z.string().optional(),
  title: z.string().optional(), kind: z.string().optional(), status: z.string().optional(),
  rawInput: z.json().optional(), rawOutput: z.json().optional(),
}).passthrough();
const sessionResultSchema = z.object({
  sessionId: z.string().optional(),
  modes: z.object({ currentModeId: z.string(), availableModes: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() })) }).optional(),
});
const initializeSchema = z.object({
  protocolVersion: z.literal(1),
  agentInfo: z.object({ name: z.string(), title: z.string().optional(), version: z.string() }).optional(),
  agentCapabilities: z.object({ loadSession: z.boolean().optional(), promptCapabilities: z.object({ image: z.boolean().optional(), audio: z.boolean().optional(), embeddedContext: z.boolean().optional() }).optional() }).default({}),
  authMethods: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() })).default([]),
});
const rpcSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).optional(), method: z.string().optional(), params: z.json().optional(), result: z.json().optional(), error: z.object({ code: z.number(), message: z.string() }).optional() });

/** One selected stdio agent owns its requests, sessions, transcript and approvals. */
export const createAcpRuntime = ({ storagePath } = {}) => {
  let child = null;
  let transport = null;
  let remoteCwd = null;
  let endpoint = 'acp:stdio';
  let closed = Promise.resolve();
  let epoch = 0;
  let sequence = 0;
  let identity = null;
  let info = null;
  let failure = null;
  let ready = false;
  let directory = null;
  let writes = Promise.resolve();
  const sessions = new Map();
  const requests = new Map();
  const permissions = new Map();
  const listeners = new Set();
  const loaded = new Set();
  const loading = new Set();

  const descriptor = () => ({ generation: ready ? 'acp' : 'unreachable', endpoint: ready ? endpoint : null, epoch, version: info?.agentInfo?.version ?? null });
  const emit = (event) => {
    const value = { ...event, eventID: `acp:${epoch}:${++sequence}` };
    for (const listener of listeners) listener(value);
  };
  const persist = () => {
    if (!storagePath || !identity) return Promise.resolve();
    const data = JSON.stringify({ identity, sessions: [...sessions.values()] });
    const saved = writes.then(async () => {
      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(`${storagePath}.tmp`, data, 'utf8');
      await rename(`${storagePath}.tmp`, storagePath);
    });
    writes = saved.catch(() => {});
    return saved;
  };
  const assertReady = () => { if (!ready || (!child && !transport)) throw new Error(failure ?? 'ACP agent is not connected'); };
  const write = (value) => {
    if (transport) return transport.send(value);
    if (!child || child.stdin.destroyed) throw new Error('ACP agent is not connected');
    child.stdin.write(`${JSON.stringify(value)}\n`);
  };
  const rpc = (method, params, timeout = 30000) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = timeout ? setTimeout(() => { requests.delete(id); reject(new Error(`ACP ${method} timed out`)); }, timeout) : null;
    requests.set(id, { resolve, reject, timer });
    try { const sent = write({ jsonrpc: '2.0', id, method, params }); if (sent) void sent.catch(fail); }
    catch (error) { requests.delete(id); if (timer) clearTimeout(timer); reject(error); }
  });
  const record = (id) => {
    const value = sessions.get(id);
    if (!value) throw new Error(`ACP session ${id} was not found`);
    return value;
  };
  const upsertMessage = (entry, message) => {
    let item = entry.messages.find((value) => value.info.id === message.id);
    if (!item) { item = { info: message, parts: [] }; entry.messages.push(item); }
    else item.info = message;
    emit({ type: 'message-upsert', message, directory: entry.session.directory });
    return item;
  };
  const upsertPart = (entry, message, part) => {
    const index = message.parts.findIndex((value) => value.id === part.id);
    if (index < 0) message.parts.push(part);
    else message.parts[index] = part;
    emit({ type: 'part-upsert', part, directory: entry.session.directory });
  };
  const status = (entry, type, outcome, error) => {
    entry.status = { type };
    emit({ type: 'status', sessionID: entry.session.id, status: entry.status, outcome, error, directory: entry.session.directory });
  };
  const cancelPermissions = (sessionID) => {
    const sent = [];
    for (const [id, pending] of permissions) {
      if (sessionID && pending.value.sessionID !== sessionID) continue;
      const result = transport || (child && !child.stdin.destroyed) ? write({ jsonrpc: '2.0', id: pending.rpcID, result: { outcome: { outcome: 'cancelled' } } }) : null;
      const complete = () => {
        if (!permissions.delete(id)) return;
        emit({ type: 'permission-replied', requestID: id, sessionID: pending.value.sessionID, directory: record(pending.value.sessionID).session.directory });
      };
      if (result) sent.push(result.then(complete));
      else complete();
    }
    return Promise.all(sent);
  };
  const fail = (error) => {
    failure = error.message;
    ready = false;
    for (const pending of requests.values()) { if (pending.timer) clearTimeout(pending.timer); pending.reject(error); }
    requests.clear();
    for (const [id, pending] of permissions) emit({ type: 'permission-replied', requestID: id, sessionID: pending.value.sessionID, directory: record(pending.value.sessionID).session.directory });
    permissions.clear();
    for (const entry of sessions.values()) {
      entry.session.readOnly = true;
      emit({ type: 'session-upsert', session: entry.session, directory: entry.session.directory });
      if (entry.status.type === 'busy') status(entry, 'idle', 'failed', { type: 'acp', message: error.message });
    }
  };
  const onUpdate = (params) => {
    const parsed = z.object({ sessionId: z.string(), update: updateSchema }).parse(params);
    const entry = record(parsed.sessionId);
    if (loading.has(parsed.sessionId)) return;
    const update = parsed.update;
    let message = entry.messages.find((value) => value.info.id === entry.assistantID);
    if (!message) return;
    if (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk') {
      if (update.content?.type !== 'text') return;
      const type = update.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'text';
      const previous = message.parts.at(-1);
      if (previous?.type === type) {
        previous.text += update.content.text ?? '';
        emit({ type: 'part-delta', sessionID: entry.session.id, messageID: message.info.id, partID: previous.id, delta: update.content.text ?? '', directory: entry.session.directory });
      } else upsertPart(entry, message, { id: randomUUID(), sessionID: entry.session.id, messageID: message.info.id, type, text: update.content.text ?? '', time: { start: Date.now() } });
    } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      if (!update.toolCallId) throw new Error('ACP tool update has no toolCallId');
      const previous = message.parts.find((value) => value.type === 'tool' && value.callID === update.toolCallId);
      const parsedInput = inputSchema.safeParse(update.rawInput);
      const input = update.rawInput === undefined ? previous?.state.input ?? {} : parsedInput.success ? parsedInput.data : { value: update.rawInput };
      const title = update.title ?? previous?.state.title ?? update.toolCallId;
      const start = previous?.state.time?.start ?? Date.now();
      const toolContent = z.array(toolContentSchema).safeParse(update.content);
      const rendered = toolContent.success ? toolContent.data.map((item) => item.type === 'diff' ? `${item.path}\n${item.newText}` : item.content.text ?? item.content.uri ?? '').join('\n') : undefined;
      const stringOutput = z.string().safeParse(update.rawOutput);
      const output = rendered ?? (update.rawOutput === undefined ? previous?.state.output ?? '' : stringOutput.success ? stringOutput.data : JSON.stringify(update.rawOutput));
      const toolStatus = update.status ?? previous?.state.status;
      const state = toolStatus === 'completed' ? { status: 'completed', input, title, output, time: { start, end: Date.now() } }
        : toolStatus === 'failed' || toolStatus === 'error' ? { status: 'error', input, error: output || title, time: { start, end: Date.now() } }
          : { status: 'running', input, title, time: { start } };
      upsertPart(entry, message, { id: previous?.id ?? randomUUID(), sessionID: entry.session.id, messageID: message.info.id, type: 'tool', callID: update.toolCallId, tool: update.kind ?? previous?.tool ?? 'acp', state });
    }
  };
  const onLine = (line) => {
    const value = rpcSchema.parse(JSON.parse(line));
    if (value.method === METHOD.UPDATE) { onUpdate(value.params); return; }
    if (value.method === METHOD.PERMISSION && value.id !== undefined) {
      const params = z.object({ sessionId: z.string(), options: z.array(optionSchema).min(1), toolCall: z.object({ toolCallId: z.string(), title: z.string().optional() }) }).parse(value.params);
      const entry = record(params.sessionId);
      const id = `acp-permission:${epoch}:${value.id}`;
      const permission = { id, sessionID: params.sessionId, title: params.toolCall.title ?? params.toolCall.toolCallId, options: params.options };
      permissions.set(id, { rpcID: value.id, value: permission });
      emit({ type: 'permission-asked', request: { generation: 'acp', value: permission }, directory: entry.session.directory });
      return;
    }
    if (value.method && value.id !== undefined) { const sent = write({ jsonrpc: '2.0', id: value.id, error: { code: -32601, message: `Unsupported client method: ${value.method}` } }); if (sent) void sent.catch(fail); return; }
    const pending = requests.get(value.id);
    if (!pending) return;
    requests.delete(value.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (value.error) pending.reject(new Error(`ACP ${value.error.code}: ${value.error.message}`));
    else if (value.result !== undefined) pending.resolve(value.result);
    else pending.reject(new Error('ACP response has no result'));
  };
  const stop = async () => {
    if (transport) {
      await cancelPermissions().catch(fail);
      const previous = transport;
      transport = null;
      fail(new Error('ACP connection closed'));
      await previous.close();
    }
    if (child) {
      cancelPermissions();
      const previous = child;
      child = null;
      fail(new Error('ACP connection closed'));
      previous.kill();
    }
    await closed;
    loaded.clear();
    await persist();
  };
  const start = async (selection) => {
    const remote = selection.mode === ACP_SERVER_MODE;
    const config = remote ? serverSchema.parse(selection) : z.object({ command: z.string().min(1), args: z.array(z.string()).default([]), cwd: z.string().refine(isAbsolute, 'ACP cwd must be absolute') }).parse(selection);
    await stop();
    epoch += 1;
    info = null;
    failure = null;
    directory = remote ? process.cwd() : config.cwd;
    remoteCwd = remote ? config.cwd : null;
    endpoint = remote ? config.url : 'acp:stdio';
    const nextIdentity = createHash('sha256').update(JSON.stringify(remote ? [config.mode, config.transport, config.url, config.cwd] : [config.command, config.args])).digest('hex');
    if (identity !== nextIdentity) sessions.clear();
    identity = nextIdentity;
    if (storagePath && sessions.size === 0) {
      try {
        const saved = JSON.parse(await readFile(storagePath, 'utf8'));
        if (saved.identity === identity && Array.isArray(saved.sessions)) {
          for (const entry of saved.sessions) {
            if (entry.session?.id && Array.isArray(entry.messages)) {
              entry.status = { type: 'idle' };
              entry.session.readOnly = true;
              sessions.set(entry.session.id, entry);
            }
          }
        }
      } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read ACP transcript: ${error.message}`); }
    }
    const currentEpoch = epoch;
    if (remote) {
      try {
        transport = await openServerTransport(config, (line) => { if (currentEpoch === epoch) onLine(line); }, (error) => { if (currentEpoch === epoch) fail(error); });
      } catch (error) { fail(error); throw error; }
    } else {
      child = spawn(config.command, config.args, { cwd: config.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
      const process = child;
      closed = new Promise((resolve) => process.once('close', resolve));
      process.stdin.on('error', (error) => { if (currentEpoch === epoch) fail(error); });
      process.on('error', (error) => { if (currentEpoch === epoch) fail(error); });
      process.on('exit', (code, signal) => { if (child === process) { child = null; fail(new Error(`ACP agent exited (${signal ?? code})`)); } });
      process.stderr.resume();
      createInterface({ input: process.stdout }).on('line', (line) => {
        if (child !== process) return;
        try { onLine(line); } catch (error) { fail(new Error(`Invalid ACP message: ${error.message}`)); process.kill(); }
      });
    }
    try {
      info = initializeSchema.parse(await rpc(METHOD.INITIALIZE, { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'openchamber', version: '1' } }));
      ready = true;
      for (const entry of sessions.values()) {
        entry.session.readOnly = !info.agentCapabilities.loadSession;
        emit({ type: 'session-upsert', session: entry.session, directory: entry.session.directory });
      }
      return descriptor();
    } catch (error) { fail(error); if (child) child.kill(); if (transport) { await transport.close(); transport = null; } throw error; }
  };
  const createSession = async ({ directory, title }) => {
    assertReady();
    if (!isAbsolute(directory)) throw new Error('ACP session directory must be absolute');
    const currentEpoch = epoch;
    const result = sessionResultSchema.parse(await rpc(METHOD.NEW, { cwd: remoteCwd ?? directory, mcpServers: [] }));
    if (currentEpoch !== epoch) throw new Error('ACP connection changed');
    if (!result.sessionId) throw new Error('ACP session/new returned no sessionId');
    const now = Date.now();
    const session = { id: result.sessionId, projectID: directory, directory, title: title || info.agentInfo?.title || info.agentInfo?.name || 'ACP', time: { created: now, updated: now }, readOnly: false };
    sessions.set(session.id, { session, messages: [], status: { type: 'idle' }, modes: result.modes });
    loaded.add(session.id);
    emit({ type: 'session-upsert', session, directory });
    await persist();
    return session;
  };
  const prompt = async ({ sessionID, messageID, text, files = [] }) => {
    assertReady();
    const entry = record(sessionID);
    const currentEpoch = epoch;
    if (entry.status.type === 'busy' || loading.has(sessionID)) throw new Error('ACP session is already running');
    if (!loaded.has(sessionID)) {
      if (!info.agentCapabilities.loadSession) throw new Error('This ACP agent cannot resume the saved session');
      loading.add(sessionID);
      try { await rpc(METHOD.LOAD, { sessionId: sessionID, cwd: remoteCwd ?? entry.session.directory, mcpServers: [] }); loaded.add(sessionID); }
      finally { loading.delete(sessionID); }
    }
    if (currentEpoch !== epoch) throw new Error('ACP connection changed');
    const content = [{ type: 'text', text }];
    for (const file of files) {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(file.url);
      if (match && match[1].startsWith('image/') && info.agentCapabilities.promptCapabilities?.image) content.push({ type: 'image', mimeType: match[1], data: match[2] });
      else if (file.url.startsWith('file:') && !remoteCwd) content.push({ type: 'resource_link', uri: file.url, name: file.filename ?? file.url });
      else if (file.url.startsWith('file:')) throw new Error('Local file attachments are unsupported by an ACP server connection');
      else throw new Error('The selected ACP agent does not support this attachment');
    }
    const now = Math.max(Date.now(), (entry.messages.at(-1)?.info.time.created ?? 0) + 1);
    const previousID = entry.assistantID;
    const previousTime = entry.session.time.updated;
    const user = { info: { id: messageID, sessionID, role: 'user', time: { created: now } }, parts: [{ id: `${messageID}:text:0`, sessionID, messageID, type: 'text', text }] };
    for (const [index, file] of files.entries()) user.parts.push({ id: `${messageID}:file:${index}`, sessionID, messageID, type: 'file', url: file.url, filename: file.filename, mime: /^data:([^;]+);/.exec(file.url)?.[1] ?? 'application/octet-stream' });
    entry.assistantID = randomUUID();
    const assistant = { info: { id: entry.assistantID, sessionID, role: 'assistant', agent: info.agentInfo?.name ?? 'acp', providerID: 'acp', modelID: 'agent', parentID: messageID, time: { created: now + 1 } }, parts: [] };
    entry.messages.push(user, assistant);
    status(entry, 'busy');
    entry.session.time.updated = now;
    try { await persist(); }
    catch (error) {
      entry.messages = entry.messages.filter((message) => message !== user && message !== assistant);
      entry.assistantID = previousID;
      entry.session.time.updated = previousTime;
      status(entry, 'idle', 'failed', { type: 'acp', message: error.message });
      throw error;
    }
    upsertMessage(entry, user.info);
    for (const part of user.parts) upsertPart(entry, user, part);
    upsertMessage(entry, assistant.info);
    void rpc(METHOD.PROMPT, { sessionId: sessionID, prompt: content }, 0).then((value) => {
      if (currentEpoch !== epoch) return;
      const result = z.object({ stopReason: z.string() }).parse(value);
      assistant.info.time.completed = Date.now();
      assistant.info.finish = result.stopReason;
      for (const part of assistant.parts) if (part.time) part.time.end = Date.now();
      upsertMessage(entry, assistant.info);
      status(entry, 'idle', result.stopReason === 'cancelled' ? 'interrupted' : 'completed');
    }).catch((error) => {
      if (currentEpoch !== epoch) return;
      assistant.info.error = { type: 'acp', message: error.message };
      assistant.info.time.completed = Date.now();
      upsertMessage(entry, assistant.info);
      status(entry, 'idle', 'failed', assistant.info.error);
    }).finally(() => { if (currentEpoch === epoch) { void cancelPermissions(sessionID).catch(fail); void persist().catch(fail); } });
    return { messageID };
  };
  const cancel = async (sessionID) => {
    assertReady(); record(sessionID); await cancelPermissions(sessionID);
    await write({ jsonrpc: '2.0', method: METHOD.CANCEL, params: { sessionId: sessionID } });
    return true;
  };
  const reply = (id, optionID) => {
    assertReady();
    const pending = permissions.get(id);
    if (!pending) throw new Error('ACP permission is no longer pending');
    if (!pending.value.options.some((option) => option.optionId === optionID)) throw new Error('Invalid ACP permission option');
    const sent = write({ jsonrpc: '2.0', id: pending.rpcID, result: { outcome: { outcome: 'selected', optionId: optionID } } });
    const complete = () => {
      permissions.delete(id);
      emit({ type: 'permission-replied', sessionID: pending.value.sessionID, requestID: id, directory: record(pending.value.sessionID).session.directory });
      return true;
    };
    return sent ? sent.then(complete) : complete();
  };
  return {
    start, stop, descriptor, createSession, prompt, cancel, reply,
    info: () => ({ ...info, error: failure }),
    directory: () => directory,
    sessions: (directory) => [...sessions.values()].filter((entry) => !directory || entry.session.directory === directory).map((entry) => entry.session),
    session: (id) => record(id).session,
    messages: (id) => record(id).messages,
    statuses: (directory) => Object.fromEntries([...sessions.values()].filter((entry) => !directory || entry.session.directory === directory).map((entry) => [entry.session.id, entry.status])),
    permissions: (directory) => [...permissions.values()].filter((entry) => !directory || record(entry.value.sessionID).session.directory === directory).map((entry) => ({ generation: 'acp', value: entry.value })),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    authenticate: (methodId) => { assertReady(); if (!info.authMethods.some((method) => method.id === methodId)) throw new Error('Unknown ACP authentication method'); return rpc(METHOD.AUTH, { methodId }); },
    setMode: async (sessionID, modeId) => { assertReady(); const entry = record(sessionID); if (!entry.modes?.availableModes.some((mode) => mode.id === modeId)) throw new Error('Unknown ACP session mode'); await rpc(METHOD.MODE, { sessionId: sessionID, modeId }); entry.modes.currentModeId = modeId; return entry.modes; },
  };
};
