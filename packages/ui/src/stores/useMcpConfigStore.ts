import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { createDeferredSafeJSONStorage } from './utils/safeStorage';
import { startConfigUpdate } from '@/lib/configUpdate';
import { refreshAfterOpenCodeRestart } from '@/stores/useAgentsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { opencodeClient } from '@/lib/opencode/client';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { noteDeferredRestartFromPayload } from '@/lib/opencode/deferredRestart';
import { z } from 'zod';
import type { JsonValue } from '@opencode/client';

export type McpScope = 'user' | 'project';
export type McpProtocol = 'legacy' | 'auto' | '2026-07-28';
export type McpCodemodeChoice = 'default' | 'on' | 'off';
export const MCP_PROTOCOLS: readonly McpProtocol[] = ['legacy', 'auto', '2026-07-28'];
export const MCP_CODEMODE_CHOICES: readonly McpCodemodeChoice[] = ['default', 'on', 'off'];
export const codemodeChoiceOf = (value: boolean | undefined): McpCodemodeChoice =>
  value === undefined ? 'default' : value ? 'on' : 'off';

type McpMutationResult = {
  ok: boolean;
  reloadFailed?: boolean;
  message?: string;
  warning?: string;
  requiresManualRestart?: boolean;
  restartDeferred?: boolean;
};

/**
 * Directory a call operates on. Settings can browse another project without
 * moving the app, so every entry point takes one; omitting it means the
 * project the app is currently on.
 */
const resolveDirectory = (directory?: string | null): string | null => {
  if (directory !== undefined) {
    const trimmed = directory?.trim();
    return trimmed ? trimmed : null;
  }
  return getConfigDirectory();
};

const getConfigDirectory = (): string | null => {
  try {
    const projectsStore = useProjectsStore.getState();
    const activeProject = projectsStore.getActiveProject?.();
    if (activeProject?.path?.trim()) {
      return activeProject.path.trim();
    }

    const clientDir = opencodeClient.getDirectory();
    if (clientDir?.trim()) {
      return clientDir.trim();
    }
  } catch (err) {
    console.warn('[McpConfigStore] Error resolving config directory:', err);
  }
  return null;
};

// ============== TYPES ==============

interface McpLocalConfig {
  type: 'local';
  command: string[];
  environment?: Record<string, string>;
  enabled: boolean;
}

interface McpOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  redirectUri?: string;
}

interface McpRemoteConfig {
  type: 'remote';
  url: string;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig | false;
  timeout?: number;
  enabled: boolean;
}

const timeoutV2Schema = z.object({
  startup: z.number().optional(),
  catalog: z.number().optional(),
  execution: z.number().optional(),
}).optional();
const oauthV2Schema = z.union([z.literal(false), z.object({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  scope: z.string().optional(),
  callback_port: z.number().optional(),
  redirect_uri: z.string().optional(),
  auth_server_metadata_url: z.string().optional(),
})]).optional();
const commonV2 = {
  name: z.string(),
  scope: z.enum(['user', 'project']).nullable().optional(),
  disabled: z.boolean().optional(),
  timeout: timeoutV2Schema,
  codemode: z.boolean().optional(),
  protocol: z.enum(['legacy', 'auto', '2026-07-28']).optional(),
  sectionKey: z.string().optional(),
  legacy: z.boolean().optional(),
};
const v2Schema = z.discriminatedUnion('type', [
  z.object({ ...commonV2, type: z.literal('local'), command: z.array(z.string()), environment: z.record(z.string(), z.string()).optional(), cwd: z.string().optional() }),
  z.object({ ...commonV2, type: z.literal('remote'), url: z.string(), headers: z.record(z.string(), z.string()).optional(), oauth: oauthV2Schema }),
]);
const v1Schema = z.discriminatedUnion('type', [
  z.object({ name: z.string(), type: z.literal('local'), command: z.array(z.string()), environment: z.record(z.string(), z.string()).optional(), enabled: z.boolean().optional(), scope: z.enum(['user', 'project']).nullable().optional() }),
  z.object({ name: z.string(), type: z.literal('remote'), url: z.string(), environment: z.record(z.string(), z.string()).optional(), headers: z.record(z.string(), z.string()).optional(), oauth: z.union([z.literal(false), z.object({ clientId: z.string().optional(), clientSecret: z.string().optional(), scope: z.string().optional(), redirectUri: z.string().optional() })]).optional(), timeout: z.number().optional(), enabled: z.boolean().optional(), scope: z.enum(['user', 'project']).nullable().optional() }),
]);

