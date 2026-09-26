// File-backed goal objectives. Session metadata must stay light (it rides
// every session.updated event), so the objective TEXT lives in a file under
// the OpenChamber data dir, keyed by the SESSION ID: sessions are globally
// unique and carry at most one goal at a time, so the mapping is fully
// deterministic — the metadata only carries an `objectiveFile: true` flag,
// never a path, and user-writable metadata cannot become a file-read vector.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

export const GOAL_OBJECTIVE_CHAR_LIMIT = 5_000;

// OpenCode session ids are URL-safe tokens; anything else is rejected before
// touching the filesystem.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;
const sessionIDSchema = z.string().regex(SESSION_ID_PATTERN);

const goalsDir = () => path.join(
  process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : path.join(os.homedir(), '.config', 'openchamber'),
  'goals',
);

const objectiveFilePath = (sessionId) => path.join(goalsDir(), `${sessionId}.md`);

export const isValidObjectiveKey = (sessionId) =>
  sessionIDSchema.safeParse(sessionId).success;

const clampContent = (content) => String(content ?? '').trim().slice(0, GOAL_OBJECTIVE_CHAR_LIMIT);

/** Write (or overwrite — a new goal replaces the old one) the session's objective. */
export const writeObjective = async (sessionId, content) => {
  if (!isValidObjectiveKey(sessionId)) {
    throw Object.assign(new Error('invalid session id'), { statusCode: 400 });
  }
  const text = clampContent(content);
  if (!text) {
    throw Object.assign(new Error('objective content is required'), { statusCode: 400 });
  }
  await fs.promises.mkdir(goalsDir(), { recursive: true });
  await fs.promises.writeFile(objectiveFilePath(sessionId), text, 'utf8');
  return { content: text };
};

/** Returns the objective text, or null when missing/invalid. */
export const readObjective = async (sessionId) => {
  if (!isValidObjectiveKey(sessionId)) return null;
  try {
    const raw = await fs.promises.readFile(objectiveFilePath(sessionId), 'utf8');
    return clampContent(raw);
  } catch {
    return null;
  }
};

/** Fork inheritance may treat only ENOENT as absent; every other read failure rejects. */
export const readObjectiveForFork = async (sessionId) => {
  if (!isValidObjectiveKey(sessionId)) throw new Error('invalid session id');
  try {
    const text = clampContent(await fs.promises.readFile(objectiveFilePath(sessionId), 'utf8'));
    if (!text) throw new Error('goal objective file is empty');
    return text;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error('Failed to read source goal objective', { cause: error });
  }
};

/** Cleanup of a failed fork repair must report a stranded file. */
export const removeObjectiveForFork = async (sessionId) => {
  if (!isValidObjectiveKey(sessionId)) throw new Error('invalid session id');
  try {
    await fs.promises.unlink(objectiveFilePath(sessionId));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('Failed to clean up fork goal objective', { cause: error });
  }
};

/** Best-effort delete; missing files are fine. */
export const deleteObjective = async (sessionId) => {
  if (!isValidObjectiveKey(sessionId)) return;
  await fs.promises.unlink(objectiveFilePath(sessionId)).catch(() => undefined);
};
