import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKernelRequest } from './kernelRequest';
import { OPENCODE_PROFILE } from '../../web/server/lib/opencode/compatibility.js';
import type { OpenCodeGenerationDescriptor } from '../../web/server/lib/opencode/compatibility.js';

function fixture(generation: OpenCodeGenerationDescriptor['generation'], endpoint = 'http://localhost:4096') {
  let descriptor: OpenCodeGenerationDescriptor = { generation, endpoint, epoch: 1, version: generation === 'oc1' ? '1.18.32' : '2.0.16' };
  let connected = true;
  const manager: Parameters<typeof resolveKernelRequest>[0] = {
    getStatus: () => connected ? 'connected' : 'error',
    getApiUrl: () => endpoint,
    getKernelRuntime: () => descriptor,
    refreshKernelRuntime: async () => descriptor,
    onStatusChange: (listener) => { listener(connected ? 'connected' : 'error'); return { dispose() {} }; },
  };
  return { manager, rebind: () => { descriptor = { ...descriptor, epoch: 2 }; },
    setProfile: (profile: OpenCodeGenerationDescriptor['profile']) => { descriptor = { ...descriptor, profile }; },
    setVersion: (version: string) => { descriptor = { ...descriptor, version }; },
    setStatus: (next: boolean) => { connected = next; },
  };
}

describe('VS Code kernel forwarding', () => {
  test('admits only allowlisted Legacy GET bootstrap and session routes', async () => {
    const { manager, setProfile, setVersion } = fixture('oc1');
    setProfile(OPENCODE_PROFILE.LEGACY);
    setVersion('1.2.27');
    for (const path of ['/api/session', '/session/status', '/provider', '/permission', '/question', '/session/s1', '/session/s1/message', '/session/s1/message/m1', '/session/s1/children']) {
      assert.equal((await resolveKernelRequest(manager, path)).url, `http://localhost:4096${path.replace(/^\/api/, '')}`);
    }
  });
  test('admits only allowlisted Legacy POST prompt, abort and replies', async () => {
    const { manager, setProfile, setVersion } = fixture('oc1');
    setProfile(OPENCODE_PROFILE.LEGACY);
    setVersion('1.2.27');
    for (const path of ['/session/s1/prompt_async', '/session/s1/abort', '/permission/p1/reply', '/question/q1/reply', '/question/q1/reject']) {
      assert.equal((await resolveKernelRequest(manager, path, 'POST')).url, `http://localhost:4096${path}`);
    }
  });
  test('rejects wrong methods and advanced Legacy routes', async () => {
    const { manager, setProfile, setVersion } = fixture('oc1');
    setProfile(OPENCODE_PROFILE.LEGACY);
    setVersion('1.2.27');
    for (const [path, method] of [
      ['/permission/p1/reply', 'GET'], ['/session/s1/prompt_async', 'GET'], ['/session', 'POST'],
      ['/model', 'GET'], ['/experimental/generate', 'POST'], ['/provider/p/oauth/callback', 'GET'],
    ]) {
      await assert.rejects(resolveKernelRequest(manager, path, method), /request is not supported/);
    }
  });
  test('admits only the exact Legacy GET event streams', async () => {
    const { manager, setProfile, setVersion } = fixture('oc1');
    setProfile(OPENCODE_PROFILE.LEGACY);
    setVersion('1.2.27');
    assert.equal((await resolveKernelRequest(manager, '/event')).url, 'http://localhost:4096/event');
    assert.equal((await resolveKernelRequest(manager, '/api/global/event')).url, 'http://localhost:4096/global/event');
    await assert.rejects(resolveKernelRequest(manager, '/event', 'POST'), /request is not supported/);
  });
  test('rejects unverified Legacy versions and disconnected status', async () => {
    const wrongVersion = fixture('oc1');
    wrongVersion.setProfile(OPENCODE_PROFILE.LEGACY);
    wrongVersion.setVersion('1.2.28');
    await assert.rejects(resolveKernelRequest(wrongVersion.manager, '/session'), /request is not supported/);
    const disconnected = fixture('oc1');
    disconnected.setProfile(OPENCODE_PROFILE.LEGACY);
    disconnected.setVersion('1.2.27');
    disconnected.setStatus(false);
    await assert.rejects(resolveKernelRequest(disconnected.manager, '/session'), /API URL not available/);
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
  test('rejects late results after verified version identity changes', async () => {
    const { manager, setVersion } = fixture('oc1');
    const selected = await resolveKernelRequest(manager, '/session');
    setVersion('1.2.27');
    assert.throws(selected.assertCurrent, /connection changed/);
  });
  test('does not forward through an unknown kernel', async () => {
    const { manager } = fixture('unknown');
    await assert.rejects(resolveKernelRequest(manager, '/session'), /not ready/);
  });
});

describe('VS Code Legacy MCP forwarding', () => {
  test('forwards finite MCP paths and retires a captured request on epoch change', async () => {
    const { manager, setProfile, setVersion, rebind } = fixture('oc1');
    setProfile(OPENCODE_PROFILE.LEGACY); setVersion('1.2.27');
    for (const [route, method] of [['/mcp?directory=%2Frepo', 'GET'], ['/mcp/probe/connect', 'POST'], ['/mcp/probe/disconnect', 'POST']]) {
      const request = await resolveKernelRequest(manager, '/api' + route, method);
      assert.equal(request.url, 'http://localhost:4096' + route);
      request.assertCurrent();
    }
    const captured = await resolveKernelRequest(manager, '/mcp');
    rebind(); assert.throws(captured.assertCurrent, /connection changed/);
    for (const [route, method] of [['/mcp', 'POST'], ['/mcp/probe/auth', 'POST'], ['/mcp/probe/connect', 'GET']]) {
      await assert.rejects(resolveKernelRequest(manager, route, method), /request is not supported/);
    }
  });
});
