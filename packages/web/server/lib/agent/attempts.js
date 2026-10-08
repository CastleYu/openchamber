import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { AGENT_ATTEMPT, AGENT_ERROR, AGENT_FILE_ERROR, AGENT_MUTATIONS } from './constants.js';
import { agentAttemptSchema as recordSchema, agentAttemptRequestSchema as keySchema, agentAttemptStateSchema as stateSchema } from './schemas.js';

const mutations = new Set(AGENT_MUTATIONS);

export class AgentAttemptError extends Error {
  constructor(code) {
    super(`Agent attempt refused: ${code}`);
    this.name = 'AgentAttemptError';
    this.code = code;
  }
}

/** Host-owned storage. An existing filename is never retried or overwritten. */
export const createAgentAttempts = ({ directory, fsPromises = fs }) => {
  const root = path.resolve(z.string().min(1).parse(directory));
  const file = (identity, requestID) => {
    // Epoch/revision changes must not make an old intent eligible for resend.
    const key = JSON.stringify([identity.family, identity.connectionID, requestID]);
    return path.join(root, `${createHash('sha256').update(key).digest('hex')}.jsonl`);
  };
  const begin = async (identity, operation, requestID) => {
    const parsed = recordSchema.safeParse({ version: AGENT_ATTEMPT.VERSION, identity, operation,
      requestID, state: AGENT_ATTEMPT.UNKNOWN });
    if (!parsed.success) throw new AgentAttemptError(AGENT_ERROR.INVALID_INPUT);
    const record = parsed.data;
    const initial = `${JSON.stringify(record)}\n`;
    // Reserve room for the longest final state. No user payload is stored.
    if (Buffer.byteLength(initial) + 16 > AGENT_ATTEMPT.MAX_RECORD_BYTES) {
      throw new AgentAttemptError(AGENT_ERROR.INVALID_INPUT);
    }
    let handle;
    try {
      await fsPromises.mkdir(root, { recursive: true, mode: 0o700 });
      handle = await fsPromises.open(file(record.identity, record.requestID), 'wx', 0o600);
      await handle.writeFile(initial, 'utf8');
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => {});
      // Keep incomplete reservations as tombstones. Removing one could permit
      // another process to send an intent whose durability was uncertain.
      throw new AgentAttemptError(error?.code === AGENT_FILE_ERROR.EXISTS
        ? AGENT_ERROR.ATTEMPT_EXISTS : AGENT_ERROR.ATTEMPT_STORAGE);
    }
    let finished = false;
    const finish = async (state) => {
      if (finished) throw new AgentAttemptError(AGENT_ERROR.ATTEMPT_STORAGE);
      finished = true;
      try {
        const final = recordSchema.parse({ ...record, state });
        await handle.writeFile(`${JSON.stringify(final)}\n`, 'utf8');
        await handle.sync();
        return final;
      } catch {
        throw new AgentAttemptError(AGENT_ERROR.ATTEMPT_STORAGE);
      } finally {
        try { await handle.close(); } catch { throw new AgentAttemptError(AGENT_ERROR.ATTEMPT_STORAGE); }
      }
    };
    return Object.freeze({ finish });
  };
  const read = async (identity, requestID) => {
    const key = keySchema.safeParse({ identity, requestID });
    if (!key.success) throw new AgentAttemptError(AGENT_ERROR.INVALID_INPUT);
    let handle;
    try {
      handle = await fsPromises.open(file(key.data.identity, key.data.requestID), 'r');
      const stat = await handle.stat();
      if (stat.size > AGENT_ATTEMPT.MAX_RECORD_BYTES * 2) throw new AgentAttemptError(AGENT_ERROR.ATTEMPT_CORRUPT);
      const text = await handle.readFile('utf8');
      if (Buffer.byteLength(text) > AGENT_ATTEMPT.MAX_RECORD_BYTES * 2 || !text.endsWith('\n')) {
        throw new AgentAttemptError(AGENT_ERROR.ATTEMPT_CORRUPT);
      }
      const lines = text.slice(0, -1).split('\n');
      if (lines.length < 1 || lines.length > 2) throw new AgentAttemptError(AGENT_ERROR.ATTEMPT_CORRUPT);
      const records = lines.map((line) => recordSchema.parse(JSON.parse(line)));
      const first = records[0];
      if (first.state !== AGENT_ATTEMPT.UNKNOWN || first.identity.family !== key.data.identity.family
        || first.identity.connectionID !== key.data.identity.connectionID || first.requestID !== key.data.requestID
        || records.some((record) => record.operation !== first.operation || record.requestID !== first.requestID
          || JSON.stringify(record.identity) !== JSON.stringify(first.identity))) {
        throw new AgentAttemptError(AGENT_ERROR.ATTEMPT_CORRUPT);
      }
      return records.at(-1);
    } catch (error) {
      if (!handle && error?.code === AGENT_FILE_ERROR.MISSING) return null;
      if (error instanceof AgentAttemptError) throw error;
      if (error instanceof SyntaxError || error instanceof z.ZodError) throw new AgentAttemptError(AGENT_ERROR.ATTEMPT_CORRUPT);
      throw new AgentAttemptError(AGENT_ERROR.ATTEMPT_STORAGE);
    } finally {
      try { await handle?.close(); } catch { throw new AgentAttemptError(AGENT_ERROR.ATTEMPT_STORAGE); }
    }
  };
  return Object.freeze({ begin, read });
};
