import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_ATTEMPT, AGENT_ERROR, AGENT_FAMILY, AGENT_OPERATION, AGENT_SUPPORT } from './constants.js';
import { createAgentAttempts } from './attempts.js';
import { agentArtifactDigest } from './artifacts.js';
import { createAgentApprovals } from './approvals.js';
import { createAgentApprovalWriter } from './approval-writer.js';
import { AgentDispatchError } from './dispatcher.js';
import { createAgentHost } from './host.js';
import { createKernelRuntime, KernelRuntimeChangedError } from '../opencode/kernel-runtime.js';

const roots = new Set();
const servers = new Set();
const sockets = new Map();
const operation = AGENT_OPERATION.GET_SESSION;
const profile = Object.freeze({ adapterID: 'host-test', family: AGENT_FAMILY.CAGENT,
  adapterRevision: 'adapter-r1', capabilityRevision: 'capability-r1' });
const session = Object.freeze({ id: 's1', workspaceID: 'w1', title: 'Host test' });
const source = (gate = '') => `${gate}\nexport function createAdapter(context) {
  return { capabilities: { '${operation}': { state: 'supported', evidence: ['fixture'] } },
    handlers: { '${operation}': async (input, identity) => {
      const response = await context.request({ method: 'GET', path: '/sessions/' + input.sessionID,
        query: { workspace: input.workspaceID } }, identity);
      return response.body;
    } } };
}`;
const connection = (url, overrides = {}) => ({ connectionID: 'conn-1', serverRevision: 'server-r1',
  baseURL: url, headers: { Authorization: 'Bearer host-secret', 'X-Host': 'host-header' },
  ready: true, authorized: true, ...overrides });
