import type {
  Command as LegacyCommand, Message as LegacyMessage, Part as LegacyPart,
  Session as LegacySession, SessionCommandResponse, OpencodeClient,
} from '@opencode-ai/sdk/v2';
import type {
  CommandInfo, SessionCommandInput, SessionInfo, SessionInterruptResponse,
  SessionMessageInfo, SessionPromptInput, SessionSyntheticInput, SessionSwitchModelInput,
} from '@opencode/client';
import type { OpenCodeGenerationDescriptor } from './compatibility.js';

export type KernelGeneration = 'oc1' | 'oc2';
export type KernelIdentity = { generation: KernelGeneration; endpoint: string; epoch: string | number };
export type KernelResult<T> = KernelIdentity & { data: T };
export type LegacyMessageRecord = { info: LegacyMessage; parts: LegacyPart[] };

export type SessionView = {
  id: string;
  title?: string;
  directory: string;
  parentID?: string;
  revert?: LegacySession['revert'] | SessionInfo['revert'];
  metadata?: LegacySession['metadata'] | SessionInfo['metadata'];
  time?: LegacySession['time'] | SessionInfo['time'];
  raw: LegacySession | SessionInfo;
};

export type MessageView = {
  id: string;
  role: LegacyMessage['role'] | SessionMessageInfo['type'];
  text?: string;
  created?: number;
  completed?: number;
  finish?: string;
  error?: Extract<LegacyMessage, { role: 'assistant' }>['error'] | Extract<SessionMessageInfo, { type: 'assistant' }>['error'];
  summary?: boolean;
  tokens?: Extract<LegacyMessage, { role: 'assistant' }>['tokens'] | Extract<SessionMessageInfo, { type: 'assistant' }>['tokens'];
  parentID?: string;
  model?: { providerID: string; modelID: string } | SessionInfo['model'];
  tools: Array<{ id: string; name: string; status: string; raw: LegacyPart | Extract<SessionMessageInfo, { type: 'assistant' }>['content'][number] }>;
  raw: LegacyMessageRecord | SessionMessageInfo;
};

export type MessagePage = {
  items: MessageView[];
  raw: LegacyMessageRecord[] | SessionMessageInfo[];
  order: 'asc' | 'desc';
  cursor?: { previous?: string | null; next?: string | null };
};

export type SessionPage = {
  items: SessionView[];
  raw: LegacySession[] | SessionInfo[];
  cursor?: { previous?: string | number | null; next?: string | number | null };
};

export type LegacySend = KernelIdentity & {
  generation: 'oc1';
  body: Omit<Parameters<OpencodeClient['session']['promptAsync']>[0], 'sessionID' | 'directory'>;
};
export type CurrentSend = KernelIdentity & {
  generation: 'oc2';
  body: Omit<SessionPromptInput, 'sessionID'>;
  model?: SessionSwitchModelInput['model'];
  agent?: string;
  synthetics?: Array<Omit<SessionSyntheticInput, 'sessionID'>>;
  postSynthetics?: Array<Omit<SessionSyntheticInput, 'sessionID'>>;
};
export type LegacyCommandSend = KernelIdentity & {
  generation: 'oc1';
  body: Omit<Parameters<OpencodeClient['session']['command']>[0], 'sessionID' | 'directory'>;
};
export type CurrentCommandSend = KernelIdentity & {
  generation: 'oc2';
  body: Omit<SessionCommandInput, 'sessionID'>;
  model?: SessionSwitchModelInput['model'];
  agent?: string;
  synthetics?: Array<Omit<SessionSyntheticInput, 'sessionID'>>;
};

