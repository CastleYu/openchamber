import express from 'express';
import { createWorktree, getWorktreeBootstrapStatus, resolvePrimaryWorktreeRoot } from '../git/index.js';
import { expandSnippets } from '../opencode/snippets.js';
import { expandCommandGoalObjective, parseScheduledCommandPrompt } from '../scheduled-tasks/runtime.js';
import { buildGoalIntroText, createSessionGoal } from '../session-goal/create.js';
import { OpenChamberControlError, asControlError } from '../openchamber-control/error.js';
import { createArchiveStore } from './archive-store.js';
import { createOpenCodeSessionMetadata, createSessionMetadataStore } from './session-metadata-store.js';
import { defaultV2Selection, validateV2Selection } from './selection-v2.js';
import { createSessionStorageScopes } from './storage-scope.js';
import { applyForkInheritance, forkGoalID } from './fork-inheritance.js';
import { readObjectiveForFork, writeObjective, removeObjectiveForFork } from '../session-goal/objectives.js';
import { isAutoModel } from '../routing/defaults.js';

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const splitModel = (value) => {
  const model = asNonEmptyString(value);
  if (!model) return null;
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex === model.length - 1) return null;
  return {
    providerID: model.slice(0, slashIndex),
    modelID: model.slice(slashIndex + 1),
  };
};

const resolveRequestedModel = (payload) => {
  const model = splitModel(payload?.model);
  if (model) return model;

  const providerID = asNonEmptyString(payload?.providerID);
  const modelID = asNonEmptyString(payload?.modelID);
  return providerID && modelID ? { providerID, modelID } : null;
};

const FALLBACK_PROVIDER_ID = 'opencode';
const FALLBACK_MODEL_ID = 'big-pickle';
const MIN_GOAL_TOKEN_BUDGET = 1_000;
const MAX_GOAL_TOKEN_BUDGET = 100_000_000;

const resolveGoalInput = (payload, prompt) => {
  const enabled = payload?.goal === true;
  if (payload?.goalTokenBudget !== undefined && !enabled) {
    return { ok: false, error: 'goalTokenBudget requires goal' };
  }
  if (enabled && !prompt) {
    return { ok: false, error: 'prompt is required when goal is enabled' };
  }
  if (payload?.goalTokenBudget === undefined) {
    return { ok: true, enabled, tokenBudget: null };
  }
  const tokenBudget = payload.goalTokenBudget;
  if (!Number.isSafeInteger(tokenBudget)
    || tokenBudget < MIN_GOAL_TOKEN_BUDGET
    || tokenBudget > MAX_GOAL_TOKEN_BUDGET) {
    return { ok: false, error: `goalTokenBudget must be an integer from ${MIN_GOAL_TOKEN_BUDGET} to ${MAX_GOAL_TOKEN_BUDGET}` };
  }
  return { ok: true, enabled, tokenBudget };
};

const isPrimaryAgentMode = (mode) => !mode || mode === 'primary' || mode === 'all';

const providerModels = (provider) => {
  if (Array.isArray(provider?.models)) return provider.models;
  if (provider?.models && typeof provider.models === 'object') return Object.values(provider.models);
  return [];
};

const hasProviderModel = (providers, providerID, modelID) => {
  return providers.some((provider) => provider?.id === providerID
    && providerModels(provider).some((model) => model?.id === modelID));
};

const resolveVariant = (providers, providerID, modelID, variant) => {
  const normalized = asNonEmptyString(variant);
  if (!normalized) return undefined;
  const provider = providers.find((entry) => entry?.id === providerID);
  const model = providerModels(provider).find((entry) => entry?.id === modelID);
  if (!model) return normalized;
  return model?.variants && Object.prototype.hasOwnProperty.call(model.variants, normalized)
    ? normalized
    : undefined;
};

const parseConfigModel = (value) => splitModel(value);

const resolveProjectDefaults = (settings, directory, projectId) => {
  const projects = Array.isArray(settings?.projects) ? settings.projects : [];
  const matchedProject = projectId
    ? projects.find((entry) => entry?.id === projectId) || null
    : projects.find((entry) => entry?.path === directory) || null;
  return {
    defaultAgent: asNonEmptyString(matchedProject?.defaultAgent),
    defaultModel: asNonEmptyString(matchedProject?.defaultModel),
    defaultVariant: asNonEmptyString(matchedProject?.defaultVariant),
  };
};

const fetchSelectionInputs = async ({ kernelOperations, directory, readSettingsFromDiskMigrated }) => {
  const settings = await readSettingsFromDiskMigrated();
  const catalog = (await kernelOperations.getSelectionCatalog({ directory })).data;
  if (catalog.generation === 'oc2') return { settings, catalog };
  return { settings, catalog, providers: catalog.providers, agents: catalog.agents,
    opencodeDefaultAgent: asNonEmptyString(catalog.config?.default_agent) || asNonEmptyString(catalog.config?.defaultAgent),
    opencodeDefaultModel: asNonEmptyString(catalog.config?.model) };
};

