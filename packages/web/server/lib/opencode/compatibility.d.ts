export const OPENCODE_GENERATION: Readonly<{
  OC1: 'oc1';
  OC2: 'oc2';
  UNSUPPORTED: 'unsupported';
  UNREACHABLE: 'unreachable';
  UNKNOWN: 'unknown';
}>;

export const MINIMUM_OPENCODE_V2_VERSION: '2.0.15';

export type OpenCodeGeneration = typeof OPENCODE_GENERATION[keyof typeof OPENCODE_GENERATION];

export interface OpenCodeGenerationDescriptor {
  generation: OpenCodeGeneration;
  endpoint: string | null;
  epoch: string | number;
  version: string | null;
}

export function isSupportedOpenCodeVersion(version: string): boolean;
export function readOpenCodeInfo(response: Response): Promise<{ version: string } | null>;
export function detectOpenCodeGeneration(options: {
  endpoint: string;
  epoch: string | number;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<OpenCodeGenerationDescriptor>;