export function createKernelOperations(dependencies: {
  getRuntime: () => OpenCodeGenerationDescriptor;
  getHeaders: () => HeadersInit;
  fetchImpl?: typeof fetch;
  prepareSession?: (input: { sessionID: string; directory?: string; identity: KernelIdentity }) => Promise<void>;
}): {
  captureIdentity(): KernelIdentity;
  getSession(input: { sessionID: string; directory?: string; signal?: AbortSignal }): Promise<KernelResult<SessionView>>;
  createSession(input: { directory: string; title?: string; parentID?: string; agent?: string; model?: SessionInfo['model']; metadata?: LegacySession['metadata']; signal?: AbortSignal; expectedIdentity?: KernelIdentity }): Promise<KernelResult<SessionView>>;
  listSessions(input?: { directory?: string; limit?: number; cursor?: string | number; search?: string; signal?: AbortSignal }): Promise<KernelResult<SessionPage>>;
  listMessages(input: { sessionID: string; directory?: string; limit?: number; cursor?: string; order?: 'asc' | 'desc'; signal?: AbortSignal }): Promise<KernelResult<MessagePage>>;
  listChildren(input: { sessionID: string; directory?: string; signal?: AbortSignal }): Promise<KernelResult<SessionView[]>>;
  listActiveStatuses(input?: { directory?: string; signal?: AbortSignal }): Promise<KernelResult<{ [sessionID: string]: { type: 'busy' | 'retry' | 'idle' } }>>;
  getSessionStatus(input: { sessionID: string; directory?: string; signal?: AbortSignal }): Promise<KernelResult<{ type: 'busy' | 'retry' | 'idle' }>>;
  listPendingPermissions(input?: { directory?: string; signal?: AbortSignal }): Promise<KernelResult<Array<{ id: string; sessionID: string; directory?: string }>>>;
  replyPermission(input: { requestID: string; sessionID: string; directory?: string; decision?: 'once' | 'always' | 'reject'; signal?: AbortSignal; expectedIdentity?: KernelIdentity }): Promise<KernelResult<boolean | void>>;
  getMessage(input: { sessionID: string; messageID: string; directory?: string; signal?: AbortSignal }): Promise<KernelResult<LegacyMessageRecord | SessionMessageInfo>>;
  addSynthetic(input: { sessionID: string; directory?: string; text: string; resume?: boolean; signal?: AbortSignal; expectedIdentity?: KernelIdentity }): Promise<KernelResult<SessionMessageInfo>>;
  switchSessionSelection(input: { sessionID: string; directory?: string; model?: SessionSwitchModelInput['model']; agent?: string; signal?: AbortSignal; expectedIdentity?: KernelIdentity }): Promise<KernelResult<boolean>>;
  listCommands(input?: { directory?: string; signal?: AbortSignal }): Promise<KernelResult<Array<LegacyCommand | CommandInfo>>>;
  getSelectionCatalog(input?: { directory?: string; signal?: AbortSignal }): Promise<KernelResult<
    | { generation: 'oc1'; providers: Array<{ id: string; models?: unknown }>; agents: Array<{ name: string; mode?: string; hidden?: boolean; model?: unknown; variant?: string }>; config: { default_agent?: string; defaultAgent?: string; model?: string } }
    | { generation: 'oc2'; models: Array<{ providerID: string; modelID: string; variants?: Array<{ id: string }> }>; agents: Array<{ id: string; name?: string; mode?: string; hidden?: boolean; model?: { providerID: string; id: string; variant?: string } }>; config: Array<{ info?: { default_agent?: string; model?: string | { providerID: string; model: string } } }> }
  >>;
  forkSession(input: { sessionID: string; directory?: string; messageID?: string; signal?: AbortSignal; expectedIdentity?: KernelIdentity }): Promise<KernelResult<SessionView>>;
  removeSession(input: { sessionID: string; directory?: string; signal?: AbortSignal; expectedIdentity?: KernelIdentity }): Promise<KernelResult<boolean>>;
  updateSession(input: { sessionID: string; directory?: string; title?: string; metadata?: LegacySession['metadata']; replaceMetadata?: boolean; time?: { archived: number }; signal?: AbortSignal; expectedIdentity?: KernelIdentity }): Promise<KernelResult<LegacySession | void>>;
  sendPrompt(input: { sessionID: string; directory?: string; request: LegacySend | CurrentSend; signal?: AbortSignal }): Promise<KernelResult<import('@opencode/client').SessionInboxUser | null> & { accepted: true }>;
  sendCommand(input: { sessionID: string; directory?: string; request: LegacyCommandSend | CurrentCommandSend; signal?: AbortSignal }): Promise<KernelResult<SessionCommandResponse | null> & { accepted: true }>;
  interruptSession(input: { sessionID: string; directory?: string; signal?: AbortSignal }): Promise<KernelResult<boolean | SessionInterruptResponse>>;
};
