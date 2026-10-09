export const OPEN_CODE_GENERATION = {
  OC1: 'oc1',
  OC2: 'oc2',
  UNSUPPORTED: 'unsupported',
  UNREACHABLE: 'unreachable',
  UNKNOWN: 'unknown',
} as const;

export type OpenCodeGeneration = typeof OPEN_CODE_GENERATION[keyof typeof OPEN_CODE_GENERATION];

export const OPEN_CODE_PROFILE = {
  OC1: OPEN_CODE_GENERATION.OC1,
  OC2: OPEN_CODE_GENERATION.OC2,
  LEGACY: 'legacy-1.2.27',
} as const;

export const OPEN_CODE_SELECTION = { AUTO: 'auto', ...OPEN_CODE_PROFILE } as const;
export const OPEN_CODE_SETTING = { SELECTION: 'opencodeSelection' } as const;

export type OpenCodeProfile = typeof OPEN_CODE_PROFILE[keyof typeof OPEN_CODE_PROFILE];

export type OpenCodeRuntime = Readonly<{
  profile?: OpenCodeProfile;
  generation: OpenCodeGeneration;
  endpoint: string | null;
  epoch: string | number;
  version: string | null;
}>;

export class OpenCodeRuntimeError extends Error {
  constructor(readonly generation: OpenCodeGeneration, readonly operation: string) {
    super(`OpenCode ${generation} does not support ${operation} in this client`);
    this.name = 'OpenCodeRuntimeError';
  }
}

export class OpenCodeRuntimeChangedError extends Error {
  constructor() {
    super('OpenCode runtime changed before the request completed');
    this.name = 'OpenCodeRuntimeChangedError';
  }
}

/** One binding belongs to one service instance, not to the process. */
export class OpenCodeRuntimeBinding {
  private current: OpenCodeRuntime | null = null;
  private revision = 0;

  get(): OpenCodeRuntime | null {
    return this.current;
  }

  set(runtime: OpenCodeRuntime): void {
    if (!runtime.endpoint) throw new OpenCodeRuntimeError(runtime.generation, 'endpoint binding');
    if (this.current?.endpoint === runtime.endpoint
      && this.current.epoch === runtime.epoch
      && this.current.generation === runtime.generation
      && this.current.version === runtime.version
      && this.current.profile === runtime.profile) return;
    this.current = Object.freeze({ ...runtime });
    this.revision += 1;
  }

  clear(): void {
    this.current = null;
    this.revision += 1;
  }

  assert(generation: 'oc1' | 'oc2', operation: string): void {
    if (!this.current) throw new OpenCodeRuntimeError('unknown', operation);
    if (this.current && this.current.generation !== generation) {
      throw new OpenCodeRuntimeError(this.current.generation, operation);
    }
  }

  async run<T>(generation: 'oc1' | 'oc2', operation: string, fn: () => Promise<T>): Promise<T> {
    this.assert(generation, operation);
    const revision = this.revision;
    const value = await fn();
    if (revision !== this.revision) throw new OpenCodeRuntimeChangedError();
    return value;
  }
}
