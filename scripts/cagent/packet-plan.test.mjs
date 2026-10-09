import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AGENT_OPERATION, AGENT_ERROR, AGENT_ARTIFACT } from '../../packages/web/server/lib/agent/constants.js';
import { agentArtifactDigest } from '../../packages/web/server/lib/agent/artifacts.js';
import { catalogDigest, MappingError } from './mapping-intake.mjs';
import { buildPacketPlan, PACKET_PLAN, PacketPlanError } from './packet-plan.mjs';

const citation = [{ document: 'guide', section: 'routes' }];
const catalog = {
  version: 1, revision: 'catalog-r1',
  documents: [{ id: 'guide', revision: 'r1', digest: 'a'.repeat(64), sections: ['routes', 'other'] }],
  endpoints: [
    { id: 'session-read', method: 'GET', path: '/api/sessions/{id}', requestRef: 'request-a', responseRef: 'response-a', effect: 'read', citations: citation },
    { id: 'unrelated', method: 'GET', path: '/api/other', requestRef: 'request-b', responseRef: 'response-b', effect: 'read', citations: [{ document: 'guide', section: 'other' }] },
  ],
};
const evidence = Object.fromEntries(['transport', 'auth', 'scope', 'result', 'failure', 'completion', 'cancellation'].map((key) => [key, citation]));
const mapping = () => ({
  version: 1, catalogRevision: catalog.revision, catalogDigest: catalogDigest(catalog),
  operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((operation) => [operation,
    operation === AGENT_OPERATION.GET_SESSION
      ? { kind: 'mapping', endpointIDs: ['session-read'], codec: 'custom', evidence }
      : { kind: 'unverified', question: 'Review this operation' }])),
  endpoints: {
    'session-read': { kind: 'shared', operations: [AGENT_OPERATION.GET_SESSION] },
    unrelated: { kind: 'out-of-scope', reason: 'not-used', citations: [{ document: 'guide', section: 'other' }] },
  },
});
const get = (plan, path) => plan.files.get(path);

