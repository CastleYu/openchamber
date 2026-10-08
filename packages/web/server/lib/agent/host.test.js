import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_OPERATION } from './constants.js';
import { agentArtifactDigest } from './artifacts.js';
import { createAgentApprovals } from './approvals.js';
import { createAgentApprovalWriter } from './approval-writer.js';
import { AgentDispatchError } from './dispatcher.js';
import { createAgentHost } from './host.js';

const roots = new Set();
const servers = new Set();
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
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
  servers.clear();
  await Promise.all([...roots].map((directory) => fsp.rm(directory, { recursive: true, force: true })));
  roots.clear();
});

describe('createAgentHost', () => {
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
