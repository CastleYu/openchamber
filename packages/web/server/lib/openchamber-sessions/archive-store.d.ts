export type ArchiveEntries = Record<string, number | null>;
export type ArchiveStore = {
  getAll(): Promise<ArchiveEntries>;
  list(): Promise<ArchiveEntries>;
  archive(ids: string[], archivedAt?: number | null, guard?: () => void): Promise<{ archived: Array<{ id: string; archivedAt: number }>; failedIds: string[] }>;
  unarchive(ids: string[], guard?: () => void): Promise<{ restored: Array<{ id: string; archivedAt: null }>; failedIds: string[] }>;
};
export function createArchiveStore(options: { dataDir: string; now?: () => number }): ArchiveStore;
