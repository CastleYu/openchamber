import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import { OpenCode } from '@opencode/client';
import { z } from 'zod';

const GENERATION = Object.freeze({ OC1: 'oc1', OC2: 'oc2' });
const STATUS = Object.freeze({ BUSY: 'busy', RETRY: 'retry', IDLE: 'idle', RUNNING: 'running' });
const ERROR_CODE = Object.freeze({
  INVALID_RESPONSE: 'invalid-response',
  UNKNOWN_STATUS: 'unknown-status',
  UNSUPPORTED_GENERATION: 'unsupported-generation',
  MISSING_ENDPOINT: 'missing-endpoint',
  RUNTIME_CHANGED: 'runtime-changed',
  INVALID_DIRECTORY: 'invalid-directory',
  UNSUPPORTED_OPERATION: 'unsupported-operation',
  INVALID_CURSOR: 'invalid-cursor',
});
const sessionSchema = z.object({ id: z.string().min(1) }).passthrough();
const legacyMessagesSchema = z.array(z.object({
  info: z.object({ id: z.string().min(1), role: z.string() }).passthrough(),
  parts: z.array(z.object({ type: z.string() }).passthrough()),
}).passthrough());
const currentMessagesSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1), type: z.string() }).passthrough()),
  cursor: z.object({ previous: z.string().nullish(), next: z.string().nullish() }),
});
const currentSessionsSchema = z.object({
  data: z.array(sessionSchema),
  cursor: z.object({ previous: z.string().nullish(), next: z.string().nullish() }),
});
const configEntriesSchema = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('document'), info: z.object({}).passthrough() }).passthrough(),
  z.object({ type: z.literal('directory'), path: z.string() }).passthrough(),
]));
const statusSchema = z.record(z.string(), z.object({ type: z.string() }).passthrough());
const commandsSchema = z.array(z.object({ name: z.string().min(1) }).passthrough());
const isRecord = (value) => z.object({}).passthrough().safeParse(value).success;
const mergeMetadataPatch = (current, patch) => {
  const next = isRecord(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = isRecord(value) ? mergeMetadataPatch(next[key], value) : value;
  }
  return next;
};

const kernelError = (code, message, generation = null) => Object.assign(new Error(message), {
  name: 'KernelOperationError', code, generation,
});

const requireData = (response, schema, label) => {
  const parsed = schema.safeParse(response?.data);
  if (!parsed.success) throw kernelError(ERROR_CODE.INVALID_RESPONSE, `${label} returned an invalid response`);
  return response.data;
};

const sessionView = (session, generation) => {
  sessionSchema.parse(session);
  const directory = generation === GENERATION.OC1 ? session.directory : session.location?.directory;
  if (!z.string().min(1).safeParse(directory).success) {
    throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Session directory is missing', generation);
  }
  const view = { id: session.id, directory, raw: session };
  if (session.title !== undefined) view.title = session.title;
  if (session.parentID) view.parentID = session.parentID;
  if (session.revert) view.revert = session.revert;
  if (session.metadata) view.metadata = session.metadata;
  if (session.time) view.time = session.time;
  return view;
};

const toolView = (part, generation) => ({
  id: part.id,
  name: generation === GENERATION.OC1 ? part.tool : part.name,
  status: part.state?.status,
  raw: part,
});

const messageView = (record, generation) => {
  const legacy = generation === GENERATION.OC1;
  const info = legacy ? record.info : record;
  const parts = legacy ? record.parts : record.content;
  const texts = (parts ?? []).filter((part) => part.type === 'text' && z.string().safeParse(part.text).success);
  const text = legacy ? texts.map((part) => part.text).join('')
    : info.type === 'user' || info.type === 'synthetic' ? info.text : texts.map((part) => part.text).join('');
  const tools = (parts ?? []).filter((part) => part.type === 'tool').map((part) => toolView(part, generation));
  const model = legacy
    ? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : null)
    : info.model;
  const view = { id: info.id, role: legacy ? info.role : info.type, tools, raw: record };
  if (text) view.text = text;
  if (info.time?.created !== undefined) view.created = info.time.created;
  if (info.time?.completed !== undefined) view.completed = info.time.completed;
  if (info.finish) view.finish = info.finish;
  if (info.error) view.error = info.error;
  if (info.summary) view.summary = info.summary;
  if (info.tokens) view.tokens = info.tokens;
  if (info.parentID) view.parentID = info.parentID;
  if (model) view.model = model;
  return view;
};

