import { describe, expect, it } from 'vitest';
import { createOpenCodeAuthStateRuntime } from './auth-state-runtime.js';

const setup = () => {
  let password = 'legacy-fixture';
  const runtime = createOpenCodeAuthStateRuntime({
    process: { env: { OPENCODE_SERVER_USERNAME: 'legacy-user' } },
    getAuthPassword: () => password,
    setAuthPassword: (value) => { password = value; },
    getAuthSource: () => 'user-env',
    setAuthSource: () => {},
    getUserProvidedPassword: (generation) => generation === 'oc2' ? 'current-fixture' : 'legacy-fixture',
    syncToHmrState: () => {},
  });
  return runtime;
};

describe('generation-specific OpenCode credentials', () => {
  it('retains the OC1 custom username and uses the OC2 fixed username', () => {
    const runtime = setup();
    expect(runtime.getOpenCodeAuthHeaders('oc1')).toEqual({ Authorization: `Basic ${Buffer.from('legacy-user:legacy-fixture').toString('base64')}` });
    expect(runtime.getOpenCodeAuthHeaders('oc2')).toEqual({ Authorization: `Basic ${Buffer.from('opencode:current-fixture').toString('base64')}` });
  });

  it('selects the launch generation before a managed runtime has been discovered', async () => {
    const runtime = setup();
    expect(await runtime.ensureLocalOpenCodeServerPassword({ generation: 'oc2', rotateManaged: true })).toBe('current-fixture');
    expect(await runtime.ensureLocalOpenCodeServerPassword({ generation: 'oc1', rotateManaged: true })).toBe('legacy-fixture');
  });
});
