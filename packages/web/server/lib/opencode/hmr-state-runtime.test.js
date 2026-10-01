import { describe, expect, it } from 'vitest';

import { createHmrStateRuntime } from './hmr-state-runtime.js';

const createRuntime = (env = {}) => createHmrStateRuntime({
  globalThisLike: {},
  os: { homedir: () => '/Users/example' },
  processLike: { env },
  stateKey: '__testHmrState',
});

describe('hmr state runtime', () => {
  it('keeps the OC1 password and applies OC2 password precedence separately', () => {
    const runtime = createRuntime({ OPENCODE_PASSWORD: 'current-secret', OPENCODE_SERVER_PASSWORD: 'legacy-secret' });
    const state = runtime.getOrCreateHmrState();
    runtime.ensureUserProvidedOpenCodePassword(state);
    expect(runtime.getUserProvidedOpenCodePassword(state, 'oc1')).toBe('legacy-secret');
    expect(runtime.getUserProvidedOpenCodePassword(state, 'oc2')).toBe('current-secret');
  });
  it('uses configured OpenCode cwd when provided', () => {
    const runtime = createRuntime({ OPENCHAMBER_OPENCODE_CWD: '/tmp/openchamber-data' });

    expect(runtime.getOrCreateHmrState().openCodeWorkingDirectory).toBe('/tmp/openchamber-data');
  });

  it('falls back to home directory without configured OpenCode cwd', () => {
    const runtime = createRuntime();

    expect(runtime.getOrCreateHmrState().openCodeWorkingDirectory).toBe('/Users/example');
  });
});
