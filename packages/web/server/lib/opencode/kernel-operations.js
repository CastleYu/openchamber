import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import { OpenCode } from '@opencode/client';
import { z } from 'zod';
import { OPENCODE_PROFILE } from './compatibility.js';
import { LEGACY_OPERATION, supportsLegacyOperation, supportsLegacyStream } from './legacy-contract.js';
import { LEGACY_CONFIG_KIND, parseLegacyConfig } from './legacy-config.js';

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
  NOT_FOUND: 'not-found',
});
const sessionSchema = z.object({ id: z.string().min(1) }).passthrough();
const legacyMessagesSchema = z.array(z.object({
  info: z.object({ id: z.string().min(1), role: z.string() }).passthrough(),
  parts: z.array(z.object({ type: z.string() }).passthrough()),
}).passthrough());
const currentMessageSchema = z.object({ id: z.string().min(1), type: z.string() }).passthrough();
const currentMessagesSchema = z.object({
  data: z.array(currentMessageSchema),
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

const kernelError = (code, message, generation = null) => {
  const error = Object.assign(new Error(message), { name: 'KernelOperationError', code, generation });
  if (code === ERROR_CODE.UNSUPPORTED_GENERATION || code === ERROR_CODE.UNSUPPORTED_OPERATION) error.status = 501;
  return error;
};

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
  const textParts = !legacy && (info.type === 'user' || info.type === 'synthetic')
    ? (z.string().safeParse(info.text).success ? [info.text] : [])
    : texts.map((part) => part.text);
  const view = { id: info.id, role: legacy ? info.role : info.type, textParts, tools, raw: record };
  const agent = info.agent || (legacy ? info.mode : undefined);
  const variant = legacy ? info.variant : model?.variant;
  if (agent) view.agent = agent;
  if (variant) view.variant = variant;
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

export const createKernelOperations = ({ getRuntime, getHeaders, fetchImpl = fetch, prepareSession = null, legacyMetadataStore = null, getStorageScope = null }) => {
  const metadataWrites = new Map();
  const capture = (directory, operation) => {
    const runtime = getRuntime();
    const generation = runtime?.generation;
    if (runtime?.profile === OPENCODE_PROFILE.LEGACY
      && (generation !== GENERATION.OC1 || !supportsLegacyOperation(operation))) {
      throw Object.assign(kernelError(ERROR_CODE.UNSUPPORTED_OPERATION,
        'OpenCode ' + OPENCODE_PROFILE.LEGACY + ' operations are not yet accepted', generation), { profile: runtime.profile });
    }
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
    return { generation, profile: runtime.profile, version: runtime.version, endpoint: runtime.endpoint, epoch: runtime.epoch, client, directory,
      storageScope: runtime.profile === OPENCODE_PROFILE.LEGACY ? (getStorageScope?.() ?? `external:${runtime.endpoint}`) : null };
  };

  const check = (context) => {
    const current = getRuntime();
    if (current?.generation !== context.generation || current.profile !== context.profile || current.version !== context.version || current.endpoint !== context.endpoint || current.epoch !== context.epoch
      || (context.profile === OPENCODE_PROFILE.LEGACY && getStorageScope && getStorageScope() !== context.storageScope)) {
      throw kernelError(ERROR_CODE.RUNTIME_CHANGED, 'OpenCode runtime changed during operation', context.generation);
    }
  };

  const identityOf = (context) => {
    const identity = { generation: context.generation, endpoint: context.endpoint, epoch: context.epoch };
    if (context.profile) identity.profile = context.profile;
    return identity;
  };
  const stamped = (context, data) => ({ ...identityOf(context), data });
  const captureIdentity = () => identityOf(capture(undefined, LEGACY_OPERATION.IDENTITY));
  const requestOptions = (signal) => signal ? { signal } : undefined;
  const prepare = async (context, sessionID) => {
    if (context.generation !== GENERATION.OC2 || !prepareSession) return;
    check(context);
    await prepareSession({ sessionID, directory: context.directory, identity: identityOf(context) });
    check(context);
  };

  const requireLegacyMetadata = () => {
    if (!legacyMetadataStore) throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Legacy supplementary metadata storage is unavailable', GENERATION.OC1);
    return legacyMetadataStore;
  };
  const sessionViewFor = async (context, session) => {
    const view = sessionView(session, context.generation);
    if (context.profile !== OPENCODE_PROFILE.LEGACY || !legacyMetadataStore) return view;
    const metadata = await legacyMetadataStore.read(context.storageScope, session.id);
    check(context);
    return { ...view, metadata };
  };

  const getSession = async ({ sessionID, directory, signal }) => {
    const context = capture(directory, LEGACY_OPERATION.SESSION_GET);
    await prepare(context, sessionID);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.session.get({ sessionID, directory }, requestOptions(signal))
      : context.client.session.get({ sessionID }, requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1 ? requireData(response, sessionSchema, 'Session get') : sessionSchema.parse(response);
    return stamped(context, await sessionViewFor(context, data));
  };

  const createSession = async ({ directory, title, parentID, agent, model, metadata, permission, workspaceID, signal, expectedIdentity }) => {
    const context = capture(directory, LEGACY_OPERATION.SESSION_CREATE);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    if (!z.string().min(1).safeParse(directory).success) {
      throw kernelError(ERROR_CODE.INVALID_DIRECTORY, 'Session directory is required', context.generation);
    }
    if (context.generation === GENERATION.OC2 && parentID) {
      throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Use forkSession to create an OC2 child session', context.generation);
    }
    if (context.generation === GENERATION.OC2 && (permission !== undefined || workspaceID !== undefined)) {
      throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Legacy session permissions and workspaces are not supported by OC2 create', context.generation);
    }
    const legacy = context.profile === OPENCODE_PROFILE.LEGACY;
    if (legacy && (agent !== undefined || model !== undefined)) {
      throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Legacy model and agent selection belongs to the prompt request', context.generation);
    }
    if (legacy && metadata !== undefined) {
      requireLegacyMetadata();
      if (!isRecord(metadata)) throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Session metadata must be an object', context.generation);
    }
    const input = {};
    if (title) input.title = title;
    if (parentID) input.parentID = parentID;
    if (agent) input.agent = agent;
    if (model) input.model = model;
    if (metadata && !legacy) input.metadata = metadata;
    if (permission !== undefined) input.permission = permission;
    if (workspaceID !== undefined) input.workspaceID = workspaceID;
    check(context);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.session.create({ directory, ...input }, requestOptions(signal))
      : context.client.session.create({ location: { directory }, ...input }, requestOptions(signal)));
    const data = context.generation === GENERATION.OC1 ? requireData(response, sessionSchema, 'Session create') : sessionSchema.parse(response);
    try { check(context); } catch (error) {
      if (legacy) throw Object.assign(error, { createdSessionID: data.id, rolledBack: false, cleanupFailed: true, partial: true });
      throw error;
    }
    if (legacy && metadata !== undefined) {
      try {
        await legacyMetadataStore.patch(context.storageScope, data.id, metadata, { replace: true, check: () => check(context) });
        check(context);
      } catch (error) {
        let cleanupFailed = false;
        try {
          check(context);
          const removed = await context.client.session.delete({ sessionID: data.id, directory }, requestOptions(signal));
          check(context);
          requireData(removed, z.literal(true), 'Legacy create rollback');
        } catch { cleanupFailed = true; }
        throw Object.assign(error, { createdSessionID: data.id, rolledBack: !cleanupFailed, cleanupFailed, partial: cleanupFailed });
      }
    }
    return stamped(context, await sessionViewFor(context, data));
  };

  const listSessions = async ({ directory, limit, cursor, search, signal } = {}) => {
    const context = capture(directory, LEGACY_OPERATION.SESSION_LIST);
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
      const page = { items: await Promise.all(data.map((item) => sessionViewFor(context, item))), raw: data };
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
    const context = capture(directory, LEGACY_OPERATION.SESSION_MESSAGES);
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
    const context = capture(directory, LEGACY_OPERATION.SESSION_CHILDREN);
    if (context.generation === GENERATION.OC1) {
      const response = await context.client.session.children({ sessionID, directory }, requestOptions(signal));
      check(context);
      return stamped(context, await Promise.all(requireData(response, z.array(sessionSchema), 'Session children')
        .map((item) => sessionViewFor(context, item))));
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
    const context = capture(directory, LEGACY_OPERATION.SESSION_STATUS);
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
    const context = capture(directory, LEGACY_OPERATION.PERMISSION_LIST);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.permission.list({ directory }, requestOptions(signal))
      : context.client.permission.request.list({ location: directory ? { directory } : undefined }, requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1
      ? requireData(response, z.array(z.object({ id: z.string(), sessionID: z.string() }).passthrough()), 'Pending permissions')
      : z.array(z.object({ id: z.string(), sessionID: z.string() }).passthrough()).parse(response?.data);
    return stamped(context, data);
  };

  const listPendingQuestions = async ({ directory, signal } = {}) => {
    const context = capture(directory, LEGACY_OPERATION.QUESTION_LIST);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.question.list({ directory }, requestOptions(signal))
      : context.client.form.list({ location: directory ? { directory } : undefined }, requestOptions(signal)));
    check(context);
    const schema = z.array(z.object({ id: z.string().min(1), sessionID: z.string().min(1) }));
    const data = context.generation === GENERATION.OC1
      ? schema.parse(requireData(response, schema, 'Pending questions'))
      : schema.parse(response?.data);
    return stamped(context, data);
  };

  const replyPermission = async ({ requestID, sessionID, directory, decision = 'once', signal, expectedIdentity }) => {
    const context = capture(directory, LEGACY_OPERATION.PERMISSION_REPLY);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    check(context);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.permission.reply({ requestID, directory, reply: decision }, requestOptions(signal))
      : context.client.permission.reply({ requestID, sessionID, decision }, requestOptions(signal)));
    check(context);
    return stamped(context, context.generation === GENERATION.OC1 ? response.data : response);
  };

  const replyQuestion = async ({ requestID, directory, answers, signal, expectedIdentity }) => {
    const context = capture(directory, LEGACY_OPERATION.QUESTION_REPLY);
    if (context.generation !== GENERATION.OC1) throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Question replies require the OC1 question contract', context.generation);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    check(context);
    const response = await context.client.question.reply({ requestID, directory, answers }, requestOptions(signal));
    check(context);
    return stamped(context, response.data);
  };
  const rejectQuestion = async ({ requestID, directory, signal, expectedIdentity }) => {
    const context = capture(directory, LEGACY_OPERATION.QUESTION_REJECT);
    if (context.generation !== GENERATION.OC1) throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Question rejection requires the OC1 question contract', context.generation);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    check(context);
    const response = await context.client.question.reject({ requestID, directory }, requestOptions(signal));
    check(context);
    return stamped(context, response.data);
  };

  const getMessage = async ({ sessionID, messageID, directory, signal }) => {
    const context = capture(directory, LEGACY_OPERATION.SESSION_MESSAGE);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.session.message({ sessionID, messageID, directory }, requestOptions(signal))
      : context.client.session.message.get({ sessionID, messageID }, requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1 ? response?.data : response;
    if (!isRecord(data)) throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Message get returned an invalid response', context.generation);
    return stamped(context, data);
  };

  const getMessageView = async (input) => {
    let result;
    try {
      result = await getMessage(input);
    } catch (error) {
      if (error?.status === 404 || error?.cause?.status === 404
        || error?._tag === 'MessageNotFoundError' || error?._tag === 'SessionNotFoundError') {
        throw Object.assign(kernelError(ERROR_CODE.NOT_FOUND, 'Message not found'), { status: 404 });
      }
      throw error;
    }
    const schema = result.generation === GENERATION.OC1
      ? legacyMessagesSchema.element
      : currentMessageSchema;
    if (!schema.safeParse(result.data).success) {
      throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Message get returned an invalid response', result.generation);
    }
    return { ...result, data: messageView(result.data, result.generation) };
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
    const context = capture(directory, LEGACY_OPERATION.COMMAND_LIST);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.command.list({ directory }, requestOptions(signal))
      : context.client.command.list({ location: directory ? { directory } : undefined }, requestOptions(signal)));
    check(context);
    const data = context.generation === GENERATION.OC1 ? requireData(response, commandsSchema, 'Command list')
      : commandsSchema.parse(response?.data);
    return stamped(context, data);
  };

  const getSelectionCatalog = async ({ directory, signal } = {}) => {
    const context = capture(directory, LEGACY_OPERATION.CATALOG_READ);
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

  // Read both endpoints through the selected SDK. Local configuration ownership
  // remains the host's responsibility; this operation grants no file access.
  const getLegacyConfiguration = async ({ directory, signal } = {}) => {
    const context = capture(directory, LEGACY_OPERATION.CONFIG_READ);
    if (!supportsLegacyStream(getRuntime())) {
      throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Exact Legacy configuration requires OpenCode 1.2.27', context.generation);
    }
    const [paths, config] = await Promise.all([
      context.client.path.get({ directory }, requestOptions(signal)),
      context.client.config.get({ directory }, requestOptions(signal)),
    ]).catch(error => {
      check(context);
      throw error;
    });
    check(context);
    const pathResult = z.object({
      home: z.string().min(1), config: z.string().min(1),
      directory: z.string().min(1), worktree: z.string().min(1),
    }).safeParse(paths.data);
    const configResult = z.object({ mcp: z.record(z.string(), z.json()).default({}) }).safeParse(config.data);
    if (!pathResult.success || !configResult.success) {
      throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Invalid Legacy configuration response', context.generation);
    }
    const mcp = Object.fromEntries(Object.entries(configResult.data.mcp)
      .map(([name, entry]) => [name, parseLegacyConfig(LEGACY_CONFIG_KIND.MCP, entry)]));
    return stamped(context, { paths: pathResult.data, mcp });
  };

  const getDefaultModel = async ({ directory, signal } = {}) => {
    const context = capture(directory);
    if (context.generation !== GENERATION.OC2) throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Default model lookup requires OC2', context.generation);
    const result = await context.client.model.default(undefined, requestOptions(signal));
    check(context);
    return stamped(context, result.data ?? null);
  };

  const importSession = async ({ chat, signal, expectedIdentity }) => {
    const context = capture();
    if (context.generation !== GENERATION.OC2) throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Chat import requires OC2', context.generation);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    const result = await context.client.session.import(chat, requestOptions(signal));
    check(context);
    return stamped(context, result);
  };

  const forkSession = async ({ sessionID, directory, messageID, signal, expectedIdentity }) => {
    const context = capture(directory, LEGACY_OPERATION.SESSION_FORK);
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
    const context = capture(directory, LEGACY_OPERATION.SESSION_REMOVE);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    const legacy = context.profile === OPENCODE_PROFILE.LEGACY;
    if (context.generation !== GENERATION.OC2 && !legacy) {
      throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Session removal requires OpenCode 2.x or accepted Legacy', context.generation);
    }
    if (legacy) requireLegacyMetadata();
    check(context);
    if (legacy) {
      const response = await context.client.session.delete({ sessionID, directory }, requestOptions(signal));
      requireData(response, z.literal(true), 'Legacy session delete');
      try {
        check(context);
        await legacyMetadataStore.patch(context.storageScope, sessionID, {}, { replace: true, check: () => check(context) });
        check(context);
      } catch (error) {
        throw Object.assign(error, { sessionID, upstreamDeleted: true, partial: true });
      }
    } else {
      await context.client.session.remove({ sessionID }, requestOptions(signal));
      check(context);
    }
    return stamped(context, true);
  };

  const updateSession = async ({ sessionID, directory, title, metadata, decideMetadata, replaceMetadata = false, time, signal, expectedIdentity }) => {
    const context = capture(directory, LEGACY_OPERATION.SESSION_UPDATE);
    if (expectedIdentity) assertRequest(context, expectedIdentity);
    if (decideMetadata && context.generation !== GENERATION.OC2 && context.profile !== OPENCODE_PROFILE.LEGACY) {
      throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'Conditional metadata writes require OC2', context.generation);
    }
    if ((metadata || decideMetadata) && !replaceMetadata) await prepare(context, sessionID);
    const write = async () => {
      check(context);
      if (expectedIdentity) assertRequest(context, expectedIdentity);
      if (context.profile === OPENCODE_PROFILE.LEGACY) {
        const hasMetadata = metadata !== undefined || Boolean(decideMetadata);
        if (hasMetadata) {
          requireLegacyMetadata();
          if (!decideMetadata && !isRecord(metadata)) throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Session metadata patch must be an object', context.generation);
        }
        const session = (await getSession({ sessionID, directory, signal })).data;
        check(context);
        const patch = decideMetadata ? decideMetadata(session.metadata ?? {}) : metadata;
        if (decideMetadata && patch === null) return { ...stamped(context, { ...session.raw, metadata: session.metadata }), metadataChanged: false };
        if (hasMetadata && !isRecord(patch)) throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Session metadata patch must be an object', context.generation);
        let raw = session.raw;
        let upstreamUpdated = false;
        if (title !== undefined || time !== undefined) {
          const input = { sessionID, directory };
          if (title !== undefined) input.title = title;
          if (time !== undefined) input.time = time;
          const response = await context.client.session.update(input, requestOptions(signal));
          upstreamUpdated = true;
          try {
            check(context);
            raw = requireData(response, sessionSchema, 'Legacy session update');
          } catch (error) {
            throw Object.assign(error, { sessionID, upstreamUpdated, partial: true });
          }
        }
        let saved = session.metadata;
        if (hasMetadata) {
          try {
            saved = await legacyMetadataStore.patch(context.storageScope, sessionID, patch,
              { replace: replaceMetadata, check: () => check(context) });
            check(context);
          } catch (error) {
            throw Object.assign(error, { sessionID, upstreamUpdated, partial: upstreamUpdated });
          }
        }
        const data = { ...raw };
        if (saved !== undefined) data.metadata = saved;
        const result = stamped(context, data);
        return decideMetadata ? { ...result, metadataChanged: true } : result;
      }
      const input = { sessionID };
      let decidedSession = null;
      if (title !== undefined) input.title = title;
      if (time !== undefined) {
        if (context.generation !== GENERATION.OC1) throw kernelError(ERROR_CODE.UNSUPPORTED_OPERATION, 'OC2 archive state is owned by OpenChamber', context.generation);
        input.time = time;
      }
      if (metadata || decideMetadata) {
        if (context.generation === GENERATION.OC2) {
          if (!decideMetadata && !isRecord(metadata)) throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Session metadata patch must be an object', context.generation);
          if (replaceMetadata) input.metadata = metadata;
          else {
            const current = sessionSchema.parse(await context.client.session.get({ sessionID }, requestOptions(signal)));
            check(context);
            if (expectedIdentity) assertRequest(context, expectedIdentity);
            const patch = decideMetadata ? decideMetadata(current.metadata ?? {}) : metadata;
            if (decideMetadata && patch === null) return { ...stamped(context, current), metadataChanged: false };
            if (!isRecord(patch)) throw kernelError(ERROR_CODE.INVALID_RESPONSE, 'Session metadata patch must be an object', context.generation);
            input.metadata = mergeMetadataPatch(current.metadata, patch);
            if (decideMetadata) decidedSession = { ...current, metadata: input.metadata };
          }
        } else input.metadata = metadata;
      }
      check(context);
      if (expectedIdentity) assertRequest(context, expectedIdentity);
      const response = await (context.generation === GENERATION.OC1
        ? context.client.session.update({ ...input, directory }, requestOptions(signal))
        : context.client.session.update(input, requestOptions(signal)));
      check(context);
      const result = stamped(context, context.generation === GENERATION.OC1 ? response.data : response);
      return decideMetadata ? { ...result, data: decidedSession, metadataChanged: true } : result;
    };
    if ((context.generation !== GENERATION.OC2 && context.profile !== OPENCODE_PROFILE.LEGACY)
      || (metadata === undefined && !decideMetadata)) return write();
    const key = `${context.generation}\0${context.profile ?? ''}\0${context.endpoint}\0${context.epoch}\0${sessionID}`;
    const previous = metadataWrites.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(write);
    metadataWrites.set(key, current);
    try { return await current; } finally {
      if (metadataWrites.get(key) === current) metadataWrites.delete(key);
    }
  };

  const assertRequest = (context, request) => {
    if (request.generation !== context.generation || request.profile !== context.profile || request.endpoint !== context.endpoint || request.epoch !== context.epoch) {
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
    const context = capture(directory, LEGACY_OPERATION.SESSION_SEND);
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
    const context = capture(directory, LEGACY_OPERATION.SESSION_COMMAND);
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
    const context = capture(directory, LEGACY_OPERATION.SESSION_STOP);
    const response = await (context.generation === GENERATION.OC1
      ? context.client.session.abort({ sessionID, directory }, requestOptions(signal))
      : context.client.session.interrupt({ sessionID }, requestOptions(signal)));
    check(context);
    return stamped(context, context.generation === GENERATION.OC1 ? response.data : response);
  };

  return {
    captureIdentity, getSession, createSession, listSessions, listMessages, listChildren, listActiveStatuses, getSessionStatus,
    listCommands, getSelectionCatalog, getLegacyConfiguration, getDefaultModel, importSession, forkSession, removeSession, updateSession, sendPrompt, sendCommand, interruptSession,
    listPendingPermissions, listPendingQuestions, replyPermission, replyQuestion, rejectQuestion, getMessage, getMessageView, addSynthetic, switchSessionSelection,
  };
};
