import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AGENT_OPERATION } from '../../packages/web/server/lib/agent/constants.js';
import { loadAgentAdapter } from '../../packages/web/server/lib/agent/loader.js';
import { catalogDigest } from './mapping-intake.mjs';
import { buildExtensionTemplate } from './extension-template.mjs';
import { buildPacketPlan } from './packet-plan.mjs';
import { runPrepareCommand } from './prepare-packets.mjs';
import { runPacketCommand } from './check-packet.mjs';
import { runFinalizeCommand } from './finalize-adapter.mjs';

const sample = (mixed = false) => {
  const citations = [{ document: 'guide', section: 'action' }];
  const catalog = { version: 1, revision: 'r1', documents: [{ id: 'guide', revision: 'r1', digest: 'a'.repeat(64), sections: ['action'] }],
    endpoints: [{ id: 'extra', method: 'POST', path: '/synthetic/action', requestRef: 'input', responseRef: 'result', effect: 'mutation', citations },
      { id: 'native', method: 'GET', path: '/synthetic/binary', requestRef: 'input', responseRef: 'binary', effect: 'read', citations }] };
  const mapping = { version: 1, catalogRevision: 'r1', catalogDigest: catalogDigest(catalog),
    operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((id) => [id, { kind: 'unverified', question: 'No actual API evidence' }])),
    endpoints: { extra: { kind: 'extension', actionID: 'cagent.sample', fit: 'form-action-result', citations },
      native: { kind: 'extension', actionID: 'cagent.binary', fit: 'requires-host-development', citations } } };
  const manifest = JSON.parse(buildExtensionTemplate().get('templates/extension/manifest.json'));
  manifest.effect = 'mutation'; manifest.evidence = citations;
  const definition = { version: 1, actionID: manifest.actionID, manifest, cases: [{ id: 'completed',
    input: { workspaceID: 'space', requestID: 'request-1', values: { query: 'hello' } },
    identity: { family: 'cagent', connectionID: 'fixture', epoch: 1, adapterRevision: 'a', capabilityRevision: 'c' },
    exchanges: [{ request: { method: 'POST', path: '/synthetic/action', body: { query: 'hello', requestID: 'request-1' } },
      outcome: { kind: 'response', response: { status: 200, body: { text: 'hello' } } } }],
    expected: { kind: 'result', result: { result: { text: 'hello' }, receipt: { requestID: 'request-1', state: 'complete' } } },
  }] };
  const extensions = { manifests: [manifest], fixtures: { [manifest.actionID]: definition } };
  let fixtures;
  if (mixed) {
    catalog.endpoints.push({ ...catalog.endpoints[1], id: 'core', path: '/synthetic/session', responseRef: 'session' });
    mapping.catalogDigest = catalogDigest(catalog);
    mapping.operations.getSession = { kind: 'mapping', endpointIDs: ['core'], codec: 'custom',
      evidence: Object.fromEntries(['transport', 'auth', 'scope', 'result', 'failure', 'completion', 'cancellation'].map((id) => [id, citations])) };
    mapping.endpoints.core = { kind: 'shared', operations: ['getSession'] };
    fixtures = { getSession: { version: 1, operation: 'getSession', cases: [{ id: 'failure',
      input: { workspaceID: 'space', sessionID: 'session' }, identity: definition.cases[0].identity,
      exchanges: [], expected: { kind: 'failure', error: 'backend-failed' } }] } };
  }
  return { catalog, mapping, extensions, fixtures };
};
const candidate = `export function createExtension(context) { return async (input, identity) => {
  const response = await context.request({ method: 'POST', path: '/synthetic/action', body: { query: input.values.query, requestID: input.requestID } }, identity);
  return { result: response.body, receipt: { requestID: input.requestID, state: 'complete' } };
}; }`;
const invoke = async (command, args) => {
  const lines = [];
  const code = await command([...args, '--json'], (line) => lines.push(line));
  assert.equal(lines.length, 1);
  return { code, report: JSON.parse(lines[0]) };
};

