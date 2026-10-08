import { detectOpenCodeGeneration, OPENCODE_GENERATION } from './compatibility.js';
import { AGENT_FAMILY } from '../agent/constants.js';

export const createOpenCodeNetworkRuntime = (deps) => {
  const {
    state,
    getOpenCodeAuthHeaders,
    configuredOpenCodeHostname = '127.0.0.1',
    getBackendSelection = () => ({ family: AGENT_FAMILY.OPENCODE, revision: 0 }),
  } = deps;

  const resolveConnectHostname = () => {
    const raw = typeof configuredOpenCodeHostname === 'string' ? configuredOpenCodeHostname.trim() : '';
    const hostname = raw || '127.0.0.1';
    if (hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]') {
      return '127.0.0.1';
    }
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      return hostname;
    }
    return hostname.includes(':') ? `[${hostname}]` : hostname;
  };

  const normalizeApiPrefix = (prefix) => {
    if (!prefix) {
      return '';
    }

    if (prefix.includes('://')) {
      try {
        const parsed = new URL(prefix);
        return normalizeApiPrefix(parsed.pathname);
      } catch {
        return '';
      }
    }

    const trimmed = prefix.trim();
    if (!trimmed || trimmed === '/') {
      return '';
    }
    const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading;
  };

  const waitForReady = async (url, timeoutMs = 10000) => {
    const selection = getBackendSelection();
    const isCurrent = () => {
      const current = getBackendSelection();
      return selection.family === AGENT_FAMILY.OPENCODE
        && current.family === selection.family && current.revision === selection.revision;
    };
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!isCurrent()) return false;
      let timeout = null;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 3000);
        const descriptor = await detectOpenCodeGeneration({
          endpoint: url,
          epoch: 0,
          headers: getOpenCodeAuthHeaders(),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        timeout = null;
        if (!isCurrent()) return false;

        if (descriptor.generation === OPENCODE_GENERATION.OC1
          || descriptor.generation === OPENCODE_GENERATION.OC2) return true;
      } catch {
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };

  const setDetectedOpenCodeApiPrefix = () => {
    state.openCodeApiPrefix = '';
    state.openCodeApiPrefixDetected = true;
    if (state.openCodeApiDetectionTimer) {
      clearTimeout(state.openCodeApiDetectionTimer);
      state.openCodeApiDetectionTimer = null;
    }
  };

  const buildOpenCodeUrl = (path, prefixOverride) => {
    if (!state.openCodePort) {
      throw new Error('OpenCode port is not available');
    }
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const prefix = normalizeApiPrefix(prefixOverride !== undefined ? prefixOverride : '');
    const fullPath = `${prefix}${normalizedPath}`;
    const base = state.openCodeBaseUrl ?? `http://${resolveConnectHostname()}:${state.openCodePort}`;
    return `${base}${fullPath}`;
  };

  const detectOpenCodeApiPrefix = () => {
    state.openCodeApiPrefixDetected = true;
    state.openCodeApiPrefix = '';
    return true;
  };

  const ensureOpenCodeApiPrefix = () => detectOpenCodeApiPrefix();

  const scheduleOpenCodeApiDetection = () => {
    return;
  };

  return {
    waitForReady,
    normalizeApiPrefix,
    setDetectedOpenCodeApiPrefix,
    buildOpenCodeUrl,
    ensureOpenCodeApiPrefix,
    scheduleOpenCodeApiDetection,
  };
};
