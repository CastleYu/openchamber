// Background session assistance. Only live idle events arm generation; there
// is no backfill. Clients hide results whose forMessageID is no longer current.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import { readMergedSettingsSync } from '../opencode/settings-files.js';
import { loadAssistContext } from './context.js';
import { buildAssistPrompt, buildAssistSystemPrompt } from './prompt.js';
import { readDescendantActivity } from '../opencode/descendant-activity.js';

const OPENCHAMBER_SETTINGS_FILE = path.join(
  process.env.OPENCHAMBER_DATA_DIR
    ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
    : path.join(os.homedir(), '.config', 'openchamber'),
  'settings.json',
);

const getSessionAssistTargets = () => {
  const settings = readMergedSettingsSync({ fs, path, settingsFilePath: OPENCHAMBER_SETTINGS_FILE });
  return {
    recap: settings.sessionRecapEnabled !== false,
    suggestion: settings.sessionSuggestionEnabled !== false,
  };
};

const IDLE_QUIET_MS = 60_000;
const RECAP_CHAR_LIMIT = 320;
const SUGGESTION_CHAR_LIMIT = 500;
const FETCH_TIMEOUT_MS = 5_000;
const GENERATION_TIMEOUT_MS = 120_000;
const QUIET_FAILURE_CODES = new Set(['context-too-small', 'output-exhausted']);

const extractJsonObject = (value) => {
  const text = String(value ?? '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  for (let end = candidate.length; end > start; end -= 1) {
    if (candidate[end - 1] !== '}') continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // keep scanning — models wrap JSON in prose sometimes
    }
  }
  return null;
};

const extractSessionStatus = (payload) => {
  if (payload?.type === 'session.idle' || payload?.type === 'session.execution.completed'
    || payload?.type === 'session.execution.started') {
    const properties = payload.properties ?? {};
    return z.string().min(1).safeParse(properties.sessionID).success
      ? { sessionId: properties.sessionID, type: payload.type === 'session.execution.started' ? 'busy' : 'idle', directory: properties.directory ?? '' }
      : null;
  }
  if (!payload || payload.type !== 'session.status') return null;
  const properties = payload.properties && typeof payload.properties === 'object' ? payload.properties : {};
  const status = properties.status && typeof properties.status === 'object' ? properties.status : {};
  const info = properties.info && typeof properties.info === 'object' ? properties.info : {};
  const sessionId = typeof properties.sessionID === 'string' ? properties.sessionID.trim() : '';
  const type = typeof status.type === 'string'
    ? status.type.trim()
    : (typeof info.type === 'string' ? info.type.trim() : '');
  if (!sessionId || !type) return null;
  const directory = typeof properties.directory === 'string' && properties.directory
    ? properties.directory
    : (typeof info.directory === 'string' ? info.directory : '');
  return { sessionId, type, directory };
};

const extractUserMessage = (payload) => {
  if (!payload || payload.type !== 'message.updated') return null;
  const info = payload.properties?.info;
  if (!info || typeof info !== 'object' || info.role !== 'user') return null;
  if (typeof info.sessionID !== 'string' || !info.sessionID) return null;
  return {
    sessionId: info.sessionID,
    createdAt: typeof info.time?.created === 'number' ? info.time.created : 0,
  };
};

