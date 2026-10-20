import { z } from 'zod';

const ACTION = Object.freeze({ ACCEPT: 'accept', DECLINE: 'decline', CANCEL: 'cancel' });
const MODE = Object.freeze({ FORM: 'form', URL: 'url' });
const choice = z.object({ const: z.string(), title: z.string() });
const label = { title: z.string().optional(), description: z.string().optional() };
const strings = z.object({ type: z.literal('string'), ...label, minLength: z.number().int().nonnegative().optional(), maxLength: z.number().int().nonnegative().optional(), format: z.enum(['email', 'uri', 'date', 'date-time']).optional(), enum: z.array(z.string()).min(1).optional(), enumNames: z.array(z.string()).optional(), oneOf: z.array(choice).min(1).optional(), default: z.string().optional() }).strict();
const numbers = z.object({ type: z.enum(['number', 'integer']), ...label, minimum: z.number().optional(), maximum: z.number().optional(), default: z.number().optional() }).strict();
const boolean = z.object({ type: z.literal('boolean'), ...label, default: z.boolean().optional() }).strict();
const multiple = z.object({ type: z.literal('array'), ...label, minItems: z.number().int().nonnegative().optional(), maxItems: z.number().int().nonnegative().optional(), items: z.union([z.object({ type: z.literal('string'), enum: z.array(z.string()).min(1) }).strict(), z.object({ anyOf: z.array(choice).min(1) }).strict()]), default: z.array(z.string()).optional() }).strict();
const form = z.object({ type: z.literal('object'), properties: z.record(z.string(), z.union([strings, numbers, boolean, multiple])), required: z.array(z.string()).optional(), $schema: z.string().optional() }).strict();
const base = { sessionId: z.string().optional(), toolCallId: z.string().optional(), requestId: z.union([z.string(), z.number()]).optional(), message: z.string() };
export const elicitationSchema = z.discriminatedUnion('mode', [z.object({ ...base, mode: z.literal(MODE.FORM), requestedSchema: form }), z.object({ ...base, mode: z.literal(MODE.URL), elicitationId: z.string(), url: z.url().refine((value) => { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }, 'Unsafe elicitation URL') })]).refine((value) => (value.sessionId !== undefined) !== (value.requestId !== undefined) && (!value.toolCallId || value.sessionId !== undefined), 'Elicitation needs exactly one scope');
const answerSchema = z.object({ action: z.enum([ACTION.ACCEPT, ACTION.DECLINE, ACTION.CANCEL]), content: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).nullish() });
const choices = (field) => field.oneOf?.map((item) => ({ value: item.const, label: item.title })) ?? field.enum?.map((value, index) => ({ value, label: field.enumNames?.[index] ?? value }));

export const fieldsFor = (schema) => {
  const required = schema.required ?? [];
  if (required.some((key) => !Object.hasOwn(schema.properties, key))) throw new Error('Unknown required elicitation field');
  return Object.entries(schema.properties).map(([key, field]) => {
    // Forms collect ordinary data. Access credentials belong in URL mode.
    if (/(password|passphrase|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|recovery[ _-]?code|credit[ _-]?card|payment[ _-]?credential)/i.test(`${key} ${field.title ?? ''} ${field.description ?? ''}`)) throw new Error('Credentials require URL elicitation');
    const items = field.type === 'array' ? field.items : null;
    const options = items ? ('enum' in items ? items.enum.map((value) => ({ value, label: value })) : items.anyOf.map((item) => ({ value: item.const, label: item.title }))) : choices(field);
    return { ...field, key, required: required.includes(key), choices: options };
  });
};

export const validateAnswer = (fields, content) => {
  const values = content ?? {};
  if (Object.keys(values).some((key) => !fields.some((field) => field.key === key))) throw new Error('Unknown elicitation answer field');
  for (const field of fields) {
    const value = values[field.key];
    if (value === undefined) { if (field.required) throw new Error(`Required field: ${field.key}`); continue; }
    let schema;
    if (field.type === 'string') {
      schema = z.string();
      if (field.format === 'email') schema = z.email();
      if (field.format === 'uri') schema = z.url();
      if (field.format === 'date') schema = z.iso.date();
      if (field.format === 'date-time') schema = z.iso.datetime({ offset: true });
      if (field.minLength !== undefined) schema = schema.min(field.minLength);
      if (field.maxLength !== undefined) schema = schema.max(field.maxLength);
      if (field.choices) schema = schema.refine((value) => field.choices.some((item) => item.value === value));
    } else if (field.type === 'number' || field.type === 'integer') {
      schema = field.type === 'integer' ? z.number().int() : z.number();
      if (field.minimum !== undefined) schema = schema.min(field.minimum);
      if (field.maximum !== undefined) schema = schema.max(field.maximum);
    } else if (field.type === 'boolean') schema = z.boolean();
    else {
      schema = z.array(z.string()).refine((value) => new Set(value).size === value.length && value.every((item) => field.choices.some((choice) => choice.value === item)));
      if (field.minItems !== undefined) schema = schema.min(field.minItems);
      if (field.maxItems !== undefined) schema = schema.max(field.maxItems);
    }
    if (!schema.safeParse(value).success) throw new Error(`Invalid field: ${field.key}`);
  }
  return values;
};