const resolveDefaultSelection = ({ agents, providers, settings, projectDefaults, opencodeDefaultAgent, opencodeDefaultModel }) => {
  const primaryAgents = agents.filter((agent) => isPrimaryAgentMode(agent?.mode) && agent?.hidden !== true);
  let resolvedAgent = null;
  const projectDefaultAgent = asNonEmptyString(projectDefaults?.defaultAgent);
  const settingsDefaultAgent = asNonEmptyString(settings?.defaultAgent);
  if (projectDefaultAgent) {
    resolvedAgent = agents.find((agent) => agent?.name === projectDefaultAgent) || null;
  }
  if (!resolvedAgent && settingsDefaultAgent) {
    resolvedAgent = agents.find((agent) => agent?.name === settingsDefaultAgent) || null;
  }
  if (!resolvedAgent && opencodeDefaultAgent) {
    const candidate = agents.find((agent) => agent?.name === opencodeDefaultAgent) || null;
    if (candidate && isPrimaryAgentMode(candidate.mode) && candidate.hidden !== true) {
      resolvedAgent = candidate;
    }
  }
  if (!resolvedAgent) {
    resolvedAgent = primaryAgents.find((agent) => agent?.name === 'build') || primaryAgents[0] || agents[0] || null;
  }

  let model = null;
  let variant;
  const projectDefaultModel = parseConfigModel(projectDefaults?.defaultModel);
  const settingsDefaultModel = parseConfigModel(settings?.defaultModel);
  if (projectDefaultModel) {
    model = projectDefaultModel;
    variant = resolveVariant(providers, model.providerID, model.modelID, projectDefaults?.defaultVariant);
  }
  if (!model && settingsDefaultModel) {
    model = settingsDefaultModel;
    variant = resolveVariant(providers, model.providerID, model.modelID, settings?.defaultVariant);
  }

  if (!model && resolvedAgent?.model?.providerID && resolvedAgent?.model?.modelID) {
    model = { providerID: resolvedAgent.model.providerID, modelID: resolvedAgent.model.modelID };
    variant = resolveVariant(providers, model.providerID, model.modelID, resolvedAgent.variant);
  }

  const opencodeModel = parseConfigModel(opencodeDefaultModel);
  if (!model && opencodeModel) {
    model = opencodeModel;
  }

  if (!model && hasProviderModel(providers, FALLBACK_PROVIDER_ID, FALLBACK_MODEL_ID)) {
    model = { providerID: FALLBACK_PROVIDER_ID, modelID: FALLBACK_MODEL_ID };
  }

  if (!model) {
    const provider = providers[0];
    const firstModel = providerModels(provider)[0];
    if (provider?.id && firstModel?.id) {
      model = { providerID: provider.id, modelID: firstModel.id };
    }
  }

  return {
    agent: resolvedAgent?.name,
    model,
    variant,
  };
};

const latestCompletedAssistantMessageID = async ({ kernelOperations, sessionID, directory }) => {
  let response;
  try {
    response = await kernelOperations.listMessages({ sessionID, directory, limit: 100 });
  } catch {
    return null;
  }
  const messages = response.data.items;
  let latest = null;
  for (const message of messages) {
    if (message.role !== 'assistant' || !Number.isFinite(message.completed)) continue;
    if (!latest || (message.created || 0) >= (latest.created || 0)) latest = message;
  }
  return asNonEmptyString(latest?.id);
};

/**
 * Upper bound on one archive batch.
 *
 * The batch is applied one session at a time against OpenCode, so an unbounded
 * list would hold a request open for as long as the list is large. Callers with
 * more sessions than this send several batches and keep their own partial
 * results.
 */
const MAX_ARCHIVE_BATCH = 500;

const parseArchiveRequest = (payload) => {
  const rawIds = payload?.ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return { ok: false, error: 'ids must be a non-empty array of session ids' };
  }
  if (rawIds.length > MAX_ARCHIVE_BATCH) {
    return { ok: false, error: `ids must contain at most ${MAX_ARCHIVE_BATCH} session ids` };
  }

  const ids = [];
  for (const value of rawIds) {
    const id = asNonEmptyString(value);
    if (!id) return { ok: false, error: 'ids must contain non-empty session ids' };
    ids.push(id);
  }

  const archivedAt = payload?.archivedAt;
  if (archivedAt !== undefined && (!Number.isSafeInteger(archivedAt) || archivedAt <= 0)) {
    return { ok: false, error: 'archivedAt must be a positive integer timestamp' };
  }

  return { ok: true, ids, archivedAt: archivedAt ?? Date.now() };
};

const resolveRequestedDirectory = async ({ payload, readSettingsFromDiskMigrated, sanitizeProjects, validateDirectoryPath }) => {
  const projectID = asNonEmptyString(payload?.projectId) || asNonEmptyString(payload?.projectID);
  if (projectID) {
    const settings = await readSettingsFromDiskMigrated();
    const projects = sanitizeProjects(settings?.projects || []);
    const project = projects.find((entry) => entry.id === projectID) || null;
    if (!project?.path) {
      return { ok: false, status: 404, error: 'Project not found' };
    }
    const validated = await validateDirectoryPath(project.path);
    return validated.ok
      ? { ok: true, directory: validated.directory, projectId: projectID }
      : { ok: false, status: 400, error: validated.error || 'Invalid project directory' };
  }

  const directory = asNonEmptyString(payload?.directory);
  const validated = await validateDirectoryPath(directory);
  if (!validated.ok) return { ok: false, status: 400, error: validated.error || 'Invalid directory' };
  const settings = await readSettingsFromDiskMigrated();
  const projects = sanitizeProjects(settings?.projects || []);
  let project = projects.find((entry) => entry.path === validated.directory);
  if (!project && projects.length > 0) {
    const { root } = await resolvePrimaryWorktreeRoot(validated.directory);
    project = projects.find((entry) => entry.path === root);
  }
  return { ok: true, directory: validated.directory, ...(project ? { projectId: project.id } : {}) };
};

const PROMPT_LANDED_TIMEOUT_MS = 5_000;
const PROMPT_LANDED_POLL_MS = 150;

// createWorktree returns while the worktree is still being populated in the
// background (git reset --hard after a --no-checkout add). Dispatching a
// prompt into a half-populated directory makes opencode's run die with
// UnknownError (agent and config files are not there yet), so wait until the
// bootstrap reaches git-ready (population done) or fails before creating the
// session and dispatching.
const WORKTREE_BOOTSTRAP_TIMEOUT_MS = 60_000;
const WORKTREE_BOOTSTRAP_POLL_MS = 150;

