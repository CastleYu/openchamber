import crypto from 'node:crypto';
import { parseOpenCodeConnection, CONNECTION_MODE } from './connection.js';

// Configured target identity survives a managed port/password/epoch change.
// It does not establish remote server-instance identity at an unchanged URL.
export const describeQueueTarget = ({ connection, identity, binary, directory }) => {
  const record = parseOpenCodeConnection(connection);
  if (!record) throw new Error('A confirmed connection is required for queueing');
  const target = { connection: record, generation: identity.generation, profile: identity.profile };
  if (record.mode !== CONNECTION_MODE.EXTERNAL) {
    if (!binary || !directory) throw new Error('Managed queue target is unavailable');
    target.binary = binary;
    target.directory = directory;
  }
  return crypto.createHash('sha256').update(JSON.stringify(target)).digest('hex');
};
