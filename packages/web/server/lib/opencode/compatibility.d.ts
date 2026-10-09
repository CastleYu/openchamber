export const OPENCODE_GENERATION: Readonly<{
  OC1: 'oc1';
  OC2: 'oc2';
  UNSUPPORTED: 'unsupported';
  UNREACHABLE: 'unreachable';
  UNKNOWN: 'unknown';
}>;

export const MINIMUM_OPENCODE_V2_VERSION: '2.0.15';

export type OpenCodeGeneration = typeof OPENCODE_GENERATION[keyof typeof OPENCODE_GENERATION];

export type OpenCodeProfile = 'oc1' | 'oc2' | 'legacy-1.2.27';

export interface OpenCodeGenerationDescriptor {
  profile?: OpenCodeProfile;
  generation: OpenCodeGeneration;
  endpoint: string | null;
  epoch: string | number;
  version: string | null;
}

export function isSupportedOpenCodeVersion(version: string): boolean;
export function supportsCredentialApi(version: string | null | undefined): boolean;
export function readOpenCodeInfo(response: Response): Promise<{ version: string } | null>;
export function detectOpenCodeGeneration(options: {
  endpoint: string;
  epoch: string | number;
  headers?: HeadersInit;
  headersForGeneration?: (generation: 'oc1' | 'oc2') => HeadersInit;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<OpenCodeGenerationDescriptor>;

export const OPENCODE_PROFILE: Readonly<{ OC1: 'oc1'; OC2: 'oc2'; LEGACY: 'legacy-1.2.27' }>;
export const OPENCODE_SELECTION: Readonly<{ AUTO: 'auto'; OC1: 'oc1'; OC2: 'oc2'; LEGACY: 'legacy-1.2.27' }>;
export const PROFILE_STATUS: Readonly<{
  READY: 'ready'; AUTH: 'auth'; UNREACHABLE: 'unreachable'; CONFLICT: 'conflict';
  MISMATCH: 'mismatch'; UNSUPPORTED: 'unsupported'; UNVERIFIED: 'unverified';
  INVALID_ENDPOINT: 'invalid-endpoint'; INVALID_SELECTION: 'invalid-selection';
}>;
export type OpenCodeSelection = typeof OPENCODE_SELECTION[keyof typeof OPENCODE_SELECTION];
export type OpenCodeProfileAdmission =
  | { status: 'ready'; selection: OpenCodeSelection; descriptor: OpenCodeGenerationDescriptor & { profile: OpenCodeProfile }; provenance: 'server' | 'user-declared'; exactVersion: boolean }
  | { status: 'invalid-selection' }
  | { status: Exclude<typeof PROFILE_STATUS[keyof typeof PROFILE_STATUS], 'ready' | 'invalid-selection'>; selection: OpenCodeSelection; descriptor: OpenCodeGenerationDescriptor };
export function detectOpenCodeProfile(options: Parameters<typeof detectOpenCodeGeneration>[0] & { selection: OpenCodeSelection }): Promise<OpenCodeProfileAdmission>;

export const OPENCODE_SETTING: Readonly<{ SELECTION: 'opencodeSelection' }>;
export function isOpenCodeSelection(value: unknown): value is OpenCodeSelection;