export type McpServerConfig = (McpLocalConfig | McpRemoteConfig) & { name: string };
export type McpServerWithScope =
  | (z.infer<typeof v1Schema> & { generation: 'oc1' })
  | (z.infer<typeof v2Schema> & { generation: 'oc2' });
export const isMcpConfigEnabled = (server: McpServerWithScope): boolean =>
  server.generation === 'oc1' ? server.enabled !== false : server.disabled !== true;

export const parseMcpConfigs = (payload: JsonValue, generation: 'oc1' | 'oc2'): McpServerWithScope[] =>
  generation === 'oc1'
    ? z.array(v1Schema).parse(payload).map((server) => ({ ...server, generation: 'oc1' as const }))
    : z.array(v2Schema).parse(payload).map((server) => ({ ...server, generation: 'oc2' as const }));

export interface McpDraft {
  name: string;
  scope: McpScope;
  type: 'local' | 'remote';
  command: string[];
  url: string;
  environment: Array<{ key: string; value: string }>;
  headers: Array<{ key: string; value: string }>;
  oauthEnabled: boolean;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
  oauthRedirectUri: string;
  oauthRaw?: McpV2OAuth | false;
  timeout: string;
  timeoutStartup?: string;
  timeoutCatalog?: string;
  timeoutExecution?: string;
  codemode?: McpCodemodeChoice;
  protocol?: McpProtocol;
  enabled: boolean;
}

// ============== HELPERS ==============

export const envRecordToArray = (env?: Record<string, string>): Array<{ key: string; value: string }> => {
  if (!env) return [];
  return Object.entries(env).map(([key, value]) => ({ key, value }));
};

const envArrayToRecord = (arr: Array<{ key: string; value: string }>): Record<string, string> | undefined => {
  const filtered = arr.filter((e) => e.key.trim());
  if (filtered.length === 0) return undefined;
  return Object.fromEntries(filtered.map((e) => [e.key.trim(), e.value]));
};

const trimOptionalString = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const CLIENT_RELOAD_DELAY_MS = 800;
const MCP_LOAD_CACHE_TTL_MS = 5000;
const DEFAULT_MCP_CACHE_KEY = '__default__';
const mcpLastLoadedAt = new Map<string, number>();
const mcpLoadInFlight = new Map<string, Promise<boolean>>();
let loadedRuntimeKey: string | null = null;

const getRuntimeKey = (): string => {
  const runtime = opencodeClient.getBoundRuntime();
  return `${runtime?.endpoint ?? ''}:${runtime?.epoch ?? ''}:${runtime?.generation ?? ''}`;
};

const getMcpCacheKey = (directory: string | null): string => {
  return `${getRuntimeKey()}:${directory?.trim() || DEFAULT_MCP_CACHE_KEY}`;
};

// ============== STORE ==============

interface McpConfigStore {
  /** Servers of the project the app is on. Chat and mobile read this one. */
  mcpServers: McpServerWithScope[];
  /** Every directory loaded so far, including the ambient one. */
  serversByDirectory: Record<string, McpServerWithScope[]>;
  selectedMcpName: string | null;
  isLoading: boolean;
  mcpDraft: McpDraft | null;

  setSelectedMcp: (name: string | null) => void;
  setMcpDraft: (draft: McpDraft | null) => void;
  loadMcpConfigs: (options?: { force?: boolean; directory?: string | null }) => Promise<boolean>;
  createMcp: (config: McpDraft, directory?: string | null) => Promise<McpMutationResult>;
  updateMcp: (name: string, config: Partial<McpDraft>, directory?: string | null) => Promise<McpMutationResult>;
  deleteMcp: (name: string, directory?: string | null) => Promise<McpMutationResult>;
  getMcpByName: (name: string, directory?: string | null) => McpServerWithScope | undefined;
  getMcpServersForDirectory: (directory?: string | null) => McpServerWithScope[];
}

const invalidateMcpCache = (directory: string | null) => {
  mcpLastLoadedAt.delete(getMcpCacheKey(directory));
};

const EMPTY_MCP_SERVERS: McpServerWithScope[] = [];

