import * as fs from 'node:fs';
import * as path from 'node:path';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import type { OpenCodeManager } from './opencode';
import { resolveKernelRequest } from './kernelRequest';
import * as gitService from './gitService';
import { chooseBridgeGitGenerationModel, type BridgeGitGenerationPayloadModel } from './bridge-git-generation-model';
import type { BridgeContext, BridgeResponse } from './bridge';

type BridgeMessageInput = {
  id: string;
  type: string;
  payload?: unknown;
};

type ExecGitResult = { stdout: string; stderr: string; exitCode: number };

type SpecialGitDeps = {
  readSettings: (ctx?: BridgeContext) => Record<string, unknown>;
  execGit: (args: string[], cwd: string) => Promise<ExecGitResult>;
};

const BRIDGE_GIT_GENERATION_TIMEOUT_MS = 2 * 60 * 1000;
const BRIDGE_GIT_GENERATION_POLL_INTERVAL_MS = 500;
const BRIDGE_GIT_MODEL_CATALOG_CACHE_TTL_MS = 30 * 1000;

let bridgeGitModelCatalogCache: Set<string> | null = null;
let bridgeGitModelCatalogCacheAt = 0;
let bridgeGitModelCatalogIdentity = '';

const sleep = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

type BridgeSdkResult<T> = {
  data?: T;
  error?: unknown;
  response?: { status?: number };
};

const formatBridgeSdkError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const unwrapBridgeSdkData = <T,>(result: BridgeSdkResult<T>, operation: string): T => {
  if (result.error) {
    const status = result.response?.status;
    throw new Error(`${operation} failed${status ? ` (${status})` : ''}: ${formatBridgeSdkError(result.error)}`);
  }
  if (result.data === undefined || result.data === null) {
    throw new Error(`${operation} failed: empty response`);
  }
  return result.data;
};

const assertBridgeSdkSuccess = (result: BridgeSdkResult<unknown>, operation: string): void => {
  if (result.error) {
    const status = result.response?.status;
    throw new Error(`${operation} failed${status ? ` (${status})` : ''}: ${formatBridgeSdkError(result.error)}`);
  }
};

const createBridgeGitClient = (apiUrl: string, authHeaders?: Record<string, string>) => createOpencodeClient({
  baseUrl: apiUrl.replace(/\/+$/, ''),
  headers: authHeaders || {},
});

const fetchBridgeGitModelCatalog = async (
  manager: OpenCodeManager,
): Promise<Set<string>> => {
  const selected = await resolveKernelRequest(manager, '/model');
  const identity = `${selected.descriptor.generation}:${selected.descriptor.endpoint}:${selected.descriptor.epoch}`;
  const now = Date.now();
  if (bridgeGitModelCatalogCache && identity === bridgeGitModelCatalogIdentity && now - bridgeGitModelCatalogCacheAt < BRIDGE_GIT_MODEL_CATALOG_CACHE_TTL_MS) {
    return bridgeGitModelCatalogCache;
  }

  let payload: Array<{ providerID: string; id: string }>;
  if (selected.descriptor.generation === 'oc2') {
    const { OpenCode } = await import('@opencode/client');
    const apiUrl = manager.getApiUrl();
    if (!apiUrl) throw new Error('OpenCode API unavailable');
    const result = await OpenCode.make({ baseUrl: apiUrl, headers: manager.getOpenCodeAuthHeaders() }).model.list(undefined, { signal: AbortSignal.timeout(8_000) });
    payload = result.data;
  } else {
    const apiUrl = manager.getApiUrl();
    if (!apiUrl) throw new Error('OpenCode API unavailable');
    payload = unwrapBridgeSdkData(await createBridgeGitClient(apiUrl, manager.getOpenCodeAuthHeaders()).v2.model.list(undefined, { signal: AbortSignal.timeout(8_000) }), 'model.list').data;
  }
  selected.assertCurrent();
  const refs = new Set<string>();
  for (const item of payload) {
    const providerID = item.providerID.trim();
    const modelID = item.id.trim();
    if (providerID && modelID) {
      refs.add(`${providerID}/${modelID}`);
    }
  }

  bridgeGitModelCatalogCache = refs;
  bridgeGitModelCatalogCacheAt = now;
  bridgeGitModelCatalogIdentity = identity;
  return refs;
};

const resolveBridgeGitGenerationModel = async (
  payloadModel: BridgeGitGenerationPayloadModel,
  settings: Record<string, unknown>,
  manager: OpenCodeManager,
): Promise<{ providerID: string; modelID: string }> => {
  let catalog: Set<string> | null = null;
  try {
    catalog = await fetchBridgeGitModelCatalog(manager);
  } catch {
    catalog = null;
  }

  const hasModel = (providerID: string, modelID: string): boolean => {
    if (!catalog) {
      return false;
    }
    return catalog.has(`${providerID}/${modelID}`);
  };

  return chooseBridgeGitGenerationModel(payloadModel, settings, hasModel);
};

