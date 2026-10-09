import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { z } from 'zod';

import { AGENT_APPROVAL, AGENT_ERROR, AGENT_FAMILY, AGENT_FILE_ERROR } from './constants.js';
import { agentApprovalSchema, agentSelectionSchema } from './schemas.js';

const scope = z.object({
  family: z.enum(Object.values(AGENT_FAMILY)), connectionID: z.string().min(1),
}).strict();
const record = z.object({ version: z.literal(AGENT_APPROVAL.VERSION), approval: agentApprovalSchema }).strict();

export class AgentApprovalError extends Error {
  constructor(code) {
    super(`Agent approval refused: ${code}`);
    this.name = 'AgentApprovalError';
    this.code = code;
  }
}

/** The maintainer-owned runner uses this basename for its reviewed record. */
export const agentApprovalName = (identity) => {
  const parsed = scope.safeParse(identity);
  if (!parsed.success) throw new AgentApprovalError(AGENT_ERROR.INVALID_INPUT);
  return `${createHash('sha256').update(JSON.stringify([
    parsed.data.family, parsed.data.connectionID,
  ])).digest('hex')}.json`;
};

/** No writer or cache: only protected host composition can select the directory. */
export const createAgentApprovals = ({ directory }) => {
  const input = z.string().min(1).safeParse(directory);
  if (!input.success) throw new AgentApprovalError(AGENT_ERROR.INVALID_INPUT);
  const root = path.resolve(input.data);
  const read = (selection) => {
    const parsed = agentSelectionSchema.safeParse(selection);
    if (!parsed.success) throw new AgentApprovalError(AGENT_ERROR.INVALID_INPUT);
    const current = parsed.data;
    if (!current.authorized || !current.ready) return null;
    const name = agentApprovalName({ family: current.family, connectionID: current.connectionID });
    let fd;
    try {
      const rootStat = fs.lstatSync(root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE);
      const target = path.join(fs.realpathSync(root), name);
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(target) !== target) {
        throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE);
      }
      fd = fs.openSync(target, 'r');
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino) {
        throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE);
      }
      if (before.size > AGENT_APPROVAL.MAX_RECORD_BYTES) throw new AgentApprovalError(AGENT_ERROR.APPROVAL_CORRUPT);
      const buffer = Buffer.alloc(AGENT_APPROVAL.MAX_RECORD_BYTES + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const size = fs.readSync(fd, buffer, bytes, buffer.length - bytes, null);
        if (size === 0) break;
        bytes += size;
      }
      const after = fs.fstatSync(fd);
      if (bytes > AGENT_APPROVAL.MAX_RECORD_BYTES || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes !== before.size) {
        throw new AgentApprovalError(AGENT_ERROR.APPROVAL_CORRUPT);
      }
      let decoded;
      try { decoded = record.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes)))); }
      catch { throw new AgentApprovalError(AGENT_ERROR.APPROVAL_CORRUPT); }
      if (!decoded.success || decoded.data.approval.family !== current.family
        || decoded.data.approval.connectionID !== current.connectionID) {
        throw new AgentApprovalError(AGENT_ERROR.APPROVAL_CORRUPT);
      }
      const approval = decoded.data.approval;
      const result = { ...approval, operations: Object.freeze(approval.operations.map((item) =>
        Object.freeze({ ...item, evidence: Object.freeze([...item.evidence]) }))) };
      if (approval.extensions) result.extensions = Object.freeze(approval.extensions.map((item) =>
        Object.freeze({ ...item, evidence: Object.freeze([...item.evidence]) })));
      return Object.freeze(result);
    } catch (error) {
      if (error instanceof AgentApprovalError) throw error;
      if (error?.code === AGENT_FILE_ERROR.MISSING) return null;
      throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE);
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE); }
      }
    }
  };
  return Object.freeze({ read });
};
