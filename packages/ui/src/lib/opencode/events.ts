import type { V2Event } from '@opencode/client';
import { EventManifest } from '@opencode/schema/event-manifest';
import { Schema } from 'effect';
import { z } from 'zod';
import type { JsonValue, Message, Part, Session, SessionStatus, StructuredError } from './model';
import type { PendingInput, PendingPermission } from './operations';
import { partIds } from './model';

const eventHeader = z.object({ type: z.string() });
const eventCodecs: ReadonlyMap<string, (typeof EventManifest.ServerDefinitions)[number]> = new Map(
  EventManifest.ServerDefinitions.map((schema) => [schema.type, schema]),
);
const serverConnected = z.object({
  id: z.string(), type: z.literal('server.connected'), data: z.object({}),
  location: z.object({ directory: z.string(), workspaceID: z.string().optional() }).optional(),
});

/** Parse the untyped relay WebSocket frame with the pinned OC2 event schema. */
export function parseV2Event(payload: JsonValue): V2Event | null {
  const header = eventHeader.safeParse(payload);
  if (!header.success) return null;
  if (header.data.type === 'server.connected') {
    const connected = serverConnected.safeParse(payload);
    return connected.success ? connected.data : null;
  }
  const schema = eventCodecs.get(header.data.type);
  if (!schema) return null;
  try {
    // The pinned full codec validates the raw frame before the projection reads it.
    // SAFETY: the pinned schema validates the full event before the client
    // type is applied. Its branded IDs and durable version types differ.
    return Schema.decodeUnknownSync(schema)(payload) as V2Event;
  } catch {
    return null;
  }
}

/** OC2 stream facts. They are deliberately separate from the OC1 SDK Event. */
export type CatalogKind = 'config' | 'agent' | 'command' | 'skill' | 'plugin' | 'credential' | 'project' | 'provider' | 'model' | 'websearch';

export type DomainEvent =
  | { type: 'session-upsert'; session: Session; directory?: string; eventID: string }
  | { type: 'message-upsert'; message: Message; directory?: string; eventID: string }
  | { type: 'part-upsert'; part: Part; directory?: string; eventID: string }
  | { type: 'part-remove'; messageID: string; partID: string; directory?: string; eventID: string }
  | { type: 'session-refresh'; sessionID: string; directory?: string; eventID: string; sequence?: number }
  | { type: 'session-delete'; sessionID: string; directory?: string; eventID: string; sequence?: number }
  | { type: 'message-refresh'; sessionID: string; messageID: string; directory?: string; eventID: string; sequence?: number }
  | { type: 'transcript-refresh'; sessionID: string; directory?: string; eventID: string; sequence?: number }
  | { type: 'part-delta'; sessionID: string; messageID: string; partID: string; delta: string; directory?: string; eventID: string; sequence?: number }
  | { type: 'status'; sessionID: string; status: SessionStatus; outcome?: 'completed' | 'failed' | 'interrupted'; error?: StructuredError; directory?: string; eventID: string; sequence?: number }
  | { type: 'permission-asked'; request: PendingPermission; directory?: string; eventID: string }
  | { type: 'permission-replied'; sessionID: string; requestID: string; directory?: string; eventID: string }
  | { type: 'input-created'; request: PendingInput; directory?: string; eventID: string }
  | { type: 'form-closed'; sessionID: string; requestID: string; directory?: string; eventID: string }
  | { type: 'vcs-branch'; branch?: string; directory?: string; eventID: string }
  | { type: 'refresh'; scope: 'global' | 'directory'; catalog?: CatalogKind; directory?: string; eventID: string };

