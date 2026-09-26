import type { OpencodeClient } from '@opencode-ai/sdk/v2';
import { z } from 'zod';
import type { SessionOperations, OperationScope, SessionCreate, SessionPatch } from '../operations';
import { OpencodeRequestError, toUpstreamErrorDetail, upstreamErrorPayloadSchema } from '../upstreamError';
import { projectLegacyMessages, projectLegacySession } from './projection';

const unwrap = <T>(result: { data?: T; error?: unknown; response?: { status?: number } }, operation: string): T => {
  if (result.error) {
    const status = result.response?.status;
    const named = z.object({ message: z.string() }).safeParse(result.error);
    const literal = z.string().safeParse(result.error);
    let description = named.success ? named.data.message : literal.success ? literal.data : '';
    if (!description) {
      try { description = JSON.stringify(result.error) ?? String(result.error); }
      catch { description = String(result.error); }
    }
    throw new OpencodeRequestError(
      `${operation} failed${status ? ` (${status})` : ''}: ${description}`,
      toUpstreamErrorDetail(upstreamErrorPayloadSchema.safeParse(result.error).data, status),
    );
  }
  if (result.data === undefined || result.data === null) throw new Error(`${operation} failed: empty response`);
  return result.data;
};

/** OC1 SDK namespace and request fields are kept intact. */
export class V1SessionOperations implements SessionOperations {
  constructor(private readonly client: OpencodeClient) {}

  async list({ directory, signal }: OperationScope) {
    const result = await this.client.session.list({ directory: directory ?? undefined }, { signal });
    return unwrap(result, 'session.list').map(projectLegacySession);
  }

  async create(input: SessionCreate | undefined, { directory, signal }: OperationScope) {
    const result = await this.client.session.create({
      directory: directory ?? undefined, parentID: input?.parentID,
      title: input?.title, metadata: input?.metadata,
    }, { signal });
    return projectLegacySession(unwrap(result, 'session.create'));
  }

  async get(id: string, { directory, signal }: OperationScope) {
    const result = await this.client.session.get({ sessionID: id, directory: directory ?? undefined }, { signal });
    return projectLegacySession(unwrap(result, 'session.get'));
  }

  async remove(id: string, { directory, signal }: OperationScope) {
    const result = await this.client.session.delete({ sessionID: id, directory: directory ?? undefined }, { signal });
    return unwrap(result, 'session.delete') === true;
  }

  async update(id: string, patch: SessionPatch, { directory, signal }: OperationScope) {
    const request: Parameters<OpencodeClient['session']['update']>[0] = { sessionID: id };
    if (directory) request.directory = directory;
    if (patch.title !== undefined) request.title = patch.title;
    if (patch.metadata !== undefined) request.metadata = patch.metadata;
    // Existing OC1 callers pass null to mean no archive-time mutation.
    if (patch.time?.archived != null) request.time = { archived: patch.time.archived };
    const result = await this.client.session.update(request, { signal });
    return projectLegacySession(unwrap(result, 'session.update'));
  }

  async messages(id: string, limit: number | undefined, { directory, signal }: OperationScope) {
    const result = await this.client.session.messages({
      sessionID: id,
      directory: directory ?? undefined,
      limit,
    }, { signal });
    return projectLegacyMessages(unwrap(result, 'session.messages'));
  }
}
