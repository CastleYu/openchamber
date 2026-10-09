import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AGENT_FAMILY } from '../agent/constants.js';
import { CONNECTION_SWITCH, OpenCodeConnectionError, parseOpenCodeConnection } from './connection.js';

const prepareSchema = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal(CONNECTION_SWITCH.CANDIDATE), connection: z.json() }),
  z.strictObject({ source: z.literal(CONNECTION_SWITCH.PREVIOUS) }),
]);
const applySchema = z.strictObject({ token: z.string().uuid(), decision: z.enum([CONNECTION_SWITCH.WAIT, CONNECTION_SWITCH.STOP]), acknowledgeClients: z.literal(true) });
const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) throw new OpenCodeConnectionError('Invalid connection confirmation', 400);
  return result.data;
};
const idle = report => [report.busy, report.permissions, report.questions].every(item => item.state === 'known' && item.count === 0);

// One pending candidate per host. Tokens contain no configuration or authority.
export const createConnectionSwitch = ({ activity, lifecycle, prepareConnection, readConnection, readPrevious, saveConnection, getOwner, getSelection, getState, stopExternal }) => {
  let pending = null;
  let applying = false;
  const requireAvailable = () => {
    if (getSelection().family !== AGENT_FAMILY.OPENCODE) throw new OpenCodeConnectionError('Unsupported backend family', 501);
    if (applying || getState().transitioning) throw new OpenCodeConnectionError('Connection transition in progress', 409);
  };
  const requireOwner = owner => {
    if (JSON.stringify(getOwner()) !== owner) throw new OpenCodeConnectionError('Connection confirmation is stale', 409);
  };
  const previous = async () => {
    const record = parseOpenCodeConnection(await readPrevious());
    if (!record) throw new OpenCodeConnectionError('No previous confirmed connection', 422);
    return record;
  };
  const prepare = async value => {
    requireAvailable(); applying = true;
    try {
      const input = parse(prepareSchema, value);
      const owner = JSON.stringify(getOwner());
      const record = input.source === CONNECTION_SWITCH.PREVIOUS ? await previous() : parseOpenCodeConnection(input.connection);
      if (!record) throw new OpenCodeConnectionError('A confirmed connection is required', 422);
      await prepareConnection(record);
      const original = parseOpenCodeConnection(await readConnection());
      const report = await activity.inspect();
      requireOwner(owner);
      pending = { token: randomUUID(), owner, record, original };
      return { token: pending.token, connection: record, activity: report };
    } finally { applying = false; }
  };
  const apply = async value => {
    requireAvailable();
    const input = parse(applySchema, value);
    if (!pending || pending.token !== input.token) throw new OpenCodeConnectionError('Connection confirmation is stale', 409);
    const candidate = pending;
    requireOwner(candidate.owner);
    applying = true;
    try {
      const check = async () => {
        requireOwner(candidate.owner);
        if (JSON.stringify(parseOpenCodeConnection(await readConnection())) !== JSON.stringify(candidate.original)) {
          throw new OpenCodeConnectionError('Saved connection changed', 409);
        }
        const report = await activity.inspect({ duringTransition: true });
        requireOwner(candidate.owner);
        if (getState().ready && input.decision === CONNECTION_SWITCH.WAIT && !idle(report)) {
          throw new OpenCodeConnectionError('Wait for authoritative idle sessions and approvals', 409);
        }
        if (getState().ready && input.decision === CONNECTION_SWITCH.STOP && getState().external) {
          if (report.busy.state !== 'known') throw new OpenCodeConnectionError('External busy activity is unknown', 409);
          await stopExternal(report);
          requireOwner(candidate.owner);
        }
      };
      await lifecycle.restartOpenCode('confirmed-connection-change', {
        resolve: async () => { requireOwner(candidate.owner); return prepareConnection(candidate.record); },
        beforeRetire: check,
        commit: async () => { await saveConnection(candidate.record); return getSelection(); },
      });
      pending = null;
      return { state: CONNECTION_SWITCH.READY, connection: candidate.record };
    } finally { applying = false; }
  };
  return { prepare, apply, previous };
};
