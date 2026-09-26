import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import { asSessionId, asSessionIdList, asSessionMetadata, asTimestamp, mergeMetadataPatch, parseJson, type JsonValue, type SessionStateStore } from './openchamberSessionState';
import { removeProviderConfig, getProviderSources, upsertProviderConfig } from './opencodeConfig';
import { getProviderAuth, removeProviderAuth } from './opencodeAuth';
import * as v2Config from './opencodeConfigV2';
import * as v2Auth from './opencodeAuthV2';
import { fetchQuotaForProvider, listConfiguredQuotaProviders } from './quotaProviders';
import { credentialStatus, deleteCredential, importCursorCredential, normalizeCredential, readCredential, validateCredential, writeCredential, type ManagedProvider } from './quotaCredentials';
import { getSessionActivitySnapshot } from './sessionActivityWatcher';
import { getOpenCodeUpgradeStatus, upgradeManagedOpenCode } from './opencode-upgrade-runtime';
import { buildAppliedResponse, buildDeferredRestartResponse } from './config-mutation-response';
import { normalizeWindowsDriveLetter, pathsEqualWithNormalizedDriveLetter } from './pathUtils';
import { resolveWorkspaceFolders } from './workspaceResolver';
import { resolveKernelRequest } from './kernelRequest';
import type { BridgeContext, BridgeResponse } from './bridge';

const legacyClient = (ctx: BridgeContext | undefined) => {
  const manager = ctx?.manager;
  const apiUrl = manager?.getApiUrl();
  if (!manager || !apiUrl) throw new Error('OpenCode is not available');
  const identity = manager.getKernelRuntime();
  if (identity.generation !== 'oc1') throw new Error('OpenCode 1 is not active');
  const client = createOpencodeClient({ baseUrl: apiUrl.replace(/\/+$/, ''), headers: manager.getOpenCodeAuthHeaders(), throwOnError: true });
  const check = () => {
    const current = manager.getKernelRuntime();
    if (current.generation !== identity.generation || current.endpoint !== identity.endpoint || current.epoch !== identity.epoch) {
      throw new Error('OpenCode connection changed during session state operation');
    }
  };
  return { client, check };
};
const providerGeneration = async (ctx: BridgeContext | undefined): Promise<'oc1' | 'oc2'> => {
  let selected = ctx?.manager?.getKernelRuntime().generation;
  if (selected !== 'oc1' && selected !== 'oc2') selected = (await ctx?.manager?.refreshKernelRuntime())?.generation;
  if (selected !== 'oc1' && selected !== 'oc2') throw new Error('OpenCode kernel is not ready');
  return selected;
};

type BridgeMessageInput = {
  id: string;
  type: string;
  payload?: unknown;
};

type SystemRuntimeDeps = {
  resolveUserPath: (value: string, baseDirectory: string) => string;
  sessionState?: SessionStateStore;
  fetchModelsMetadata: () => Promise<unknown>;
  updateCheckUrl: string;
  clientReloadDelayMs: number;
};

const NOTIFICATION_CLAIM_TTL_MS = 10_000;
const notificationClaims = new Map<string, number>();

const claimNotification = (key: string): boolean => {
  const now = Date.now();
  for (const [claimKey, claimedAt] of notificationClaims) {
    if (now - claimedAt > NOTIFICATION_CLAIM_TTL_MS) {
      notificationClaims.delete(claimKey);
    }
  }

  const existing = notificationClaims.get(key);
  if (existing && now - existing <= NOTIFICATION_CLAIM_TTL_MS) {
    return false;
  }

  notificationClaims.set(key, now);
  return true;
};


const getOpenChamberConfigDir = (): string => {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, 'openchamber');
  }
  return path.join(os.homedir(), '.config', 'openchamber');
};

const sanitizeInstallScope = (scope: string): 'vscode' | 'web' => {
  if (scope === 'vscode' || scope === 'web') return scope;
  return 'web';
};