const filesFor = (text) => {
  const bytes = Buffer.from(text);
  const files = [{ path: 'adapter.mjs', bytes: bytes.length, digest: createHash('sha256').update(bytes).digest('hex') }];
  return { files, manifest: { version: 1, files, artifactDigest: agentArtifactDigest(files) } };
};
const artifact = async (text = source()) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'oc-agent-host-'));
  roots.add(directory);
  const descriptor = filesFor(text);
  await fsp.writeFile(path.join(directory, 'adapter.mjs'), text);
  return { directory, ...descriptor };
};
const start = async (handler) => {
  const server = http.createServer(handler);
  servers.add(server);
  const connected = new Set();
  sockets.set(server, connected);
  server.on('connection', (socket) => {
    connected.add(socket);
    socket.on('close', () => connected.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}/`;
};
const approvalFor = (identity, digest, overrides = {}) => ({
  family: profile.family, connectionID: identity.connectionID, adapterID: profile.adapterID,
  adapterRevision: profile.adapterRevision, capabilityRevision: profile.capabilityRevision,
  serverRevision: 'server-r1', artifactDigest: digest,
  operations: [{ operation, evidence: ['host-reviewed fixture'] }], ...overrides,
});
const makeHost = (getAcceptance = () => null) => createAgentHost({ getAcceptance });
const select = (host, item, conn) => host.select({ ...item, profile, connection: conn });

afterEach(async () => {
  await Promise.all([...servers].map((server) => new Promise((resolve) => {
    for (const socket of sockets.get(server) || []) socket.destroy();
    server.close(resolve);
  })));
  sockets.clear();
  servers.clear();
  await Promise.all([...roots].map((directory) => fsp.rm(directory, { recursive: true, force: true })));
  roots.clear();
});

describe('createAgentHost', () => {
  it('loads an unverified artifact and dispatches only while its persisted live review remains exact', async () => {
    const item = await artifact(source().replace("state: 'supported'", "state: 'unverified'"));
    let calls = 0;
    const url = await start((_request, response) => {
      calls += 1;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(session));
    });
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'oc-agent-host-review-'));
    roots.add(directory);
    const store = createAgentApprovals({ directory });
    const writer = createAgentApprovalWriter({ directory });
    const host = makeHost(store.read);
    const identity = await select(host, item, connection(url));
    const input = { workspaceID: 'w1', sessionID: 's1' };
    await expect(host.dispatcher.dispatch(operation, input, identity)).rejects.toMatchObject({ code: AGENT_ERROR.UNVERIFIED });
    writer.write(approvalFor(identity, item.manifest.artifactDigest));
    await expect(host.dispatcher.dispatch(operation, input, identity)).rejects.toMatchObject({ code: AGENT_ERROR.UNVERIFIED });
    expect(calls).toBe(0);
    writer.write(approvalFor(identity, item.manifest.artifactDigest, { operations: [
      { operation, state: AGENT_SUPPORT.ADAPTED, evidence: ['independent-live-review:r1'] },
    ] }));
    expect((await host.dispatcher.dispatch(operation, input, identity)).data).toEqual(session);
    expect(calls).toBe(1);
    writer.revoke({ family: profile.family, connectionID: identity.connectionID });
    await expect(host.dispatcher.dispatch(operation, input, identity)).rejects.toMatchObject({ code: AGENT_ERROR.UNVERIFIED });
    expect(calls).toBe(1);
  });

  it('preserves entered mutation uncertainty across selection cancellation and refuses replay after reselection', async () => {
    const effect = AGENT_OPERATION.SEND_PROMPT;
    const item = await artifact(`export function createAdapter(context) {
      return { capabilities: { '${effect}': { state: 'supported', evidence: ['fixture'] } },
        handlers: { '${effect}': async (input, identity) => {
          await context.request({ method: 'POST', path: '/effect', body: input }, identity);
        } } };
    }`);
    let enter;
    let calls = 0;
    const entered = new Promise((resolve) => { enter = resolve; });
    const url = await start(() => { calls += 1; enter(); });
    const ledger = await fsp.mkdtemp(path.join(os.tmpdir(), 'oc-agent-host-ledger-'));
    roots.add(ledger);
    const attempts = createAgentAttempts({ directory: ledger });
    const host = createAgentHost({ attempts, getAcceptance: (selection) => approvalFor(selection,
      item.manifest.artifactDigest, { operations: [{ operation: effect, evidence: ['host-reviewed fixture'] }] }) });
    const first = await select(host, item, connection(url));
    const input = { workspaceID: 'w1', sessionID: 's1', requestID: 'selection-mutation', text: 'hello' };
    const pending = host.dispatcher.dispatch(effect, input, first);
    const refused = expect(pending).rejects.toMatchObject({ code: AGENT_ERROR.UNKNOWN_OUTCOME });
    await entered;
    host.selectOpenCode();
    await refused;
    expect((await attempts.read(first, input.requestID)).state).toBe(AGENT_ATTEMPT.UNKNOWN);
    const next = await select(host, item, connection(url));
    await expect(host.dispatcher.dispatch(effect, input, next)).rejects.toMatchObject({ code: AGENT_ERROR.ATTEMPT_EXISTS });
    expect(calls).toBe(1);
  });

  it('keeps OpenCode detection disabled after a failed CAgent selection until OpenCode is selected', async () => {
    let detections = 0;
    const host = makeHost();
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}),
      getBackendSelection: host.getSelection,
      detect: async ({ endpoint, epoch }) => {
        detections += 1;
        return { generation: 'oc1', endpoint, epoch, version: '1.18.32' };
      },
    });
    const item = await artifact('export const unrelated = true;');

    expect((await runtime.refresh()).generation).toBe('oc1');
    await expect(select(host, item, connection('http://127.0.0.1/'))).rejects.toBeDefined();
    expect(host.getSelection()).toMatchObject({ family: AGENT_FAMILY.CAGENT });
    expect(runtime.get()).toMatchObject({ generation: 'unsupported', endpoint: null });
    expect((await runtime.refresh()).generation).toBe('unsupported');
    expect((await runtime.reprobe()).generation).toBe('unsupported');
    host.clear();
    expect(host.getSelection()).toMatchObject({ family: AGENT_FAMILY.CAGENT });
    expect(runtime.get()).toMatchObject({ generation: 'unsupported', endpoint: null });
    expect(detections).toBe(1);

    host.selectOpenCode();
    expect(runtime.get()).toMatchObject({ generation: 'unknown', endpoint: null });
    expect((await runtime.refresh()).generation).toBe('oc1');
    expect(detections).toBe(2);
  });

  it('rejects an OpenCode probe that finishes after failed CAgent selection', async () => {
    let finish;
    const host = makeHost();
    const runtime = createKernelRuntime({
      getEndpoint: () => 'http://127.0.0.1:4096', getHeaders: () => ({}),
      getBackendSelection: host.getSelection,
      detect: (input) => new Promise((resolve) => {
        finish = () => resolve({ generation: 'oc1', endpoint: input.endpoint, epoch: input.epoch, version: '1.18.32' });
      }),
    });
    const item = await artifact('export const unrelated = true;');
    const pending = runtime.refresh();
    await Promise.resolve();
    const selection = select(host, item, connection('http://127.0.0.1/'));
    await expect(selection).rejects.toBeDefined();
    finish();

    await expect(pending).rejects.toBeInstanceOf(KernelRuntimeChangedError);
    expect(runtime.get()).toMatchObject({ generation: 'unsupported', endpoint: null });
  });

  it('owns an explicit family choice through failed loads and clear until OpenCode is selected', async () => {
    const host = makeHost();
    const initial = host.getSelection();
    expect(initial).toEqual({ family: 'opencode', revision: 0 });
    expect(Object.isFrozen(initial)).toBe(true);
    expect(host.getSelection()).toBe(initial);
    const item = await artifact('export const unrelated = true;');
    await expect(select(host, item, connection('http://127.0.0.1/'))).rejects.toBeDefined();
    const failed = host.getSelection();
    expect(failed).toEqual({ family: 'cagent', revision: 1 });
    host.clear();
    expect(host.getSelection()).toEqual({ family: 'cagent', revision: 2 });
    host.selectOpenCode();
    expect(host.getSelection()).toEqual({ family: 'opencode', revision: 3 });
    expect(initial).toEqual({ family: 'opencode', revision: 0 });
    expect(failed).toEqual({ family: 'cagent', revision: 1 });
  });

  it('retires a native pending adapter when OpenCode is selected explicitly', async () => {
    const marker = `__agent_family_gate_${randomUUID().replaceAll('-', '')}`;
    let enter;
    let release;
    const entered = new Promise((resolve) => { enter = resolve; });
    globalThis[marker] = { enter, wait: new Promise((resolve) => { release = resolve; }) };
    const item = await artifact(source(`globalThis.${marker}.enter(); await globalThis.${marker}.wait;`));
    const host = makeHost();
    try {
      const pending = select(host, item, connection('http://127.0.0.1/'));
      await entered;
      expect(host.getSelection()).toEqual({ family: 'cagent', revision: 1 });
      host.selectOpenCode();
      release();
      await expect(pending).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
      expect(host.getSelection()).toEqual({ family: 'opencode', revision: 2 });
      expect(() => host.dispatcher.captureIdentity()).toThrow(expect.objectContaining({ code: AGENT_ERROR.UNAVAILABLE }));
    } finally { release(); delete globalThis[marker]; }
  });

  it('constructs a frozen unavailable host without reading approval or making HTTP requests', async () => {
    let approvals = 0;
    let requests = 0;
    const url = await start((_req, res) => { requests += 1; res.end('{}'); });
    const host = createAgentHost({ getAcceptance: () => { approvals += 1; return null; } });
    expect(Object.isFrozen(host)).toBe(true);
    expect(Object.isFrozen(host.dispatcher)).toBe(true);
    expect(Object.isFrozen(host.features)).toBe(true);
    expect(() => host.dispatcher.captureIdentity()).toThrow(expect.objectContaining({ code: AGENT_ERROR.UNAVAILABLE }));
    expect(approvals).toBe(0);
    expect(requests).toBe(0);
    expect(url).toMatch(/^http:\/\//);
  });

  it('uses the host approval file reader on dispatch, with no pre-approval network access', async () => {
    let received;
    const url = await start((req, res) => {
      received = { url: req.url, authorization: req.headers.authorization, host: req.headers['x-host'] };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session));
    });
    const item = await artifact();
    const approvalsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oc-agent-host-approvals-'));
    roots.add(approvalsDir);
    const writer = createAgentApprovalWriter({ directory: approvalsDir });
    const reader = createAgentApprovals({ directory: approvalsDir });
    const host = makeHost((selection) => reader.read(selection));
    const conn = connection(url);
    const identity = await select(host, item, conn);
    expect(identity).toEqual({ family: profile.family, connectionID: conn.connectionID, epoch: 1,
      adapterRevision: profile.adapterRevision, capabilityRevision: profile.capabilityRevision });
    await expect(host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }))
      .rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
    expect(received).toBeUndefined();

    const approval = approvalFor(identity, item.manifest.artifactDigest);
    writer.write(approval);
    expect(await host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }))
      .toEqual({ identity, data: session });
    expect(received).toEqual({ url: '/sessions/s1?workspace=w1', authorization: 'Bearer host-secret', host: 'host-header' });
    writer.revoke({ family: identity.family, connectionID: identity.connectionID });
    received = undefined;
    await expect(host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, identity))
      .rejects.toMatchObject({ code: AGENT_ERROR.UNACCEPTED });
    expect(received).toBeUndefined();
  });

  it('keeps candidate factory requests unavailable while a selection is loading', async () => {
    const marker = `__agent_host_factory_${randomUUID().replaceAll('-', '')}`;
    const attempted = `export async function createAdapter(context) {
      try { await context.request({ method: 'GET', path: '/sessions/s1' }, {
        family: '${AGENT_FAMILY.CAGENT}', connectionID: 'conn-1', epoch: 1,
        adapterRevision: '${profile.adapterRevision}', capabilityRevision: '${profile.capabilityRevision}' });
      } catch (error) { globalThis.${marker} = error.code; }
      return { capabilities: { '${operation}': { state: 'supported', evidence: ['fixture'] } }, handlers: {} };
    }`;
    const item = await artifact(attempted);
    let requests = 0;
    const url = await start((_req, res) => { requests += 1; res.end('{}'); });
    try {
      const host = makeHost();
      await select(host, item, connection(url));
      expect(globalThis[marker]).toBe(AGENT_ERROR.UNAVAILABLE);
      expect(requests).toBe(0);
    } finally { delete globalThis[marker]; }
  });

  it('advances identity on clear and reselection, and refuses the retired identity', async () => {
    const url = await start((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(session)); });
    const item = await artifact();
    const accepted = new Set();
    const host = makeHost((selection) => accepted.has(selection.epoch)
      ? approvalFor(selection, item.manifest.artifactDigest) : null);
    const first = await select(host, item, connection(url));
    accepted.add(first.epoch);
    host.clear();
    await expect(host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, first))
      .rejects.toMatchObject({ code: AGENT_ERROR.UNAVAILABLE });
    const second = await select(host, item, connection(url, { connectionID: 'conn-2' }));
    expect(second.epoch).toBe(first.epoch + 2);
    accepted.add(second.epoch);
    await expect(host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, first))
      .rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    await expect(host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, second))
      .resolves.toMatchObject({ identity: second, data: session });
  });

  it('rejects an extra caller epoch before retiring the live selection', async () => {
    const url = await start((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(session)); });
    const item = await artifact();
    const accepted = new Set();
    const host = makeHost((selection) => accepted.has(selection.connectionID)
      ? approvalFor(selection, item.manifest.artifactDigest) : null);
    const first = await select(host, item, connection(url));
    accepted.add(first.connectionID);
    await expect(host.select({ ...item, profile, connection: { ...connection(url), epoch: 99 } }))
      .rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
    await expect(host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, first))
      .resolves.toMatchObject({ identity: first, data: session });
  });

  it('retires a good selection as soon as a validated artifact switch begins, even if loading fails', async () => {
    const url = await start((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(session)); });
    const item = await artifact();
    const host = makeHost((selection) => approvalFor(selection, item.manifest.artifactDigest));
    const first = await select(host, item, connection(url));
    const broken = { ...item, manifest: { ...item.manifest, artifactDigest: '0'.repeat(64) } };
    await expect(select(host, broken, connection(url, { connectionID: 'conn-2' })))
      .rejects.toMatchObject({ code: AGENT_ERROR.ARTIFACT_MISMATCH });
    await expect(host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, first))
      .rejects.toMatchObject({ code: AGENT_ERROR.UNAVAILABLE });
  });

  it('refuses an in-flight HTTP read after the host is cleared', async () => {
    let received;
    let release;
    const entered = new Promise((resolve) => { received = resolve; });
    const response = new Promise((resolve) => { release = resolve; });
    const url = await start(async (_req, res) => {
      received();
      await response;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session));
    });
    const item = await artifact();
    const host = makeHost((selection) => approvalFor(selection, item.manifest.artifactDigest));
    const identity = await select(host, item, connection(url));
    const pending = host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, identity);
    const refused = expect(pending).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    try {
      await entered;
      host.clear();
    } finally { release(); }
    await refused;
  });

  it.each(['clear', 'selectOpenCode', 'reselection'])('rejects a held HTTP read immediately after %s retires its selection', async (action) => {
    let received;
    const entered = new Promise((resolve) => { received = resolve; });
    let release;
    const response = new Promise((resolve) => { release = resolve; });
    const url = await start(async (_req, res) => {
      received();
      await response;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session));
    });
    const item = await artifact();
    const host = makeHost((selection) => approvalFor(selection, item.manifest.artifactDigest));
    const identity = await select(host, item, connection(url));
    const pending = host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, identity);
    const refused = expect(pending).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    try {
      await entered;
      if (action === 'clear') host.clear();
      if (action === 'selectOpenCode') host.selectOpenCode();
      if (action === 'reselection') await select(host, item, connection(url, { connectionID: 'conn-2' }));
      await refused;
    } finally { release(); }
  });

  it('rejects a response body held after headers when its selection is cleared', async () => {
    let received;
    const entered = new Promise((resolve) => { received = resolve; });
    let release;
    const response = new Promise((resolve) => { release = resolve; });
    const url = await start(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"partial":');
      received();
      await response;
      res.end('true}');
    });
    const item = await artifact();
    const host = makeHost((selection) => approvalFor(selection, item.manifest.artifactDigest));
    const identity = await select(host, item, connection(url));
    const pending = host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, identity);
    const refused = expect(pending).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    try {
      await entered;
      host.clear();
      await refused;
    } finally { release(); }
  });

  it('uses the new selection after aborting a retired request', async () => {
    let calls = 0;
    let entered;
    const requestStarted = new Promise((resolve) => { entered = resolve; });
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const url = await start(async (_req, res) => {
      calls += 1;
      if (calls === 1) {
        entered();
        await held;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session));
    });
    const item = await artifact();
    const host = makeHost((selection) => approvalFor(selection, item.manifest.artifactDigest));
    const first = await select(host, item, connection(url));
    const pending = host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, first);
    const refused = expect(pending).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    try {
      await requestStarted;
      host.clear();
      await refused;
    } finally { release(); }

    const second = await select(host, item, connection(url, { connectionID: 'conn-2' }));
    await expect(host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, second))
      .resolves.toMatchObject({ identity: second, data: session });
    expect(calls).toBe(2);
  });

  it('keeps overlapping factory loads from replacing the newest selection', async () => {
    const marker = `__agent_host_gate_${randomUUID().replaceAll('-', '')}`;
    const gateSource = `globalThis.${marker}.enter(); await globalThis.${marker}.wait;`;
    let release;
    let enter;
    const entered = new Promise((resolve) => { enter = resolve; });
    globalThis[marker] = { enter, wait: new Promise((resolve) => { release = resolve; }) };
    const slow = await artifact(source(gateSource));
    const fast = await artifact();
    const url = await start((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(session)); });
    const host = makeHost((selection) => approvalFor(selection, fast.manifest.artifactDigest));
    try {
      const pending = select(host, slow, connection(url));
      await entered;
      const latest = await select(host, fast, connection(url, { connectionID: 'conn-latest' }));
      release();
      await expect(pending).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
      await expect(host.dispatcher.dispatch(operation, { workspaceID: 'w1', sessionID: 's1' }, latest))
        .resolves.toMatchObject({ identity: latest, data: session });
    } finally { release(); delete globalThis[marker]; }
  });
});