test('creates one syntax-only packet with narrowly scoped protected references', async () => {
  const plan = buildPacketPlan(catalog, mapping());
  assert.deepEqual(plan.packets.map(({ operation }) => operation), [AGENT_OPERATION.GET_SESSION]);
  const packet = plan.packets[0];
  assert.equal(packet.goal, 'Read one session owned by the selected backend.');
  assert.deepEqual(packet.files, [PACKET_PLAN.FILE.HANDLER]);
  assert.equal(packet.checkScope, 'syntax-only');
  assert.equal(packet.status, 'awaiting-implementation');
  assert.equal(packet.checkCommand[0], 'node');
  assert.equal(packet.checkCommand[1], '--check');
  const protectedPaths = [...plan.files.keys()].filter((path) => path.startsWith('protected/'));
  assert.deepEqual(protectedPaths.sort(), [
    'protected/getSession/mapping.json', 'protected/getSession/packet.json', 'protected/getSession/reference.en.md',
    'protected/getSession/reference.zh-CN.md', 'protected/getSession/schema.json', 'protected/coverage.json',
    'protected/registration.json',
  ].sort());
  const mapped = JSON.parse(get(plan, 'protected/getSession/mapping.json'));
  assert.deepEqual(mapped.endpoints.map(({ id }) => id), ['session-read']);
  assert.deepEqual(mapped.documents, [{ id: 'guide', revision: 'r1', digest: 'a'.repeat(64), sections: ['routes'] }]);
  const schema = JSON.parse(get(plan, 'protected/getSession/schema.json'));
  assert.equal(schema.operation, AGENT_OPERATION.GET_SESSION);
  assert.match(get(plan, 'protected/getSession/reference.en.md'), /Read one session owned/);
  const registration = JSON.parse(get(plan, 'protected/registration.json'));
  assert.equal(Object.keys(registration.capabilities).length, 22);
  assert.ok(Object.values(registration.capabilities).every(({ state, evidence: items }) => state === 'unverified' && items.length === 0));

  const source = get(plan, 'candidate/getSession/handler.mjs');
  assert.equal((await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`).then((module) => Object.keys(module).join(','))), 'createOperation');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let calls = 0;
  const operation = module.createOperation({ request: () => { calls += 1; } });
  await assert.rejects(operation({}, {}, {}), new RegExp(AGENT_ERROR.UNVERIFIED));
  assert.equal(calls, 0);

  const manifest = JSON.parse(get(plan, 'control/manifest.json'));
  assert.equal(manifest.version, AGENT_ARTIFACT.VERSION);
  assert.equal(manifest.artifactDigest, plan.digest);
  assert.ok(manifest.files.every(({ path }) => !path.startsWith('candidate/')));
  assert.deepEqual(manifest.files.map(({ path }) => path), manifest.files.map(({ path }) => path).slice().sort());
  for (const item of manifest.files) {
    const contents = get(plan, `protected/${item.path}`);
    assert.equal(item.bytes, Buffer.byteLength(contents));
    assert.equal(item.digest, createHash('sha256').update(contents).digest('hex'));
  }
  assert.equal(agentArtifactDigest(manifest.files), manifest.artifactDigest);
});

test('detaches file maps and canonicalizes equivalent object key orders', () => {
  const first = buildPacketPlan(catalog, mapping());
  first.files.clear();
  const reorderedCatalog = {
    endpoints: catalog.endpoints.map((row) => Object.fromEntries(Object.entries(row).reverse())),
    documents: catalog.documents.map((row) => Object.fromEntries(Object.entries(row).reverse())),
    revision: catalog.revision, version: catalog.version,
  };
  const value = mapping();
  const reordered = { ...value, operations: Object.fromEntries(Object.entries(value.operations).reverse()), endpoints: Object.fromEntries(Object.entries(value.endpoints).reverse()) };
  const again = buildPacketPlan(reorderedCatalog, reordered);
  const normal = buildPacketPlan(catalog, mapping());
  assert.equal(again.digest, normal.digest);
  assert.deepEqual([...again.files], [...normal.files]);
});

test('rejects stale or unknown mappings and refuses plans with no mapping-ready operation', () => {
  const stale = mapping(); stale.catalogDigest = 'b'.repeat(64);
  assert.throws(() => buildPacketPlan(catalog, stale), (error) => error instanceof MappingError);
  const unknown = mapping(); unknown.operations.unknown = { kind: 'unverified', question: 'Review' };
  assert.throws(() => buildPacketPlan(catalog, unknown), (error) => error instanceof MappingError);
  const unresolved = mapping(); unresolved.operations.getSession = { kind: 'unverified', question: 'Review getSession' };
  unresolved.endpoints['session-read'] = { kind: 'out-of-scope', reason: 'not-used', citations: citation };
  assert.throws(() => buildPacketPlan(catalog, unresolved), (error) => error instanceof PacketPlanError && error.code === PACKET_PLAN.ERROR.NO_READY);
});

test('freezes owner fixtures only for the complete mapping-ready operation set', () => {
  const definition = { version: 1, operation: 'getSession', cases: [{ id: 'read',
    input: { workspaceID: 'space', sessionID: 'session' },
    identity: { family: 'cagent', connectionID: 'fixture', epoch: 1, adapterRevision: 'a', capabilityRevision: 'c' },
    exchanges: [], expected: { kind: 'result', result: { id: 'session', workspaceID: 'space' } },
  }] };
  const fixtures = { getSession: definition };
  const plan = buildPacketPlan(catalog, mapping(), fixtures);
  assert.equal(plan.packets[0].checkScope, 'semantic-fixtures');
  const manifest = JSON.parse(plan.files.get('control/manifest.json'));
  assert.ok(manifest.files.some(({ path }) => path === 'getSession/fixtures.json'));
  assert.equal(JSON.parse(plan.files.get('protected/getSession/fixtures.json')).cases[0].id, 'read');
  for (const value of [{}, { getSession: null }, { getSession: definition, listSessions: definition }]) {
    assert.throws(() => buildPacketPlan(catalog, mapping(), value), PacketPlanError);
  }
});