/** The selected connection owns pending forms and accepted URL workflows. */
export const createElicitations = ({ write, emit, record, agent, epoch, hasRequest }) => {
  const pending = new Map();
  const global = () => [...pending.values()].filter((item) => item.value.scope === 'request').map((item) => item.value);
  const publish = (item, closed = false) => {
    if (item.value.scope === 'request') emit({ type: 'connection-inputs', inputs: global() });
    else emit(closed ? { type: 'form-closed', sessionID: item.value.sessionID, requestID: item.value.id, directory: record(item.value.sessionID).session.directory } : { type: 'input-created', request: { generation: 'acp', kind: 'elicitation', value: item.value }, directory: record(item.value.sessionID).session.directory });
  };
  const close = (item) => { if (!pending.delete(item.value.id)) return; publish(item, true); };
  const reply = async (id, raw) => {
    const item = pending.get(id);
    if (!item || item.epoch !== epoch() || item.responding || item.value.state !== 'pending') throw new Error('ACP interaction is no longer pending');
    const answer = answerSchema.parse(raw);
    const result = { action: answer.action };
    if (answer.action === ACTION.ACCEPT && item.value.mode === MODE.FORM) result.content = validateAnswer(item.value.fields, answer.content);
    item.responding = true;
    try { await write({ jsonrpc: '2.0', id: item.rpcID, result }); }
    catch (error) { item.responding = false; throw error; }
    if (pending.get(id) !== item) return true;
    if (answer.action === ACTION.ACCEPT && item.value.mode === MODE.URL) { item.value = { ...item.value, state: 'waiting' }; item.responding = false; publish(item); }
    else close(item);
    return true;
  };
  return {
    create: (rpcID, raw) => {
      const params = elicitationSchema.parse(raw);
      if (params.sessionId !== undefined) record(params.sessionId);
      else if (!hasRequest(params.requestId)) throw new Error('Unknown originating ACP request');
      if (params.mode === MODE.URL && [...pending.values()].some((item) => item.value.elicitationId === params.elicitationId)) throw new Error('Duplicate elicitation ID');
      const fields = params.mode === MODE.FORM ? fieldsFor(params.requestedSchema) : undefined;
      if (fields) for (const field of fields) if (field.default !== undefined) validateAnswer([{ ...field, required: false }], { [field.key]: field.default });
      const id = `acp-input:${epoch()}:${rpcID}`;
      if (pending.has(id)) throw new Error('Duplicate elicitation request');
      const value = { id, agent: agent(), message: params.message, mode: params.mode, state: 'pending', ...(params.sessionId !== undefined ? { scope: 'session', sessionID: params.sessionId, toolCallID: params.toolCallId } : { scope: 'request', requestID: params.requestId }), ...(params.mode === MODE.FORM ? { fields } : { url: params.url, elicitationId: params.elicitationId }) };
      const item = { rpcID, epoch: epoch(), value, responding: false };
      pending.set(id, item); publish(item);
    },
    reply, global,
    sessions: (directory) => [...pending.values()].filter((item) => item.value.scope === 'session' && (!directory || record(item.value.sessionID).session.directory === directory)).map((item) => ({ generation: 'acp', kind: 'elicitation', value: item.value })),
    complete: (raw) => { const { elicitationId } = z.object({ elicitationId: z.string() }).parse(raw); const item = [...pending.values()].find((item) => item.value.elicitationId === elicitationId); if (item) close(item); },
    clear: () => { for (const item of pending.values()) close(item); },
    cancel: async (scope, id) => {
      for (const item of pending.values()) {
        if (scope && (item.value.scope !== scope || (scope === 'session' ? item.value.sessionID : item.value.requestID) !== id)) continue;
        if (item.value.state === 'pending' && !item.responding) await reply(item.value.id, { action: ACTION.CANCEL });
        else close(item);
      }
    },
  };
};