const extractTextFromMessageParts = (parts: unknown): string => {
  if (!Array.isArray(parts)) {
    return '';
  }

  const textParts = parts
    .filter((part) => {
      if (!part || typeof part !== 'object') return false;
      const record = part as Record<string, unknown>;
      return record.type === 'text' && typeof record.text === 'string';
    })
    .map((part) => (part as Record<string, unknown>).text as string)
    .map((text) => text.trim())
    .filter((text) => text.length > 0);

  return textParts.join('\n').trim();
};

const generateBridgeTextWithSessionFlow = async ({
  apiUrl,
  directory,
  prompt,
  providerID,
  modelID,
  authHeaders,
  check,
}: {
  apiUrl: string;
  directory: string;
  prompt: string;
  providerID: string;
  modelID: string;
  authHeaders?: Record<string, string>;
  check: () => void;
}): Promise<string> => {
  const client = createBridgeGitClient(apiUrl, authHeaders);
  const deadlineAt = Date.now() + BRIDGE_GIT_GENERATION_TIMEOUT_MS;
  const remainingMs = () => Math.max(1_000, deadlineAt - Date.now());
  let sessionId: string | null = null;

  try {
    check();
    const session = unwrapBridgeSdkData(
      await client.session.create({
        ...(directory ? { directory } : {}),
        title: 'Git Generation',
      }, { signal: AbortSignal.timeout(remainingMs()) }),
      'session.create'
    );
    check();
    const sessionObj = session && typeof session === 'object' ? session as Record<string, unknown> : null;
    const createdSessionId = sessionObj && typeof sessionObj.id === 'string' ? sessionObj.id : '';
    if (!createdSessionId) {
      throw new Error('Invalid session response');
    }
    sessionId = createdSessionId;

    assertBridgeSdkSuccess(
      await client.session.promptAsync({
        sessionID: sessionId,
        ...(directory ? { directory } : {}),
        model: {
          providerID,
          modelID,
        },
        parts: [{ type: 'text', text: prompt }],
      }, { signal: AbortSignal.timeout(remainingMs()) }),
      'session.promptAsync'
    );
    check();

    while (Date.now() < deadlineAt) {
      await sleep(BRIDGE_GIT_GENERATION_POLL_INTERVAL_MS);
      check();

      const messagesResponse = await client.session.messages({
        sessionID: sessionId,
        ...(directory ? { directory } : {}),
        limit: 10,
      }, { signal: AbortSignal.timeout(remainingMs()) });
      check();

      if (messagesResponse.error) {
        continue;
      }

      const messages = messagesResponse.data;
      if (!Array.isArray(messages)) {
        continue;
      }

      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i] as Record<string, unknown> | null;
        if (!message || typeof message !== 'object') {
          continue;
        }
        const info = message.info as Record<string, unknown> | undefined;
        if (info?.role !== 'assistant' || info?.finish !== 'stop') {
          continue;
        }

        const text = extractTextFromMessageParts(message.parts);
        if (text) {
          return text;
        }
      }
    }

    throw new Error('Timeout waiting for generation to complete');
  } finally {
    if (sessionId) {
      try {
        check();
        await client.session.delete({ sessionID: sessionId }, { signal: AbortSignal.timeout(5_000) });
      } catch {
        // ignore cleanup failures
      }
    }
  }
};

const generateV2Text = async (manager: OpenCodeManager, prompt: string, providerID: string, modelID: string): Promise<string> => {
  const selected = await resolveKernelRequest(manager, '/experimental/generate');
  if (selected.descriptor.generation !== 'oc2') throw new Error('OpenCode 2 is not active');
  const apiUrl = manager.getApiUrl();
  if (!apiUrl) throw new Error('OpenCode API unavailable');
  const { OpenCode } = await import('@opencode/client');
  const result = await OpenCode.make({ baseUrl: apiUrl, headers: manager.getOpenCodeAuthHeaders() }).generate.text(
    { prompt, model: { id: modelID, providerID } },
    { signal: AbortSignal.timeout(BRIDGE_GIT_GENERATION_TIMEOUT_MS) },
  );
  selected.assertCurrent();
  return result.text.trim();
};

const parseJsonObjectSafe = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

