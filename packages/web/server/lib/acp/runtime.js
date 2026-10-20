import { spawnAcp, terminateAcp } from './process.js';
import { createInterface } from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ACP_SERVER_MODE, serverSchema, openServerTransport } from './server-transport.js';
import { METHOD, UPDATE, initializeSchema, sessionResultSchema, listSchema, configSchema, modesSchema, commandsSchema, usageSchema, localUpdateSchema } from './protocol.js';
import { createElicitations } from './elicitation.js';
import { createAcpCallbacks } from './callbacks.js';
import { resolveProjectCwd } from './project-mapping.js';

const optionSchema = z.object({ optionId: z.string(), name: z.string(), kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']) });
const contentSchema = z.object({ type: z.string(), text: z.string().optional(), uri: z.string().optional(), mimeType: z.string().optional(), data: z.string().optional(), name: z.string().optional(), resource: z.object({ uri: z.string(), mimeType: z.string().optional(), text: z.string().optional(), blob: z.string().optional() }).optional() });
const toolContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), content: contentSchema }),
  z.object({ type: z.literal('diff'), path: z.string(), oldText: z.string().nullable().optional(), newText: z.string() }),
  z.object({ type: z.literal('terminal'), terminalId: z.string() }),
]);
const planSchema = z.array(z.object({ content: z.string(), status: z.enum(['pending', 'in_progress', 'completed']), priority: z.enum(['high', 'medium', 'low']) }));
const inputSchema = z.record(z.string(), z.json());
const updateSchema = z.object({
  sessionUpdate: z.string(), content: z.union([contentSchema, z.array(toolContentSchema)]).optional(), toolCallId: z.string().optional(),
  title: z.string().nullable().optional(), kind: z.string().optional(), status: z.string().optional(),
  rawInput: z.json().optional(), rawOutput: z.json().optional(),
}).passthrough();
const rpcSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).optional(), method: z.string().optional(), params: z.json().optional(), result: z.json().optional(), error: z.object({ code: z.number(), message: z.string() }).optional() });
const savedEntrySchema = z.object({
  session: z.object({ id: z.string(), directory: z.string(), title: z.string(), time: z.object({ created: z.number(), updated: z.number() }).passthrough() }).passthrough(),
  messages: z.array(z.object({ info: z.object({ id: z.string(), role: z.enum(['user', 'assistant']), time: z.object({ created: z.number() }).passthrough() }).passthrough(), parts: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()) })),
  agentCwd: z.string().optional(), historyComplete: z.boolean().optional(), hidden: z.boolean().optional(), titleOverride: z.boolean().optional(),
  configOptions: configSchema.optional(), modes: modesSchema.optional(), commands: commandsSchema.optional(), usage: usageSchema.optional(),
}).passthrough();

