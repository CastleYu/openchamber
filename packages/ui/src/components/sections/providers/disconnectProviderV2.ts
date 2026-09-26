import type { IntegrationInfo } from '@opencode/client';
import { findIntegrationForProvider } from './providerAuthV2';

export type DisconnectProviderOperations = {
  removeCredential(id: string): Promise<void>;
  removeConfig(): Promise<boolean>;
  listIntegrations(): Promise<IntegrationInfo[]>;
};

/** Remove OpenCode-owned logins before removing OpenChamber-owned configuration. */
export async function disconnectProviderV2(
  providerID: string,
  integrations: IntegrationInfo[],
  operations: DisconnectProviderOperations,
): Promise<void> {
  const connection = findIntegrationForProvider(integrations, providerID);
  if (connection?.connections.some((item) => item.type === 'env')) {
    throw new Error('An environment-provided connection cannot be removed here.');
  }
  let removedCredential = false;
  for (const credential of connection?.connections ?? []) {
    if (credential.type === 'credential') {
      await operations.removeCredential(credential.id);
      removedCredential = true;
    }
  }
  const removedConfig = await operations.removeConfig();
  if (!removedCredential && !removedConfig) throw new Error('No provider connection was removed.');
  const updated = findIntegrationForProvider(await operations.listIntegrations(), providerID);
  if (updated?.connections.length) {
    throw new Error('The provider still has an active connection.');
  }
}
