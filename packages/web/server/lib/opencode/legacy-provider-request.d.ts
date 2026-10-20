import type { OpenCodeGenerationDescriptor } from './compatibility.js';
import type { LegacyProviderRuntime } from './legacy-provider-runtime.js';
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export { LEGACY_PROVIDER_ROUTE } from './legacy-provider-routes.js';
export declare function createLegacyProviderRequest(input: { api: LegacyProviderRuntime; getRuntime: () => OpenCodeGenerationDescriptor }): (request: { method: string; path: string; body?: JsonValue; caller: string | null; signal?: AbortSignal }) => Promise<{ status: number; body: JsonValue }>;