/**
 * Servers of one project. Returns a stored array so components can select it
 * directly; an omitted directory means the project the app is on.
 */
export const selectMcpServersForDirectory = (
  state: Pick<McpConfigStore, 'serversByDirectory'>,
  directory?: string | null,
): McpServerWithScope[] => {
  const cacheKey = getMcpCacheKey(resolveDirectory(directory));
  return state.serversByDirectory[cacheKey] ?? EMPTY_MCP_SERVERS;
};

export const useMcpConfigStore = create<McpConfigStore>()(
  devtools(
    persist(
      (set, get) => ({
        mcpServers: [],
        serversByDirectory: {},
        selectedMcpName: null,
        isLoading: false,
        mcpDraft: null,

        setSelectedMcp: (name) => set({ selectedMcpName: name }),

        setMcpDraft: (draft) => set({ mcpDraft: draft }),

        loadMcpConfigs: async (options) => {
          const runtimeKey = getRuntimeKey();
          if (loadedRuntimeKey !== runtimeKey) {
            loadedRuntimeKey = runtimeKey;
            mcpLastLoadedAt.clear();
            mcpLoadInFlight.clear();
            set({ mcpServers: [], serversByDirectory: {}, isLoading: false });
          }
          const configDirectory = resolveDirectory(options?.directory);
          const cacheKey = getMcpCacheKey(configDirectory);
          const isAmbient = cacheKey === getMcpCacheKey(getConfigDirectory());
          const now = Date.now();
          const loadedAt = mcpLastLoadedAt.get(cacheKey) ?? 0;
          const hasCachedConfigs = (get().serversByDirectory[cacheKey] ?? (isAmbient ? get().mcpServers : [])).length > 0;

          if (!options?.force && hasCachedConfigs && now - loadedAt < MCP_LOAD_CACHE_TTL_MS) {
            return true;
          }

          const inFlight = mcpLoadInFlight.get(cacheKey);
          if (!options?.force && inFlight) {
            return inFlight;
          }

          const request = (async () => {
            set({ isLoading: true });
            try {
              const runtime = opencodeClient.getBoundRuntime();
              if (runtime?.generation !== 'oc1' && runtime?.generation !== 'oc2') {
                throw new Error('OpenCode runtime is not bound for MCP configuration');
              }
              const queryParams = configDirectory ? `?directory=${encodeURIComponent(configDirectory)}` : '';
              const response = await runtimeFetch(`/api/config/mcp${queryParams}`, {
                headers: configDirectory ? { 'x-opencode-directory': configDirectory } : undefined,
              });
              if (!response.ok) {
                throw new Error('Failed to load MCP configs');
              }
              const payload = await response.json();
              const after = opencodeClient.getBoundRuntime();
              if (after?.endpoint !== runtime.endpoint || after.epoch !== runtime.epoch || after.generation !== runtime.generation) {
                throw new Error('OpenCode runtime changed during MCP configuration load');
              }
              const data = parseMcpConfigs(payload, runtime.generation);
              set((state) => {
                const next: Partial<McpConfigStore> = {
                  serversByDirectory: { ...state.serversByDirectory, [cacheKey]: data },
                  isLoading: false,
                };
                if (isAmbient) next.mcpServers = data;
                return next;
              });
              mcpLastLoadedAt.set(cacheKey, Date.now());
              return true;
            } catch (error) {
              console.error('[McpConfigStore] Failed to load MCP configs:', error);
              set({ isLoading: false });
              return false;
            }
          })();

          mcpLoadInFlight.set(cacheKey, request);
          try {
            return await request;
          } finally {
            mcpLoadInFlight.delete(cacheKey);
          }
        },

        createMcp: async (config: McpDraft, directory?: string | null) => {
          try {
            const body = opencodeClient.getBoundRuntime()?.generation === 'oc2'
              ? buildMcpBodyV2(config)
              : buildMcpBody(config);
            const configDirectory = resolveDirectory(directory);
            const queryParams = configDirectory ? `?directory=${encodeURIComponent(configDirectory)}` : '';
            const response = await runtimeFetch(`/api/config/mcp/${encodeURIComponent(config.name)}${queryParams}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(configDirectory ? { 'x-opencode-directory': configDirectory } : {}),
              },
              body: JSON.stringify(body),
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to create MCP server');
            }

            invalidateMcpCache(configDirectory);

            if (payload?.requiresManualRestart) {
              await get().loadMcpConfigs({ force: true, directory: configDirectory });
              return {
                ok: true,
                requiresManualRestart: true,
                reloadFailed: payload?.reloadFailed === true,
                message: payload?.message,
                warning: payload?.warning,
              };
            }

            if (noteDeferredRestartFromPayload(payload, 'mcp', { id: config.name })) {
              await get().loadMcpConfigs({ force: true, directory: configDirectory });
              return {
                ok: true,
                restartDeferred: true,
                reloadFailed: payload?.reloadFailed === true,
                message: payload?.message,
                warning: payload?.warning,
              };
            }

            if (payload?.requiresReload) {
              startConfigUpdate('Creating MCP server configuration…');
              await refreshAfterOpenCodeRestart({
                message: payload.message,
                delayMs: payload.reloadDelayMs ?? CLIENT_RELOAD_DELAY_MS,
                scopes: ['all'],
              });
              await get().loadMcpConfigs({ force: true, directory: configDirectory });
              return {
                ok: true,
                reloadFailed: payload?.reloadFailed === true,
                message: payload?.message,
                warning: payload?.warning,
              };
            }

            await get().loadMcpConfigs({ force: true, directory: configDirectory });
            return {
              ok: true,
              reloadFailed: payload?.reloadFailed === true,
              message: payload?.message,
              warning: payload?.warning,
            };
          } catch (error) {
            console.error('[McpConfigStore] Failed to create MCP:', error);
            return { ok: false };
          }
        },

        updateMcp: async (name: string, config: Partial<McpDraft>, directory?: string | null) => {
          try {
            const configDirectory = resolveDirectory(directory);
            const existing = get().getMcpByName(name, configDirectory);
            const body = opencodeClient.getBoundRuntime()?.generation === 'oc2'
              ? buildMcpBodyV2(config, existing?.generation === 'oc2' ? existing : undefined)
              : buildMcpBody(config);
            const queryParams = configDirectory ? `?directory=${encodeURIComponent(configDirectory)}` : '';
            const response = await runtimeFetch(`/api/config/mcp/${encodeURIComponent(name)}${queryParams}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                ...(configDirectory ? { 'x-opencode-directory': configDirectory } : {}),
              },
              body: JSON.stringify(body),
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to update MCP server');
            }

            invalidateMcpCache(configDirectory);

            if (payload?.requiresManualRestart) {
              await get().loadMcpConfigs({ force: true, directory: configDirectory });
              return {
                ok: true,
                requiresManualRestart: true,
                reloadFailed: payload?.reloadFailed === true,
                message: payload?.message,
                warning: payload?.warning,
              };
            }

            if (noteDeferredRestartFromPayload(payload, 'mcp', { id: name })) {
              await get().loadMcpConfigs({ force: true, directory: configDirectory });
              return {
                ok: true,
                restartDeferred: true,
                reloadFailed: payload?.reloadFailed === true,
                message: payload?.message,
                warning: payload?.warning,
              };
            }

            if (payload?.requiresReload) {
              startConfigUpdate('Updating MCP server configuration…');
              await refreshAfterOpenCodeRestart({
                message: payload.message,
                delayMs: payload.reloadDelayMs ?? CLIENT_RELOAD_DELAY_MS,
                scopes: ['all'],
              });
              await get().loadMcpConfigs({ force: true, directory: configDirectory });
              return {
                ok: true,
                reloadFailed: payload?.reloadFailed === true,
                message: payload?.message,
                warning: payload?.warning,
              };
            }

            await get().loadMcpConfigs({ force: true, directory: configDirectory });
            return {
              ok: true,
              reloadFailed: payload?.reloadFailed === true,
              message: payload?.message,
              warning: payload?.warning,
            };
          } catch (error) {
            console.error('[McpConfigStore] Failed to update MCP:', error);
            throw error;
          }
        },

        deleteMcp: async (name: string, directory?: string | null) => {
          try {
            const configDirectory = resolveDirectory(directory);
            const queryParams = configDirectory ? `?directory=${encodeURIComponent(configDirectory)}` : '';
            const response = await runtimeFetch(`/api/config/mcp/${encodeURIComponent(name)}${queryParams}`, {
              method: 'DELETE',
              headers: configDirectory ? { 'x-opencode-directory': configDirectory } : undefined,
            });

            const payload = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(payload?.error || 'Failed to delete MCP server');
            }

            invalidateMcpCache(configDirectory);

            if (get().selectedMcpName === name) {
              set({ selectedMcpName: null });
            }

            if (payload?.requiresManualRestart) {
              await get().loadMcpConfigs({ force: true, directory: configDirectory });
              return {
                ok: true,
                requiresManualRestart: true,
                reloadFailed: payload?.reloadFailed === true,
                message: payload?.message,
                warning: payload?.warning,
              };
            }

            if (noteDeferredRestartFromPayload(payload, 'mcp', { id: name })) {
              await get().loadMcpConfigs({ force: true, directory: configDirectory });
              return {
                ok: true,
                restartDeferred: true,
                reloadFailed: payload?.reloadFailed === true,
                message: payload?.message,
                warning: payload?.warning,
              };
            }

            if (payload?.requiresReload) {
              startConfigUpdate('Deleting MCP server configuration…');
              await refreshAfterOpenCodeRestart({
                message: payload.message,
                delayMs: payload.reloadDelayMs ?? CLIENT_RELOAD_DELAY_MS,
                scopes: ['all'],
              });
            }

            await get().loadMcpConfigs({ force: true, directory: configDirectory });
            return {
              ok: true,
              reloadFailed: payload?.reloadFailed === true,
              message: payload?.message,
              warning: payload?.warning,
            };
          } catch (error) {
            console.error('[McpConfigStore] Failed to delete MCP:', error);
            return { ok: false };
          }
        },

        getMcpByName: (name: string, directory?: string | null) => {
          return get().getMcpServersForDirectory(directory).find((s) => s.name === name);
        },

        getMcpServersForDirectory: (directory?: string | null) => {
          return selectMcpServersForDirectory(get(), directory);
        },
      }),
      {
        name: 'mcp-config-store',
        storage: createDeferredSafeJSONStorage(),
        partialize: (state) => ({ selectedMcpName: state.selectedMcpName }),
      },
    ),
    { name: 'mcp-config-store' },
  ),
);


