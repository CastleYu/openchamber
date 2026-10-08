import { z } from 'zod';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_HTTP, AGENT_SERVER_METHOD } from './constants.js';
import { agentIdentitySchema, agentServerRequestSchema, agentServerResponseSchema } from './schemas.js';

const connectionSchema = z.object({
  identity: agentIdentitySchema.extend({ family: z.literal(AGENT_FAMILY.CAGENT) }),
  baseURL: z.url(), headers: z.record(z.string(), z.string()),
  ready: z.boolean(), authorized: z.boolean(),
}).strict();
const same = (left, right) => left.family === right.family && left.connectionID === right.connectionID
  && left.epoch === right.epoch && left.adapterRevision === right.adapterRevision
  && left.capabilityRevision === right.capabilityRevision;

export class AgentTransportError extends Error {
  constructor(code) {
    super(`Agent transport refused: ${code}`);
    this.name = 'AgentTransportError';
    this.code = code;
  }
}

/** Endpoint and credentials are read from protected host state at each call. No retries. */
export const createAgentTransport = ({ getConnection }) => {
  if (!z.function().safeParse(getConnection).success) throw new AgentTransportError(AGENT_ERROR.INVALID_INPUT);
  const current = (expected) => {
    let selected;
    try { selected = connectionSchema.safeParse(getConnection()); }
    catch { throw new AgentTransportError(AGENT_ERROR.UNAVAILABLE); }
    if (!selected.success) throw new AgentTransportError(AGENT_ERROR.UNAVAILABLE);
    const value = selected.data;
    if (!same(expected, value.identity)) throw new AgentTransportError(AGENT_ERROR.CHANGED);
    if (!value.authorized) throw new AgentTransportError(AGENT_ERROR.UNAUTHORIZED);
    if (!value.ready) throw new AgentTransportError(AGENT_ERROR.UNAVAILABLE);
    return value;
  };
  const request = async (input, identity) => {
    const parsed = agentServerRequestSchema.safeParse(input);
    const scope = agentIdentitySchema.safeParse(identity);
    if (!parsed.success || !scope.success) throw new AgentTransportError(AGENT_ERROR.INVALID_INPUT);
    const wire = parsed.data;
    if (wire.method === AGENT_SERVER_METHOD.GET && wire.body !== undefined) {
      throw new AgentTransportError(AGENT_ERROR.INVALID_INPUT);
    }
    try {
      const connection = current(scope.data);
      const base = new URL(connection.baseURL);
      if (![AGENT_HTTP.HTTP, AGENT_HTTP.HTTPS].includes(base.protocol) || base.username || base.password
        || base.search || base.hash || !base.pathname.endsWith('/')) {
        throw new AgentTransportError(AGENT_ERROR.INVALID_INPUT);
      }
      // Preserve the configured API prefix. Reject normalization into a different endpoint.
      for (const part of wire.path.split('/')) {
        let decoded;
        try { decoded = decodeURIComponent(part); }
        catch { throw new AgentTransportError(AGENT_ERROR.INVALID_INPUT); }
        if (decoded === '.' || decoded === '..' || /[\/\\\u0000-\u001f]/.test(decoded)) {
          throw new AgentTransportError(AGENT_ERROR.INVALID_INPUT);
        }
      }
      const url = new URL(`${base.href}${wire.path.slice(1)}`);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
        throw new AgentTransportError(AGENT_ERROR.INVALID_INPUT);
      }
      for (const [key, value] of Object.entries(wire.query || {})) url.searchParams.set(key, value);
      const headers = new Headers(connection.headers);
      headers.set(AGENT_HTTP.ACCEPT, AGENT_HTTP.JSON);
      if (wire.body !== undefined) headers.set(AGENT_HTTP.CONTENT_TYPE, AGENT_HTTP.JSON);
      const response = await fetch(url, {
        method: wire.method, headers, redirect: AGENT_HTTP.REDIRECT,
        body: wire.body === undefined ? undefined : JSON.stringify(wire.body),
      });
      let body;
      try {
        current(scope.data);
        if (response.status >= 300 && response.status < 400) {
          throw new AgentTransportError(AGENT_ERROR.INVALID_RESPONSE);
        }
        if (response.status === AGENT_HTTP.NO_CONTENT || response.status === AGENT_HTTP.RESET_CONTENT) {
          await response.body?.cancel();
          body = null;
        } else {
          try { body = await response.json(); }
          catch { throw new AgentTransportError(AGENT_ERROR.INVALID_RESPONSE); }
        }
        current(scope.data);
      } catch (error) {
        await response.body?.cancel().catch(() => {});
        throw error;
      }
      const result = agentServerResponseSchema.safeParse({ status: response.status, body });
      if (!result.success) throw new AgentTransportError(AGENT_ERROR.INVALID_RESPONSE);
      return result.data;
    } catch (error) {
      if (error instanceof AgentTransportError) throw error;
      throw new AgentTransportError(AGENT_ERROR.BACKEND_FAILED);
    }
  };
  return Object.freeze({ request });
};
