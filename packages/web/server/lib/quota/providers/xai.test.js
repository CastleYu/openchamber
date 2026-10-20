import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureOpenCodeCredentials } from '../../opencode/auth.js';
import { fetchQuota } from './xai.js';

const legacyRuntime = {
  generation: 'oc1',
  profile: 'legacy-1.2.27',
  version: '1.2.27',
  endpoint: 'http://127.0.0.1:4096',
  epoch: 1,
};

afterEach(() => {
  configureOpenCodeCredentials(() => ({ generation: 'oc1' }), null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('xAI OAuth refresh with Legacy credentials', () => {
  it('rejects before requesting or writing a rotated refresh token', async () => {
    const auth = { xai: { type: 'oauth', access: 'expired', refresh: 'refresh-token', expires: 1 } };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const write = vi.spyOn(fs, 'writeFileSync');
    configureOpenCodeCredentials(() => legacyRuntime, null, { read: async () => auth });

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Legacy credential access');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
