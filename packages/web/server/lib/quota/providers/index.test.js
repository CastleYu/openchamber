import { describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({ readOpenCodeCredentials: async () => ({}) }));

import * as google from './google/index.js';
import { fetchQuotaForProvider, listConfiguredQuotaProviders } from './index.js';

describe('quota provider registry', () => {
  it('exposes google provider configuration helpers through the provider module', () => {
    expect(google.providerId).toBe('google');
    expect(google.providerName).toBe('Google');
    expect(typeof google.isConfigured).toBe('function');
    expect(typeof google.resolveGoogleAuthSources).toBe('function');
  });

  it('can list configured providers without missing provider exports', async () => {
    await expect(listConfiguredQuotaProviders()).resolves.toBeInstanceOf(Array);
  });

  it('coalesces concurrent refreshes by provider ID', async () => {
    const first = fetchQuotaForProvider('unsupported-test-provider');
    const second = fetchQuotaForProvider('unsupported-test-provider');

    expect(first).toBe(second);
    await first;
    expect(fetchQuotaForProvider('unsupported-test-provider')).not.toBe(first);
  });

  it('does not coalesce quota reads across runtime epochs or generations', async () => {
    const oc1 = fetchQuotaForProvider('unsupported-test-provider', { generation: 'oc1', endpoint: 'local', epoch: 1 });
    const oc2 = fetchQuotaForProvider('unsupported-test-provider', { generation: 'oc2', endpoint: 'local', epoch: 1 });
    const next = fetchQuotaForProvider('unsupported-test-provider', { generation: 'oc2', endpoint: 'local', epoch: 2 });
    expect(oc1).not.toBe(oc2);
    expect(oc2).not.toBe(next);
    await Promise.all([oc1, oc2, next]);
  });
});