const getOrCreateInstallId = (scope: string): string => {
  const configDir = getOpenChamberConfigDir();
  const normalizedScope = sanitizeInstallScope(scope);
  const idPath = path.join(configDir, `install-id-${normalizedScope}`);

  try {
    const existing = fs.readFileSync(idPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // Generate new id.
  }

  const installId = randomUUID();
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(idPath, `${installId}\n`, { encoding: 'utf8', mode: 0o600 });
  return installId;
};

const mapNodePlatformToApiPlatform = (value: string): 'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'web' => {
  // The webview already sends API-shaped values; Node's os.platform() is the fallback source.
  if (value === 'macos' || value === 'windows' || value === 'linux' || value === 'android' || value === 'ios' || value === 'web') {
    return value;
  }
  if (value === 'darwin') return 'macos';
  if (value === 'win32') return 'windows';
  return 'web';
};

const mapNodeArchToApiArch = (value: string): 'arm64' | 'x64' | 'unknown' => {
  if (value === 'arm64' || value === 'aarch64') return 'arm64';
  if (value === 'x64' || value === 'amd64') return 'x64';
  return 'unknown';
};

type ParsedDiffHunk = {
  newStart: number;
  oldLines: string[];
  newLines: string[];
};

const VIRTUAL_DIFF_SCHEME = 'openchamber-diff';
const virtualDiffContents = new Map<string, string>();
let virtualDiffCounter = 0;
let virtualDiffProviderDisposable: vscode.Disposable | null = null;

const ensureVirtualDiffProviderRegistered = (ctx?: BridgeContext): void => {
  if (virtualDiffProviderDisposable) {
    return;
  }

  virtualDiffProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
    VIRTUAL_DIFF_SCHEME,
    {
      provideTextDocumentContent: (uri: vscode.Uri) => {
        const key = new URLSearchParams(uri.query).get('key') || '';
        return virtualDiffContents.get(key) ?? '';
      },
    },
  );

  if (ctx?.context) {
    ctx.context.subscriptions.push(virtualDiffProviderDisposable);
  }
};

const createVirtualOriginalDiffUri = (modifiedPath: string, content: string): vscode.Uri => {
  const key = `${Date.now()}-${++virtualDiffCounter}`;
  virtualDiffContents.set(key, content);

  if (virtualDiffContents.size > 100) {
    const firstKey = virtualDiffContents.keys().next().value;
    if (firstKey) {
      virtualDiffContents.delete(firstKey);
    }
  }

  return vscode.Uri.from({
    scheme: VIRTUAL_DIFF_SCHEME,
    path: `/${path.basename(modifiedPath) || 'original'}`,
    query: `key=${encodeURIComponent(key)}`,
  });
};