const waitForWorktreeBootstrapReady = async ({ directory }) => {
  const deadline = Date.now() + WORKTREE_BOOTSTRAP_TIMEOUT_MS;
  for (;;) {
    const status = await getWorktreeBootstrapStatus(directory);
    if (status?.status === 'failed') {
      throw new OpenChamberControlError(`Worktree bootstrap failed: ${status.error || 'unknown error'}`, 500);
    }
    const phase = status?.phase;
    if (status?.status === 'ready' || phase === 'git-ready' || phase === 'setup-ready') return;
    if (Date.now() >= deadline) {
      throw new OpenChamberControlError('Timed out waiting for the worktree bootstrap', 500);
    }
    await new Promise((resolve) => setTimeout(resolve, WORKTREE_BOOTSTRAP_POLL_MS));
  }
};

const latestUserMessageID = async ({ kernelOperations, sessionID, directory }) => {
  let response;
  try {
    response = await kernelOperations.listMessages({ sessionID, directory, limit: 100 });
  } catch {
    return { ok: false, messageID: null };
  }
  const messages = response.data.items;
  let latest = null;
  for (const message of messages) {
    if (message.role !== 'user') continue;
    if (!latest || (message.created || 0) >= (latest.created || 0)) latest = message;
  }
  return { ok: true, messageID: asNonEmptyString(latest?.id) };
};

// `prompt_async` answers 204 as soon as OpenCode forks the run, and every later
// failure is reported only on the session event stream. Confirm the prompt was
// actually recorded so `promptDispatched` never claims a dispatch that vanished.
const waitForPromptLanded = async ({ kernelOperations, sessionID, directory, baselineUserMessageID }) => {
  const deadline = Date.now() + PROMPT_LANDED_TIMEOUT_MS;
  for (;;) {
    const latest = await latestUserMessageID({ kernelOperations, sessionID, directory });
    // A failed lookup is not authoritative evidence that the prompt was lost.
    if (!latest.ok) return true;
    if (latest.messageID && latest.messageID !== baselineUserMessageID) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, PROMPT_LANDED_POLL_MS));
  }
};

const resolveWorktreeInput = (payload) => {
  if (!payload?.worktree || typeof payload.worktree !== 'object') return null;
  const name = asNonEmptyString(payload.worktree.name);
  if (!name) return null;
  const branchName = asNonEmptyString(payload.worktree.branchName);
  const startRef = asNonEmptyString(payload.worktree.startRef);
  return {
    mode: 'new',
    name,
    ...(branchName ? { branchName } : {}),
    ...(startRef ? { startRef } : {}),
    ...(typeof payload.setUpstream === 'boolean' ? { setUpstream: payload.setUpstream } : {}),
  };
};

