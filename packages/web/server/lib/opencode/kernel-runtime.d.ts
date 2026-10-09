import type { OpenCodeGenerationDescriptor, OpenCodeSelection, OpenCodeProfileAdmission, detectOpenCodeProfile, detectOpenCodeGeneration } from './compatibility.js';
import type { AgentBackendSelection } from '../agent/host.js';

export class KernelRuntimeChangedError extends Error {}

export function createKernelRuntime(dependencies: {
  getEndpoint: () => string | null;
  getHeaders: () => HeadersInit;
  headersForGeneration?: (generation: 'oc1' | 'oc2') => HeadersInit;
  getBackendSelection?: () => AgentBackendSelection;
  getRequestedSelection?: () => OpenCodeSelection | null;
  detectProfile?: typeof detectOpenCodeProfile;
  detect?: typeof detectOpenCodeGeneration;
  onChange?: (descriptor: Readonly<OpenCodeGenerationDescriptor>) => void;
}): {
  get(): Readonly<OpenCodeGenerationDescriptor>;
  getAdmission(): OpenCodeProfileAdmission | null;
  refresh(): Promise<Readonly<OpenCodeGenerationDescriptor>>;
  reprobe(): Promise<{
    descriptor: Readonly<OpenCodeGenerationDescriptor>;
    generation: OpenCodeGenerationDescriptor['generation'];
    preserved: boolean;
  }>;
  invalidate(): void;
};