export async function handleSpecialGitBridgeMessage(
  message: BridgeMessageInput,
  ctx: BridgeContext | undefined,
  deps: SpecialGitDeps,
): Promise<BridgeResponse | null> {
  const { id, type, payload } = message;

  switch (type) {
    case 'api:git/pr-description': {
      const { directory, base, head, context, providerId, modelId, zenModel: payloadZenModel } = (payload || {}) as {
        directory?: string;
        base?: string;
        head?: string;
        context?: string;
        providerId?: string;
        modelId?: string;
        zenModel?: string;
      };
      if (!directory) {
        return { id, type, success: false, error: 'Directory is required' };
      }
      if (!base || !head) {
        return { id, type, success: false, error: 'base and head are required' };
      }

      let files: string[] = [];
      try {
        const listed = await gitService.getGitRangeFiles(directory, base, head);
        files = Array.isArray(listed) ? listed : [];
      } catch {
        files = [];
      }

      if (files.length === 0) {
        return { id, type, success: false, error: 'No diffs available for base...head' };
      }

      let diffSummaries = '';
      for (const file of files) {
        try {
          const diff = await gitService.getGitRangeDiff(directory, base, head, file, 3);
          const raw = typeof diff?.diff === 'string' ? diff.diff : '';
          if (!raw.trim()) continue;
          diffSummaries += `FILE: ${file}\n${raw}\n\n`;
        } catch {
          // ignore
        }
      }

      if (!diffSummaries.trim()) {
        return { id, type, success: false, error: 'No diffs available for selected files' };
      }

      const prompt = `You are drafting a GitHub Pull Request title + description. Respond in JSON of the shape {"title": string, "body": string} (ONLY JSON in response, no markdown fences) with these rules:\n- title: concise, sentence case, <= 80 chars, no trailing punctuation, no commit-style prefixes (no "feat:", "fix:")\n- body: GitHub-flavored markdown with these sections in this order: Summary, Testing, Notes\n- Summary: 3-6 bullet points describing user-visible changes; avoid internal helper function names\n- Testing: bullet list ("- Not tested" allowed)\n- Notes: bullet list; include breaking/rollout notes only when relevant\n\nContext:\n- base branch: ${base}\n- head branch: ${head}${context?.trim() ? `\n- Additional context: ${context.trim()}` : ''}\n\nDiff summary:\n${diffSummaries}`;

      try {
        const manager = ctx?.manager;
        const apiUrl = manager?.getApiUrl();
        if (!apiUrl || !manager) {
          return { id, type, success: false, error: 'OpenCode API unavailable' };
        }

        const selected = await resolveKernelRequest(manager, '/model');

        const settings = deps.readSettings(ctx) as Record<string, unknown>;
        const { providerID, modelID } = await resolveBridgeGitGenerationModel(
          { providerId, modelId, zenModel: payloadZenModel },
          settings,
          manager,
        );
        selected.assertCurrent();
        const raw = selected.descriptor.generation === 'oc2'
          ? await generateV2Text(manager, prompt, providerID, modelID)
          : await generateBridgeTextWithSessionFlow({ apiUrl, directory, prompt, providerID, modelID, authHeaders: manager.getOpenCodeAuthHeaders(), check: selected.assertCurrent });
        selected.assertCurrent();
        if (!raw) {
          return { id, type, success: false, error: 'No PR description returned by generator' };
        }

        const cleaned = String(raw)
          .trim()
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();

        const parsed = parseJsonObjectSafe(cleaned) || parseJsonObjectSafe(raw);
        if (parsed) {
          const title = typeof parsed.title === 'string' ? parsed.title : '';
          const body = typeof parsed.body === 'string' ? parsed.body : '';
          return { id, type, success: true, data: { title, body } };
        }

        return { id, type, success: true, data: { title: '', body: String(raw) } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: message };
      }
    }

    case 'api:git/conflict-details': {
      const { directory } = (payload || {}) as { directory?: string };
      if (!directory) {
        return { id, type, success: false, error: 'Directory is required' };
      }

      try {
        const statusResult = await deps.execGit(['status', '--porcelain'], directory);
        const statusPorcelain = statusResult.stdout;

        const unmergedResult = await deps.execGit(['diff', '--name-only', '--diff-filter=U'], directory);
        const unmergedFiles = unmergedResult.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);

        const diffResult = await deps.execGit(['diff'], directory);
        const diff = diffResult.stdout;

        let operation: 'merge' | 'rebase' = 'merge';
        let headInfo = '';

        const mergeHeadResult = await deps.execGit(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], directory);
        const mergeHeadExists = mergeHeadResult.exitCode === 0;

        if (mergeHeadExists) {
          operation = 'merge';
          const mergeHead = mergeHeadResult.stdout.trim();
          let mergeMsg = '';
          try {
            const mergeMsgPath = path.join(directory, '.git', 'MERGE_MSG');
            mergeMsg = await fs.promises.readFile(mergeMsgPath, 'utf8');
          } catch {
            // MERGE_MSG may not exist
          }
          headInfo = `MERGE_HEAD: ${mergeHead}${mergeMsg ? '\n' + mergeMsg : ''}`;
        } else {
          const rebaseHeadResult = await deps.execGit(['rev-parse', '--verify', '--quiet', 'REBASE_HEAD'], directory);
          const rebaseHeadExists = rebaseHeadResult.exitCode === 0;

          if (rebaseHeadExists) {
            operation = 'rebase';
            const rebaseHead = rebaseHeadResult.stdout.trim();
            headInfo = `REBASE_HEAD: ${rebaseHead}`;
          }
        }

        return {
          id,
          type,
          success: true,
          data: {
            statusPorcelain: statusPorcelain.trim(),
            unmergedFiles,
            diff: diff.trim(),
            headInfo: headInfo.trim(),
            operation,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { id, type, success: false, error: message };
      }
    }

    default:
      return null;
  }
}