export const createOpenChamberSessionService = (dependencies) => {
  const {
    kernelOperations,
    dataDir,
    getStorageScope,
    broadcastGlobalUiEvent,
    readSettingsFromDiskMigrated,
    sanitizeProjects,
    validateDirectoryPath,
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    waitForOpenCodeReady,
    emitSessionCreatedEvent,
    createSessionGoal: createSessionGoalOverride,
    sessionKnowledgeRuntime = null,
    // Auto routing. Prompts dispatched here go straight to OpenCode, not
    // through the proxy that rewrites the Auto sentinel, so the same hook runs
    // on the body before it is sent. Null when routing is not wired in.
    resolvePromptBody = null,
  } = dependencies;

  if (!kernelOperations) throw new Error('kernelOperations is required for session routes');
  const current = (identity) => {
    const now = kernelOperations.captureIdentity();
    if (now.generation !== identity.generation || now.endpoint !== identity.endpoint || now.epoch !== identity.epoch) {
      throw new OpenChamberControlError('OpenCode runtime changed during session operation', 409);
    }
  };
  const oc2 = () => {
    const identity = kernelOperations.captureIdentity();
    if (identity.generation !== 'oc2') throw new OpenChamberControlError('This route requires OpenCode 2.x', 404);
    return identity;
  };
  const scopes = dataDir ? createSessionStorageScopes({ dataDir }) : null;
  const stores = new Map();
  const storageScope = (identity) => {
    current(identity);
    const scope = getStorageScope ? getStorageScope() : 'managed';
    if (!asNonEmptyString(scope)) throw new Error('OC2 storage scope is unavailable');
    return scope;
  };
  const storesFor = async (identity) => {
    const scope = storageScope(identity);
    if (dependencies.archiveStore || dependencies.sessionMetadataStore) {
      return { archiveStore: dependencies.archiveStore, sessionMetadataStore: dependencies.sessionMetadataStore };
    }
    if (!scopes) throw new Error('OC2 session storage is unavailable');
    let entry = stores.get(scope);
    if (!entry) {
      const dir = await scopes.directory(scope);
      current(identity);
      // Another first request may have installed the shared transaction owner
      // while scope resolution was pending. Never create a second writer.
      entry = stores.get(scope);
      if (!entry) {
        entry = {
          archiveStore: createArchiveStore({ dataDir: dir }),
          sessionMetadataStore: createSessionMetadataStore({ dataDir: dir,
            openCode: createOpenCodeSessionMetadata({ kernelOperations }) }),
        };
        stores.set(scope, entry);
      }
    }
    current(identity);
    return entry;
  };
  const broadcastArchived = (sessionID, archivedAt) => broadcastGlobalUiEvent?.({
    type: 'openchamber:session-archived', properties: { sessionID, archivedAt },
  });
  const getArchivedSessions = async () => {
    const identity = kernelOperations.captureIdentity();
    if (identity.generation !== 'oc2') return null;
    const { archiveStore } = await storesFor(identity);
    const result = await archiveStore.getAll();
    current(identity);
    return result;
  };
  const getStoredSessionMetadata = async () => {
    const identity = kernelOperations.captureIdentity();
    if (identity.generation !== 'oc2') return null;
    const { sessionMetadataStore } = await storesFor(identity);
    const result = await sessionMetadataStore.listUnmigrated();
    current(identity);
    return result;
  };
  const prepareSessionMetadata = async ({ sessionID, directory = '', identity }) => {
    if (identity.generation !== 'oc2') return;
    current(identity);
    const { sessionMetadataStore } = await storesFor(identity);
    await sessionMetadataStore.ensureMigrated(sessionID, { directory, expectedIdentity: identity });
    current(identity);
  };
  const migrateStoredSessionMetadata = async () => {
    const identity = oc2();
    const { sessionMetadataStore } = await storesFor(identity);
    const pending = await sessionMetadataStore.migrateLegacy();
    current(identity);
    return pending;
  };

  // Last user message of an existing session, as a selection to reuse. Returns
  // null when the session has no user message carrying a model.
  const fetchLastUserSelection = async ({ sessionID, directory }) => {
    try {
      if (kernelOperations.captureIdentity().generation === 'oc2') {
        const session = (await kernelOperations.getSession({ sessionID, directory })).data;
        const providerID = asNonEmptyString(session.raw?.model?.providerID);
        const modelID = asNonEmptyString(session.raw?.model?.id);
        return { model: providerID && modelID ? { providerID, modelID } : null,
          agent: asNonEmptyString(session.raw?.agent), variant: asNonEmptyString(session.raw?.model?.variant) };
      }
      const response = await kernelOperations.listMessages({ sessionID, directory, limit: 20 });
      const records = response.data.items;
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const info = records[index]?.raw?.info;
        if (info?.role !== 'user') continue;
        const providerID = asNonEmptyString(info.model?.providerID);
        const modelID = asNonEmptyString(info.model?.modelID);
        if (!providerID || !modelID) continue;
        return {
          model: { providerID, modelID },
          agent: asNonEmptyString(info.agent),
          variant: asNonEmptyString(info.model?.variant),
        };
      }
    } catch {
    }
    return null;
  };

  // Explicit model/agent/variant are never checked by `prompt_async`: an unknown
  // agent makes the forked run fail silently, leaving a session with no message.
  // Reject them before any session, worktree, or goal side effect happens.
  const validateRequestedSelection = async ({ directory, requestedModel, requestedAgent, requestedVariant }) => {
    if (!requestedModel && !requestedAgent && !requestedVariant) return;
    const inputs = await fetchSelectionInputs({
      kernelOperations,
      directory,
      readSettingsFromDiskMigrated,
    });
    if (inputs.catalog.generation === 'oc2') {
      validateV2Selection({ catalog: inputs.catalog, model: requestedModel, agent: requestedAgent,
        variant: requestedVariant, directory });
      return;
    }
    const { providers, agents } = inputs;

    // An empty list means the lookup failed or returned nothing authoritative;
    // it must not turn a valid selection into a rejection.
    if (requestedAgent && agents.length > 0) {
      const agent = agents.find((entry) => entry?.name === requestedAgent) || null;
      if (!agent) {
        throw new OpenChamberControlError(`Unknown agent '${requestedAgent}' for ${directory}`, 400);
      }
      if (!isPrimaryAgentMode(agent.mode)) {
        throw new OpenChamberControlError(`Agent '${requestedAgent}' is a subagent and cannot receive a prompt directly`, 400);
      }
    }

    if (requestedModel && providers.length > 0) {
      if (!hasProviderModel(providers, requestedModel.providerID, requestedModel.modelID)) {
        throw new OpenChamberControlError(
          `Unknown model '${requestedModel.providerID}/${requestedModel.modelID}' for ${directory}`,
          400,
        );
      }
      if (requestedVariant
        && !resolveVariant(providers, requestedModel.providerID, requestedModel.modelID, requestedVariant)) {
        throw new OpenChamberControlError(
          `Unknown variant '${requestedVariant}' for model '${requestedModel.providerID}/${requestedModel.modelID}'`,
          400,
        );
      }
    }
  };

  const dispatchPrompt = async ({
    baseUrl,
    authHeaders,
    identity,
    sessionID,
    directory,
    projectId,
    prompt,
    goalInput,
    requestedModel,
    requestedAgent,
    requestedVariant,
    reuseSessionSelection = false,
  }) => {
    let model = requestedModel;
    let agent = requestedAgent;
    let variant = requestedVariant;
    if (reuseSessionSelection && (!model || !agent)) {
      const previous = await fetchLastUserSelection({ sessionID, directory });
      if (previous) {
        if (!model && previous.model) {
          model = previous.model;
          if (variant == null) variant = previous.variant ?? undefined;
        }
        if (!agent && previous.agent) agent = previous.agent;
      }
    }
    if (!model || !agent) {
      const inputs = await fetchSelectionInputs({
        kernelOperations,
        directory,
        readSettingsFromDiskMigrated,
      });
      const projectDefaults = resolveProjectDefaults(inputs.settings, directory, projectId);
      const defaults = inputs.catalog.generation === 'oc2'
        ? defaultV2Selection({ catalog: inputs.catalog, settings: inputs.settings, projectDefaults })
        : resolveDefaultSelection({ ...inputs, projectDefaults });
      if (!model) {
        model = defaults.model;
        if (variant == null) variant = defaults.variant;
      }
      agent = agent || defaults.agent;
    }
    if (!model) {
      const error = new Error('No model is configured or available for the requested directory');
      error.statusCode = 400;
      throw error;
    }

    const expandedPrompt = expandSnippets(prompt, directory);
    if (identity.generation === 'oc2' && isAutoModel(model)) {
      if (!resolvePromptBody) throw new OpenChamberControlError('Auto routing is unavailable on this server', 400);
      const routed = { model, agent, variant, parts: [{ type: 'text', text: expandedPrompt }] };
      await resolvePromptBody(routed, { sessionId: sessionID, directory });
      model = routed.model;
      agent = routed.agent || agent;
      variant = routed.variant;
      if (isAutoModel(model)) throw new OpenChamberControlError('Auto routing returned no concrete model', 500);
    }
    const parsedCommand = parseScheduledCommandPrompt(prompt);
    let resolvedCommand = null;
    if (parsedCommand) {
      try {
        const response = await kernelOperations.listCommands({ directory });
        const commands = response.data;
        const command = commands.find((candidate) => candidate?.name === parsedCommand.command);
        if (command) resolvedCommand = { ...parsedCommand, template: command.template };
      } catch {
      }
    }
    if (goalInput.enabled) {
      const commandObjective = identity.generation === 'oc1' && resolvedCommand
        ? expandCommandGoalObjective(resolvedCommand.template, resolvedCommand.arguments)
        : null;
      await (createSessionGoalOverride || createSessionGoal)({
        baseUrl,
        authHeaders,
        sessionID,
        directory,
        objective: commandObjective ?? expandedPrompt,
        tokenBudget: goalInput.tokenBudget,
        providerID: model.providerID,
        modelID: model.modelID,
        onWarning: (message, error) => console.warn(`[OpenChamberSessions] ${message}:`, error?.message || error),
        kernelOperations,
        expectedIdentity: identity,
      });
    }

    const markGoalPartial = (error) => {
      if (goalInput.enabled && error && typeof error === 'object') error.goalConfigured = true;
      return error;
    };

    const knowledge = sessionKnowledgeRuntime
      ? await sessionKnowledgeRuntime.resolvePendingForSession(sessionID, directory)
        .catch(() => ({ text: '', signature: '' }))
      : { text: '', signature: '' };
    const recordKnowledge = async () => {
      if (knowledge.text && sessionKnowledgeRuntime) {
        await sessionKnowledgeRuntime.recordDelivered(sessionID, directory, knowledge.signature)
          .catch(() => undefined);
      }
    };

    if (resolvedCommand) {
      try {
        current(identity);
        await kernelOperations.sendCommand({ sessionID, directory, request: identity.generation === 'oc1'
          ? { ...identity, body: { command: resolvedCommand.command, arguments: resolvedCommand.arguments,
            ...(agent ? { agent } : {}), model: `${model.providerID}/${model.modelID}`,
            ...(variant ? { variant } : {}) } }
          : { ...identity, body: { name: resolvedCommand.command, text: resolvedCommand.arguments || '' },
            model: { id: model.modelID, providerID: model.providerID, ...(variant ? { variant } : {}) },
            agent, synthetics: knowledge.text ? [{ text: knowledge.text, resume: false }] : [] } });
      } catch (error) {
        throw markGoalPartial(error);
      }
      if (identity.generation === 'oc2') await recordKnowledge();
    } else {
      const baseline = identity.generation === 'oc1'
        ? await latestUserMessageID({ kernelOperations, sessionID, directory }) : { messageID: null };
      // A session the agent dispatched has no UI to attach the project's
      // standing context, so it is asked for here. Never fails the dispatch:
      // a session that runs without its background beats one that never runs.
      const payload = {
        model,
        ...(agent ? { agent } : {}),
        ...(variant ? { variant } : {}),
        parts: [
          ...(knowledge.text ? [{ type: 'text', text: knowledge.text, synthetic: true }] : []),
          { type: 'text', text: expandedPrompt },
          ...(goalInput.enabled
            ? [{ type: 'text', text: buildGoalIntroText(goalInput.tokenBudget), synthetic: true }]
            : []),
        ],
      };
      if (identity.generation === 'oc1') await resolvePromptBody?.(payload, { sessionId: sessionID, directory });
      try {
        current(identity);
        const sent = await kernelOperations.sendPrompt({ sessionID, directory, request: identity.generation === 'oc1'
          ? { ...identity, body: payload }
          : { ...identity, body: { text: expandedPrompt },
            model: { id: model.modelID, providerID: model.providerID, ...(variant ? { variant } : {}) },
            agent,
            synthetics: knowledge.text ? [{ text: knowledge.text, resume: false }] : [],
            postSynthetics: goalInput.enabled
              ? [{ text: buildGoalIntroText(goalInput.tokenBudget), resume: false }] : [] } });
        if (identity.generation === 'oc2' && !asNonEmptyString(sent.data?.id)) {
          return { model, agent, variant, promptDispatched: false, dispatchedAsCommand: false,
            promptError: 'OpenCode accepted the prompt but returned no queued message' };
        }
      } catch (error) {
        throw markGoalPartial(error);
      }
      // After the prompt is accepted, so a rejected dispatch carries it again.
      await recordKnowledge();
      const landed = identity.generation === 'oc2' || await waitForPromptLanded({
        kernelOperations,
        sessionID,
        directory,
        baselineUserMessageID: baseline.messageID,
      });
      if (!landed) {
        return {
          model,
          agent,
          variant,
          promptDispatched: false,
          dispatchedAsCommand: false,
          promptError: 'OpenCode accepted the prompt but it never appeared in the session',
        };
      }
    }

    return { model, agent, variant, promptDispatched: true, dispatchedAsCommand: Boolean(resolvedCommand) };
  };

  /**
   * Archive a batch of sessions in one request.
   *
   * The UI archives every session linked to a worktree before removing it.
   * Doing that from the browser costs one request per session plus a store
   * reconciliation between each of them, which is what made deleting a
   * worktree with many sessions take tens of seconds. Here the batch stays on
   * the server, next to OpenCode, and the client reconciles once.
   *
   * Sessions are updated one at a time on purpose: they are archived against a
   * single OpenCode instance, and a fan-out of concurrent writes would trade a
   * UI stall for server event-loop starvation. One failed session never stops
   * the batch — it is reported in `failedIds` while the rest still archive, so
   * callers keep the partial-failure behaviour they already show.
   */
  const archive = async (payload = {}) => {
    const parsed = parseArchiveRequest(payload);
    if (!parsed.ok) {
      throw new OpenChamberControlError(parsed.error, 400);
    }

    const identity = kernelOperations.captureIdentity();
    if (identity.generation === 'oc2') {
      const { archiveStore } = await storesFor(identity);
      current(identity);
      const { archived, failedIds } = await archiveStore.archive(parsed.ids, parsed.archivedAt, () => current(identity));
      for (const entry of archived) broadcastArchived(entry.id, entry.archivedAt);
      return { archived, failedIds };
    }

    const resolvedDirectory = await resolveRequestedDirectory({
      payload,
      readSettingsFromDiskMigrated,
      sanitizeProjects,
      validateDirectoryPath,
    });
    if (!resolvedDirectory.ok) {
      throw new OpenChamberControlError(resolvedDirectory.error, resolvedDirectory.status || 400);
    }

    if (typeof waitForOpenCodeReady === 'function') await waitForOpenCodeReady(10_000, 250);

    const directory = resolvedDirectory.directory;
    const archived = [];
    const failedIds = [];
    for (const sessionID of parsed.ids) {
      try {
        current(identity);
        const response = await kernelOperations.updateSession({ sessionID, directory,
          time: { archived: parsed.archivedAt }, expectedIdentity: identity });
        const session = response.data;
        if (session?.id) archived.push(session);
        else failedIds.push(sessionID);
      } catch (error) {
        if (error?.code === 'runtime-changed' || error?.statusCode === 409) throw error;
        console.warn('[OpenChamberSessions] failed to archive session', sessionID, error);
        failedIds.push(sessionID);
      }
    }

    return { directory, archived, failedIds };
  };

  const unarchive = async (payload = {}) => {
    const identity = oc2();
    const parsed = parseArchiveRequest(payload);
    if (!parsed.ok) throw new OpenChamberControlError(parsed.error, 400);
    const { archiveStore } = await storesFor(identity);
    current(identity);
    const { restored, failedIds } = await archiveStore.unarchive(parsed.ids, () => current(identity));
    for (const entry of restored) broadcastArchived(entry.id, null);
    return { restored, failedIds };
  };

  const setMetadata = async (sessionID, payload = {}) => {
    const identity = oc2();
    const id = asNonEmptyString(sessionID);
    if (!id) throw new OpenChamberControlError('a session id is required', 400);
    const patch = payload.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new OpenChamberControlError('patch must be an object', 400);
    }
    const { sessionMetadataStore } = await storesFor(identity);
    current(identity);
    const metadata = await sessionMetadataStore.setSessionMetadata(id, patch,
      { directory: asNonEmptyString(payload.directory) || '' });
    current(identity);
    broadcastGlobalUiEvent?.({ type: 'openchamber:session-metadata', properties: { sessionID: id, metadata } });
    return { metadata };
  };

  const getMetadata = async (sessionID, directory = '') => {
    const identity = oc2();
    const id = asNonEmptyString(sessionID);
    if (!id) throw new OpenChamberControlError('a session id is required', 400);
    const { sessionMetadataStore } = await storesFor(identity);
    const metadata = await sessionMetadataStore.get(id, { directory });
    current(identity);
    return { metadata };
  };

  const create = async (payload = {}) => {
    const identity = kernelOperations.captureIdentity();
    const title = asNonEmptyString(payload.title);
    const prompt = asNonEmptyString(payload.prompt);
    const goalInput = resolveGoalInput(payload, prompt);
    if (!goalInput.ok) {
      throw new OpenChamberControlError(goalInput.error, 400);
    }
    const model = resolveRequestedModel(payload);
    const agent = asNonEmptyString(payload.agent);
    const variant = asNonEmptyString(payload.variant);

    const resolvedDirectory = await resolveRequestedDirectory({
      payload,
      readSettingsFromDiskMigrated,
      sanitizeProjects,
      validateDirectoryPath,
    });
    if (!resolvedDirectory.ok) {
      throw new OpenChamberControlError(resolvedDirectory.error, resolvedDirectory.status || 400);
    }

    const worktreeInput = resolveWorktreeInput(payload);
    let worktree = null;
    let sessionDirectory = resolvedDirectory.directory;
    if (payload?.worktree && !worktreeInput) {
      throw new OpenChamberControlError('worktree.name is required when worktree is provided', 400);
    }

    if (typeof waitForOpenCodeReady === 'function') await waitForOpenCodeReady(10_000, 250);

    if (prompt) {
      await validateRequestedSelection({
        directory: resolvedDirectory.directory,
        requestedModel: model,
        requestedAgent: agent,
        requestedVariant: variant,
      });
    }

    if (worktreeInput) {
      worktree = await createWorktree(resolvedDirectory.directory, worktreeInput);
      sessionDirectory = worktree.path;
      await waitForWorktreeBootstrapReady({ directory: sessionDirectory });
    }

    current(identity);
    const baseUrl = buildOpenCodeUrl('/', '').replace(/\/$/, '');
    const authHeaders = getOpenCodeAuthHeaders();
    const sessionID = (await kernelOperations.createSession({ directory: sessionDirectory,
      ...(title ? { title } : {}), expectedIdentity: identity })).data.id;

    let dispatch = { model, agent, variant, promptDispatched: false, dispatchedAsCommand: false };
    if (prompt) {
      dispatch = await dispatchPrompt({
        baseUrl,
        authHeaders,
        identity,
        sessionID,
        directory: sessionDirectory,
        projectId: resolvedDirectory.projectId,
        prompt,
        goalInput,
        requestedModel: model,
        requestedAgent: agent,
        requestedVariant: variant,
      });
    }

    const result = {
      sessionId: sessionID,
      directory: sessionDirectory,
      ...(resolvedDirectory.projectId ? { projectId: resolvedDirectory.projectId } : {}),
      ...(title ? { title } : {}),
      ...(worktree ? { worktree } : {}),
      ...(prompt && dispatch.model ? { model: dispatch.model } : {}),
      ...(prompt && dispatch.agent ? { agent: dispatch.agent } : {}),
      ...(prompt && dispatch.variant ? { variant: dispatch.variant } : {}),
      promptDispatched: dispatch.promptDispatched,
      ...(dispatch.promptError ? { promptError: dispatch.promptError } : {}),
      dispatchedAsCommand: dispatch.dispatchedAsCommand,
      ...(goalInput.enabled ? { goalEnabled: true } : {}),
      ...(goalInput.tokenBudget ? { goalTokenBudget: goalInput.tokenBudget } : {}),
    };

    try {
      emitSessionCreatedEvent?.({
        sessionID,
        directory: sessionDirectory,
        ...(resolvedDirectory.projectId ? { projectID: resolvedDirectory.projectId } : {}),
        ...(title ? { title } : {}),
        ...(worktree ? { worktree } : {}),
        ...(prompt && dispatch.model ? { model: dispatch.model } : {}),
        ...(prompt && dispatch.agent ? { agent: dispatch.agent } : {}),
        ...(prompt && dispatch.variant ? { variant: dispatch.variant } : {}),
        promptDispatched: dispatch.promptDispatched,
        dispatchedAsCommand: dispatch.dispatchedAsCommand,
        ...(goalInput.enabled ? { goalEnabled: true } : {}),
        ...(goalInput.tokenBudget ? { goalTokenBudget: goalInput.tokenBudget } : {}),
        createdAt: Date.now(),
      });
    } catch {
    }

    return result;
  };

  const runExisting = async (action, sourceSessionId, payload = {}) => {
    const identity = kernelOperations.captureIdentity();
    const sourceSessionID = asNonEmptyString(sourceSessionId);
    const prompt = asNonEmptyString(payload.prompt);
    if (!sourceSessionID) throw new OpenChamberControlError('sessionId is required', 400);
    if (!prompt) throw new OpenChamberControlError('prompt is required', 400);
    const goalInput = resolveGoalInput(payload, prompt);
    if (!goalInput.ok) throw new OpenChamberControlError(goalInput.error, 400);
    const requestedModel = resolveRequestedModel(payload);

    let targetSessionID = sourceSessionID;
    let targetSession = null;
    let directory = null;
    try {
      const resolvedDirectory = await resolveRequestedDirectory({
        payload,
        readSettingsFromDiskMigrated,
        sanitizeProjects,
        validateDirectoryPath,
      });
      if (!resolvedDirectory.ok) {
        throw new OpenChamberControlError(resolvedDirectory.error, resolvedDirectory.status || 400);
      }
      directory = resolvedDirectory.directory;
      if (typeof waitForOpenCodeReady === 'function') await waitForOpenCodeReady(10_000, 250);

      await validateRequestedSelection({
        directory,
        requestedModel,
        requestedAgent: asNonEmptyString(payload.agent),
        requestedVariant: asNonEmptyString(payload.variant),
      });

      const baseUrl = buildOpenCodeUrl('/', '').replace(/\/$/, '');
      const authHeaders = getOpenCodeAuthHeaders();
      if (action === 'fork') {
        current(identity);
        targetSession = (await kernelOperations.forkSession({ sessionID: sourceSessionID, directory,
          messageID: asNonEmptyString(payload.messageId) || undefined, expectedIdentity: identity })).data;
        targetSessionID = targetSession.id;
        if (identity.generation === 'oc2') {
          try {
            await applyForkInheritance({
              sourceSessionID, fork: targetSession,
              readObjective: readObjectiveForFork,
              readGoalID: async (sessionID) => {
                const session = (await kernelOperations.getSession({ sessionID, directory })).data;
                current(identity);
                return forkGoalID(session.metadata);
              },
              writeObjective, removeObjective: removeObjectiveForFork,
              writeMetadata: (sessionID, metadata) => kernelOperations.updateSession({
                sessionID, directory, metadata, expectedIdentity: identity,
              }),
              assertCurrent: () => current(identity),
            });
            current(identity);
          } catch (error) {
            // Only the new fork is eligible for rollback, and only on its
            // captured kernel. A failed/ambiguous delete stays partial.
            current(identity);
            try {
              const removed = await kernelOperations.removeSession({
                sessionID: targetSessionID, directory, expectedIdentity: identity,
              });
              current(identity);
              if (removed.data !== true) throw new Error('Fork rollback was not acknowledged');
            } catch (rollbackError) {
              throw new AggregateError([error, rollbackError], 'Fork inheritance failed and the new fork could not be removed');
            }
            targetSessionID = sourceSessionID;
            targetSession = null;
            throw error;
          }
        }
      }

      const baselineAssistantMessageId = await latestCompletedAssistantMessageID({
        kernelOperations,
        sessionID: targetSessionID,
        directory,
      });

      const dispatch = await dispatchPrompt({
        baseUrl,
        authHeaders,
        identity,
        sessionID: targetSessionID,
        directory,
        projectId: resolvedDirectory.projectId,
        prompt,
        goalInput,
        requestedModel,
        requestedAgent: asNonEmptyString(payload.agent),
        requestedVariant: asNonEmptyString(payload.variant),
        reuseSessionSelection: true,
      });
      const result = {
        action,
        sessionId: targetSessionID,
        directory,
        ...(action === 'fork' ? { sourceSessionId: sourceSessionID } : {}),
        ...(targetSession?.title ? { title: targetSession.title } : {}),
        ...(baselineAssistantMessageId ? { baselineAssistantMessageId } : {}),
        model: dispatch.model,
        ...(dispatch.agent ? { agent: dispatch.agent } : {}),
        ...(dispatch.variant ? { variant: dispatch.variant } : {}),
        promptDispatched: dispatch.promptDispatched,
        ...(dispatch.promptError ? { promptError: dispatch.promptError } : {}),
        dispatchedAsCommand: dispatch.dispatchedAsCommand,
        ...(goalInput.enabled ? { goalEnabled: true } : {}),
        ...(goalInput.tokenBudget ? { goalTokenBudget: goalInput.tokenBudget } : {}),
      };

      if (action === 'fork') {
        try {
          emitSessionCreatedEvent?.({
            sessionID: targetSessionID,
            directory,
            sourceSessionID,
            ...(targetSession?.title ? { title: targetSession.title } : {}),
            model: dispatch.model,
            ...(dispatch.agent ? { agent: dispatch.agent } : {}),
            ...(dispatch.variant ? { variant: dispatch.variant } : {}),
            promptDispatched: dispatch.promptDispatched,
            dispatchedAsCommand: dispatch.dispatchedAsCommand,
            ...(goalInput.enabled ? { goalEnabled: true } : {}),
            ...(goalInput.tokenBudget ? { goalTokenBudget: goalInput.tokenBudget } : {}),
            createdAt: Date.now(),
          });
        } catch {
        }
      }
      return result;
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      const forkCreated = action === 'fork' && targetSessionID !== sourceSessionID;
      const goalConfigured = error?.goalConfigured === true;
      throw new OpenChamberControlError(
        error instanceof Error ? error.message : `Failed to ${action} session`,
        statusCode,
        {
        ...(forkCreated || goalConfigured
          ? {
            partial: true,
            partialAction: forkCreated ? 'fork-created' : 'goal-configured',
            sessionId: targetSessionID,
            directory,
          }
          : {}),
        },
      );
    }
  };

  return {
    create,
    archive,
    unarchive,
    getMetadata,
    setMetadata,
    getArchivedSessions,
    getStoredSessionMetadata,
    prepareSessionMetadata,
    migrateStoredSessionMetadata,
    send: (sessionID, payload) => runExisting('send', sessionID, payload),
    fork: (sessionID, payload) => runExisting('fork', sessionID, payload),
  };
};

