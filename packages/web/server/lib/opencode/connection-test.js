import { z } from 'zod';
import { AGENT_FAMILY } from '../agent/constants.js';
import { CONNECTION_MODE, OpenCodeConnectionError } from './connection.js';
import { detectOpenCodeProfile } from './compatibility.js';

export const CONNECTION_TEST = Object.freeze({ ROUTE: '/api/config/opencode-connection/test', CANCEL_ROUTE: '/api/config/opencode-connection/test/cancel', TIMEOUT_MS: 15000 });
const inputSchema = z.strictObject({ token: z.uuid(), connection: z.json() });
const tokenSchema = z.object({ token: z.uuid() });
const parse = (schema, raw) => {
  const result = schema.safeParse(raw);
  if (!result.success) throw new OpenCodeConnectionError('Invalid connection test', 400);
  return result.data;
};

// Shared host owner: no settings writes, lifecycle calls, CLI/version execution or SDK rebinding.
export const createConnectionTest = ({ prepareConnection, getContext }) => {
  const pending = new Map();
  const cancel = raw => {
    const { token } = parse(tokenSchema, raw);
    pending.get(token)?.abort();
    return { cancelled: true };
  };
  const test = async (raw, signal) => {
    const { token, connection } = parse(inputSchema, raw);
    if (pending.has(token)) throw new OpenCodeConnectionError('Connection test already running', 409);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, CONNECTION_TEST.TIMEOUT_MS);
    pending.set(token, controller);
    const check = () => {
      if (controller.signal.aborted) throw new OpenCodeConnectionError('Connection test cancelled or timed out', 408);
    };
    try {
      check();
      const context = await getContext();
      check();
      if (context.family !== AGENT_FAMILY.OPENCODE) throw new OpenCodeConnectionError('Unsupported backend family', 501);
      // Snapshot both protocol credentials before any asynchronous candidate validation.
      const credentials = { oc1: new Headers(context.headersForGeneration('oc1')), oc2: new Headers(context.headersForGeneration('oc2')) };
      const prepared = await prepareConnection(connection);
      check();
      const beforeProbe = await getContext();
      check();
      if (beforeProbe.owner !== context.owner) throw new OpenCodeConnectionError('Connection test is stale', 409);
      let result;
      if (prepared.mode !== CONNECTION_MODE.EXTERNAL) {
        result = { kind: 'launch', status: 'validated', binary: prepared.binary };
      } else {
        const admitted = await detectOpenCodeProfile({ endpoint: prepared.endpoint, epoch: 0, selection: context.selection,
          signal: controller.signal,
          headersForGeneration: prepared.endpoint === context.endpoint ? generation => credentials[generation] : undefined });
        check();
        result = { kind: 'endpoint', status: admitted.status, selection: context.selection,
          version: admitted.descriptor?.version ?? null, profile: admitted.status === 'ready' ? admitted.descriptor.profile : null };
      }
      const current = await getContext();
      check();
      if (current.owner !== context.owner) throw new OpenCodeConnectionError('Connection test is stale', 409);
      return result;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      pending.delete(token);
    }
  };
  return { test, cancel };
};
