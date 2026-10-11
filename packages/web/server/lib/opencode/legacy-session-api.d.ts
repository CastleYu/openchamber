import type { JSONType } from 'zod/v4/core';
import type { OpenCodeGenerationDescriptor } from './compatibility.js';
import type { createKernelOperations } from './kernel-operations.js';
import type { LegacyMetadataStore } from '../openchamber-sessions/legacy-metadata-store.js';

type LegacySessionPayload = JSONType;

// SDK wire payloads are parsed inside this boundary. Hosts only serialize the result.
export function createLegacySessionApi(options: {
  getRuntime: () => OpenCodeGenerationDescriptor;
  operations: Pick<ReturnType<typeof createKernelOperations>, 'createSession' | 'updateSession' | 'removeSession'>;
  metadataStore: LegacyMetadataStore;
  getStorageScope: () => string;
}): {
  accepts(method: string, route: string): boolean;
  overlay(payload: LegacySessionPayload, identity: OpenCodeGenerationDescriptor): Promise<LegacySessionPayload>;
  request(input: { method: string; route: string; body: LegacySessionPayload | undefined; query: { [key: string]: string | string[] }; directory?: string; signal?: AbortSignal }): Promise<{ status: number; body: LegacySessionPayload }>;
};
