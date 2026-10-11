import type { Session } from '@opencode-ai/sdk/v2';

export type LegacySessionMetadata = NonNullable<Session['metadata']>;
export type LegacyMetadataStore = {
  read(scope: string, sessionID: string): Promise<LegacySessionMetadata>;
  patch(
    scope: string,
    sessionID: string,
    metadata: LegacySessionMetadata,
    options?: { replace?: boolean; check?: () => void },
  ): Promise<LegacySessionMetadata>;
};

export function createLegacyMetadataStore(options: {
  dataDir: string;
  fsPromises?: typeof import('node:fs').promises;
  pathModule?: typeof import('node:path');
}): LegacyMetadataStore;
