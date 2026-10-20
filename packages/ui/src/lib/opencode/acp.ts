import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';
import type { DomainEvent } from './events';
import type { SessionMessages, SessionPatch } from './operations';
import type { Session, SessionStatus } from './model';
import type { JsonValue } from './model';
import type { SyncBootstrapOperations, SyncSource } from '@/sync/source';
import { OpenCodeRuntimeChangedError, type OpenCodeRuntimeBinding } from './runtime';
import { acpTaggedInputSchema, acpConnectionInputSchema, acpInfoSchema, type AcpAnswer } from './acp-interactions';

const ROOT = '/api/acp';
const timeSchema = z.object({ created: z.number(), updated: z.number(), archived: z.number().optional() });
const sessionSchema = z.object({ id: z.string(), projectID: z.string(), directory: z.string(), title: z.string(), time: timeSchema, readOnly: z.boolean().optional(), metadata: z.record(z.string(), z.json()).optional() });
const choiceSchema = z.object({ value: z.string(), name: z.string(), description: z.string().optional() });
const commandSchema = z.object({ name: z.string(), description: z.string(), input: z.object({ hint: z.string() }).nullable().optional() });
const controlsSchema = z.object({
  configOptions: z.array(z.object({
    id: z.string(), name: z.string(), description: z.string().optional(), category: z.string().optional(),
    type: z.literal('select'), currentValue: z.string(),
    options: z.array(z.union([choiceSchema, z.object({ group: z.string(), name: z.string(), options: z.array(choiceSchema) })])),
  })),
  modes: z.object({ currentModeId: z.string(), availableModes: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() })) }).optional(),
  commands: z.array(commandSchema),
  usage: z.object({ used: z.number().nonnegative(), size: z.number().nonnegative(), cost: z.object({ amount: z.number(), currency: z.string() }).optional() }).optional(),
  capabilities: z.object({ load: z.boolean(), resume: z.boolean(), delete: z.boolean() }),
});
export type AcpControls = z.infer<typeof controlsSchema>;
export type AcpCommand = z.infer<typeof commandSchema>;
const errorSchema = z.object({ type: z.string(), message: z.string() });
const messageBase = z.object({ id: z.string(), sessionID: z.string() });
const messageSchema = z.discriminatedUnion('role', [
  messageBase.extend({ role: z.literal('user'), time: z.object({ created: z.number() }) }),
  messageBase.extend({ role: z.literal('assistant'), agent: z.string(), providerID: z.string(), modelID: z.string(), parentID: z.string().optional(), finish: z.string().optional(), error: errorSchema.optional(), time: z.object({ created: z.number(), completed: z.number().optional() }) }),
]);
const partBase = z.object({ id: z.string(), sessionID: z.string(), messageID: z.string() });
const partTime = z.object({ start: z.number(), end: z.number().optional() });
const inputSchema = z.record(z.string(), z.json());
const toolMetadataSchema = z.object({ acp: z.literal(true).optional(), output: z.string().optional(), diffs: z.array(z.object({ type: z.literal('diff'), path: z.string(), oldText: z.string().nullable().optional(), newText: z.string() })).optional() });
const toolStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('running'), input: inputSchema, title: z.string().optional(), metadata: toolMetadataSchema.optional(), time: z.object({ start: z.number() }) }),
  z.object({ status: z.literal('completed'), input: inputSchema, title: z.string().optional(), output: z.string(), metadata: toolMetadataSchema.optional(), time: z.object({ start: z.number(), end: z.number() }) }),
  z.object({ status: z.literal('error'), input: inputSchema, error: z.string(), time: z.object({ start: z.number(), end: z.number() }) }),
]);
const partSchema = z.discriminatedUnion('type', [
  partBase.extend({ type: z.literal('text'), text: z.string(), time: partTime.optional() }),
  partBase.extend({ type: z.literal('file'), url: z.string(), mime: z.string(), filename: z.string().optional() }),
  partBase.extend({ type: z.literal('reasoning'), text: z.string(), time: partTime }),
  partBase.extend({ type: z.literal('tool'), callID: z.string(), tool: z.string(), state: toolStateSchema }),
]);
const permissionSchema = z.object({ id: z.string(), sessionID: z.string(), title: z.string(), options: z.array(z.object({ optionId: z.string(), name: z.string(), kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']) })) });
const taggedPermissionSchema = z.object({ generation: z.literal('acp'), value: permissionSchema });
const statusSchema = z.object({ type: z.enum(['idle', 'busy']) });
const eventBase = z.object({ directory: z.string().optional(), eventID: z.string() });
const eventSchema = z.discriminatedUnion('type', [
  eventBase.extend({ type: z.literal('session-upsert'), session: sessionSchema }),
  eventBase.extend({ type: z.literal('session-refresh'), sessionID: z.string() }),
  eventBase.extend({ type: z.literal('session-delete'), sessionID: z.string() }),
  eventBase.extend({ type: z.literal('transcript-refresh'), sessionID: z.string() }),
  eventBase.extend({ type: z.literal('message-upsert'), message: messageSchema }),
  eventBase.extend({ type: z.literal('part-upsert'), part: partSchema }),
  eventBase.extend({ type: z.literal('part-delta'), sessionID: z.string(), messageID: z.string(), partID: z.string(), delta: z.string() }),
  eventBase.extend({ type: z.literal('status'), sessionID: z.string(), status: statusSchema, outcome: z.enum(['completed', 'failed', 'interrupted']).optional(), error: errorSchema.optional() }),
  eventBase.extend({ type: z.literal('permission-asked'), request: taggedPermissionSchema }),
  eventBase.extend({ type: z.literal('permission-replied'), sessionID: z.string(), requestID: z.string() }),
  eventBase.extend({ type: z.literal('input-created'), request: acpTaggedInputSchema }),
  eventBase.extend({ type: z.literal('form-closed'), sessionID: z.string(), requestID: z.string() }),
  eventBase.extend({ type: z.literal('connection-inputs'), inputs: z.array(acpConnectionInputSchema), error: z.string().optional() }),
]);
const messagePageSchema = z.array(z.object({ info: messageSchema, parts: z.array(partSchema) }));

/** OpenChamber domain transport for its selected ACP process. */
export class AcpClient {
  async read<T>(path: string, schema: z.ZodType<T>, directory?: string | null, signal?: AbortSignal): Promise<T> {
    const response = await runtimeFetch(`${ROOT}${path}`, { query: { directory }, signal });
    if (!response.ok) throw new Error(`ACP ${path} failed (${response.status})`);
    return schema.parse(await response.json());
  }

  async write<T>(path: string, body: JsonValue, schema: z.ZodType<T>): Promise<T> {
    const response = await runtimeFetch(`${ROOT}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const error = z.object({ error: z.string() }).parse(await response.json());
      throw new Error(error.error);
    }
    return schema.parse(await response.json());
  }

  sessions(directory?: string | null, signal?: AbortSignal): Promise<Session[]> { return this.read('/sessions', z.array(sessionSchema), directory, signal); }
  session(id: string): Promise<Session> { return this.read(`/sessions/${encodeURIComponent(id)}`, sessionSchema); }
  update(id: string, patch: SessionPatch): Promise<Session> { return this.write(`/sessions/${encodeURIComponent(id)}/update`, patch, sessionSchema); }
  remove(id: string): Promise<boolean> { return this.write(`/sessions/${encodeURIComponent(id)}/delete`, {}, z.boolean()); }
  controls(id: string, signal?: AbortSignal): Promise<AcpControls> { return this.read(`/sessions/${encodeURIComponent(id)}/controls`, controlsSchema, undefined, signal); }
  configure(id: string, configId: string, value: string): Promise<AcpControls> { return this.write(`/sessions/${encodeURIComponent(id)}/config`, { configId, value }, controlsSchema); }
  mode(id: string, modeId: string): Promise<AcpControls> { return this.write(`/sessions/${encodeURIComponent(id)}/mode`, { modeId }, controlsSchema); }
  commands(directory?: string | null, signal?: AbortSignal): Promise<AcpCommand[]> { return this.read('/commands', z.array(commandSchema), directory, signal); }
  messages(id: string, signal?: AbortSignal): Promise<SessionMessages> { return this.read(`/sessions/${encodeURIComponent(id)}/messages`, messagePageSchema, undefined, signal); }
  create(directory: string, title?: string): Promise<Session> {
    return title ? this.write('/sessions', { directory, title }, sessionSchema) : this.write('/sessions', { directory }, sessionSchema);
  }
  statuses(directory?: string | null, signal?: AbortSignal): Promise<Record<string, SessionStatus>> { return this.read('/status', z.record(z.string(), statusSchema), directory, signal); }
  permissions(directory?: string | null, signal?: AbortSignal) { return this.read('/permissions', z.array(taggedPermissionSchema), directory, signal); }
  path(directory?: string | null, signal?: AbortSignal) { return this.read('/path', z.object({ directory: z.string(), home: z.string() }), directory, signal); }
  prompt(sessionID: string, messageID: string, text: string, files: Array<{ url: string; filename?: string }> = []) { return this.write('/prompt', { sessionID, messageID, text, files }, z.object({ messageID: z.string() })); }
  cancel(sessionID: string) { return this.write(`/sessions/${encodeURIComponent(sessionID)}/cancel`, {}, z.boolean()); }
  reply(id: string, optionID: string) { return this.write(`/permissions/${encodeURIComponent(id)}`, { optionID }, z.boolean()); }
  inputs(directory?: string | null, signal?: AbortSignal) { return this.read('/inputs', z.array(acpTaggedInputSchema), directory, signal); }
  connectionInputs(signal?: AbortSignal) { return this.read('/connection-inputs', z.array(acpConnectionInputSchema), undefined, signal); }
  info(signal?: AbortSignal) { return this.read('/info', acpInfoSchema, undefined, signal); }
  authenticate(methodId: string, epoch: number) { return this.write('/authenticate', { methodId, epoch }, z.object({})); }
  replyInput(id: string, answer: AcpAnswer) { return this.write(`/inputs/${encodeURIComponent(id)}`, answer, z.boolean()); }

  async *events(signal: AbortSignal, onActivity?: () => void): AsyncIterable<DomainEvent> {
    for await (const event of this.interactionEvents(signal, onActivity)) if (event.type !== 'connection-inputs') yield event;
  }

  async *interactionEvents(signal: AbortSignal, onActivity?: () => void) {
    const response = await runtimeFetch(`${ROOT}/events`, { signal, headers: { Accept: 'text/event-stream' } });
    if (!response.ok || !response.body) throw new Error(`ACP event stream failed (${response.status})`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        onActivity?.();
        buffer += decoder.decode(chunk.value, { stream: true });
        let end = buffer.indexOf('\n\n');
        while (end >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
          if (data) yield eventSchema.parse(JSON.parse(data));
          end = buffer.indexOf('\n\n');
        }
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
  }

  source(binding: OpenCodeRuntimeBinding, bootstrap: SyncBootstrapOperations): SyncSource {
    const events = this.events.bind(this);
    const runtime = binding.get();
    const current = () => { if (binding.get() !== runtime) throw new OpenCodeRuntimeChangedError(); };
    const run = async <T>(request: () => Promise<T>): Promise<T> => { current(); const result = await request(); current(); return result; };
    return {
      generation: 'acp', identity: this, bootstrap,
      listSessions: (directory, signal) => run(() => this.sessions(directory, signal)),
      getSession: (id) => run(() => this.session(id)),
      messagePage: (id, _directory, _limit, _cursor, signal) => run(async () => ({ items: await this.messages(id, signal) })),
      getMessage: (id, messageID) => run(async () => { const message = (await this.messages(id)).find((item) => item.info.id === messageID); if (!message) throw new Error(`ACP message ${messageID} was not found`); return message; }),
      status: (directory, signal) => run(() => this.statuses(directory, signal)),
      permissions: (directory, signal) => run(() => this.permissions(directory, signal)),
      inputs: (directory, signal) => run(() => this.inputs(directory, signal)),
      events: async function* (signal, _lastEventID, onActivity) {
        for await (const event of events(signal, onActivity)) { current(); yield { generation: 'acp', value: event }; }
      },
    };
  }
}