const sendServiceError = (res, error, fallback) => {
  const controlError = asControlError(error, fallback);
  return res.status(controlError.statusCode).json({
    error: controlError.message,
    ...(controlError.partial === true ? {
      partial: true,
      partialAction: controlError.partialAction,
      sessionId: controlError.sessionId,
      directory: controlError.directory,
    } : {}),
  });
};

export const registerOpenChamberSessionRoutes = (app, dependencies) => {
  const service = dependencies.sessionService || createOpenChamberSessionService(dependencies);

  app.post('/api/openchamber/sessions', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      return res.json(await service.create(req.body && typeof req.body === 'object' ? req.body : {}));
    } catch (error) {
      console.error('[OpenChamberSessions] failed to create session:', error);
      return sendServiceError(res, error, 'Failed to create session');
    }
  });

  app.post('/api/openchamber/sessions/archive', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      return res.json(await service.archive(req.body && typeof req.body === 'object' ? req.body : {}));
    } catch (error) {
      console.error('[OpenChamberSessions] failed to archive sessions:', error);
      return sendServiceError(res, error, 'Failed to archive sessions');
    }
  });

  app.post('/api/openchamber/sessions/unarchive', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      return res.json(await service.unarchive(req.body && typeof req.body === 'object' ? req.body : {}));
    } catch (error) {
      console.error('[OpenChamberSessions] failed to unarchive sessions:', error);
      return sendServiceError(res, error, 'Failed to unarchive sessions');
    }
  });

  app.get('/api/openchamber/sessions/:sessionId/metadata', async (req, res) => {
    try {
      return res.json(await service.getMetadata(req.params.sessionId, asNonEmptyString(req.query?.directory) || ''));
    } catch (error) {
      console.error('[OpenChamberSessions] failed to read session metadata:', error);
      return sendServiceError(res, error, 'Failed to read session metadata');
    }
  });

  app.post('/api/openchamber/sessions/:sessionId/metadata', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      return res.json(await service.setMetadata(req.params.sessionId,
        req.body && typeof req.body === 'object' ? req.body : {}));
    } catch (error) {
      console.error('[OpenChamberSessions] failed to store session metadata:', error);
      return sendServiceError(res, error, 'Failed to store session metadata');
    }
  });

  app.post(
    '/api/openchamber/sessions/:sessionId/send',
    express.json({ limit: '1mb' }),
    async (req, res) => {
      try {
        return res.json(await service.send(req.params.sessionId, req.body));
      } catch (error) {
        console.error('[OpenChamberSessions] failed to send session:', error);
        return sendServiceError(res, error, 'Failed to send session');
      }
    },
  );
  app.post(
    '/api/openchamber/sessions/:sessionId/fork',
    express.json({ limit: '1mb' }),
    async (req, res) => {
      try {
        return res.json(await service.fork(req.params.sessionId, req.body));
      } catch (error) {
        console.error('[OpenChamberSessions] failed to fork session:', error);
        return sendServiceError(res, error, 'Failed to fork session');
      }
    },
  );
};