// ============== HELPERS ==============

function buildMcpBody(config: Partial<McpDraft>): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (config.scope !== undefined) body.scope = config.scope;

  if (config.type !== undefined) body.type = config.type;

  if (config.type === 'local' || config.command !== undefined) {
    body.command = (config.command ?? []).filter((s) => s.trim());
  }

  if (config.type === 'remote' || config.url !== undefined) {
    body.url = config.url?.trim() ?? '';
  }

  if (config.environment !== undefined) {
    body.environment = envArrayToRecord(config.environment) ?? {};
  }

  if (config.headers !== undefined) {
    body.headers = envArrayToRecord(config.headers) ?? {};
  }

  if (
    config.oauthEnabled !== undefined ||
    config.oauthClientId !== undefined ||
    config.oauthClientSecret !== undefined ||
    config.oauthScope !== undefined ||
    config.oauthRedirectUri !== undefined
  ) {
    if (config.oauthEnabled === false) {
      body.oauth = false;
    } else {
      const oauth = {
        clientId: trimOptionalString(config.oauthClientId),
        clientSecret: trimOptionalString(config.oauthClientSecret),
        scope: trimOptionalString(config.oauthScope),
        redirectUri: trimOptionalString(config.oauthRedirectUri),
      };

      if (oauth.clientId || oauth.clientSecret || oauth.scope || oauth.redirectUri) {
        body.oauth = oauth;
      } else if (config.oauthEnabled) {
        body.oauth = {};
      } else {
        body.oauth = false;
      }
    }
  }

  if (config.timeout !== undefined) {
    const timeout = Number(config.timeout);
    if (Number.isFinite(timeout) && timeout > 0) {
      body.timeout = timeout;
    } else {
      body.timeout = null;
    }
  }

  if (config.enabled !== undefined) {
    body.enabled = config.enabled;
  }

  return body;
}

