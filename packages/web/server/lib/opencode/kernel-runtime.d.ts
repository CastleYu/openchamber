import type { OpenCodeGenerationDescriptor, detectOpenCodeGeneration } from './compatibility.js';

export class KernelRuntimeChangedError extends Error {}

export function createKernelRuntime(dependencies: {
  getEndpoint: () => string | null;
  getHeaders: () => HeadersInit;
  detect?: typeof detectOpenCodeGeneration;
  onChange?: (descriptor: Readonly<OpenCodeGenerationDescriptor>) => void;
}): {
  get(): Readonly<OpenCodeGenerationDescriptor>;
  refresh(): Promise<Readonly<OpenCodeGenerationDescriptor>>;
  invalidate(): void;
};
