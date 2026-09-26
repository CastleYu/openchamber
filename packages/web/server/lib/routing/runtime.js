/**
 * Owns Jev routing at runtime: whether Auto is ready, rewriting a prompt body
 * that names the `openchamber/auto` model, and the safety net consulted before
 * a permission is auto-accepted. Every failure path keeps the user's own
 * behaviour: a prompt goes to the fallback model, a permission is accepted as
 * auto-accept would have, and the UI is told why.
 */
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import { z } from 'zod';
import { isRoutingFeatureAvailable } from './feature-flag.js';
import { AUTO_MODEL_REF, BUILTIN_CATEGORIES, isAutoModel } from './defaults.js';
import { createRoutingStore, parseEffectiveConfig } from './store.js';
import { buildPermissionRequest, buildRoutingRequest, createJevClient, decidePermission, decideRouting, jevEndpoint } from './jev.js';
import { loadRoutingHistory, turnsToHistory } from './history.js';

const HISTORY_TIMEOUT_MS = 2500;
/** A held permission is remembered so reconnect reconciliation does not re-ask Jev. */
const PERMISSION_DECISION_TTL_MS = 15 * 60 * 1000;

const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

const textPartSchema = z.object({ type: z.literal('text'), text: z.string(), synthetic: z.boolean().optional() });
const commandBodySchema = z.object({ command: z.string(), arguments: z.string().optional() });
const currentCommandBodySchema = z.object({ name: z.string().trim().min(1), text: z.string().nullish() });
const promptBodySchema = z.object({ parts: z.array(z.unknown()).optional() });

/** The user's words for this send: text parts the composer authored, or the slash command. */
export const requestTextOf = (body) => {
  const currentCommand = currentCommandBodySchema.safeParse(body);
  if (currentCommand.success) return `/${currentCommand.data.name}${currentCommand.data.text?.trim() ? ` ${currentCommand.data.text.trim()}` : ''}`;
  const command = commandBodySchema.safeParse(body);
  if (command.success) {
    const args = command.data.arguments?.trim();
    return `/${command.data.command}${args ? ` ${args}` : ''}`;
  }
  const currentPrompt = z.object({ text: z.string() }).safeParse(body);
  if (currentPrompt.success) return currentPrompt.data.text.trim();
  const prompt = promptBodySchema.safeParse(body);
  const parts = prompt.success ? prompt.data.parts ?? [] : [];
  return parts
    .map((part) => textPartSchema.safeParse(part))
    .filter((part) => part.success && !part.data.synthetic)
    .map((part) => part.data.text)
    .join('\n\n')
    .trim();
};

