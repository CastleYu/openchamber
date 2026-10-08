import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentAuthority } from './authority.js';
import { agentArtifactDigest } from './artifacts.js';
import { AGENT_ERROR, AGENT_FAMILY, AGENT_OPERATION, AGENT_SUPPORT, AGENT_SERVER_METHOD } from './constants.js';
import { createAgentDispatcher } from './dispatcher.js';
import { AgentAdapterError, loadAgentAdapter } from './loader.js';

const profile = Object.freeze({ adapterID: 'synthetic-api', family: AGENT_FAMILY.CAGENT,
  adapterRevision: 'adapter-v1', capabilityRevision: 'capability-v1' });
const identity = Object.freeze({ family: AGENT_FAMILY.CAGENT, connectionID: 'connection-1', epoch: 3,
  adapterRevision: profile.adapterRevision, capabilityRevision: profile.capabilityRevision });
const operation = AGENT_OPERATION.GET_SESSION;
const session = Object.freeze({ id: 'session-1', workspaceID: 'workspace-1', title: 'Synthetic' });
const support = Object.freeze({ state: AGENT_SUPPORT.SUPPORTED, evidence: ['syntheticAPI'] });
const handlerBody = `async (input, identity) => {
  const response = await context.request({ method: 'GET', path: '/sessions', query: { id: input.sessionID } }, identity);
  return response.body;
}`;
const adapterSource = (body = handlerBody, additions = '') => `
${additions}
export function createAdapter(context) {
  return { capabilities: { '${operation}': { state: 'supported', evidence: ['syntheticAPI'] } },
    handlers: { '${operation}': ${body} } };
}
`;

const cases = [];
const globals = [];
const makeArtifact = async (source, entries = {}) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-agent-loader-'));
  cases.push(directory);
  const files = { 'adapter.mjs': source, ...entries };
  const records = [];
  for (const [name, content] of Object.entries(files)) {
    const bytes = Buffer.from(content);
    const target = path.join(directory, ...name.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    records.push({ path: name, bytes: bytes.length, digest: createHash('sha256').update(bytes).digest('hex') });
  }
  const manifest = { version: 1, files: records, artifactDigest: agentArtifactDigest(records) };
  return { directory, manifest };
};
const load = (artifact, transport = { request: vi.fn(async () => ({ status: 200, body: session })) }, details = {}) =>
  loadAgentAdapter({ ...artifact, profile, transport, ...details });

