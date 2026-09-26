export function createSessionStorageScopes(options: { dataDir: string }): {
  directory(scope: string): Promise<string>;
  ownerPath: string;
};