export function createRoutingRuntime({
  dataDir,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  kernelOperations = null,
  broadcastGlobalUiEvent,
  fetchImpl = fetch,
  store = createRoutingStore({ dataDir }),
  jev = createJevClient({ fetchImpl }),
  now = Date.now,
}) {
  const permissionDecisions = new Map();
  const autoSessions = new Map();
  const identityKey = (identity) => `${identity.generation}\0${identity.endpoint}\0${identity.epoch}`;
  const currentIdentity = () => kernelOperations?.captureIdentity() ?? null;
  const generation = () => currentIdentity()?.generation ?? 'oc1';
  const assertIdentity = (expected) => {
    if (!expected) return;
    const current = currentIdentity();
    if (identityKey(current) !== identityKey(expected)) throw new Error('OpenCode runtime changed during routing');
  };

  const broadcast = (type, properties) => {
    try {
      broadcastGlobalUiEvent?.({ type, properties });
    } catch (error) {
      console.warn(`[routing] failed to broadcast ${type}:`, errorMessage(error));
    }
  };

  const enabledCategories = (config) => config.categories.filter((category) => category.enabled);

  /** What the client needs to decide whether to offer Auto and what the settings page shows. */
  const describe = async () => {
    const current = generation() === 'oc2';
    const available = current || isRoutingFeatureAvailable();
    if (!available) return { available: false, autoReady: false, tokenPresent: false, config: null, builtins: [] };
    const [config, token] = await Promise.all([store.readConfig(), store.readToken()]);
    const tokenPresent = Boolean(token);
    const autoReady = config.enabled && (current || tokenPresent) && Boolean(config.fallback) && enabledCategories(config).length >= 2;
    // Built-in text travels with the config so "Reset" in Settings restores the shipped wording.
    const result = { available, autoReady, tokenPresent, config, builtins: BUILTIN_CATEGORIES };
    if (current) result.jevSource = jevEndpoint(token).source;
    return result;
  };

  const publishUpdated = async () => {
    const state = await describe();
    broadcast('openchamber:routing.updated', { available: state.available, autoReady: state.autoReady, tokenPresent: state.tokenPresent });
    return state;
  };

  const readHistory = async ({ sessionId, directory }) => {
    if (currentIdentity()?.generation === 'oc2') {
      const page = (await kernelOperations.listMessages({ sessionID: sessionId, directory, limit: 50, order: 'desc' })).data;
      const messages = page.items.toReversed();
      const turns = [];
      let turn = null;
      for (const message of messages) {
        if (message.role === 'user' && message.text) {
          turn = { user: { text: message.text }, assistant: null };
          turns.push(turn);
        } else if (message.role === 'assistant' && turn && message.text && message.completed && !message.error) {
          turn.assistant = { text: message.text };
        }
      }
      return turnsToHistory(turns.filter((item) => item.assistant));
    }
    const baseUrl = buildOpenCodeUrl('/', '').replace(/\/$/, '');
    const client = createOpencodeClient({ baseUrl, headers: getOpenCodeAuthHeaders(), throwOnError: true });
    const signal = AbortSignal.timeout(HISTORY_TIMEOUT_MS);
    return loadRoutingHistory({
      signal,
      readPage: (page) => client.session.messages({ sessionID: sessionId, directory, ...page }, { signal }),
    });
  };

  // A category without a model of its own means "the fallback pair"; a variant
  // only travels with the model it was chosen for.
  const applyChoice = (body, config, choice) => {
    const own = Boolean(choice?.model);
    const model = own ? choice.model : config.fallback.model;
    const variant = own ? choice.variant : config.fallback.variant;
    // Keep the wire shape the route uses: a string on /command, an object on the prompt routes.
    body.model = z.string().safeParse(body.model).success
      ? `${model.providerID}/${model.modelID}`
      : { providerID: model.providerID, modelID: model.modelID };
    if (variant) body.variant = variant;
    else delete body.variant;
    if (choice?.agent) body.agent = choice.agent;
    return { providerID: model.providerID, modelID: model.modelID, variant: variant ?? null, agent: choice?.agent ?? null };
  };

  const chooseCurrent = (config, choice, composerAgent) => {
    const own = Boolean(choice?.model);
    const model = own ? choice.model : config.fallback.model;
    const variant = own ? choice.variant : config.fallback.variant;
    const ref = { providerID: model.providerID, id: model.modelID };
    if (variant) ref.variant = variant;
    return {
      model: ref,
      agent: choice?.agent || composerAgent || null,
      decision: { providerID: model.providerID, modelID: model.modelID, variant: variant ?? null, agent: choice?.agent ?? null },
    };
  };

  const noteModelSelection = (sessionId, model, directory) => {
    if (!sessionId) return false;
    const identity = currentIdentity();
    autoSessions.delete(sessionId);
    if (!isAutoModel(model)) return false;
    autoSessions.set(sessionId, { directory, key: identity ? identityKey(identity) : '' });
    while (autoSessions.size > 1000) autoSessions.delete(autoSessions.keys().next().value);
    return true;
  };

  const isAutoSession = (sessionId) => {
    const entry = autoSessions.get(sessionId);
    const identity = currentIdentity();
    return Boolean(entry && identity && entry.key === identityKey(identity));
  };

  const resolveAutoSelection = async ({ sessionId, directory, model, agent, requestText }) => {
    if (!isAutoModel(model)) return null;
    const identity = currentIdentity();
    const state = await describe();
    assertIdentity(identity);
    const config = state.config;
    if (!config?.fallback) throw Object.assign(new Error('Auto routing is selected but no fallback model is configured'), { status: 400 });
    const decision = { sessionId, at: now(), category: null, confidence: 0, reason: 'not-ready', ms: 0 };
    let selection = chooseCurrent(config, null, agent);
    if (state.autoReady) {
      let history = [];
      try { history = await readHistory({ sessionId, directory }); }
      catch (error) { console.warn('[routing] history unavailable, routing on the request alone:', errorMessage(error)); }
      assertIdentity(identity);
      try {
        const token = await store.readToken();
        const { answers, ms } = await jev.ask(buildRoutingRequest({ categories: enabledCategories(config), history, request: (requestText ?? '').trim() }), token);
        assertIdentity(identity);
        const result = decideRouting(answers.category, { categories: enabledCategories(config), minConfidence: config.minConfidence });
        decision.category = result.category?.id ?? null;
        decision.confidence = result.confidence;
        decision.reason = result.reason;
        decision.ms = ms;
        selection = chooseCurrent(config, result.category, agent);
      } catch (error) {
        assertIdentity(identity);
        decision.reason = 'error';
        decision.error = errorMessage(error);
      }
    }
    Object.assign(decision, selection.decision);
    broadcast('openchamber:routing.decision', decision);
    return { model: selection.model, agent: selection.agent, decision };
  };

  const routeSend = async ({ sessionId, directory, body }) => {
    if (!isAutoSession(sessionId)) return null;
    const identity = currentIdentity();
    const resolved = await resolveAutoSelection({ sessionId, directory, model: AUTO_MODEL_REF,
      agent: z.string().safeParse(body?.agent).success ? body.agent : null,
      requestText: requestTextOf(body), });
    assertIdentity(identity);
    await kernelOperations.switchSessionSelection({ sessionID: sessionId, directory,
      model: resolved.model, agent: resolved.agent, expectedIdentity: identity });
    assertIdentity(identity);
    return resolved.decision;
  };

  /**
   * Rewrites `body.model` in place when it is the Auto sentinel. Returns the
   * decision that was applied, or null when the body named a real model.
   * Throws only when Auto cannot be honoured at all (no fallback configured):
   * the sentinel must never reach OpenCode.
   */
  const resolvePromptBody = async (body, { sessionId, directory }) => {
    if (!isAutoModel(body?.model)) return null;
    const state = await describe();
    const config = state.config;
    if (!config?.fallback) {
      throw Object.assign(new Error('Auto routing is selected but no fallback model is configured'), { status: 400 });
    }
    const decision = { sessionId, at: now(), category: null, confidence: 0, reason: 'not-ready', ms: 0 };
    if (state.autoReady) {
      const request = requestTextOf(body);
      let history = [];
      try {
        history = await readHistory({ sessionId, directory });
      } catch (error) {
        console.warn('[routing] history unavailable, routing on the request alone:', errorMessage(error));
      }
      try {
        const token = await store.readToken();
        const { answers, ms } = await jev.ask(buildRoutingRequest({ categories: enabledCategories(config), history, request }), token);
        const result = decideRouting(answers.category, { categories: enabledCategories(config), minConfidence: config.minConfidence });
        decision.category = result.category?.id ?? null;
        decision.confidence = result.confidence;
        decision.reason = result.reason;
        decision.ms = ms;
        Object.assign(decision, applyChoice(body, config, result.category));
      } catch (error) {
        decision.reason = 'error';
        decision.error = errorMessage(error);
        Object.assign(decision, applyChoice(body, config, null));
      }
    } else {
      Object.assign(decision, applyChoice(body, config, null));
    }
    broadcast('openchamber:routing.decision', decision);
    return decision;
  };

  /**
   * Consulted by permission auto-accept before it replies. `accept` keeps the
   * reply; `hold` leaves the request for the user; `skipped` is `accept` with
   * a reason the UI surfaces (Jev unreachable, bad key).
   */
  const evaluatePermission = async (permission, directory) => {
    if (!permission?.id) return { action: 'accept' };
    const cached = permissionDecisions.get(permission.id);
    if (cached && now() - cached.at < PERMISSION_DECISION_TTL_MS) return cached.result;
    const state = await describe();
    if (!state.available || !state.config?.enabled || !state.config.safetyNet.enabled || !state.tokenPresent) return { action: 'accept' };
    let result;
    try {
      const token = await store.readToken();
      const { answers } = await jev.ask(buildPermissionRequest(permission), token);
      const verdict = decidePermission(answers, { threshold: state.config.safetyNet.threshold });
      result = verdict.hold
        ? { action: 'hold', score: verdict.score, kind: verdict.kind }
        : { action: 'accept', score: verdict.score, kind: verdict.kind };
      if (verdict.hold) {
        broadcast('openchamber:routing.permission-held', {
          permissionId: permission.id, sessionId: permission.sessionID, directory: directory ?? null, score: verdict.score, kind: verdict.kind,
        });
      }
    } catch (error) {
      result = { action: 'accept', skipped: errorMessage(error) };
      broadcast('openchamber:routing.safety-skipped', {
        permissionId: permission.id, sessionId: permission.sessionID, directory: directory ?? null, error: result.skipped,
      });
    }
    permissionDecisions.set(permission.id, { at: now(), result });
    return result;
  };

  const forgetPermission = (permissionId) => {
    permissionDecisions.delete(permissionId);
  };

  const updateConfig = async (input) => {
    const config = parseEffectiveConfig(input);
    await store.writeConfig(config);
    return publishUpdated();
  };

  const setToken = async (token) => {
    const parsed = z.string().trim().min(1).max(4000).safeParse(token);
    if (!parsed.success) throw Object.assign(new Error('A Jev API key is required'), { status: 400 });
    await store.writeToken(parsed.data);
    return publishUpdated();
  };

  const clearToken = async () => {
    await store.clearToken();
    return publishUpdated();
  };

  /** Held permissions the UI can read back after a reload. */
  const heldPermissions = () => {
    const held = [];
    for (const [permissionId, entry] of permissionDecisions) {
      if (entry.result.action === 'hold') held.push({ permissionId, score: entry.result.score, kind: entry.result.kind });
    }
    return held;
  };

  return { generation, describe, resolvePromptBody, noteModelSelection, isAutoSession, resolveAutoSelection, routeSend,
    evaluatePermission, forgetPermission, heldPermissions, updateConfig, setToken, clearToken };
}