const activeStatus = (value, generation) => {
  const type = value.type;
  if (generation === GENERATION.OC2 && type === STATUS.RUNNING) return { type: STATUS.BUSY };
  if (generation === GENERATION.OC1 && (type === STATUS.BUSY || type === STATUS.RETRY || type === STATUS.IDLE)) return value;
  throw kernelError(ERROR_CODE.UNKNOWN_STATUS, `Unrecognized ${generation} session status: ${type}`, generation);
};

export const createKernelOperations = ({ getRuntime, getHeaders, fetchImpl = fetch, prepareSession = null }) => {
  const metadataWrites = new Map();
  const capture = (directory) => {
    const runtime = getRuntime();
    const generation = runtime?.generation;
    if (generation !== GENERATION.OC1 && generation !== GENERATION.OC2) {
      throw kernelError(ERROR_CODE.UNSUPPORTED_GENERATION, 'OpenCode generation is not ready', generation);
    }
    if (!z.string().url().safeParse(runtime.endpoint).success) {
      throw kernelError(ERROR_CODE.MISSING_ENDPOINT, 'OpenCode endpoint is not ready', generation);
    }
    const headers = new Headers(getHeaders());
    if (generation === GENERATION.OC2 && directory) {
      headers.set('x-opencode-directory', encodeURIComponent(directory));
    }
    const options = { baseUrl: runtime.endpoint, headers, fetch: fetchImpl };
    const client = generation === GENERATION.OC1
      ? createOpencodeClient({ ...options, throwOnError: true })
      : OpenCode.make(options);
    return { generation, endpoint: runtime.endpoint, epoch: runtime.epoch, client, directory };
  };

  const check = (context) => {
    const current = getRuntime();
    if (current?.generation !== context.generation || current.endpoint !== context.endpoint || current.epoch !== context.epoch) {
      throw kernelError(ERROR_CODE.RUNTIME_CHANGED, 'OpenCode runtime changed during operation', context.generation);
    }
  };

  const stamped = (context, data) => ({
    generation: context.generation, endpoint: context.endpoint, epoch: context.epoch, data,
  });
  const captureIdentity = () => {
    const { generation, endpoint, epoch } = capture();
    return { generation, endpoint, epoch };
  };
  const requestOptions = (signal) => signal ? { signal } : undefined;
  const prepare = async (context, sessionID) => {
    if (context.generation !== GENERATION.OC2 || !prepareSession) return;
    check(context);
    await prepareSession({ sessionID, directory: context.directory, identity: {
      generation: context.generation, endpoint: context.endpoint, epoch: context.epoch,
    } });
    check(context);
  };

  const getSession = async ({ sessionID, directory, signal }) => {
    const context = capture(directory);
    await prepare(context, sessionID);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.session.get({ sessionID, directory }, requestOptions(signal))
      : context.client.session.get({ sessionID }, requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1 ? requireData(response, sessionSchema, 'Session get') : sessionSchema.parse(response);
    return stamped(context, sessionView(data, context.generation));
  };

  const createSession = async ({ directory, title, parentID, agent, model, metadata, signal, expectedIdentity }) => {
    const context = capture(directory);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    if (!z.string().min(1).safeParse(directory).success) {
      throw kernelError(ERROR_CODE.INVALID_DIRECTORY, 'Session directory is required', context.generation);
    }
    if (context.generation === GENERATION.OC2 && parentID) {
      throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Use forkSession to create an OC2 child session', context.generation);
    }
    const input = {};
    if (title) input.title = title;
    if (parentID) input.parentID = parentID;
    if (agent) input.agent = agent;
    if (model) input.model = model;
    if (metadata) input.metadata = metadata;
    check(context);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.session.create({ directory, ...input }, requestOptions(signal))
      : context.client.session.create({ location: { directory }, ...input }, requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1 ? requireData(response, sessionSchema, 'Session create') : sessionSchema.parse(response);
    return stamped(context, sessionView(data, context.generation));
  };

  const listSessions = async ({ directory, limit, cursor, search, signal } = {}) => {
    const context = capture(directory);
    if (cursor !== undefined && ((context.generation === GENERATION.OC1 && !z.number().int().nonnegative().safeParse(cursor).success)
      || (context.generation === GENERATION.OC2 && !z.string().min(1).safeParse(cursor).success))) {
      throw kernelError(ERROR_CODE.INVALID_CURSOR, 'Session cursor does not match OpenCode generation', context.generation);
    }
    const response = context.generation === GENERATION.OC1
      ? await (directory ? context.client.session.list({ directory, limit, search, start: cursor }, requestOptions(signal))
        : context.client.experimental.session.list({ limit, search, cursor }, requestOptions(signal)))
      : await context.client.session.list({ directory, limit, cursor, search }, requestOptions(signal));
    check(context);
    if (context.generation === GENERATION.OC1) {
      const data = requireData(response, z.array(sessionSchema), 'Session list');
      const page = { items: data.map((item) => sessionView(item, context.generation)), raw: data };
      const next = response.response?.headers.get('x-next-cursor');
      if (next && z.coerce.number().int().nonnegative().safeParse(next).success) page.cursor = { next: Number(next) };
      return stamped(context, page);
    }
    const page = currentSessionsSchema.parse(response);
    return stamped(context, {
      items: page.data.map((item) => sessionView(item, context.generation)), raw: page.data,
      cursor: page.cursor,
    });
  };

  const listMessages = async ({ sessionID, directory, limit, cursor, order = 'desc', signal }) => {
    const context = capture(directory);
    const response = context.generation === GENERATION.OC1
      ? await context.client.session.messages({ sessionID, directory, limit, before: cursor }, requestOptions(signal))
      : await context.client.message.list({ sessionID, limit, order, cursor }, requestOptions(signal));
    check(context);
    if (context.generation === GENERATION.OC1) {
      const data = requireData(response, legacyMessagesSchema, 'Session messages');
      const next = response.response?.headers.get('x-next-cursor');
      const page = { items: data.map((item) => messageView(item, context.generation)), raw: data, order: 'asc' };
      if (next) page.cursor = { next };
      return stamped(context, page);
    }
    const page = currentMessagesSchema.parse(response);
    return stamped(context, {
      items: page.data.map((item) => messageView(item, context.generation)), raw: page.data,
      order, cursor: page.cursor,
    });
  };

  const listChildren = async ({ sessionID, directory, signal }) => {
    const context = capture(directory);
    if (context.generation === GENERATION.OC1) {
      const response = await context.client.session.children({ sessionID, directory }, requestOptions(signal));
      check(context);
      return stamped(context, requireData(response, z.array(sessionSchema), 'Session children')
        .map((item) => sessionView(item, context.generation)));
    }
    const children = [];
    let cursor;
    do {
      const response = currentSessionsSchema.parse(await context.client.session.list({ directory, limit: 100, cursor }, requestOptions(signal)));
      check(context);
      children.push(...response.data.filter((item) => item.parentID === sessionID)
        .map((item) => sessionView(item, context.generation)));
      cursor = response.cursor.next ?? undefined;
    } while (cursor);
    return stamped(context, children);
  };

  const listActiveStatuses = async ({ directory, signal } = {}) => {
    const context = capture(directory);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.session.status({ directory }, requestOptions(signal))
      : context.client.session.active(requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1 ? requireData(response, statusSchema, 'Session status')
      : statusSchema.parse(response);
    return stamped(context, Object.fromEntries(Object.entries(data).map(([id, value]) => [id, activeStatus(value, context.generation)])));
  };

  const getSessionStatus = async ({ sessionID, directory, signal }) => {
    const active = await listActiveStatuses({ directory, signal });
    return { ...active, data: active.data[sessionID] ?? { type: STATUS.IDLE } };
  };

  const listPendingPermissions = async ({ directory, signal } = {}) => {
    const context = capture(directory);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.permission.list({ directory }, requestOptions(signal))
      : context.client.permission.request.list({ location: directory ? { directory } : undefined }, requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1
      ? requireData(response, z.array(z.object({ id: z.string(), sessionID: z.string() }).passthrough()), 'Pending permissions')
      : z.array(z.object({ id: z.string(), sessionID: z.string() }).passthrough()).parse(response?.data);
    return stamped(context, data);
  };

  const replyPermission = async ({ requestID, sessionID, directory, decision = 'once', signal, expectedIdentity }) => {
    const context = capture(directory);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    check(context);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.permission.reply({ requestID, directory, reply: decision }, requestOptions(signal))
      : context.client.permission.reply({ requestID, sessionID, decision }, requestOptions(signal)));
    check(context);
    return stamped(context, context.generation === GENERATION.OC1 ? response.data : response);
  };

  const getMessage = async ({ sessionID, messageID, directory, signal }) => {
    const context = capture(directory);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.session.message({ sessionID, messageID, directory }, requestOptions(signal))
      : context.client.session.message.get({ sessionID, messageID }, requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1 ? response?.data : response;
    if (!isRecord(data)) throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Message get returned an invalid response', context.generation);
    return stamped(context, data);
  };

  const addSynthetic = async ({ sessionID, directory, text, resume = false, signal, expectedIdentity }) => {
    const context = capture(directory);
    if (context.generation !== GENERATION.OC2) throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Synthetic message operation is OC2 only', context.generation);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    check(context);
    const response = await context.client.session.synthetic({ sessionID, text, resume }, requestOptions(signal));
    check(context);
    return stamped(context, response);
  };

  const switchSessionSelection = async ({ sessionID, directory, model, agent, signal, expectedIdentity }) => {
    const context = capture(directory);
    if (context.generation !== GENERATION.OC2) throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'OC2 session selection is required', context.generation);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    if (model) {
      check(context);
      await context.client.session.switchModel({ sessionID, model }, requestOptions(signal));
      check(context);
    }
    if (agent) {
      check(context);
      await context.client.session.switchAgent({ sessionID, agent }, requestOptions(signal));
      check(context);
    }
    return stamped(context, true);
  };

  const listCommands = async ({ directory, signal } = {}) => {
    const context = capture(directory);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.command.list({ directory }, requestOptions(signal))
      : context.client.command.list({ location: directory ? { directory } : undefined }, requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1 ? requireData(response, commandsSchema, 'Command list')
      : commandsSchema.parse(response?.data);
    return stamped(context, data);
  };

  const getSelectionCatalog = async ({ directory, signal } = {}) => {
    const context = capture(directory);
    if (context.generation === GENERATION.OC1) {
      const [providers, agents, config] = await Promise.all([
        context.client.config.providers({ directory }, requestOptions(signal)),
        context.client.app.agents({ directory }, requestOptions(signal)),
        context.client.config.get({ directory }, requestOptions(signal)),
      ]);
      check(context);
      return stamped(context, {
        generation: GENERATION.OC1,
        providers: z.object({ providers: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough().parse(providers.data).providers,
        agents: z.array(z.object({ name: z.string() }).passthrough()).parse(agents.data),
        config: z.object({}).passthrough().parse(config.data),
      });
    }
    const location = directory ? { location: { directory } } : undefined;
    // The OC2 catalog handlers can return an empty cold registry before plugins activate.
    // integration.list waits for Plugin.awaitActivation in the pinned kernel.
    await context.client.integration.list(location, requestOptions(signal));
    check(context);
    const [models, agents, config] = await Promise.all([
      context.client.model.list(location, requestOptions(signal)),
      context.client.agent.list(location, requestOptions(signal)),
      context.client.config.get(location, requestOptions(signal)),
    ]);
    check(context);
    return stamped(context, {
      generation: GENERATION.OC2,
      models: z.array(z.object({ providerID: z.string(), modelID: z.string() }).passthrough()).parse(models?.data),
      agents: z.array(z.object({ id: z.string() }).passthrough()).parse(agents?.data),
      config: configEntriesSchema.parse(config),
    });
  };

  const forkSession = async ({ sessionID, directory, messageID, signal, expectedIdentity }) => {
    const context = capture(directory);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    check(context);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.session.fork({ sessionID, directory, messageID }, requestOptions(signal))
      : context.client.session.fork({ sessionID, before: messageID }, requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1 ? requireData(response, sessionSchema, 'Session fork') : sessionSchema.parse(response);
    return stamped(context, sessionView(data, context.generation));
  };

  const removeSession = async ({ sessionID, directory, signal, expectedIdentity }) => {
    const context = capture(directory);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    if (context.generation !== GENERATION.OC2) {
      throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Fork rollback requires OpenCode 2.x', context.generation);
    }
    check(context);
    await context.client.session.remove({ sessionID }, requestOptions(signal));
    check(context);
    return stamped(context, true);
  };

  const updateSession = async ({ sessionID, directory, title, metadata, replaceMetadata = false, time, signal, expectedIdentity }) => {
    const context = capture(directory);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    if (metadata && !replaceMetadata) await prepare(context, sessionID);
    const write = async () => {
      check(context);
      if (expectedIdentity) assertRequest(context, expectedIdentity);
      const input = { sessionID };
      if (title !== undefined) input.title = title;
      if (time !== undefined) {
        if (context.generation !== GENERATION.OC1) throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'OC2 archive state is owned by OpenChamber', context.generation);
        input.time = time;
      }
      if (metadata) {
        if (context.generation === GENERATION.OC2) {
          if (!isRecord(metadata)) throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Session metadata patch must be an object', context.generation);
          if (replaceMetadata) input.metadata = metadata;
          else {
            const current = sessionSchema.parse(await context.client.session.get({ sessionID }, requestOptions(signal)));
            check(context);
            if (expectedIdentity) assertRequest(context, expectedIdentity);
            input.metadata = mergeMetadataPatch(current.metadata, metadata);
          }
        } else input.metadata = metadata;
      }
      check(context);
      if (expectedIdentity) assertRequest(context, expectedIdentity);
      const response = await (context.generation === GENERATION.OC1
        ? context.client.session.update({ ...input, directory }, requestOptions(signal))
        : context.client.session.update(input, requestOptions(signal)));
      check(context);
      return stamped(context, context.generation === GENERATION.OC1 ? response.data : response);
    };
    if (context.generation !== GENERATION.OC2 || !metadata) return write();
    const key = `${context.endpoint}\0${context.epoch}\0${sessionID}`;
    const previous = metadataWrites.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(write);
    metadataWrites.set(key, current);
    try { return await current; } finally {
      if (metadataWrites.get(key) === current) metadataWrites.delete(key);
    }
  };

  const assertRequest = (context, request) => {
    if (request.generation !== context.generation || request.endpoint !== context.endpoint || request.epoch !== context.epoch) {
      throw kernelError(ERROR_CODE.RUNTIME_CHANGED, 'Send request was built for another OpenCode runtime', context.generation);
    }
  };

  const prepareCurrentSend = async (context, sessionID, request, signal) => {
    if (request.model) {
      await context.client.session.switchModel({ sessionID, model: request.model }, requestOptions(signal));
      check(context);
    }
    if (request.agent) {
      await context.client.session.switchAgent({ sessionID, agent: request.agent }, requestOptions(signal));
      check(context);
    }
    for (const synthetic of request.synthetics ?? []) {
      await context.client.session.synthetic({ ...synthetic, sessionID }, requestOptions(signal));
      check(context);
    }
  };

  const sendPrompt = async ({ sessionID, directory, request, signal }) => {
    const context = capture(directory);
    assertRequest(context, request);
    if (context.generation === GENERATION.OC1) {
      await context.client.session.promptAsync({ ...request.body, sessionID, directory }, requestOptions(signal));
      check(context);
      return { ...stamped(context, null), accepted: true };
    }
    await prepareCurrentSend(context, sessionID, request, signal);
    check(context);
    const receipt = await context.client.session.prompt({ ...request.body, sessionID }, requestOptions(signal));
    check(context);
    for (const synthetic of request.postSynthetics ?? []) {
      await context.client.session.synthetic({ ...synthetic, sessionID }, requestOptions(signal));
      check(context);
    }
    return { ...stamped(context, receipt), accepted: true };
  };

  const sendCommand = async ({ sessionID, directory, request, signal }) => {
    const context = capture(directory);
    assertRequest(context, request);
    if (context.generation === GENERATION.OC1) {
      const response = await context.client.session.command({ ...request.body, sessionID, directory }, requestOptions(signal));
      check(context);
      return { ...stamped(context, response.data), accepted: true };
    }
    await prepareCurrentSend(context, sessionID, request, signal);
    check(context);
    await context.client.session.command({ ...request.body, sessionID }, requestOptions(signal));
    check(context);
    return { ...stamped(context, null), accepted: true };
  };

  const interruptSession = async ({ sessionID, directory, signal }) => {
    const context = capture(directory);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.session.abort({ sessionID, directory }, requestOptions(signal))
      : context.client.session.interrupt({ sessionID }, requestOptions(signal)));
    check(context);
    return stamped(context, context.generation === GENERATION.OC1 ? response.data : response);
  };

  return {
    captureIdentity, getSession, createSession, listSessions, listMessages, listChildren, listActiveStatuses, getSessionStatus,
    listCommands, getSelectionCatalog, forkSession, removeSession, updateSession, sendPrompt, sendCommand, interruptSession,
    listPendingPermissions, replyPermission, getMessage, addSynthetic, switchSessionSelection,
  };
};