export const createSessionAssistRuntime = ({
  kernelOperations = null,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  getSmallModelService,
  getTargets = getSessionAssistTargets,
  quietMs = IDLE_QUIET_MS,
}) => {
  const timers = new Map();
  const inflight = new Map();
  const ready = new Map();
  let stopped = false;

  const clearTimer = (sessionId) => {
    const existing = timers.get(sessionId);
    if (existing) {
      clearTimeout(existing.timer);
      timers.delete(sessionId);
    }
  };

  const invalidate = (sessionId) => {
    clearTimer(sessionId);
    ready.delete(sessionId);
    inflight.get(sessionId)?.controller.abort();
  };

  const generateAssist = async (sessionId, directory, signal) => {
    const targets = getTargets();
    if (!targets.recap && !targets.suggestion) return;
    const identity = kernelOperations?.captureIdentity();
    const baseUrl = buildOpenCodeUrl('/', '').replace(/\/$/, '');
    const client = kernelOperations ? null : createOpencodeClient({ baseUrl, headers: getOpenCodeAuthHeaders(), throwOnError: true });
    const requestOptions = () => ({ signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) });
    const checkCurrent = () => {
      signal.throwIfAborted();
      if (identity) {
        const current = kernelOperations.captureIdentity();
        if (current.generation !== identity.generation || current.endpoint !== identity.endpoint || current.epoch !== identity.epoch) {
          throw new Error('Session assist runtime changed');
        }
      }
      if (buildOpenCodeUrl('/', '').replace(/\/$/, '') !== baseUrl) throw new Error('Session assist runtime changed');
    };
    const treeIdle = async () => {
      if (identity?.generation !== 'oc2') return true;
      try {
        const statuses = (await kernelOperations.listActiveStatuses({ directory, signal })).data;
        const busy = statuses[sessionId]?.type === 'busy' || statuses[sessionId]?.type === 'retry'
          ? true : await readDescendantActivity(kernelOperations, sessionId, directory, statuses, identity);
        checkCurrent();
        return busy === false;
      } catch {
        checkCurrent();
        return false;
      }
    };
    const { data: session } = kernelOperations
      ? await kernelOperations.getSession({ sessionID: sessionId, directory, signal })
      : await client.session.get({ sessionID: sessionId, directory }, requestOptions());
    checkCurrent();
    // Reverted history is not the active conversation. A new prompt clears
    // the revert boundary before its next idle event.
    if (session?.id !== sessionId || session.parentID || session.revert?.messageID || session.time?.archived) return;
    if (!await treeIdle()) {
      armTimer(sessionId, directory);
      return;
    }
    const context = await loadAssistContext({
      signal,
      readPage: async (page) => {
        if (!kernelOperations) return client.session.messages({ sessionID: sessionId, directory, ...page }, requestOptions());
        const result = (await kernelOperations.listMessages({ sessionID: sessionId, directory, limit: page.limit, cursor: page.before, signal })).data;
        const ordered = (result.order === 'asc' ? result.items : [...result.items].reverse())
          .filter((item) => item.role === 'user' || item.role === 'assistant');
        return {
          data: ordered.map((item) => ({
            info: { ...item.raw, id: item.id, role: item.role, parentID: item.parentID,
              providerID: item.model?.providerID ?? item.raw.providerID,
              modelID: item.model?.id ?? item.model?.modelID ?? item.raw.modelID,
              time: { created: item.created, completed: item.completed },
              finish: item.finish, error: item.error, summary: item.summary },
            parts: item.raw.parts ?? item.raw.content ?? (item.text ? [{ type: 'text', text: item.text }] : []),
          })),
          response: { headers: new Headers(result.cursor?.next ? { 'x-next-cursor': result.cursor.next } : {}) },
        };
      },
    });
    checkCurrent();
    if (!context) return;
    const { last, turns } = context;
    const { describeSmallModel, generateSmallModelText } = await getSmallModelService();
    const preferredProviderID = last.providerID;
    const preferredModelID = last.modelID;
    const described = await describeSmallModel({ directory, preferredProviderID, preferredModelID });
    checkCurrent();
    if (!described) return;
    const system = buildAssistSystemPrompt(targets);
    const prompt = buildAssistPrompt(turns, targets, described.inputCharBudget - system.length - 512);
    if (!prompt) return;
    let generated;
    try {
      generated = await generateSmallModelText({
        prompt: prompt.text, system, directory, sessionID: sessionId,
        preferredProviderID, preferredModelID, restrictToPreferredProvider: true,
        onOverflow: 'error', timeoutMs: GENERATION_TIMEOUT_MS, signal,
      });
    } catch (error) {
      if (!signal.aborted && Number(error?.statusCode) !== 404 && !QUIET_FAILURE_CODES.has(error?.code)) {
        console.warn('[session-assist] generation failed');
      }
      return;
    }
    checkCurrent();
    const structured = extractJsonObject(generated?.text);
    let recap = targets.recap && typeof structured?.recap === 'string' ? structured.recap.trim().slice(0, RECAP_CHAR_LIMIT) : '';
    let suggestion = targets.suggestion && typeof structured?.suggestion === 'string' ? structured.suggestion.trim().slice(0, SUGGESTION_CHAR_LIMIT) : '';
    const hasCyrillic = (text) => /[\u0400-\u04FF]/.test(text);
    const hasCjk = (text) => /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(text);
    // Quoted source and assistant replies cannot authorize a different script.
    // With no authored language sample, leave the decision to the prompt.
    const scriptMismatch = (text) => prompt.language && ((hasCyrillic(text) && !hasCyrillic(prompt.language))
      || (hasCjk(text) && !hasCjk(prompt.language)));
    if (recap && scriptMismatch(recap)) recap = '';
    if (suggestion && scriptMismatch(suggestion)) suggestion = '';
    if (!recap && !suggestion) return;
    const latestConversation = async () => {
      let cursor;
      const cursors = new Set();
      for (let index = 0; index < 8; index += 1) {
        const page = (await kernelOperations.listMessages({ sessionID: sessionId, directory, limit: 50, cursor, signal })).data;
        const ordered = page.order === 'asc' ? [...page.items].reverse() : page.items;
        const latest = ordered.find((item) => item.role === 'user' || item.role === 'assistant');
        if (latest) return latest;
        cursor = page.cursor?.next;
        if (!cursor) return null;
        if (cursors.has(cursor)) throw new Error('Session message pagination made no progress');
        cursors.add(cursor);
      }
      return null;
    };
    const latest = kernelOperations
      ? await latestConversation()
      : (await client.session.messages({ sessionID: sessionId, directory, limit: 1 }, requestOptions())).data?.at(-1);
    checkCurrent();
    if ((kernelOperations ? latest?.id : latest?.info?.id) !== last.id) return;
    // Never fall back to the pre-generation metadata snapshot after a failed
    // fresh read: doing so overwrites dismissals and unrelated metadata.
    const { data: freshSession } = kernelOperations
      ? await kernelOperations.getSession({ sessionID: sessionId, directory, signal })
      : await client.session.get({ sessionID: sessionId, directory }, requestOptions());
    checkCurrent();
    if (freshSession?.id !== sessionId || freshSession.revert?.messageID || freshSession.time?.archived || freshSession.directory !== session.directory) return;
    if (!await treeIdle()) {
      armTimer(sessionId, directory);
      return;
    }
    const enabled = getTargets();
    if (!enabled.recap) recap = '';
    if (!enabled.suggestion) suggestion = '';
    if (!recap && !suggestion) return;
    const currentMetadata = freshSession.metadata ?? {};
    const currentNamespace = currentMetadata.openchamber ?? {};
    if (kernelOperations) await kernelOperations.updateSession({ sessionID: sessionId, directory, metadata: {
      ...currentMetadata,
      openchamber: { ...currentNamespace, assist: { recap, suggestion, forMessageID: last.id, generatedAt: Date.now() } },
    }, signal });
    else await client.session.update({
      sessionID: sessionId, directory,
      metadata: {
        ...currentMetadata,
        openchamber: {
          ...currentNamespace,
          assist: { recap, suggestion, forMessageID: last.id, generatedAt: Date.now() },
        },
      },
    }, requestOptions());
  };

  const startGeneration = (sessionId, directory, armedAt) => {
    if (stopped) return;
    if (inflight.has(sessionId)) {
      ready.set(sessionId, { directory, armedAt });
      return;
    }
    const controller = new AbortController();
    inflight.set(sessionId, { controller, armedAt });
    generateAssist(sessionId, directory, controller.signal)
      .catch(() => {
        if (!controller.signal.aborted) console.warn('[session-assist] failed to read or save assistance');
      })
      .finally(() => {
        inflight.delete(sessionId);
        if (ready.has(sessionId)) {
          const next = ready.get(sessionId);
          ready.delete(sessionId);
          startGeneration(sessionId, next.directory, next.armedAt);
        }
      });
  };

  const armTimer = (sessionId, directory) => {
    clearTimer(sessionId);
    const armedAt = Date.now();
    const timer = setTimeout(() => {
      timers.delete(sessionId);
      startGeneration(sessionId, directory, armedAt);
    }, quietMs);
    timer.unref?.();
    timers.set(sessionId, { timer, armedAt });
  };

  const processPayload = (payload, directoryHint = '') => {
    if (stopped) return;
    const status = extractSessionStatus(payload);
    if (status) {
      if (status.type === 'idle') armTimer(status.sessionId, status.directory || directoryHint);
      else invalidate(status.sessionId);
      return;
    }
    const userMessage = extractUserMessage(payload);
    if (userMessage) {
      // Ignore old message.updated events re-emitted after completion.
      const since = timers.get(userMessage.sessionId)?.armedAt ?? inflight.get(userMessage.sessionId)?.armedAt;
      if (since !== undefined && userMessage.createdAt >= since) invalidate(userMessage.sessionId);
    }
  };

  const stop = () => {
    stopped = true;
    for (const sessionId of timers.keys()) clearTimer(sessionId);
    ready.clear();
    for (const { controller } of inflight.values()) controller.abort();
  };
  return { processPayload, stop };
};
