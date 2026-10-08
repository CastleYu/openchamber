import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

import { AGENT_APPROVAL, AGENT_ERROR, AGENT_FILE_ERROR, AGENT_FILE_MODE } from './constants.js';
import { AgentApprovalError, agentApprovalName } from './approvals.js';
import { agentApprovalSchema } from './schemas.js';

/** Maintainer-only persistence. Call only after independent evidence review. No public route. */
export const createAgentApprovalWriter = ({ directory }) => {
  const parsed = z.string().min(1).safeParse(directory);
  if (!parsed.success) throw new AgentApprovalError(AGENT_ERROR.INVALID_INPUT);
  const root = path.resolve(parsed.data);
  const target = (name) => {
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE);
    const file = path.join(fs.realpathSync(root), name);
    try {
      const previous = fs.lstatSync(file);
      if (!previous.isFile() || previous.isSymbolicLink() || fs.realpathSync(file) !== file) {
        throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE);
      }
    } catch (error) {
      if (error?.code !== AGENT_FILE_ERROR.MISSING) throw error;
    }
    return file;
  };
  const write = (approval) => {
    const checked = agentApprovalSchema.safeParse(approval);
    if (!checked.success) throw new AgentApprovalError(AGENT_ERROR.INVALID_INPUT);
    const value = checked.data;
    const bytes = Buffer.from(JSON.stringify({ version: AGENT_APPROVAL.VERSION, approval: value }));
    if (bytes.length > AGENT_APPROVAL.MAX_RECORD_BYTES) throw new AgentApprovalError(AGENT_ERROR.INVALID_INPUT);
    const name = agentApprovalName({ family: value.family, connectionID: value.connectionID });
    let fd;
    let temporary;
    try {
      const file = target(name);
      const pending = `${file}.${randomUUID()}${AGENT_APPROVAL.TEMP_SUFFIX}`;
      fd = fs.openSync(pending, AGENT_FILE_MODE.EXCLUSIVE, AGENT_FILE_MODE.OWNER_READ_WRITE);
      temporary = pending;
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      if (target(name) !== file) throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE);
      fs.renameSync(temporary, file);
      temporary = undefined;
    } catch (error) {
      if (error instanceof AgentApprovalError) throw error;
      throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE);
    } finally {
      let failed = false;
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { failed = true; }
      }
      if (temporary !== undefined) {
        try { fs.unlinkSync(temporary); }
        catch (error) {
          if (error?.code !== AGENT_FILE_ERROR.MISSING) failed = true;
        }
      }
      if (failed) throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE);
    }
  };
  const revoke = (identity) => {
    const name = agentApprovalName(identity);
    try {
      const file = target(name);
      try { fs.unlinkSync(file); }
      catch (error) {
        if (error?.code === AGENT_FILE_ERROR.MISSING) return false;
        throw error;
      }
      return true;
    } catch (error) {
      if (error instanceof AgentApprovalError) throw error;
      throw new AgentApprovalError(AGENT_ERROR.APPROVAL_STORAGE);
    }
  };
  return Object.freeze({ write, revoke });
};
