import { z } from 'zod';
import { QUEUE_TARGET } from '../../web/server/lib/opencode/queue-target.js';
import { AGENT_FAMILY } from '../../web/server/lib/agent/constants.js';
import { createConnectionActivity } from '../../web/server/lib/opencode/connection-activity.js';
import { createConnectionSwitch } from '../../web/server/lib/opencode/connection-switch.js';
import { createKernelOperations } from '../../web/server/lib/opencode/kernel-operations.js';
import { CONNECTION_SWITCH, OPENCODE_CONNECTION, OpenCodeConnectionError, describeOpenCodeConnections, prepareOpenCodeConnection } from '../../web/server/lib/opencode/connection.js';

export const CONNECTION_BRIDGE = 'api:opencode/connection';
const requestSchema = z.strictObject({ method: z.enum(['GET', 'POST']), path: z.string(), body: z.json().optional() });

// Extension-host composition of the same finite confirmation and SDK owners as Web.
export const createVSCodeConnectionRuntime = deps => {
  const prepareConnection = value => prepareOpenCodeConnection(value, {
    resolveBinary: deps.resolveBinary, resolveLaunchSpec: deps.resolveLaunchSpec,
    stat: deps.stat, env: deps.getEnv(),
  });
  const kernelOperations = createKernelOperations({ getRuntime: deps.getRuntime, getHeaders: deps.getHeaders });
  // VS Code has no server-owned dispatch queue. Browser drafts/queues belong to their client.
  const activity = createConnectionActivity({ kernelOperations, queue: null, getDirectories: deps.getDirectories, getState: deps.getState });
  const owner = createConnectionSwitch({ activity, lifecycle: { restartOpenCode: (_, transaction) => deps.replace(transaction) },
    prepareConnection, readConnection: () => deps.readSettings()[OPENCODE_CONNECTION.SETTING] ?? null,
    readPrevious: deps.readPrevious, saveConnection: deps.saveConnection,
    getOwner: deps.getOwner, getSelection: () => ({ family: AGENT_FAMILY.OPENCODE }),
    getState: deps.getState, stopExternal: activity.stop,
  });
  const discover = () => describeOpenCodeConnections({ settings: deps.readSettings(), env: deps.getEnv(), resolveBinary: deps.resolveBinary, configured: deps.getConfigured() });
  const request = async raw => {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return { status: 400, body: { error: 'invalid_connection_request' } };
    const { method, path, body } = parsed.data;
    try {
      if (method === 'GET' && path === QUEUE_TARGET.ROUTE) return { status: 200, body: { target: deps.getQueueTarget() } };
      if (method === 'GET' && path === OPENCODE_CONNECTION.ROUTE) return { status: 200, body: discover() };
      if (method === 'GET' && path === OPENCODE_CONNECTION.ACTIVITY_ROUTE) return { status: 200, body: await activity.inspect() };
      if (method === 'GET' && path === CONNECTION_SWITCH.PREVIOUS_ROUTE) return { status: 200, body: { connection: await owner.previous() } };
      if (method === 'POST' && path === CONNECTION_SWITCH.PREPARE_ROUTE) return { status: 200, body: await owner.prepare(body) };
      if (method === 'POST' && path === CONNECTION_SWITCH.APPLY_ROUTE) return { status: 200, body: await owner.apply(body) };
      return { status: 404, body: { error: 'connection_route_not_found' } };
    } catch (error) {
      const status = error instanceof OpenCodeConnectionError ? error.status : 503;
      return { status, body: { error: status === 409 ? 'connection_changed' : status === 501 ? 'unsupported_runtime' : 'connection_failed' } };
    }
  };
  return { prepareConnection, discover, request };
};
