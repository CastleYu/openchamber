export type SessionMetadata = { [key: string]: unknown };
export type MetadataIdentity = { generation: 'oc2'; endpoint: string; epoch: string | number };
export type OpenCodeSessionMetadata = {
  captureIdentity(): MetadataIdentity;
  read(sessionID: string, options?: { directory?: string }): Promise<SessionMetadata | null>;
  write(sessionID: string, patch: SessionMetadata, options?: { directory?: string; expectedIdentity?: MetadataIdentity }): Promise<unknown>;
  writeLegacy(sessionID: string, metadata: SessionMetadata, options?: { directory?: string; expectedIdentity?: MetadataIdentity }): Promise<unknown>;
};
export type SessionMetadataStore = {
  get(sessionID: string, options?: { directory?: string }): Promise<SessionMetadata>;
  ensureMigrated(sessionID: string, options?: { directory?: string; expectedIdentity?: MetadataIdentity }): Promise<void>;
  setSessionMetadata(sessionID: string, patch: SessionMetadata, options?: { directory?: string }): Promise<SessionMetadata>;
  listUnmigrated(): Promise<Record<string, SessionMetadata>>;
};
export function createSessionMetadataStore(options: { dataDir: string; openCode: OpenCodeSessionMetadata; now?: () => number }): SessionMetadataStore;
