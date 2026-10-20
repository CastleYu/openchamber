import type { OpenCodeRuntime } from '@/lib/opencode/runtime';
import { OPEN_CODE_PROFILE } from '@/lib/opencode/runtime';
import type { LegacyProviderMethods } from '@/lib/opencode/legacy-providers';

export const isLegacyProviderRuntime = (runtime: OpenCodeRuntime | null): boolean =>
  runtime?.generation === 'oc1' && runtime.profile === OPEN_CODE_PROFILE.LEGACY && runtime.version === '1.2.27';

export const supportsLegacyMethod = (method: LegacyProviderMethods[string][number]): boolean =>
  method.prompts === undefined || method.prompts.length === 0;

export const resolveProvidersPageMode = (runtime: OpenCodeRuntime | null): 'oc2' | 'legacy' | 'oc1' | 'none' => {
  if (runtime?.generation === 'oc2') return 'oc2';
  if (isLegacyProviderRuntime(runtime)) return 'legacy';
  if (runtime?.generation === 'oc1') return 'oc1';
  return 'none';
};