/** Project only facts the OC2 event actually carries. Full records come from the HTTP projection. */
export function projectV2Event(event: V2Event): DomainEvent | null {
  const directory = event.location?.directory;
  const eventID = event.id;
  const sequence = 'durable' in event ? event.durable.seq : undefined;
  const catalog = (kind: CatalogKind): DomainEvent => ({ type: 'refresh', scope: 'global', catalog: kind, directory, eventID });
  switch (event.type) {
    case 'session.deleted':
      return { type: 'session-delete', sessionID: event.data.sessionID, directory, eventID, sequence };
    case 'session.created':
    case 'session.moved':
    case 'session.renamed':
    case 'session.metadata.updated':
    case 'session.permissions':
    case 'session.viewed':
    case 'session.forked':
    case 'session.revert.staged':
    case 'session.revert.committed':
    case 'session.revert.cleared':
    case 'session.usage.updated':
      return { type: 'session-refresh', sessionID: event.data.sessionID, directory, eventID, sequence };
    case 'session.agent.selected':
    case 'session.model.selected':
    case 'session.instructions.updated':
    case 'session.synthetic':
    case 'session.skill.activated':
    case 'session.shell.started':
    case 'session.shell.ended':
    case 'session.inbox.delivered':
    case 'session.inbox.enqueued':
    case 'session.inbox.cancelled':
    case 'session.compaction.started':
    case 'session.compaction.delta':
    case 'session.compaction.ended':
    case 'session.compaction.failed':
      return { type: 'transcript-refresh', sessionID: event.data.sessionID, directory, eventID, sequence };
    case 'session.text.delta':
      return { type: 'part-delta', sessionID: event.data.sessionID, messageID: event.data.assistantMessageID,
        partID: partIds.text(event.data.assistantMessageID, event.data.ordinal), delta: event.data.delta, directory, eventID, sequence };
    case 'session.reasoning.delta':
      return { type: 'part-delta', sessionID: event.data.sessionID, messageID: event.data.assistantMessageID,
        partID: partIds.reasoning(event.data.assistantMessageID, event.data.ordinal), delta: event.data.delta, directory, eventID, sequence };
    case 'session.text.started':
    case 'session.text.ended':
    case 'session.reasoning.started':
    case 'session.reasoning.ended':
    case 'session.tool.called':
    case 'session.tool.input.started':
    case 'session.tool.input.delta':
    case 'session.tool.input.ended':
    case 'session.tool.progress':
    case 'session.tool.success':
    case 'session.tool.failed':
    case 'session.step.started':
    case 'session.step.streamed':
    case 'session.step.ended':
    case 'session.step.failed':
    case 'session.retry.scheduled':
      return { type: 'message-refresh', sessionID: event.data.sessionID,
        messageID: event.data.assistantMessageID, directory, eventID, sequence };
    case 'session.status':
      return { type: 'status', sessionID: event.data.sessionID, status: event.data.status, directory, eventID };
    case 'session.idle':
    case 'session.execution.succeeded':
      return { type: 'status', sessionID: event.data.sessionID, status: { type: 'idle' }, outcome: 'completed', directory, eventID, sequence };
    case 'session.execution.failed':
      return { type: 'status', sessionID: event.data.sessionID, status: { type: 'idle' }, outcome: 'failed', error: event.data.error, directory, eventID, sequence };
    case 'session.execution.interrupted':
      return { type: 'status', sessionID: event.data.sessionID, status: { type: 'idle' }, outcome: 'interrupted', directory, eventID, sequence };
    case 'session.execution.started':
      return { type: 'status', sessionID: event.data.sessionID, status: { type: 'busy' }, directory, eventID, sequence };
    case 'permission.asked':
      return { type: 'permission-asked', request: { generation: 'oc2', value: event.data }, directory, eventID };
    case 'permission.replied':
      return { type: 'permission-replied', sessionID: event.data.sessionID, requestID: event.data.requestID, directory, eventID };
    case 'form.created':
      return { type: 'input-created', request: { generation: 'oc2', kind: 'form', value: event.data.form }, directory, eventID };
    case 'form.replied':
    case 'form.cancelled':
      return { type: 'form-closed', sessionID: event.data.sessionID, requestID: event.data.id, directory, eventID };
    case 'vcs.branch.updated':
      return { type: 'vcs-branch', branch: event.data.branch, directory, eventID };
    case 'project.updated':
      return catalog('project');
    case 'config.updated':
      return catalog('config');
    case 'provider.updated':
      return catalog('provider');
    case 'agent.updated':
      return catalog('agent');
    case 'model.updated':
      return catalog('model');
    case 'command.updated':
      return catalog('command');
    case 'skill.updated':
      return catalog('skill');
    case 'plugin.updated':
      return catalog('plugin');
    case 'credential.updated':
    case 'credential.switched':
      return catalog('credential');
    case 'websearch.updated':
      return catalog('websearch');
    case 'server.connected':
      return { type: 'refresh', scope: 'global', directory, eventID };
    case 'location.shutdown':
      return { type: 'refresh', scope: 'directory', directory, eventID };
    default:
      return null;
  }
}
