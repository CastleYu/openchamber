import type { Config as LegacyConfig, McpStatus as LegacyMcpStatus, Provider as LegacyProvider } from '@opencode-ai/sdk/v2';
import type { FormAnswer, FormInfo, PermissionRequest as V2PermissionRequest } from '@opencode/client';
import type { Config as V2Config, McpServerStatus, Message, Metadata, Model, ModelRef, Part, Provider as V2Provider, Session } from './model';
import type { PermissionRequest as LegacyPermissionRequest } from '@/types/permission';
import type { QuestionRequest } from '@/types/question';

/** Session and message results shared by both protocol adapters. */
export type SessionMessages = Array<{ info: Message; parts: Part[] }>;

export type SessionPatch = {
  title?: string;
  metadata?: Metadata;
  /** OC1 treats null archive time as no change; keep the old caller contract. */
  time?: { archived?: number | null };
};

export type SessionCreate = { parentID?: string; title?: string; metadata?: Metadata };

export type OperationScope = {
  directory?: string | null;
  signal?: AbortSignal;
};

/** Catalog values stay complete; the two default-model contracts differ. */
export type ProviderCatalog =
  | { generation: 'oc1'; providers: LegacyProvider[]; default: Record<string, string> }
  | { generation: 'oc2'; providers: V2Provider[]; models: Model[]; default?: ModelRef };

export type TaggedConfig =
  | { generation: 'oc1'; value: LegacyConfig }
  | { generation: 'oc2'; value: V2Config };

export type McpCatalog =
  | { generation: 'oc1'; value: Record<string, LegacyMcpStatus> }
  | { generation: 'oc2'; value: McpServerStatus[] };

export type BootstrapPath = {
  directory: string;
  projectID?: string;
  worktree?: string;
  home?: string;
  state?: string;
  config?: string;
};

export type PendingPermission =
  | { generation: 'oc1'; value: LegacyPermissionRequest }
  | { generation: 'oc2'; value: V2PermissionRequest };

export type PendingInput =
  | { generation: 'oc1'; kind: 'question'; value: QuestionRequest }
  | { generation: 'oc2'; kind: 'form'; value: FormInfo };

export type InputAnswer =
  | { generation: 'oc1'; kind: 'question'; request: QuestionRequest; answers: string[][] }
  | { generation: 'oc2'; kind: 'form'; request: FormInfo; answer: FormAnswer };

export interface SessionOperations {
  list(scope: OperationScope): Promise<Session[]>;
  create(input: SessionCreate | undefined, scope: OperationScope): Promise<Session>;
  get(id: string, scope: OperationScope): Promise<Session>;
  remove(id: string, scope: OperationScope): Promise<boolean>;
  update(id: string, patch: SessionPatch, scope: OperationScope): Promise<Session>;
  messages(id: string, limit: number | undefined, scope: OperationScope): Promise<SessionMessages>;
}