const positiveTimeout = (value: string | undefined): number | undefined => {
  if (value === undefined || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export type McpV2OAuth = Exclude<z.infer<typeof oauthV2Schema>, false | undefined>;
type McpV2Timeout = NonNullable<z.infer<typeof timeoutV2Schema>>;
type McpV2WriteBody = {
  scope?: McpScope;
  type?: 'local' | 'remote';
  command?: string[];
  url?: string;
  environment?: Record<string, string>;
  headers?: Record<string, string>;
  disabled?: boolean;
  timeout?: McpV2Timeout | null;
  oauth?: McpV2OAuth | false;
  codemode?: boolean | null;
  protocol?: McpProtocol | null;
};

export const buildMcpBodyV2 = (
  config: Partial<McpDraft>,
  previous?: Extract<McpServerWithScope, { generation: 'oc2' }>,
): McpV2WriteBody => {
  const body: McpV2WriteBody = {};
  if (config.scope !== undefined) body.scope = config.scope;
  if (config.type !== undefined) body.type = config.type;
  if (config.command !== undefined) body.command = config.command.filter((part) => part.trim());
  if (config.url !== undefined) body.url = config.url.trim();
  if (config.environment !== undefined) body.environment = envArrayToRecord(config.environment) ?? {};
  if (config.headers !== undefined) body.headers = envArrayToRecord(config.headers) ?? {};
  if (config.enabled !== undefined) body.disabled = !config.enabled;
  if (config.codemode !== undefined) body.codemode = config.codemode === 'default' ? null : config.codemode === 'on';
  if (config.protocol !== undefined) body.protocol = config.protocol === 'legacy' ? null : config.protocol;

  const hasV2Timeout = config.timeoutStartup !== undefined
    || config.timeoutCatalog !== undefined
    || config.timeoutExecution !== undefined;
  if (hasV2Timeout) {
    const startup = positiveTimeout(config.timeoutStartup);
    const catalog = positiveTimeout(config.timeoutCatalog);
    const execution = positiveTimeout(config.timeoutExecution);
    const timeout: McpV2Timeout = {};
    if (startup !== undefined) timeout.startup = startup;
    if (catalog !== undefined) timeout.catalog = catalog;
    if (execution !== undefined) timeout.execution = execution;
    body.timeout = Object.keys(timeout).length ? timeout : null;
  } else if (config.timeout !== undefined) {
    const value = positiveTimeout(config.timeout);
    body.timeout = value === undefined ? null : { ...previous?.timeout, catalog: value, execution: value };
  }

  const previousOAuth = previous?.type === 'remote' ? previous.oauth : undefined;
  const previousOAuthFields = previousOAuth ? previousOAuth : null;
  const editsOAuth = config.oauthRaw !== undefined || (previous
    ? (config.oauthEnabled !== undefined && config.oauthEnabled !== (previousOAuth !== false))
      || (config.oauthClientId !== undefined && config.oauthClientId.trim() !== (previousOAuthFields?.client_id ?? ''))
      || (config.oauthClientSecret !== undefined && config.oauthClientSecret.trim() !== (previousOAuthFields?.client_secret ?? ''))
      || (config.oauthScope !== undefined && config.oauthScope.trim() !== (previousOAuthFields?.scope ?? ''))
      || (config.oauthRedirectUri !== undefined && config.oauthRedirectUri.trim() !== (previousOAuthFields?.redirect_uri ?? ''))
    : Boolean(trimOptionalString(config.oauthClientId) || trimOptionalString(config.oauthClientSecret)
      || trimOptionalString(config.oauthScope) || trimOptionalString(config.oauthRedirectUri)));
  if (editsOAuth) {
    if (config.oauthRaw !== undefined) {
      body.oauth = config.oauthRaw;
    } else if (config.oauthEnabled === false) {
      body.oauth = false;
    } else {
      const old = previous?.type === 'remote' && previous.oauth ? previous.oauth : null;
      const oauth: McpV2OAuth = {};
      if (old?.callback_port !== undefined) oauth.callback_port = old.callback_port;
      if (old?.auth_server_metadata_url !== undefined) oauth.auth_server_metadata_url = old.auth_server_metadata_url;
      const clientID = trimOptionalString(config.oauthClientId);
      const clientSecret = trimOptionalString(config.oauthClientSecret);
      const scope = trimOptionalString(config.oauthScope);
      const redirectURI = trimOptionalString(config.oauthRedirectUri);
      if (clientID) oauth.client_id = clientID;
      if (clientSecret) oauth.client_secret = clientSecret;
      if (scope) oauth.scope = scope;
      if (redirectURI) oauth.redirect_uri = redirectURI;
      body.oauth = oauth;
    }
  }
  return body;
};
