import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKernelRequest } from './kernelRequest';
import { OPENCODE_PROFILE } from '../../web/server/lib/opencode/compatibility.js';
import type { OpenCodeGenerationDescriptor } from '../../web/server/lib/opencode/compatibility.js';

function fixture(generation: OpenCodeGenerationDescriptor['generation'], endpoint = 'http://localhost:4096') {
  let descriptor: OpenCodeGenerationDescriptor = { generation, endpoint, epoch: 1, version: generation === 'oc1' ? '1.18.32' : '2.0.16' };
  const manager: Parameters<typeof resolveKernelRequest>[0] = {
    getStatus: () => 'connected',
    getApiUrl: () => endpoint,
    getKernelRuntime: () => descriptor,
    refreshKernelRuntime: async () => descriptor,
    onStatusChange: () => ({ dispose() {} }),
  };
  return { manager, rebind: () => { descriptor = { ...descriptor, epoch: 2 }; },
    setProfile: (profile: OpenCodeGenerationDescriptor['profile']) => { descriptor = { ...descriptor, profile }; },
  };
}

describe('VS Code kernel forwarding', () => {
  test('refuses unaccepted Legacy read, mutation and SSE forwarding', async () => {
    const { manager, setProfile } = fixture('oc1');
    setProfile(OPENCODE_PROFILE.LEGACY);
    for (const path of ['/session', '/session/s/message', '/event', '/global/event', '/provider/p/oauth/callback']) {
      await assert.rejects(resolveKernelRequest(manager, path), /operations are not yet accepted/);
    }
  });
  test('rejects completion when only the profile changes', async () => {
    const { manager, setProfile } = fixture('oc1');
    setProfile(OPENCODE_PROFILE.OC1);
    const selected = await resolveKernelRequest(manager, '/session');
    setProfile(OPENCODE_PROFILE.LEGACY);
    assert.throws(selected.assertCurrent, /connection changed/);
  });
  test('keeps OC1 paths and mounted base paths', async () => {
    const { manager } = fixture('oc1', 'http://localhost:4096/mount/api');
    const selected = await resolveKernelRequest(manager, '/api/session?directory=%2Frepo');
    assert.equal(selected.url, 'http://localhost:4096/mount/api/session?directory=%2Frepo');
  });
  test('adds exactly one OC2 API prefix and maps its event endpoint', async () => {
    const { manager } = fixture('oc2');
    assert.equal((await resolveKernelRequest(manager, '/session')).url, 'http://localhost:4096/api/session');
    assert.equal((await resolveKernelRequest(manager, '/api/session')).url, 'http://localhost:4096/api/session');
    assert.equal((await resolveKernelRequest(manager, '/global/event')).url, 'http://localhost:4096/api/event');
  });
  test('rejects late results after same-generation restart', async () => {
    const { manager, rebind } = fixture('oc2');
    const selected = await resolveKernelRequest(manager, '/session');
    rebind();
    assert.throws(selected.assertCurrent, /connection changed/);
  });
  test('does not forward through an unknown kernel', async () => {
    const { manager } = fixture('unknown');
    await assert.rejects(resolveKernelRequest(manager, '/session'), /not ready/);
  });
});