const parseUnifiedDiffHunks = (patch: string): ParsedDiffHunk[] => {
  const lines = patch.split(/\r?\n/);
  const hunks: ParsedDiffHunk[] = [];

  let current: ParsedDiffHunk | null = null;

  for (const line of lines) {
    const headerMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (headerMatch) {
      if (current) {
        hunks.push(current);
      }
      current = {
        newStart: Number(headerMatch[1] || 1),
        oldLines: [],
        newLines: [],
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('\\ No newline')) {
      continue;
    }

    if (line.startsWith('-')) {
      current.oldLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith('+')) {
      current.newLines.push(line.slice(1));
      continue;
    }

    if (line.startsWith(' ')) {
      const content = line.slice(1);
      current.oldLines.push(content);
      current.newLines.push(content);
    }
  }

  if (current) {
    hunks.push(current);
  }

  return hunks;
};

const reconstructOriginalContentFromPatch = (modifiedContent: string, patch: string): string | null => {
  const hunks = parseUnifiedDiffHunks(patch);
  if (hunks.length === 0) {
    return null;
  }

  const lines = modifiedContent.split('\n');
  for (let index = hunks.length - 1; index >= 0; index -= 1) {
    const hunk = hunks[index];
    if (!hunk) {
      continue;
    }
    const startIndex = Math.max(0, hunk.newStart - 1);
    const replaceCount = hunk.newLines.length;
    lines.splice(startIndex, replaceCount, ...hunk.oldLines);
  }

  return lines.join('\n');
};

const fetchFreeZenModels = async (): Promise<Array<{ id: string; owned_by?: string }>> => [];

export async function handleSystemBridgeMessage(
  message: BridgeMessageInput,
  ctx: BridgeContext | undefined,
  deps: SystemRuntimeDeps,
): Promise<BridgeResponse | null> {
  const { id, type, payload } = message;

  switch (type) {
    case 'api:opencode/directory': {
      const target = (payload as { path?: string })?.path;
      if (!target) {
        return { id, type, success: false, error: 'Path is required' };
      }
      const baseDirectory =
        ctx?.manager?.getWorkingDirectory() || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
      const resolvedPath = deps.resolveUserPath(target, baseDirectory);
      const result = await ctx?.manager?.setWorkingDirectory(resolvedPath);
      if (!result) {
        return { id, type, success: false, error: 'OpenCode manager unavailable' };
      }
      return { id, type, success: true, data: result };
    }

    case 'api:models/metadata': {
      try {
        const data = await deps.fetchModelsMetadata();
        return { id, type, success: true, data };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'api:opencode/runtime': {
      if (!ctx?.manager) return { id, type, success: false, error: 'OpenCode manager unavailable' };
      const descriptor = await ctx.manager.refreshKernelRuntime();
      return { id, type, success: true, data: descriptor };
    }

    case 'api:opencode/version': {
      try {
        const apiUrl = ctx?.manager?.getApiUrl();
        if (!apiUrl || !ctx?.manager) {
          return { id, type, success: true, data: { version: null, error: 'OpenCode manager unavailable' } };
        }
        const version = (await ctx.manager.refreshKernelRuntime()).version;
        return { id, type, success: true, data: { version } };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: true, data: { version: null, error: errorMessage } };
      }
    }

    case 'api:opencode/upgrade-status': {
      return { id, type, success: true, data: await getOpenCodeUpgradeStatus(ctx?.manager) };
    }

    case 'api:opencode/upgrade': {
      const target = (payload as { target?: unknown } | undefined)?.target;
      return { id, type, success: true, data: await upgradeManagedOpenCode(ctx?.manager, target) };
    }

    case 'api:session-activity:get': {
      return { id, type, success: true, data: getSessionActivitySnapshot() };
    }

    case 'api:notifications:claim': {
      const key = typeof (payload as { key?: unknown } | undefined)?.key === 'string'
        ? (payload as { key: string }).key.trim()
        : '';
      return { id, type, success: true, data: { claimed: key ? claimNotification(key) : false } };
    }

    case 'api:zen:models': {
      const models = await fetchFreeZenModels();
      return { id, type, success: true, data: { models } };
    }

    case 'api:openchamber:update-check': {
      try {
        const body = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
        const currentVersion = typeof body.currentVersion === 'string' && body.currentVersion.trim().length > 0
          ? body.currentVersion.trim()
          : String(ctx?.context?.extension?.packageJSON?.version || 'unknown');
        const instanceMode = typeof body.instanceMode === 'string' && body.instanceMode.trim().length > 0
          ? body.instanceMode.trim()
          : 'local';
        const deviceClass = typeof body.deviceClass === 'string' && body.deviceClass.trim().length > 0
          ? body.deviceClass.trim()
          : 'desktop';
        const platformRaw = typeof body.platform === 'string' && body.platform.trim().length > 0
          ? body.platform.trim()
          : os.platform();
        const archRaw = typeof body.arch === 'string' && body.arch.trim().length > 0
          ? body.arch.trim()
          : os.arch();
        const reportUsage = body.reportUsage !== false;

        const requestBody = {
          appType: 'vscode',
          deviceClass,
          platform: mapNodePlatformToApiPlatform(platformRaw),
          arch: mapNodeArchToApiArch(archRaw),
          channel: 'stable',
          currentVersion,
          ...(reportUsage ? { installId: getOrCreateInstallId('vscode') } : {}),
          instanceMode,
          reportUsage,
        };

        const response = await fetch(deps.updateCheckUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => 'update check failed');
          return { id, type, success: false, error: text || `Update check failed with ${response.status}` };
        }

        const data = await response.json();
        return { id, type, success: true, data };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'editor:openFile': {
      const { path: filePath, line, column } = payload as { path: string; line?: number; column?: number };
      try {
        const options: vscode.TextDocumentShowOptions = {};
        if (typeof line === 'number') {
          const pos = new vscode.Position(Math.max(0, line - 1), column || 0);
          options.selection = new vscode.Range(pos, pos);
        }
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath), options);
        return { id, type, success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'editor:openDiff': {
      const { original, modified, label, line, patch } = payload as {
        original: string;
        modified: string;
        label?: string;
        line?: number;
        patch?: string;
      };
      try {
        const modifiedUri = vscode.Uri.file(modified);
        const modifiedDoc = await vscode.workspace.openTextDocument(modifiedUri);
        let originalUri = original ? vscode.Uri.file(original) : modifiedUri;

        if (typeof patch === 'string' && patch.trim().length > 0) {
          const originalContent = reconstructOriginalContentFromPatch(modifiedDoc.getText(), patch);
          if (typeof originalContent === 'string') {
            ensureVirtualDiffProviderRegistered(ctx);
            originalUri = createVirtualOriginalDiffUri(modified, originalContent);
          }
        }

        const leftLabel = original ? path.basename(original) : `${path.basename(modified)} (before)`;
        const title = label || `${leftLabel} ↔ ${path.basename(modified)}`;

        await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title);

        if (typeof line === 'number' && Number.isFinite(line)) {
          const targetLine = Math.max(0, Math.trunc(line) - 1);
          await new Promise((resolve) => setTimeout(resolve, 0));
          const targetEditor = vscode.window.visibleTextEditors.find(
            (editor) => editor.document.uri.toString() === modifiedUri.toString(),
          );
          if (targetEditor) {
            const target = new vscode.Position(targetLine, 0);
            targetEditor.selection = new vscode.Selection(target, target);
            targetEditor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenter);
          }
        }

        return { id, type, success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'api:sessions/archive':
    case 'api:sessions/unarchive': {
      const body = (payload || {}) as { ids?: JsonValue; archivedAt?: JsonValue; directory?: string };
      const ids = asSessionIdList(body.ids);
      if (ids.length === 0) return { id, type, success: false, error: 'ids must be a non-empty array of session ids' };
      try {
        const generation = ctx?.manager?.getKernelRuntime().generation;
        if (generation === 'oc2') {
          if (!deps.sessionState) throw new Error('Session state store is unavailable');
          const data = type === 'api:sessions/archive'
            ? await deps.sessionState.archive(ids, asTimestamp(body.archivedAt))
            : await deps.sessionState.unarchive(ids);
          return { id, type, success: true, data };
        }
        if (generation !== 'oc1') throw new Error('OpenCode kernel is not ready');
        const { client, check } = legacyClient(ctx);
        const manager = ctx?.manager;
        if (!manager) throw new Error('OpenCode is not available');
        const directory = body.directory || manager.getWorkingDirectory();
        const stamp = asTimestamp(body.archivedAt) ?? Date.now();
        const archived: Array<{ id: string; archivedAt: number }> = [];
        const restored: Array<{ id: string; archivedAt: null }> = [];
        const failedIds: string[] = [];
        for (const sessionID of ids) {
          try {
            check();
            if (type === 'api:sessions/archive') {
              const response = await client.session.update({ sessionID, directory, time: { archived: stamp } });
              check();
              if (!response.data?.id) throw new Error('OpenCode did not return the updated session');
              archived.push({ id: sessionID, archivedAt: stamp });
            } else {
              // The OC1 SDK type omits the nullable archive reset accepted by
              // the session PATCH route, so keep this one wire call explicit.
              const selected = await resolveKernelRequest(manager, `/api/session/${encodeURIComponent(sessionID)}?directory=${encodeURIComponent(directory ?? '')}`);
              const response = await fetch(selected.url, { method: 'PATCH',
                headers: { ...manager.getOpenCodeAuthHeaders(), 'content-type': 'application/json' },
                body: JSON.stringify({ time: { archived: null } }) });
              selected.assertCurrent();
              if (!response.ok) throw new Error(`OpenCode unarchive failed (${response.status})`);
              restored.push({ id: sessionID, archivedAt: null });
            }
          } catch (error) {
            check();
            failedIds.push(sessionID);
          }
        }
        return { id, type, success: true, data: type === 'api:sessions/archive'
          ? { archived, failedIds, directory } : { restored, failedIds, directory } };
      } catch (error) {
        return { id, type, success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    case 'api:sessions/metadata:get':
    case 'api:sessions/metadata:set': {
      const body = (payload || {}) as { sessionId?: JsonValue; patch?: JsonValue; directory?: string };
      const sessionId = asSessionId(body.sessionId);
      if (!sessionId) return { id, type, success: false, error: 'a session id is required' };
      const patch = type === 'api:sessions/metadata:set' ? asSessionMetadata(body.patch) : null;
      if (type === 'api:sessions/metadata:set' && !patch) return { id, type, success: false, error: 'patch must be an object' };
      try {
        const generation = ctx?.manager?.getKernelRuntime().generation;
        const directory = body.directory || ctx?.manager?.getWorkingDirectory() || '';
        if (generation === 'oc2') {
          if (!deps.sessionState) throw new Error('Session state store is unavailable');
          const metadata = patch
            ? await deps.sessionState.setMetadata(sessionId, patch, directory)
            : await deps.sessionState.getMetadata(sessionId, directory);
          return { id, type, success: true, data: { metadata } };
        }
        if (generation !== 'oc1') throw new Error('OpenCode kernel is not ready');
        const { client, check } = legacyClient(ctx);
        const response = await client.session.get({ sessionID: sessionId, directory });
        check();
        if (!response.data) throw new Error(`session ${sessionId} was not found`);
        const current = asSessionMetadata(parseJson(JSON.stringify(response.data.metadata ?? {})) ?? undefined);
        if (!current) throw new Error('OpenCode session metadata is malformed');
        if (!patch) return { id, type, success: true, data: { metadata: current } };
        const metadata = mergeMetadataPatch(current, patch);
        check();
        await client.session.update({ sessionID: sessionId, directory, metadata });
        check();
        return { id, type, success: true, data: { metadata } };
      } catch (error) {
        return { id, type, success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    case 'api:provider/auth:delete': {
      const { providerId, scope, directory } = (payload || {}) as { providerId?: string; scope?: string; directory?: string };
      if (!providerId) {
        return { id, type, success: false, error: 'Provider ID is required' };
      }
      const normalizedScope = typeof scope === 'string' ? scope : 'auth';
      const workingDirectory = typeof directory === 'string' && directory.trim().length > 0
        ? directory.trim()
        : ctx?.manager?.getWorkingDirectory();
      try {
        const generation = await providerGeneration(ctx);
        if (generation === 'oc2') {
          if (normalizedScope === 'auth') {
            return { id, type, success: false, error: 'OpenCode 2 owns provider credentials. Disconnect through OpenCode credential settings.' };
          }
          if (!['user', 'project', 'custom', 'all'].includes(normalizedScope)) {
            return { id, type, success: false, error: 'Invalid scope' };
          }
          const scopes: Array<'user' | 'project' | 'custom'> = normalizedScope === 'all'
            ? ['user', 'project', 'custom'] : [normalizedScope as 'user' | 'project' | 'custom'];
          let removed = false;
          for (const target of scopes) {
            if (target === 'project' && !workingDirectory) continue;
            removed = v2Config.removeProviderConfig(providerId, workingDirectory, target) || removed;
          }
          return { id, type, success: true, data: { removed,
            ...buildAppliedResponse(removed ? 'Provider configuration removed. Credentials are managed separately by OpenCode.' : 'Provider was not configured.',
              { credentialsRemoved: false }) } };
        }
        let removed = false;
        if (normalizedScope === 'auth') {
          removed = removeProviderAuth(providerId);
        } else if (normalizedScope === 'user' || normalizedScope === 'project' || normalizedScope === 'custom') {
          removed = removeProviderConfig(providerId, workingDirectory, normalizedScope);
        } else if (normalizedScope === 'all') {
          const authRemoved = removeProviderAuth(providerId);
          const userRemoved = removeProviderConfig(providerId, workingDirectory, 'user');
          const projectRemoved = workingDirectory
            ? removeProviderConfig(providerId, workingDirectory, 'project')
            : false;
          const customRemoved = removeProviderConfig(providerId, workingDirectory, 'custom');
          removed = authRemoved || userRemoved || projectRemoved || customRemoved;
        } else {
          return { id, type, success: false, error: 'Invalid scope' };
        }

        return {
          id,
          type,
          success: true,
          data: {
            removed,
            ...(removed
              ? buildDeferredRestartResponse(`Provider ${providerId} disconnected successfully. Restart OpenCode to apply.`)
              : {
                success: true,
                requiresReload: false,
                message: `Provider ${providerId} was not configured.`,
              }),
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'api:provider/source:get': {
      const { providerId, directory } = (payload || {}) as { providerId?: string; directory?: string };
      if (!providerId) {
        return { id, type, success: false, error: 'Provider ID is required' };
      }
      try {
        const generation = await providerGeneration(ctx);
        const workingDirectory = typeof directory === 'string' && directory.trim().length > 0
          ? directory.trim()
          : ctx?.manager?.getWorkingDirectory();
        const sources = generation === 'oc2'
          ? v2Config.getProviderSources(providerId, workingDirectory)
          : getProviderSources(providerId, workingDirectory);
        const auth = generation === 'oc2' ? v2Auth.getProviderAuth(providerId) : getProviderAuth(providerId);
        sources.auth.exists = Boolean(auth);
        const config = generation === 'oc2' ? v2Config.getStoredProviderConfig(providerId, workingDirectory) : undefined;
        return { id, type, success: true, data: { providerId, sources, ...(config ? { config } : {}) } };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'api:provider:upsert': {
      const {
        providerID,
        providerId: providerIdAlias,
        config,
        scope,
        directory,
      } = (payload || {}) as {
        providerID?: string;
        providerId?: string;
        config?: unknown;
        scope?: string;
        directory?: string;
      };
      const providerId = (typeof providerID === 'string' && providerID.trim())
        || (typeof providerIdAlias === 'string' && providerIdAlias.trim())
        || '';
      if (!providerId) {
        return { id, type, success: false, error: 'Provider ID is required' };
      }
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return { id, type, success: false, error: 'Provider config is required' };
      }
      const normalizedScope = typeof scope === 'string' ? scope : 'user';
      if (normalizedScope !== 'user' && normalizedScope !== 'project' && normalizedScope !== 'custom') {
        return { id, type, success: false, error: 'Invalid scope' };
      }
      try {
        const generation = await providerGeneration(ctx);
        const workingDirectory = typeof directory === 'string' && directory.trim().length > 0
          ? directory.trim()
          : ctx?.manager?.getWorkingDirectory();
        const writeConfig = generation === 'oc2' ? v2Config.upsertProviderConfig : upsertProviderConfig;
        const storedAuth = generation === 'oc2' ? v2Auth.getProviderAuth(providerId) : getProviderAuth(providerId);
        const result = writeConfig(
          providerId,
          config,
          workingDirectory,
          normalizedScope,
          { hasStoredAuth: Boolean(storedAuth) },
        );
        if (generation === 'oc1') await ctx?.manager?.restart();
        return {
          id,
          type,
          success: true,
          data: {
            success: true,
            providerId: result.providerId,
            path: result.path,
            config: result.config,
            requiresReload: generation === 'oc1',
            ...(generation === 'oc1' ? { reloadDelayMs: deps.clientReloadDelayMs } : {}),
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'api:quota:providers': {
      try {
        const providers = listConfiguredQuotaProviders();
        return { id, type, success: true, data: { providers } };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'api:quota:credentials': {
      const { providerId, method, credential: input } = (payload || {}) as { providerId?: ManagedProvider; method?: string; credential?: unknown };
      try {
        if (!providerId || !['exe-dev', 'ollama-cloud', 'cursor'].includes(providerId)) return { id, type, success: false, error: 'Unsupported credential provider' };
        if (method === 'GET') return { id, type, success: true, data: credentialStatus(providerId) };
        if (method === 'DELETE') { deleteCredential(providerId); return { id, type, success: true, data: { configured: false } }; }
        if (method === 'IMPORT') {
          if (providerId !== 'cursor') return { id, type, success: false, error: 'Import unavailable' };
          const credential = importCursorCredential();
          await validateCredential(providerId, credential);
          return { id, type, success: true, data: writeCredential(providerId, credential) };
        }
        if (method === 'PUT') {
          const credential = normalizeCredential(providerId, input);
          if (!credential) return { id, type, success: false, error: 'Invalid credential' };
          await validateCredential(providerId, credential);
          return { id, type, success: true, data: writeCredential(providerId, credential) };
        }
        if (method === 'VALIDATE') {
          const credential = readCredential(providerId);
          if (!credential) return { id, type, success: false, error: 'Not configured' };
          await validateCredential(providerId, credential);
          return { id, type, success: true, data: { valid: true } };
        }
        return { id, type, success: false, error: 'Unsupported method' };
      } catch (error) {
        return { id, type, success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    case 'api:quota:get': {
      const { providerId } = (payload || {}) as { providerId?: string };
      if (!providerId) {
        return { id, type, success: false, error: 'Provider ID is required' };
      }
      try {
        const result = await fetchQuotaForProvider(providerId);
        return { id, type, success: true, data: result };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'api:workspace:addFolder': {
      try {
        // SAFETY: bridge payloads are untrusted JSON from the webview; the
        // cast only reads the optional path field, and non-string values fail
        // the emptiness check below (or throw inside the try, which the catch
        // converts into a clean failure response).
        const { path: targetPath } = (payload || {}) as { path?: string };
        if (!targetPath || targetPath.trim().length === 0) {
          return { id, type, success: false, error: 'Directory path is required' };
        }
        const folders = vscode.workspace.workspaceFolders ?? [];
        const uri = vscode.Uri.file(normalizeWindowsDriveLetter(targetPath.trim()));
        // `Uri.fsPath` lowercases the Windows drive letter again, so both sides
        // have to go through the shared comparison (see pathUtils).
        const alreadyAdded = folders.some(
          (folder) => pathsEqualWithNormalizedDriveLetter(folder.uri.fsPath, uri.fsPath),
        );
        if (!alreadyAdded) {
          const updated = await vscode.workspace.updateWorkspaceFolders(folders.length, null, { uri });
          if (!updated) {
            return { id, type, success: false, error: 'Failed to add workspace folder' };
          }
        }
        return {
          id,
          type,
          success: true,
          data: { workspaceFolders: resolveWorkspaceFolders(vscode.workspace.workspaceFolders ?? []) },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'vscode:command': {
      const { command, args } = (payload || {}) as { command?: string; args?: unknown[] };
      if (!command) {
        return { id, type, success: false, error: 'Command is required' };
      }
      try {
        const result = await vscode.commands.executeCommand(command, ...(args || []));
        return { id, type, success: true, data: { result } };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'vscode:openExternalUrl': {
      const { url } = (payload || {}) as { url?: string };
      const target = typeof url === 'string' ? url.trim() : '';
      if (!target) {
        return { id, type, success: false, error: 'URL is required' };
      }
      try {
        await vscode.env.openExternal(vscode.Uri.parse(target));
        return { id, type, success: true, data: { opened: true } };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    case 'vscode:openLocalPath': {
      const { path: localPath } = (payload || {}) as { path?: string };
      const target = typeof localPath === 'string' ? localPath.trim() : '';
      if (!target) {
        return { id, type, success: false, error: 'Path is required' };
      }
      try {
        const opened = await vscode.env.openExternal(vscode.Uri.file(target));
        return { id, type, success: true, data: { opened } };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: errorMessage };
      }
    }

    default:
      return null;
  }
}