test('extension plans bind finite fixtures and retain host-development inventory without packets', () => {
  const { catalog, mapping, extensions } = sample();
  const plan = buildPacketPlan(catalog, mapping, undefined, undefined, undefined, extensions);
  assert.deepEqual(plan.packets.map((packet) => packet.operation), ['cagent.sample']);
  const registration = JSON.parse(plan.files.get('protected/registration.json'));
  assert.deepEqual(registration.operations, []);
  assert.equal(registration.extensions[0].factory, 'createExtension');
  assert.equal(plan.files.has('candidate/cagent.binary/handler.mjs'), false);
  assert.equal(JSON.parse(plan.files.get('protected/extension-coverage.json')).actions.find((row) => row.actionID === 'cagent.binary').available, false);
  for (const mutate of [
    (value) => { value.fixtures = {}; },
    (value) => { value.fixtures['cagent.other'] = value.fixtures['cagent.sample']; },
    (value) => { value.manifests.push(value.manifests[0]); },
    (value) => { value.fixtures['cagent.sample'].manifest = { ...value.fixtures['cagent.sample'].manifest, revision: 'changed' }; },
  ]) {
    const value = structuredClone(extensions); mutate(value);
    assert.throws(() => buildPacketPlan(catalog, mapping, undefined, undefined, undefined, value));
  }
  const changed = structuredClone(extensions); changed.fixtures['cagent.sample'].cases[0].expected.result.result.text = 'changed';
  assert.notEqual(buildPacketPlan(catalog, mapping, undefined, undefined, undefined, changed).digest, plan.digest);
});

for (const mixed of [false, true]) test(`offline preparation, checks and final artifact preserve ${mixed ? 'mixed' : 'extension-only'} candidates`, { timeout: 120000 }, async () => {
  const nodePath = process.env.CAGENT_TEST_NODE;
  assert.ok(nodePath, 'CAGENT_TEST_NODE must identify a native Node executable');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-extra-packets-'));
  try {
    const input = sample(mixed);
    for (const [name, value] of Object.entries(input)) if (value !== undefined) await fs.writeFile(path.join(root, `${name}.json`), JSON.stringify(value));
    const workspace = path.join(root, 'workspace');
    const args = ['--catalog', path.join(root, 'catalog.json'), '--mapping', path.join(root, 'mapping.json'), '--extensions', path.join(root, 'extensions.json'), '--out', workspace];
    if (mixed) args.push('--fixtures', path.join(root, 'fixtures.json'));
    const prepared = await invoke(runPrepareCommand, args);
    assert.equal(prepared.code, 0, JSON.stringify(prepared.report));
    assert.equal(prepared.report.packets, mixed ? 2 : 1);
    const check = ['--workspace', workspace, '--operation', 'cagent.sample', '--node', nodePath, '--kit-digest', prepared.report.digest];
    const refusal = await invoke(runPacketCommand, check);
    assert.equal(refusal.code, 1);
    assert.equal(refusal.report.state, 'fixtures-failed');
    await fs.writeFile(path.join(workspace, 'candidate', 'cagent.sample', 'handler.mjs'), candidate);
    assert.equal((await invoke(runPacketCommand, check)).code, 0);
    if (mixed) await fs.writeFile(path.join(workspace, 'candidate', 'getSession', 'handler.mjs'), "export function createOperation() { return async () => { throw new Error('backend-failed'); }; }");
    const out = path.join(root, 'finalized');
    const finalized = await invoke(runFinalizeCommand, ['--workspace', workspace, '--node', nodePath, '--kit-digest', prepared.report.digest, '--out', out]);
    assert.equal(finalized.code, 0, JSON.stringify(finalized.report));
    assert.equal(finalized.report.extensions, 1);
    assert.equal(finalized.report.operations, mixed ? 1 : 0);
    assert.equal(finalized.report.activation, 'unavailable');
    const artifact = JSON.parse(await fs.readFile(path.join(out, 'control', 'manifest.json'), 'utf8'));
    const loaded = await loadAgentAdapter({ directory: path.join(out, 'artifact'), manifest: artifact,
      profile: { adapterID: 'synthetic', family: 'cagent', adapterRevision: 'a', capabilityRevision: 'c' },
      transport: { request: async () => ({ status: 200, body: { text: 'hello' } }) } });
    assert.equal(loaded.extensions[0].manifest.actionID, 'cagent.sample');
    assert.equal(loaded.extensions[0].capability.state, 'unverified');
    assert.equal(Boolean(loaded.handlers.getSession), mixed);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
