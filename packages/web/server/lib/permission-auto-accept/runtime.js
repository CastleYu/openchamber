import { z } from 'zod';
import { waitForKernelReady } from '../event-stream/global-hub.js';
import { isAutoAnsweringMode, isPermissionMode, toPermissionMode } from './modes.js';
import { createPermissionModesStore } from './modes-store.js';

const SETTINGS_KEY = 'permissionAutoAccept';
const MODES_KEY = 'permissionAutoAcceptModes';
const DEFAULT_MODE_KEY = 'permissionDefaultMode';
const RETRY_DELAYS_MS = [0, 250, 1000];
const REQUEST_TIMEOUT_MS = 5000;
const SESSION_CACHE_LIMIT = 10000;
const OUTCOME_CACHE_LIMIT = 1000;

const normalizePolicy = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sessions = {};
  const entries = source.sessions && typeof source.sessions === 'object' && !Array.isArray(source.sessions)
    ? Object.entries(source.sessions)
    : [];
  for (const [sessionId, enabled] of entries) {
    if (sessionId && typeof enabled === 'boolean') sessions[sessionId] = enabled;
  }
  const revision = Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0;
  return { sessions, revision };
};

const emptyModes = () => ({ sessions: {}, revision: 0 });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPermissionAutoAcceptRuntime({
  dataDir,
  modeStore = dataDir ? createPermissionModesStore({ dataDir }) : null,
  globalEventHub,
  getKernelRuntime = null,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  readSettingsFromDiskMigrated,
  persistSettings,
  broadcastGlobalUiEvent,
  // The routing safety net: asked once per request before the automatic reply.
  // `hold` leaves the request for the user; absent means every request is replied to.
  evaluatePermission = null,
  onPermissionReplied = null,
  resolveLegacyEnabledMode = async () => 'auto',
  kernelOperations = null,
  fetchImpl = fetch,
  retryDelaysMs = RETRY_DELAYS_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
}) {
  let policy = normalizePolicy();
  let modes = emptyModes();
  let legacyMode = 'auto';
  let legacyModeKey = '';
  let modeLoaded = false;
  let loaded = false;
  let loadPromise = null;
  let writePromise = Promise.resolve();
  const sessions = new Map();
  const inFlight = new Map();
  const reconcilePromises = new Map();
  const outcomes = new Map();
  let identityKey = '';
  const identity = () => {
    if (!kernelOperations) return null;
    const current = kernelOperations.captureIdentity();
    const key = `${current.generation}\0${current.endpoint}\0${current.epoch}`;
    if (key !== identityKey) {
      identityKey = key;
      sessions.clear();
      inFlight.clear();
      reconcilePromises.clear();
      outcomes.clear();
    }
    return current;
  };
  const assertIdentity = (expected) => {
    if (!expected) return;
    const current = kernelOperations.captureIdentity();
    if (current.generation !== expected.generation || current.endpoint !== expected.endpoint || current.epoch !== expected.epoch) {
      throw new Error('OpenCode runtime changed during permission auto-accept');
    }
  };

  const snapshot = () => {
    if (identity()?.generation !== 'oc2') return { sessions: { ...policy.sessions }, revision: policy.revision };
    const sessions = { ...policy.sessions };
    for (const [id, mode] of Object.entries(modes.sessions)) sessions[id] = isAutoAnsweringMode(mode);
    const projectedModes = {};
    for (const [id, enabled] of Object.entries(policy.sessions)) projectedModes[id] = enabled ? legacyMode : 'ask';
    return { sessions, modes: { ...projectedModes, ...modes.sessions }, revision: modes.revision };
  };

  const load = async () => {
    if (loaded) {
      const current = identity();
      if (current?.generation === 'oc2' && !modeLoaded) {
        modes = modeStore ? await modeStore.read() : emptyModes();
        modeLoaded = true;
      }
      const key = current ? `${current.generation}\0${current.endpoint}\0${current.epoch}` : '';
      if (current?.generation === 'oc2' && key !== legacyModeKey && Object.values(policy.sessions).includes(true)) {
        legacyMode = await resolveLegacyEnabledMode();
        legacyModeKey = key;
      }
      return snapshot();
    }
    if (!loadPromise) {
      loadPromise = readSettingsFromDiskMigrated()
        .then(async (settings) => {
          policy = normalizePolicy(settings?.[SETTINGS_KEY]);
          if (identity()?.generation === 'oc2') {
            modes = modeStore ? await modeStore.read() : emptyModes();
            modeLoaded = true;
          }
          if (identity()?.generation === 'oc2' && Object.values(policy.sessions).includes(true)) {
            legacyMode = await resolveLegacyEnabledMode();
            legacyModeKey = identityKey;
          }
          loaded = true;
          return snapshot();
        })
        .finally(() => { loadPromise = null; });
    }
    return loadPromise;
  };

  const persistUpdate = (key, update) => {
    writePromise = writePromise.catch(() => undefined).then(async () => {
      const current = key === MODES_KEY ? modes : policy;
      const next = update(current);
      if (key === MODES_KEY) {
        if (!modeStore) throw new Error('OC2 permission mode storage is unavailable');
        await modeStore.write(next);
      } else {
        await persistSettings({ [key]: next });
      }
      if (key === MODES_KEY) modes = next;
      else policy = next;
      loaded = true;
      broadcastGlobalUiEvent?.({
        type: 'openchamber:permission-auto-accept.updated',
        properties: snapshot(),
      });
      return snapshot();
    });
    return writePromise;
  };

  const setSessionPolicy = async (sessionId, enabled, directory) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new TypeError('sessionId is required');
    const oc2 = identity()?.generation === 'oc2';
    const mode = toPermissionMode(enabled);
    if (oc2 ? !mode : typeof enabled !== 'boolean') throw new TypeError(oc2 ? 'mode must be ask, safety or auto' : 'enabled must be a boolean');
    await load();
    const result = await persistUpdate(oc2 ? MODES_KEY : SETTINGS_KEY, (current) => ({
      ...current,
      sessions: { ...current.sessions, [sessionId.trim()]: oc2 ? mode : enabled },
      revision: current.revision + 1,
    }));
    if (oc2 ? isAutoAnsweringMode(mode) : enabled) await reconcilePending({ directories: [directory] });
    return result;
  };

  const applyDefaultMode = async (sessionId) => {
    if (identity()?.generation !== 'oc2') return;
    await load();
    await writePromise.catch(() => undefined);
    if (Object.hasOwn(modes.sessions, sessionId) || Object.hasOwn(policy.sessions, sessionId)) return;
    const settings = await readSettingsFromDiskMigrated();
    const mode = settings?.[DEFAULT_MODE_KEY];
    if (!isPermissionMode(mode) || mode === 'ask') return;
    await persistUpdate(MODES_KEY, (current) => Object.hasOwn(current.sessions, sessionId) || Object.hasOwn(policy.sessions, sessionId) ? current : ({
      sessions: { ...current.sessions, [sessionId]: mode }, revision: current.revision + 1,
    }));
  };

  const rememberSession = (info, directoryHint) => {
    const id = z.string().min(1).safeParse(info?.id);
    if (!id.success) return;
    const parentID = z.string().min(1).safeParse(info.parentID);
    const ownDirectory = z.string().min(1).safeParse(info.directory);
    const locationDirectory = z.string().min(1).safeParse(info.location?.directory);
    sessions.set(info.id, {
      parentID: parentID.success ? parentID.data : null,
      directory: ownDirectory.success ? ownDirectory.data : locationDirectory.success ? locationDirectory.data : directoryHint,
    });
    if (sessions.size > SESSION_CACHE_LIMIT) {
      sessions.delete(sessions.keys().next().value);
    }
  };

  const request = async (path, { directory, method = 'GET', body } = {}) => {
    const url = new URL(buildOpenCodeUrl(path, ''));
    if (directory) url.searchParams.set('directory', directory);
    const response = await fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...getOpenCodeAuthHeaders(),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) {
      const error = new Error(`OpenCode request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.json().catch(() => null);
  };

  const getSession = async (sessionId, directory) => {
    const cached = sessions.get(sessionId);
    if (cached) return cached;
    const info = kernelOperations
      ? (await kernelOperations.getSession({ sessionID: sessionId, directory })).data.raw
      : await request(`/session/${encodeURIComponent(sessionId)}`, { directory });
    rememberSession(info?.data ?? info, directory);
    return sessions.get(sessionId) ?? null;
  };

  const isSessionAutoAccepting = async (sessionId, directory) => {
    await load();
    await writePromise.catch(() => undefined);
    const seen = new Set();
    let current = sessionId;
    let currentDirectory = directory;
    while (current && !seen.has(current)) {
      if (identity()?.generation === 'oc2' && Object.hasOwn(modes.sessions, current)) return isAutoAnsweringMode(modes.sessions[current]);
      if (Object.hasOwn(policy.sessions, current)) return policy.sessions[current] === true;
      seen.add(current);
      let info;
      try {
        info = await getSession(current, currentDirectory);
      } catch {
        return false;
      }
      current = info?.parentID ?? null;
      currentDirectory = info?.directory ?? currentDirectory;
    }
    return false;
  };

  const resolveMode = async (sessionId, directory) => {
    await load();
    await writePromise.catch(() => undefined);
    const seen = new Set();
    let current = sessionId;
    let scope = directory;
    while (current && !seen.has(current)) {
      if (Object.hasOwn(modes.sessions, current)) return modes.sessions[current];
      if (Object.hasOwn(policy.sessions, current)) {
        return policy.sessions[current] ? legacyMode : 'ask';
      }
      seen.add(current);
      let info;
      try { info = await getSession(current, scope); } catch { return 'ask'; }
      current = info?.parentID ?? null;
      scope = info?.directory ?? scope;
    }
    return 'ask';
  };

  const replyOnce = async (permission, directory) => {
    if (!permission?.id || !permission?.sessionID) return false;
    const captured = identity();
    await load();
    const mode = captured?.generation === 'oc2'
      ? await resolveMode(permission.sessionID, directory)
      : (await isSessionAutoAccepting(permission.sessionID, directory) ? 'legacy' : 'ask');
    if (mode === 'ask') return false;
    assertIdentity(captured);
    if (mode === 'safety' || mode === 'legacy') {
      const verdict = evaluatePermission ? await evaluatePermission(permission, directory) : null;
      if (mode === 'safety' ? verdict?.action !== 'accept' : verdict?.action === 'hold') {
        outcomes.set(permission.id, 'held');
        return true;
      }
    }
    assertIdentity(captured);
    if (kernelOperations) {
      await kernelOperations.replyPermission({
        requestID: permission.id, sessionID: permission.sessionID, directory,
        decision: 'once', expectedIdentity: captured,
      });
      assertIdentity(captured);
      outcomes.set(permission.id, 'replied');
      if (outcomes.size > OUTCOME_CACHE_LIMIT) outcomes.delete(outcomes.keys().next().value);
      return true;
    }
    await request(`/permission/${encodeURIComponent(permission.id)}/reply`, {
      directory,
      method: 'POST',
      body: { reply: 'once' },
    });
    outcomes.set(permission.id, 'replied');
    return true;
  };

  const isPermissionAutoAnswered = async (sessionId, directory, permissionId) => {
    if (identity()?.generation !== 'oc2') return isSessionAutoAccepting(sessionId, directory);
    const mode = await resolveMode(sessionId, directory);
    if (mode === 'auto') return true;
    if (mode === 'ask') return false;
    return outcomes.get(permissionId) === 'replied';
  };

  const processPermission = (permission, directory) => {
    if (!permission?.id) return Promise.resolve(false);
    let captured;
    try { captured = identity(); } catch { return Promise.resolve(false); }
    const key = permission.id;
    const existing = inFlight.get(key);
    if (existing) return existing;
    const task = (async () => {
      for (const delay of retryDelaysMs) {
        if (delay > 0) await wait(delay);
        try {
          assertIdentity(captured);
          return await replyOnce(permission, directory);
        } catch (error) {
          if (error?.status === 404) return true;
          try { assertIdentity(captured); } catch { return false; }
        }
      }
      return false;
    })().finally(() => { if (inFlight.get(key) === task) inFlight.delete(key); });
    inFlight.set(key, task);
    return task;
  };

  async function reconcilePending({ directories = [] } = {}) {
    const normalizedDirectories = Array.from(new Set(
      directories.filter((directory) => typeof directory === 'string' && directory.trim()).map((directory) => directory.trim()),
    ));
    const key = normalizedDirectories.length > 0 ? normalizedDirectories.join('\n') : 'all';
    const existing = reconcilePromises.get(key);
    if (existing) return existing;
    const task = (async () => {
      await load();
      const captured = identity();
      const scopes = [undefined, ...normalizedDirectories];
      const pendingById = new Map();
      for (const directory of scopes) {
        assertIdentity(captured);
        let payload;
        try {
          payload = kernelOperations
            ? (await kernelOperations.listPendingPermissions({ directory })).data
            : await request('/permission', { directory });
        } catch {
          continue;
        }
        assertIdentity(captured);
        const pending = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : null;
        if (!pending) continue;
        for (const permission of pending) {
          if (!permission?.id) continue;
          pendingById.set(permission.id, { permission, directory: permission.directory ?? directory });
        }
      }
      assertIdentity(captured);
      await Promise.all(Array.from(pendingById.values()).map(({ permission, directory }) =>
        processPermission(permission, directory)));
    })().finally(() => { if (reconcilePromises.get(key) === task) reconcilePromises.delete(key); });
    reconcilePromises.set(key, task);
    return task;
  }

  const processEvent = (event) => {
    const directory = typeof event?.directory === 'string' && event.directory !== 'global' ? event.directory : undefined;
    const raw = event?.payload;
    const payloads = event?.translated
      ? event.translated()
      : [raw?.payload && z.object({}).passthrough().safeParse(raw.payload).success ? raw.payload : raw];
    for (const payload of payloads) {
      if (payload?.type === 'session.created' || payload?.type === 'session.updated') {
        rememberSession(payload.properties?.info, directory);
        if (payload.type === 'session.created' && payload.properties?.info?.id && !payload.properties.info.parentID) {
          void applyDefaultMode(payload.properties.info.id).catch((error) => {
            console.warn('[permission-auto-accept] default mode failed:', error?.message ?? error);
          });
        }
      } else if (payload?.type === 'permission.asked') {
        void processPermission(payload.properties, directory ?? payload.properties?.directory);
      } else if (payload?.type === 'permission.replied') {
        const permissionId = payload.properties?.requestID;
        if (z.string().safeParse(permissionId).success) {
          outcomes.delete(permissionId);
          onPermissionReplied?.(permissionId);
        }
      }
    }
  };

  const start = () => {
    const unsubscribeEvent = globalEventHub.subscribeEvent(processEvent);
    const unsubscribeStatus = globalEventHub.subscribeStatus((status) => {
      if (status?.type === 'connect') void reconcilePending().catch((error) => {
        console.warn('[permission-auto-accept] reconciliation failed:', error?.message ?? error);
      });
    });
    // Lifecycle flips the kernel descriptor from `unknown` to `oc1`/`oc2` once
    // OpenCode answers. Reading settings before that resolves goes through a
    // kernel that is not ready yet and logs a failure that is not a real one.
    // Wait for the same readiness signal the event hub uses; a generation that
    // never becomes ready stays quiet here and the status `connect`
    // reconciliation loads the policy once the stream is up.
    void (async () => {
      const descriptor = await waitForKernelReady(getKernelRuntime);
      if (descriptor && descriptor.generation !== 'oc1' && descriptor.generation !== 'oc2') return;
      await load().then(() => reconcilePending());
    })().catch((error) => {
      console.warn('[permission-auto-accept] failed to load policy:', error?.message ?? error);
    });
    return () => {
      unsubscribeEvent();
      unsubscribeStatus();
    };
  };

  return {
    snapshot,
    load,
    setSessionPolicy,
    isPermissionAutoAnswered,
    isSessionAutoAccepting,
    processPermission,
    reconcilePending,
    start,
  };
}

export function registerPermissionAutoAcceptRoutes(app, runtime) {
  app.get('/api/permission-auto-accept', async (_req, res) => {
    try {
      res.json(await runtime.load());
    } catch (error) {
      res.status(500).json({ error: error?.message ?? 'Failed to load permission auto-accept policy' });
    }
  });

  app.put('/api/permission-auto-accept/sessions/:sessionId', async (req, res) => {
    try {
      const directory = typeof req.body?.directory === 'string' ? req.body.directory : undefined;
      res.json(await runtime.setSessionPolicy(req.params.sessionId, req.body?.mode ?? req.body?.enabled, directory));
    } catch (error) {
      res.status(error instanceof TypeError ? 400 : 500).json({ error: error?.message });
    }
  });
}