afterEach(async () => {
  for (const marker of globals.splice(0)) delete globalThis[marker];
  for (const directory of cases.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe('loadAgentAdapter', () => {
  it('loads verified source from a data URL and freezes a profile-owned registration', async () => {
    const artifact = await makeArtifact(adapterSource());
    const transport = { request: vi.fn(async () => ({ status: 200, body: session })) };
    const registration = await load(artifact, transport);
    expect(registration).toMatchObject({ ...profile, artifactDigest: artifact.manifest.artifactDigest,
      capabilities: { [operation]: support } });
    expect(Object.isFrozen(registration)).toBe(true);
    expect(Object.isFrozen(registration.capabilities[operation])).toBe(true);
    expect(Object.isFrozen(registration.capabilities[operation].evidence)).toBe(true);
    expect(Object.isFrozen(registration.handlers)).toBe(true);
    expect(Object.keys(registration)).toEqual(['adapterID', 'family', 'adapterRevision', 'capabilityRevision',
      'artifactDigest', 'capabilities', 'handlers']);
    expect(registration.handlers[operation]).toBeTypeOf('function');
  });

  it('rejects missing entry, invalid digests, and unlisted files before module evaluation', async () => {
    const marker = `__agent_loader_${randomUUID().replaceAll('-', '')}`;
    const source = `globalThis.${marker} = true; ${adapterSource()}`;
    const missing = await makeArtifact(source);
    await fs.rm(path.join(missing.directory, 'adapter.mjs'));
    await expect(load(missing)).rejects.toMatchObject({ code: AGENT_ERROR.ARTIFACT_UNAVAILABLE });
    const wrongDigest = await makeArtifact(source);
    wrongDigest.manifest.artifactDigest = '0'.repeat(64);
    await expect(load(wrongDigest)).rejects.toMatchObject({ code: AGENT_ERROR.ARTIFACT_MISMATCH });
    const extra = await makeArtifact(source);
    await fs.writeFile(path.join(extra.directory, 'unexpected.txt'), 'extra');
    await expect(load(extra)).rejects.toMatchObject({ code: AGENT_ERROR.ARTIFACT_BOUNDARY });
    expect(Object.hasOwn(globalThis, marker)).toBe(false);
  });

  it('pins import to captured bytes if the reviewed source changes after capture', async () => {
    const artifact = await makeArtifact(adapterSource());
    const { readAgentAdapterArtifact } = await import('./artifacts.js');
    const snapshot = await readAgentAdapterArtifact(artifact);
    await fs.writeFile(path.join(artifact.directory, 'adapter.mjs'), 'throw new Error("changed source");');
    const { createAdapter } = await import(snapshot.moduleURL);
    expect(createAdapter).toBeTypeOf('function');
  });

  it('normalizes broken module exports, factories, handlers, support, and extra fields', async () => {
    const secret = 'do-not-leak-this-secret';
    const invalid = [
      'export const unrelated = true;',
      `export function createAdapter() { throw new Error('${secret}'); }`,
      `export function createAdapter() { return { capabilities: { '${operation}': { state: 'supported', evidence: ['syntheticAPI'] } }, handlers: { '${operation}': null } }; }`,
      adapterSource().replace("state: 'supported'", "state: 'not-supported'"),
      adapterSource(handlerBody).replace("evidence: ['syntheticAPI']", "evidence: ['syntheticAPI'], extra: 'x'"),
      `export function createAdapter() { return { capabilities: { '${operation}': { state: 'supported', evidence: ['syntheticAPI'] } }, handlers: { '${operation}': ${handlerBody}, extra: () => null } }; }`,
    ];
    for (const [index, source] of invalid.entries()) {
      const error = await load(await makeArtifact(source)).catch((value) => value);
      expect(error, `invalid fixture ${index}`).toBeInstanceOf(AgentAdapterError);
      expect(error.code).toBe(AGENT_ERROR.ADAPTER_FAILED);
      expect(error.message).not.toContain(secret);
    }
  });

  it('freezes request context, validates JSON requests and identity, and isolates transports', async () => {
    const marker = `__agent_context_${randomUUID().replaceAll('-', '')}`;
    globals.push(marker);
    const frozenContextSource = `export function createAdapter(context) {
      globalThis.${marker} = Object.isFrozen(context);
      return { capabilities: { '${operation}': { state: 'supported', evidence: ['syntheticAPI'] } },
        handlers: { '${operation}': async (input, scope) => {
      await context.request({ method: 'POST', path: '/sessions', query: { mode: 'new' }, body: { title: 'synthetic' } }, scope);
      return ${JSON.stringify(session)};
    } } };
    }`;
    const artifact = await makeArtifact(frozenContextSource);
    const first = { request: vi.fn(async () => ({ status: 201, body: null })) };
    const second = { request: vi.fn(async () => ({ status: 202, body: null })) };
    const [one, two] = await Promise.all([load(artifact, first), load(artifact, second)]);
    expect(await one.handlers[operation]({ workspaceID: 'w', sessionID: 's' }, identity)).toEqual(session);
    expect(await two.handlers[operation]({ workspaceID: 'w', sessionID: 's' }, identity)).toEqual(session);
    expect(first.request).toHaveBeenCalledWith({ method: AGENT_SERVER_METHOD.POST, path: '/sessions', query: { mode: 'new' }, body: { title: 'synthetic' } }, identity);
    expect(first.request).toHaveBeenCalledTimes(1);
    expect(second.request).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(one.handlers)).toBe(true);
    expect(globalThis[marker]).toBe(true);
  });

  it('rejects malformed endpoint requests, identity mismatches, and malformed transport responses', async () => {
    const invalidRequests = [
        { method: 'GET', path: 'https://host/sessions' }, { method: 'GET', path: '//host/sessions' },
        { method: 'GET', path: '/sessions', auth: 'secret' }, { method: 'GET', path: '/sessions', query: { x: 1 } },
        { method: 'GET', path: '/sessions', body: undefined, extra: true },
        { method: 'GET', path: '/sessions?secret=x' }, { method: 'GET', path: '/sessions#fragment' },
        { method: 'GET', path: '/sessions\\child' }, { method: 'HEAD', path: '/sessions' },
    ];
    const transport = { request: vi.fn(async () => ({ status: 200, body: session })) };
    for (const request of invalidRequests) {
      const source = adapterSource(`async (_input, scope) => {
        await context.request(${JSON.stringify(request)}, scope); return ${JSON.stringify(session)};
      }`);
      const registration = await load(await makeArtifact(source), transport);
      await expect(registration.handlers[operation]({ workspaceID: 'w', sessionID: 's' }, identity))
        .rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
    }
    expect(transport.request).not.toHaveBeenCalled();

    const needsIdentity = await load(await makeArtifact(adapterSource(`async () => {
      await context.request({ method: 'GET', path: '/sessions' }); return ${JSON.stringify(session)};
    }`)), transport);
    await expect(needsIdentity.handlers[operation]({ workspaceID: 'w', sessionID: 's' }, identity)).rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
    for (const changed of [{ family: AGENT_FAMILY.OPENCODE }, { adapterRevision: 'other' }, { capabilityRevision: 'other' }]) {
      const scope = { ...identity, ...changed };
      const simple = await load(await makeArtifact(adapterSource()), transport);
      await expect(simple.handlers[operation]({ workspaceID: 'w', sessionID: 's' }, scope)).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    }
    const badResponse = await load(await makeArtifact(adapterSource()), { request: vi.fn(async () => ({ status: 200, body: undefined })) });
    await expect(badResponse.handlers[operation]({ workspaceID: 'w', sessionID: 's' }, identity)).rejects.toMatchObject({ code: AGENT_ERROR.INVALID_RESPONSE });
  });

  it('dispatches only after independent host approval and carries parsed identity to transport', async () => {
    const artifact = await makeArtifact(adapterSource());
    const transport = { request: vi.fn(async () => ({ status: 200, body: session })) };
    const registration = await load(artifact, transport);
    const selection = { ...identity, adapterID: profile.adapterID, serverRevision: 'server-v1', ready: true, authorized: true };
    let approved = false;
    const authority = createAgentAuthority({ registrations: [registration], getSelection: () => selection,
      getAcceptance: () => approved ? ({ family: profile.family, connectionID: identity.connectionID,
        adapterID: profile.adapterID, adapterRevision: profile.adapterRevision,
        capabilityRevision: profile.capabilityRevision, serverRevision: selection.serverRevision,
        artifactDigest: registration.artifactDigest, operations: [{ operation, evidence: ['host-approved synthetic API'] }] }) : null });
    const dispatcher = createAgentDispatcher({ getBinding: authority.getBinding });
    await expect(dispatcher.dispatch(operation, { workspaceID: 'workspace-1', sessionID: 'session-1' }))
      .rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
    expect(transport.request).not.toHaveBeenCalled();
    approved = true;
    const result = await dispatcher.dispatch(operation, { workspaceID: 'workspace-1', sessionID: 'session-1' });
    expect(result).toEqual({ identity, data: session });
    expect(transport.request).toHaveBeenCalledWith({ method: 'GET', path: '/sessions', query: { id: 'session-1' } }, identity);
  });
});