/** One selected stdio agent owns its requests, sessions, transcript and approvals. */
export const createAcpRuntime = ({ storagePath } = {}) => {
  let child = null;
  let stoppingChild = null;
  let termination = null;
  let transport = null;
  let remoteCwd = null;
  let serverConfig = null;
  let callbacks = null;
  let cleanup = Promise.resolve();
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
  let commits = Promise.resolve();
  let hydrated = false;
  let creating = 0;
  const pendingUpdates = new Map();
  const partitions = new Map();
  const sessions = new Map();
  const requests = new Map();
  const permissions = new Map();
  const listeners = new Set();
  const loaded = new Set();
  const loading = new Map();
  const opening = new Map();
  const mutations = new Set();
  // Only live terminal snapshots and the tool parts referencing them. History owns final output.
  const terminalOutputs = new Map();
  const terminalParts = new Map();
  const toolBindings = new Map();

  const descriptor = () => ({ generation: ready ? 'acp' : 'unreachable', endpoint: ready ? endpoint : null, epoch, version: info?.agentInfo?.version ?? null });
  const emit = (event) => {
    const value = { ...event, eventID: `acp:${epoch}:${++sequence}` };
    for (const listener of listeners) listener(value);
  };
  const persist = (values = sessions) => {
    if (!storagePath || !identity) return Promise.resolve();
    const owner = identity;
    const saved = writes.then(async () => {
      const all = new Map(partitions);
      all.set(owner, [...values.values()]);
      const data = JSON.stringify({ version: 2, partitions: Object.fromEntries(all) });
      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(`${storagePath}.tmp`, data, 'utf8');
      await rename(`${storagePath}.tmp`, storagePath);
      partitions.set(owner, [...values.values()]);
    });
    writes = saved.catch(() => {});
    return saved;
  };
  const commit = (build, currentEpoch = epoch) => {
    const saved = commits.then(async () => {
      if (currentEpoch !== epoch) throw new Error('ACP connection changed');
      const changes = build();
      const next = new Map(sessions);
      for (const entry of changes) next.set(entry.session.id, entry);
      await persist(next);
      if (currentEpoch !== epoch) throw new Error('ACP connection changed');
      for (const entry of changes) {
        const previous = sessions.get(entry.session.id);
        if (previous) entry.status = previous.status;
        sessions.set(entry.session.id, entry);
      }
      return changes;
    });
    commits = saved.catch(() => {});
    return saved;
  };
  const assertReady = () => { if (!ready || (!child && !transport)) throw new Error(failure ?? 'ACP agent is not connected'); };
  const terminate = (process) => {
    if (stoppingChild !== process) { stoppingChild = process; termination = terminateAcp(process); }
    return termination;
  };
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
    if (!value || value.hidden) throw new Error(`ACP session ${id} was not found`);
    return value;
  };
  const elicitations = createElicitations({ write, emit, record, agent: () => info?.agentInfo?.title ?? info?.agentInfo?.name ?? 'ACP', epoch: () => epoch, hasRequest: (id) => requests.has(id) });
  const upsertMessage = (entry, message) => {
    let item = entry.messages.find((value) => value.info.id === message.id);
    if (!item) { item = { info: message, parts: [] }; entry.messages.push(item); }
    else item.info = message;
    if (!loading.has(entry.session.id)) emit({ type: 'message-upsert', message, directory: entry.session.directory });
    return item;
  };
  const upsertPart = (entry, message, part) => {
    const index = message.parts.findIndex((value) => value.id === part.id);
    if (index < 0) message.parts.push(part);
    else message.parts[index] = part;
    if (!loading.has(entry.session.id)) emit({ type: 'part-upsert', part, directory: entry.session.directory });
  };
  const renderContent = (sessionID, content) => content.filter((item) => item.type !== 'diff').map((item) => item.type === 'terminal'
    ? terminalOutputs.get(sessionID)?.get(item.terminalId)?.output ?? ''
    : item.content.text ?? item.content.uri ?? '').join('\n');
  const terminalOutput = (snapshot) => {
    let outputs = terminalOutputs.get(snapshot.sessionId);
    if (!outputs) { outputs = new Map(); terminalOutputs.set(snapshot.sessionId, outputs); }
    outputs.set(snapshot.terminalId, snapshot);
    for (const binding of terminalParts.get(snapshot.sessionId)?.get(snapshot.terminalId)?.values() ?? []) {
      const part = binding.message.parts.find((value) => value.id === binding.id);
      if (!part) continue;
      const output = renderContent(snapshot.sessionId, binding.content);
      if (part.state.status === 'running') {
        if (part.state.metadata?.output === output) continue;
        upsertPart(binding.entry, binding.message, { ...part, state: { ...part.state, metadata: { ...part.state.metadata, output } } });
      } else if (part.state.status === 'completed') {
        if (part.state.output === output) continue;
        upsertPart(binding.entry, binding.message, { ...part, state: { ...part.state, output } });
      }
    }
  };
  const releaseCallbacks = async (sessionID, owner = callbacks) => {
    await owner?.stop(sessionID);
    if (owner !== callbacks) return;
    if (sessionID === undefined) { terminalOutputs.clear(); terminalParts.clear(); toolBindings.clear(); }
    else { terminalOutputs.delete(sessionID); terminalParts.delete(sessionID); toolBindings.delete(sessionID); }
  };
  const status = (entry, type, outcome, error) => {
    const owner = sessions.get(entry.session.id) ?? entry;
    owner.status = { type };
    emit({ type: 'status', sessionID: owner.session.id, status: owner.status, outcome, error, directory: owner.session.directory });
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
    if (callbacks) {
      cleanup = releaseCallbacks().catch((error) => {
        failure = error.message;
        emit({ type: 'connection-inputs', inputs: [], error: failure });
        throw error;
      });
      // Retain the rejection for stop/start while preventing an unhandled rejection.
      void cleanup.catch(() => {});
    }
    for (const pending of requests.values()) { if (pending.timer) clearTimeout(pending.timer); pending.reject(error); }
    requests.clear();
    elicitations.clear();
    emit({ type: 'connection-inputs', inputs: [], error: failure });
    for (const [id, pending] of permissions) emit({ type: 'permission-replied', requestID: id, sessionID: pending.value.sessionID, directory: record(pending.value.sessionID).session.directory });
    permissions.clear();
    for (const entry of sessions.values()) {
      entry.session.readOnly = true;
      if (!entry.hidden) emit({ type: 'session-upsert', session: entry.session, directory: entry.session.directory });
      if (entry.status.type === 'busy') status(entry, 'idle', 'failed', { type: 'acp', message: error.message });
    }
  };
  const capabilities = () => ({ load: info?.agentCapabilities.loadSession === true, resume: Boolean(info?.agentCapabilities.sessionCapabilities?.resume), delete: Boolean(info?.agentCapabilities.sessionCapabilities?.delete) });
  const controls = (entry) => {
    const value = { configOptions: entry.configOptions ?? [], commands: entry.commands ?? [], capabilities: capabilities() };
    if (entry.modes) value.modes = entry.modes;
    if (entry.usage) value.usage = entry.usage;
    return value;
  };
  const touch = (entry) => {
    entry.session.time.updated = Math.max(Date.now(), entry.session.time.updated + 1);
    return entry;
  };
  const refresh = (entry) => {
    emit({ type: 'session-upsert', session: entry.session, directory: entry.session.directory });
    emit({ type: 'session-refresh', sessionID: entry.session.id, directory: entry.session.directory });
  };
  const applyControls = (entry, result) => {
    if (result.configOptions !== undefined) entry.configOptions = result.configOptions;
    if (result.modes !== undefined) entry.modes = result.modes;
  };
  const idle = (id) => {
    const entry = record(id);
    if (entry.status.type === 'busy' || loading.has(id) || mutations.has(id)) throw new Error('ACP session is already running');
    return entry;
  };
  const onUpdate = (params) => {
    const parsed = z.object({ sessionId: z.string(), update: updateSchema }).parse(params);
    if (!sessions.has(parsed.sessionId) && creating) { pendingUpdates.set(parsed.sessionId, [...(pendingUpdates.get(parsed.sessionId) ?? []), params]); return; }
    if (sessions.get(parsed.sessionId)?.hidden) return;
    const replay = loading.get(parsed.sessionId);
    const entry = replay ?? record(parsed.sessionId);
    const update = parsed.update;
    let changed = true;
    if (update.sessionUpdate === UPDATE.CONFIG) entry.configOptions = configSchema.parse(update.configOptions);
    else if (update.sessionUpdate === UPDATE.MODE && entry.modes) entry.modes.currentModeId = z.string().parse(update.currentModeId);
    else if (update.sessionUpdate === UPDATE.COMMANDS) entry.commands = commandsSchema.parse(update.availableCommands);
    else if (update.sessionUpdate === UPDATE.USAGE) entry.usage = usageSchema.parse(update);
    else if (update.sessionUpdate === UPDATE.INFO) {
      if (update.title !== undefined && update.title !== null && !entry.titleOverride) entry.session.title = z.string().parse(update.title);
      if (update.updatedAt !== undefined && update.updatedAt !== null) { const time = Date.parse(z.string().parse(update.updatedAt)); if (Number.isFinite(time)) entry.session.time.updated = time; }
    } else changed = false;
    if (changed) { if (!replay) { touch(entry); refresh(entry); void persist().catch(fail); } return; }
    if (replay && update.sessionUpdate === UPDATE.USER) {
      let user = entry.messages.at(-1);
      if (user?.info.role !== 'user') {
        const id = randomUUID();
        user = upsertMessage(entry, { id, sessionID: entry.session.id, role: 'user', time: { created: Date.now() + entry.messages.length } });
        entry.assistantID = null;
      }
      if (update.content?.type === 'text') {
        const previous = user.parts.at(-1);
        if (previous?.type === 'text') previous.text += update.content.text ?? '';
        else upsertPart(entry, user, { id: randomUUID(), sessionID: entry.session.id, messageID: user.info.id, type: 'text', text: update.content.text ?? '' });
      } else if (update.content?.type === 'resource_link') upsertPart(entry, user, { id: randomUUID(), sessionID: entry.session.id, messageID: user.info.id, type: 'file', url: update.content.uri, filename: update.content.name, mime: update.content.mimeType ?? 'application/octet-stream' });
      else if ([ 'image', 'audio' ].includes(update.content?.type) && update.content.data) upsertPart(entry, user, { id: randomUUID(), sessionID: entry.session.id, messageID: user.info.id, type: 'file', url: `data:${update.content.mimeType};base64,${update.content.data}`, mime: update.content.mimeType });
      else if (update.content?.type === 'resource' && update.content.resource) {
        const resource = update.content.resource;
        const mime = resource.mimeType ?? (resource.text !== undefined ? 'text/plain' : 'application/octet-stream');
        const data = resource.text !== undefined ? Buffer.from(resource.text, 'utf8').toString('base64') : resource.blob;
        upsertPart(entry, user, { id: randomUUID(), sessionID: entry.session.id, messageID: user.info.id, type: 'file', url: data === undefined ? resource.uri : `data:${mime};base64,${data}`, mime });
      }
      return;
    }
    let message = entry.messages.find((value) => value.info.id === entry.assistantID);
    if (!message && replay && [UPDATE.TEXT, UPDATE.THOUGHT, UPDATE.TOOL, UPDATE.TOOL_UPDATE, UPDATE.PLAN].includes(update.sessionUpdate)) {
      const id = randomUUID(); entry.assistantID = id;
      message = upsertMessage(entry, { id, sessionID: entry.session.id, role: 'assistant', agent: info.agentInfo?.name ?? 'acp', providerID: 'acp', modelID: 'agent', parentID: entry.messages.at(-1)?.info.id, time: { created: Date.now() + entry.messages.length } });
    }
    if (!message) return;
    if (update.sessionUpdate === UPDATE.PLAN) {
      const todos = planSchema.parse(update.entries);
      const id = `acp-plan:${message.info.id}`;
      const previous = message.parts.find((part) => part.id === id);
      const now = Date.now();
      upsertPart(entry, message, { id, sessionID: entry.session.id, messageID: message.info.id, type: 'tool', callID: id, tool: 'todowrite', state: { status: 'completed', input: { todos }, title: 'Plan', output: '', time: { start: previous?.state.time.start ?? now, end: now } } });
    } else if (update.sessionUpdate === UPDATE.TEXT || update.sessionUpdate === UPDATE.THOUGHT) {
      if (update.content?.type !== 'text') return;
      const type = update.sessionUpdate === UPDATE.THOUGHT ? 'reasoning' : 'text';
      const previous = message.parts.at(-1);
      if (previous?.type === type) {
        previous.text += update.content.text ?? '';
        if (!replay) emit({ type: 'part-delta', sessionID: entry.session.id, messageID: message.info.id, partID: previous.id, delta: update.content.text ?? '', directory: entry.session.directory });
      } else upsertPart(entry, message, { id: randomUUID(), sessionID: entry.session.id, messageID: message.info.id, type, text: update.content.text ?? '', time: { start: Date.now() } });
    } else if (update.sessionUpdate === UPDATE.TOOL || update.sessionUpdate === UPDATE.TOOL_UPDATE) {
      if (!update.toolCallId) throw new Error('ACP tool update has no toolCallId');
      const previous = message.parts.find((value) => value.type === 'tool' && value.callID === update.toolCallId);
      const parsedInput = inputSchema.safeParse(update.rawInput);
      const input = update.rawInput === undefined ? previous?.state.input ?? {} : parsedInput.success ? parsedInput.data : { value: update.rawInput };
      const title = update.title ?? previous?.state.title ?? update.toolCallId;
      const start = previous?.state.time?.start ?? Date.now();
      const toolContent = z.array(toolContentSchema).safeParse(update.content);
      let owners = terminalParts.get(entry.session.id);
      if (!owners) { owners = new Map(); terminalParts.set(entry.session.id, owners); }
      let bindings = toolBindings.get(entry.session.id);
      if (!bindings) { bindings = new Map(); toolBindings.set(entry.session.id, bindings); }
      const binding = bindings.get(update.toolCallId);
      const content = toolContent.success ? toolContent.data : binding?.content;
      const rendered = content ? renderContent(entry.session.id, content) : undefined;
      const stringOutput = z.string().safeParse(update.rawOutput);
      const output = rendered ?? (update.rawOutput === undefined ? previous?.state.output ?? '' : stringOutput.success ? stringOutput.data : JSON.stringify(update.rawOutput));
      const toolStatus = update.status ?? previous?.state.status;
      const diffs = toolContent.success ? toolContent.data.filter((item) => item.type === 'diff') : previous?.state.metadata?.diffs;
      const metadata = diffs?.length ? { acp: true, diffs } : { acp: true };
      const state = toolStatus === 'completed' ? { status: 'completed', input, title, output, metadata, time: { start, end: Date.now() } }
        : toolStatus === 'failed' || toolStatus === 'error' ? { status: 'error', input, error: output || title, time: { start, end: Date.now() } }
          : { status: 'running', input, title, metadata: { ...metadata, output }, time: { start } };
      const part = { id: previous?.id ?? randomUUID(), sessionID: entry.session.id, messageID: message.info.id, type: 'tool', callID: update.toolCallId, tool: update.kind ?? previous?.tool ?? 'acp', state };
      upsertPart(entry, message, part);
      if (toolContent.success || binding) {
        for (const item of binding?.content ?? []) if (item.type === 'terminal') {
          const parts = owners.get(item.terminalId);
          parts?.delete(update.toolCallId);
          if (!parts?.size) owners.delete(item.terminalId);
        }
        bindings.delete(update.toolCallId);
        const next = { entry, message, id: part.id, content };
        for (const item of content ?? []) if (item.type === 'terminal') {
          let parts = owners.get(item.terminalId);
          if (!parts) { parts = new Map(); owners.set(item.terminalId, parts); }
          parts.set(update.toolCallId, next);
          bindings.set(update.toolCallId, next);
        }
      }
    }
  };
  const onLine = (line) => {
    const value = rpcSchema.parse(JSON.parse(line));
    const currentEpoch = epoch;
    const originChild = child;
    const originTransport = transport;
    const respond = (body) => {
      if (currentEpoch !== epoch || originChild !== child || originTransport !== transport) return;
      try { const sent = write({ jsonrpc: '2.0', id: value.id, ...body }); if (sent) void sent.catch(fail); }
      catch (error) { fail(error); }
    };
    if (value.method && value.id !== undefined && callbacks?.handles(value.method)) {
      const owner = callbacks;
      void owner.request(value.method, value.params).then((result) => respond({ result }), (error) => respond({ error: { code: error instanceof z.ZodError ? -32602 : -32603, message: error.message } }));
      return;
    }
    try {
      if (value.method === METHOD.ELICIT && value.id !== undefined) {
        try { elicitations.create(value.id, value.params); }
        catch { respond({ error: { code: -32602, message: 'Invalid or unsupported elicitation parameters' } }); }
        return;
      }
      if (value.method === METHOD.ELICIT_COMPLETE) { elicitations.complete(value.params); return; }
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
      if (value.method && value.id !== undefined) { respond({ error: { code: -32601, message: `Unsupported client method: ${value.method}` } }); return; }
      const pending = requests.get(value.id);
      if (!pending) return;
      requests.delete(value.id);
      void elicitations.cancel('request', value.id).catch(fail);
      if (pending.timer) clearTimeout(pending.timer);
      if (value.error) pending.reject(new Error(`ACP ${value.error.code}: ${value.error.message}`));
      else if (value.result !== undefined) pending.resolve(value.result);
      else pending.reject(new Error('ACP response has no result'));
    } catch (error) {
      if (!value.method || value.id === undefined) throw error;
      respond({ error: { code: error instanceof z.ZodError ? -32602 : -32603, message: error.message } });
    }
  };
  const stop = async () => {
    await elicitations.cancel().catch(fail);
    await cleanup;
    await releaseCallbacks();
    callbacks = null;
    if (child || transport) epoch += 1;
    if (transport) {
      await cancelPermissions().catch(fail);
      const previous = transport;
      transport = null;
      fail(new Error('ACP connection closed'));
      await previous.close();
    }
    if (child) {
      await cancelPermissions();
      const previous = child;
      fail(new Error('ACP connection closed'));
      await terminate(previous);
      if (child === previous) child = null;
    }
    await closed;
    await commits;
    loaded.clear();
    loading.clear();
    opening.clear();
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
    serverConfig = remote ? config : null;
    endpoint = remote ? config.url : 'acp:stdio';
    const nextIdentity = createHash('sha256').update(JSON.stringify(remote ? [config.mode, config.transport, config.url, config.cwd] : [config.command, config.args])).digest('hex');
    if (!hydrated && storagePath) {
      try {
        const saved = z.object({ identity: z.string().nullable().optional(), sessions: z.array(z.json()).optional(), partitions: z.record(z.string(), z.array(z.json())).optional() }).parse(JSON.parse(await readFile(storagePath, 'utf8')));
        for (const [key, values] of Object.entries(saved.partitions ?? {})) partitions.set(key, values);
        if (saved.identity && saved.sessions && !partitions.has(saved.identity)) partitions.set(saved.identity, saved.sessions);
      } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot read ACP transcript: ${error.message}`); }
    }
    hydrated = true;
    if (identity) partitions.set(identity, [...sessions.values()]);
    const restored = (partitions.get(nextIdentity) ?? []).map((value) => savedEntrySchema.parse(value));
    identity = nextIdentity;
    sessions.clear();
    for (const entry of restored) {
      entry.status = { type: 'idle' };
      entry.session.readOnly = true;
      entry.agentCwd ??= remoteCwd ?? entry.session.directory;
      // Legacy transcripts were complete local conversations, including empty new sessions.
      entry.historyComplete ??= true;
      sessions.set(entry.session.id, entry);
    }
    const currentEpoch = epoch;
    callbacks = remote ? null : createAcpCallbacks({ directory: (id) => record(id).agentCwd, onOutput: (snapshot) => { if (currentEpoch === epoch) terminalOutput(snapshot); } });
    if (remote) {
      try {
        transport = await openServerTransport(config, (line) => { if (currentEpoch === epoch) onLine(line); }, (error) => { if (currentEpoch === epoch) fail(error); });
      } catch (error) { fail(error); throw error; }
    } else {
      try { child = await spawnAcp(config); }
      catch (error) { fail(error); throw error; }
      const process = child;
      closed = new Promise((resolve) => process.once('close', resolve));
      process.stdin.on('error', (error) => { if (currentEpoch === epoch) fail(error); });
      process.on('error', (error) => { if (currentEpoch === epoch) fail(error); });
      process.on('exit', (code, signal) => { if (child === process) { child = null; fail(new Error(`ACP agent exited (${signal ?? code})`)); } });
      process.stderr.resume();
      createInterface({ input: process.stdout }).on('line', (line) => {
        if (child !== process) return;
        try { onLine(line); } catch (error) { fail(new Error(`Invalid ACP message: ${error.message}`)); void terminate(process).catch(fail); }
      });
    }
    try {
      info = initializeSchema.parse(await rpc(METHOD.INITIALIZE, { protocolVersion: 1, clientCapabilities: { ...callbacks?.capabilities, elicitation: { form: {}, url: {} } }, clientInfo: { name: 'openchamber', version: '1' } }));
      ready = true;
      for (const entry of sessions.values()) {
        entry.session.readOnly = !capabilities().load && !capabilities().resume;
        if (!entry.hidden) emit({ type: 'session-upsert', session: entry.session, directory: entry.session.directory });
      }
      return descriptor();
    } catch (error) { fail(error); if (child) await terminate(child); await closed; child = null; if (transport) { await transport.close(); transport = null; } throw error; }
  };
  const createSession = async ({ directory, title }) => {
    assertReady();
    if (!isAbsolute(directory)) throw new Error('ACP session directory must be absolute');
    creating += 1;
    try {
      const currentEpoch = epoch;
      const agentCwd = serverConfig ? resolveProjectCwd(serverConfig, directory) : directory;
      const result = sessionResultSchema.parse(await rpc(METHOD.NEW, { cwd: agentCwd, mcpServers: [] }));
      if (currentEpoch !== epoch) throw new Error('ACP connection changed');
      if (!result.sessionId) throw new Error('ACP session/new returned no sessionId');
      const now = Date.now();
      const session = { id: result.sessionId, projectID: directory, directory, title: title || info.agentInfo?.title || info.agentInfo?.name || 'ACP', time: { created: now, updated: now }, readOnly: false };
      if (sessions.has(session.id)) throw new Error('ACP session/new reused an existing session ID');
      const entry = { session, messages: [], status: { type: 'idle' }, modes: result.modes, configOptions: result.configOptions, agentCwd, historyComplete: true, titleOverride: Boolean(title) };
      await commit(() => { if (sessions.has(session.id)) throw new Error('ACP session/new reused an existing session ID'); return [entry]; }, currentEpoch);
      loaded.add(session.id);
      for (const value of pendingUpdates.get(session.id) ?? []) onUpdate(value);
      pendingUpdates.delete(session.id);
      emit({ type: 'session-upsert', session, directory });
      return session;
    } finally { creating -= 1; if (!creating) pendingUpdates.clear(); }
  };
  const discover = async (scope) => {
    assertReady();
    if (!info.agentCapabilities.sessionCapabilities?.list) return visibleSessions(scope);
    const currentEpoch = epoch;
    const discovered = [];
    const agentCwd = scope ? serverConfig ? resolveProjectCwd(serverConfig, scope) : localDirectory(scope) : undefined;
    const cursors = new Set();
    let cursor;
    do {
      const params = {};
      if (scope) params.cwd = agentCwd;
      if (cursor) params.cursor = cursor;
      const page = listSchema.parse(await rpc(METHOD.LIST, params));
      if (currentEpoch !== epoch) throw new Error('ACP connection changed');
      discovered.push(...page.sessions);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('ACP session/list repeated a cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const changes = await commit(() => {
      const changes = [];
      for (const item of discovered) {
        if (agentCwd && (serverConfig ? item.cwd !== agentCwd : localDirectory(item.cwd) !== agentCwd)) continue;
        const previous = sessions.get(item.sessionId);
        if (previous?.hidden || loading.has(item.sessionId) || mutations.has(item.sessionId)) continue;
        if (previous?.status.type === 'busy') continue;
        const updated = Date.parse(item.updatedAt ?? '');
        const now = Number.isFinite(updated) ? updated : previous?.session.time.updated ?? Date.now();
        const group = previous?.session.directory ?? scope ?? serverConfig?.projectMappings?.find((mapping) => mapping.cwd === item.cwd)?.directory ?? item.cwd;
        const session = previous ? { ...previous.session, time: { ...previous.session.time, updated: Math.max(previous.session.time.updated, now) } } : { id: item.sessionId, projectID: group, directory: group, title: item.title ?? info.agentInfo?.name ?? 'ACP', time: { created: now, updated: now }, readOnly: !capabilities().load && !capabilities().resume };
        if (item.title && !previous?.titleOverride) session.title = item.title;
        if (!previous && !capabilities().load) session.metadata = { acpHistoryIncomplete: true };
        const entry = previous ? { ...previous, session } : { session, messages: [], status: { type: 'idle' }, agentCwd: item.cwd, historyComplete: false };
        changes.push(entry);
      }
      return changes;
    }, currentEpoch);
    for (const entry of changes) emit({ type: 'session-upsert', session: entry.session, directory: entry.session.directory });
    return visibleSessions(scope);
  };
  const restore = async (id) => {
    assertReady();
    const entry = record(id);
    if (loaded.has(id)) return entry.messages;
    idle(id);
    const currentEpoch = epoch;
    const caps = capabilities();
    if (!caps.load && !caps.resume) return entry.messages;
    const resume = caps.resume && (entry.historyComplete || !caps.load);
    const staged = structuredClone(entry);
    const callbackOwner = callbacks;
    staged.assistantID = null;
    if (!resume) staged.messages = [];
    loading.set(id, staged);
    try {
      const result = sessionResultSchema.parse(await rpc(resume ? METHOD.RESUME : METHOD.LOAD, { sessionId: id, cwd: entry.agentCwd, mcpServers: [] }));
      if (currentEpoch !== epoch) throw new Error('ACP connection changed');
      await releaseCallbacks(id, callbackOwner);
      applyControls(staged, result);
      if (!resume) {
        staged.historyComplete = true;
        if (staged.session.metadata) delete staged.session.metadata.acpHistoryIncomplete;
        for (const message of staged.messages) if (message.info.role === 'assistant') { message.info.time.completed = message.info.time.created; message.info.finish = 'end_turn'; }
      }
      touch(staged);
      await commit(() => [staged], currentEpoch); loaded.add(id);
      refresh(staged);
      if (!resume) emit({ type: 'transcript-refresh', sessionID: id, directory: staged.session.directory });
      return staged.messages;
    } finally {
      try { await releaseCallbacks(id, callbackOwner); }
      finally { if (loading.get(id) === staged) loading.delete(id); }
    }
  };
  const open = (id) => {
    if (opening.has(id)) return opening.get(id);
    const promise = restore(id).finally(() => { if (opening.get(id) === promise) opening.delete(id); });
    opening.set(id, promise); return promise;
  };
  const updateSession = async (id, value) => {
    const entry = idle(id);
    const patch = localUpdateSchema.parse(value);
    const currentEpoch = epoch;
    mutations.add(id);
    try {
      const next = structuredClone(entry);
      if (patch.title !== undefined) { next.session.title = patch.title; next.titleOverride = true; }
      if (patch.metadata !== undefined) next.session.metadata = { ...next.session.metadata, ...patch.metadata };
      if (patch.time?.archived !== undefined) { if (patch.time.archived === null) delete next.session.time.archived; else next.session.time.archived = patch.time.archived; }
      next.session.time.updated = Math.max(Date.now(), next.session.time.updated + 1);
      await commit(() => [next], currentEpoch); refresh(next); return next.session;
    } finally { mutations.delete(id); }
  };
  const deleteSession = async (id) => {
    const entry = idle(id);
    const currentEpoch = epoch;
    mutations.add(id);
    try {
      const hidden = { ...entry, hidden: true };
      await releaseCallbacks(id);
      if (capabilities().delete) { assertReady(); await rpc(METHOD.DELETE, { sessionId: id }); }
      await commit(() => [hidden], currentEpoch); loaded.delete(id);
      emit({ type: 'session-delete', sessionID: id, directory: entry.session.directory }); return true;
    } finally { mutations.delete(id); }
  };
  const setConfig = async (id, configId, value) => {
    await open(id); const entry = record(id); assertReady();
    if (mutations.has(id)) throw new Error('ACP session controls are being updated');
    const option = entry.configOptions?.find((item) => item.id === configId);
    const choices = option?.options.flatMap((item) => 'group' in item ? item.options : [item]);
    if (!choices?.some((item) => item.value === value)) throw new Error('Unknown ACP config value');
    const currentEpoch = epoch;
    mutations.add(id);
    try {
      const result = z.object({ configOptions: configSchema }).parse(await rpc(METHOD.CONFIG, { sessionId: id, configId, value }));
      if (currentEpoch !== epoch) throw new Error('ACP connection changed');
      const [next] = await commit(() => { const current = record(id); return [touch({ ...current, session: { ...current.session, time: { ...current.session.time } }, configOptions: result.configOptions })]; }, currentEpoch);
      refresh(next); return controls(next);
    } finally { mutations.delete(id); }
  };
  // Compare local UI grouping keys without changing the agent's saved cwd.
  const localDirectory = (value) => process.platform === 'win32'
    ? resolve(value).replace(/^([a-z]):/, (_, drive) => `${drive.toUpperCase()}:`) : value;
  const inDirectory = (entry, scope) => !scope || localDirectory(entry.session.directory) === localDirectory(scope);
  const visibleSessions = (scope) => [...sessions.values()].filter((entry) => !entry.hidden && inDirectory(entry, scope)).map((entry) => entry.session);
  const prompt = async ({ sessionID, messageID, text, files = [] }) => {
    assertReady();
    const currentEpoch = epoch;
    if (!loaded.has(sessionID)) {
      if (!capabilities().load && !capabilities().resume) throw new Error('This ACP agent cannot resume the saved session');
      await open(sessionID);
    }
    const entry = idle(sessionID);
    if (currentEpoch !== epoch) throw new Error('ACP connection changed');
    const content = [{ type: 'text', text }];
    for (const file of files) {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(file.url);
      if (match && match[1].startsWith('image/') && info.agentCapabilities.promptCapabilities?.image) content.push({ type: 'image', mimeType: match[1], data: match[2] });
      else if (match && match[1].startsWith('audio/') && info.agentCapabilities.promptCapabilities?.audio) content.push({ type: 'audio', mimeType: match[1], data: match[2] });
      else if (match && match[1] === 'text/plain' && info.agentCapabilities.promptCapabilities?.embeddedContext) content.push({ type: 'resource', resource: { uri: `attachment:${encodeURIComponent(file.filename ?? 'text.txt')}`, mimeType: match[1], text: Buffer.from(match[2], 'base64').toString('utf8') } });
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
    const callbackOwner = callbacks;
    void rpc(METHOD.PROMPT, { sessionId: sessionID, prompt: content }, 0).then(async (value) => {
      if (currentEpoch !== epoch) return;
      const result = z.object({ stopReason: z.string() }).parse(value);
      await releaseCallbacks(sessionID, callbackOwner);
      if (currentEpoch !== epoch) return;
      assistant.info.time.completed = Date.now();
      assistant.info.finish = result.stopReason;
      for (const part of assistant.parts) if (part.time) part.time.end = Date.now();
      upsertMessage(entry, assistant.info);
      status(entry, 'idle', result.stopReason === 'cancelled' ? 'interrupted' : 'completed');
    }).catch(async (error) => {
      if (currentEpoch !== epoch) return;
      try { await releaseCallbacks(sessionID, callbackOwner); } catch (cleanupError) { error = cleanupError; }
      if (currentEpoch !== epoch) return;
      assistant.info.error = { type: 'acp', message: error.message };
      assistant.info.time.completed = Date.now();
      upsertMessage(entry, assistant.info);
      status(entry, 'idle', 'failed', assistant.info.error);
    }).finally(() => { if (currentEpoch === epoch) { void cancelPermissions(sessionID).catch(fail); void elicitations.cancel('session', sessionID).catch(fail); void persist().catch(fail); } });
    return { messageID };
  };
  const cancel = async (sessionID) => {
    assertReady(); record(sessionID); await cancelPermissions(sessionID); await elicitations.cancel('session', sessionID);
    const callbackOwner = callbacks;
    await write({ jsonrpc: '2.0', method: METHOD.CANCEL, params: { sessionId: sessionID } });
    await releaseCallbacks(sessionID, callbackOwner);
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
    start, stop, descriptor, createSession, prompt, cancel, reply, discover, open, updateSession, deleteSession, setConfig,
    info: () => ({ ...info, epoch, error: failure }),
    directory: () => directory,
    sessions: visibleSessions,
    session: (id) => record(id).session,
    messages: (id) => record(id).messages,
    statuses: (directory) => Object.fromEntries([...sessions.values()].filter((entry) => !entry.hidden && inDirectory(entry, directory)).map((entry) => [entry.session.id, entry.status])),
    permissions: (directory) => [...permissions.values()].filter((entry) => inDirectory(record(entry.value.sessionID), directory)).map((entry) => ({ generation: 'acp', value: entry.value })),
    inputs: (directory) => elicitations.sessions().filter((input) => inDirectory(record(input.value.sessionID), directory)),
    connectionInputs: elicitations.global,
    replyInput: (id, answer) => { assertReady(); return elicitations.reply(id, answer); },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    authenticate: (methodId, expectedEpoch = epoch) => {
      assertReady();
      if (expectedEpoch !== epoch) throw new Error('ACP connection changed');
      const method = info.authMethods.find((method) => method.id === methodId);
      if (!method) throw new Error('Unknown ACP authentication method');
      if (method.type && method.type !== 'agent') throw new Error('This authentication method requires login through the agent CLI');
      return rpc(METHOD.AUTH, { methodId }, 0);
    },
    controls: async (id) => { await open(id); return controls(record(id)); },
    commands: (scope) => [...new Map([...sessions.values()].filter((entry) => !entry.hidden && inDirectory(entry, scope)).flatMap((entry) => (entry.commands ?? []).map((command) => [command.name, command]))).values()],
    setMode: async (id, modeId) => {
      await open(id); const entry = record(id); assertReady();
      if (mutations.has(id)) throw new Error('ACP session controls are being updated');
      if (entry.configOptions?.length) throw new Error('Use ACP config options for this session');
      if (!entry.modes?.availableModes.some((mode) => mode.id === modeId)) throw new Error('Unknown ACP session mode');
      const currentEpoch = epoch; mutations.add(id);
      try {
        await rpc(METHOD.MODE, { sessionId: id, modeId });
        const [next] = await commit(() => { const current = record(id); return [touch({ ...current, session: { ...current.session, time: { ...current.session.time } }, modes: { ...current.modes, currentModeId: modeId } })]; }, currentEpoch);
        refresh(next); return controls(next);
      } finally { mutations.delete(id); }
    },
  };
};
