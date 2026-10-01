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
import { AUTO_MODEL_REF, BUILTIN_CATEGORIES, ZEN_JEV_PROMOTION_ACTIVE, isAutoModel } from './defaults.js';
import { createRoutingStore, parseEffectiveConfig } from './store.js';
import { buildPermissionRequest, buildRoutingRequest, createJevClient, decidePermission, decideRouting, jevEndpoint } from './jev.js';
import { loadRoutingHistory, turnsToHistory } from './history.js';
import { CLASSIFIER_SOURCES, classifierEndpoint, legacyClassifier, normalizeCustomEndpointUrl, resolveClassifier } from './classifier.js';
import { readOpenCodeCredentials } from '../opencode/auth.js';

const HISTORY_TIMEOUT_MS = 2500;
/** A held permission is remembered so reconnect reconciliation does not re-ask Jev. */
const PERMISSION_DECISION_TTL_MS = 15 * 60 * 1000;

const errorMessage = (error) => (error instanceof Error ? error.message : String(error));
const customEndpointInputSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  model: z.string().trim().min(1).max(200),
  key: z.string().trim().max(4000).nullable().optional(),
});
const apiKeySchema = z.object({ type: z.literal('api'), key: z.string().min(1) });
export const readOpenCodeKeys = async ({ readAuth = readOpenCodeCredentials, env = process.env } = {}) => {
  let auth = {};
  try { auth = await readAuth(); } catch { /* An unreadable credential store leaves environment keys available. */ }
  const saved = (id) => apiKeySchema.safeParse(auth?.[id]).data?.key ?? null;
  return {
    zenKey: saved('opencode'),
    openrouterKey: saved('openrouter') ?? env.OPENROUTER_API_KEY ?? null,
    vercelKey: saved('vercel') ?? env.AI_GATEWAY_API_KEY ?? null,
  };
};

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
  readProviderKeys = () => readOpenCodeKeys(),
  zenPromotionActive = ZEN_JEV_PROMOTION_ACTIVE,
  enterpriseMode = () => false,
  readPinnedEndpoint = () => null,
  now = Date.now,
}) {
  const permissionDecisions = new Map();
  const autoSessions = new Map();
  const identityKey = (identity) => `${identity.generation}\0${identity.endpoint}\0${identity.epoch}`;
  let lastIdentityKey = '';
  const currentIdentity = () => {
    const identity = kernelOperations?.captureIdentity() ?? null;
    const key = identity ? identityKey(identity) : '';
    if (key !== lastIdentityKey) {
      lastIdentityKey = key;
      permissionDecisions.clear();
      autoSessions.clear();
    }
    return identity;
  };
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

  const resolveAccess = async () => {
    const [typesafeKey, selected, savedEndpoint] = await Promise.all([
      store.readToken(), store.readClassifierSource(), store.readCustomEndpoint(),
    ]);
    const pinned = readPinnedEndpoint();
    const customEndpoint = pinned ?? savedEndpoint;
    const keys = { typesafeKey, customEndpoint, ...(await readProviderKeys()) };
    const choice = enterpriseMode() ? (pinned && selected === 'custom' ? 'custom' : 'off') : selected;
    const classification = resolveClassifier({ selected: choice, ...keys, zenPromotionActive });
    const endpoint = classification.effective ? classifierEndpoint(classification.effective, keys) : null;
    return { typesafeKey, classification, endpoint, customEndpoint, pinned: Boolean(pinned) };
  };

  /** What the client needs to decide whether to offer Auto and what the settings page shows. */
  const describe = async () => {
    const current = generation() === 'oc2';
    const available = current || isRoutingFeatureAvailable();
    if (!available) return { available: false, autoReady: false, tokenPresent: false, config: null, builtins: [] };
    const [config, access] = await Promise.all([store.readConfig(), current ? resolveAccess() : store.readToken()]);
    const tokenPresent = current ? Boolean(access.typesafeKey) : Boolean(access);
    const autoReady = config.enabled && (current ? Boolean(access.endpoint) : tokenPresent)
      && Boolean(config.fallback) && enabledCategories(config).length >= 2;
    // Built-in text travels with the config so "Reset" in Settings restores the shipped wording.
    const result = { available, autoReady, tokenPresent, config, builtins: BUILTIN_CATEGORIES };
    if (current) {
      result.jevAvailable = Boolean(access.endpoint);
      result.jevSource = access.classification.effective === 'typesafe' ? 'typesafe' : 'zen-free';
      result.classifier = legacyClassifier(access.classification);
      result.classification = access.classification;
      result.customEndpoint = access.customEndpoint ? {
        url: access.customEndpoint.url, model: access.customEndpoint.model,
        keyPresent: Boolean(access.customEndpoint.key), pinned: access.pinned,
      } : null;
      result.enterpriseMode = enterpriseMode();
    }
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

  const withKnownVariant = async (selection, directory, identity) => {
    const variant = selection.model.variant;
    if (identity?.generation !== 'oc2' || !variant || !kernelOperations?.getSelectionCatalog) return selection;
    let models;
    try {
      models = (await kernelOperations.getSelectionCatalog({ directory })).data.models;
      assertIdentity(identity);
    } catch (error) {
      console.warn('[routing] model catalog unavailable, keeping the saved variant:', errorMessage(error));
      return selection;
    }
    const { providerID, id } = selection.model;
    const entry = models.find((model) => model.providerID === providerID && model.modelID === id);
    if (!entry || entry.variants?.some((known) => known.id === variant)) return selection;
    return {
      ...selection,
      model: { providerID, id },
      decision: { ...selection.decision, variant: null },
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
        const access = await resolveAccess();
        if (!access.endpoint) throw new Error('No classification provider is selected');
        const { answers, ms } = await jev.ask(buildRoutingRequest({ categories: enabledCategories(config), history, request: (requestText ?? '').trim() }), access.endpoint);
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
    selection = await withKnownVariant(selection, directory, identity);
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
    const oc2 = generation() === 'oc2';
    if (!oc2 && (!state.available || !state.config?.enabled || !state.config.safetyNet.enabled || !state.tokenPresent)) return { action: 'accept' };
    if (oc2 && !state.jevAvailable) return { action: 'hold', unavailable: true };
    let result;
    try {
      const access = oc2 ? await resolveAccess() : null;
      if (oc2 && !access.endpoint) return { action: 'hold', unavailable: true };
      const token = oc2 ? access.endpoint : await store.readToken();
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
      result = { action: oc2 ? 'hold' : 'accept', skipped: errorMessage(error) };
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
    if (generation() === 'oc2' && enterpriseMode()) {
      throw Object.assign(new Error('Classification provider is restricted by enterprise policy'), { status: 403 });
    }
    await store.writeToken(parsed.data);
    if (generation() === 'oc2') await store.writeClassifierSource('typesafe');
    return publishUpdated();
  };

  const clearToken = async () => {
    await store.clearToken();
    return publishUpdated();
  };

  const legacySafetyNetEnabled = async () => {
    try { return (await store.readConfig()).safetyNet.enabled === true ? 'safety' : 'auto'; }
    catch { return 'auto'; }
  };

  const setClassifierSource = async (source) => {
    if (generation() !== 'oc2') throw Object.assign(new Error('Classification sources require OpenCode 2'), { status: 404 });
    if (!CLASSIFIER_SOURCES.includes(source)) throw Object.assign(new Error('Unknown classification provider'), { status: 400 });
    if (enterpriseMode() && source !== 'off' && !(source === 'custom' && readPinnedEndpoint())) {
      throw Object.assign(new Error('Classification provider is restricted by enterprise policy'), { status: 403 });
    }
    await store.writeClassifierSource(source);
    return publishUpdated();
  };

  const setCustomEndpoint = async (input) => {
    if (generation() !== 'oc2') throw Object.assign(new Error('Custom classification requires OpenCode 2'), { status: 404 });
    if (readPinnedEndpoint()) throw Object.assign(new Error('Custom endpoint is set by the administrator'), { status: 409 });
    if (enterpriseMode()) throw Object.assign(new Error('Custom endpoint is restricted by enterprise policy'), { status: 403 });
    const parsed = customEndpointInputSchema.safeParse(input);
    if (!parsed.success) throw Object.assign(new Error('A URL and model are required'), { status: 400 });
    const previous = await store.readCustomEndpoint();
    const endpoint = { url: normalizeCustomEndpointUrl(parsed.data.url), model: parsed.data.model };
    const key = parsed.data.key === undefined || parsed.data.key === '' ? previous?.key : parsed.data.key;
    if (key) endpoint.key = key;
    await store.writeCustomEndpoint(endpoint);
    await store.writeClassifierSource('custom');
    return publishUpdated();
  };

  const clearCustomEndpoint = async () => {
    if (readPinnedEndpoint()) throw Object.assign(new Error('Custom endpoint is set by the administrator'), { status: 409 });
    await store.clearCustomEndpoint();
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
    evaluatePermission, forgetPermission, heldPermissions, updateConfig, setToken, clearToken,
    legacySafetyNetEnabled, setClassifierSource, setCustomEndpoint, clearCustomEndpoint };
}
