import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_OPERATION } from '../../packages/web/server/lib/agent/constants.js';
import { catalogDigest } from './mapping-intake.mjs';
import { buildExtensionTemplate } from './extension-template.mjs';
import { compileExtensions } from './extension-mapping.mjs';

const sample = () => {
  const evidence = [{ document: 'guide', section: 'action' }];
  const catalog = { version: 1, revision: 'r1', documents: [{ id: 'guide', revision: 'r1', digest: 'a'.repeat(64), sections: ['action', 'result'] }],
    endpoints: [{ id: 'extra', method: 'POST', path: '/synthetic/action', requestRef: 'input', responseRef: 'result', effect: 'mutation', citations: evidence }] };
  const mapping = { version: 1, catalogRevision: 'r1', catalogDigest: catalogDigest(catalog),
    operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((id) => [id, { kind: 'unverified', question: 'No real API evidence' }])),
    endpoints: { extra: { kind: 'extension', actionID: 'cagent.sample', fit: 'form-action-result', citations: evidence } } };
  const manifest = JSON.parse(buildExtensionTemplate().get('templates/extension/manifest.json'));
  manifest.effect = 'mutation';
  manifest.evidence = structuredClone(evidence);
  return { catalog, mapping, manifest };
};

test('complete extension inventory binds manifests to reviewed mappings without activation', () => {
  const { catalog, mapping, manifest } = sample();
  const report = compileExtensions(catalog, mapping, [manifest]);
  assert.deepEqual(report.actions, [{ actionID: 'cagent.sample', endpointIDs: ['extra'], effect: 'mutation', state: 'candidate-required', available: false }]);
  assert.equal(report.activation, 'unavailable');
  assert.equal(Object.isFrozen(report.actions[0].endpointIDs), true);
  assert.doesNotMatch(JSON.stringify(report), /synthetic\/action|guide|result/);
  assert.throws(() => compileExtensions(catalog, mapping, []));
  assert.throws(() => compileExtensions(catalog, mapping, [manifest, manifest]));
  assert.throws(() => compileExtensions(catalog, mapping, [{ ...manifest, actionID: 'cagent.unknown' }]));
});

test('effect and cited documentation cannot be weakened by an extension manifest', () => {
  const { catalog, mapping, manifest } = sample();
  assert.throws(() => compileExtensions(catalog, mapping, [{ ...manifest, effect: 'read' }]));
  assert.throws(() => compileExtensions(catalog, mapping, [{ ...manifest, evidence: [{ document: 'guide', section: 'result' }] }]));
  assert.throws(() => compileExtensions(catalog, mapping, [{ ...manifest, evidence: [...manifest.evidence, { document: 'missing', section: 'action' }] }]));
  assert.throws(() => compileExtensions(catalog, mapping, [{ ...manifest, enabled: true }]));
});

test('multi-endpoint actions retain every endpoint and mutation effect', () => {
  const { catalog, mapping, manifest } = sample();
  catalog.endpoints.push({ ...catalog.endpoints[0], id: 'observation', method: 'GET', effect: 'read', path: '/synthetic/result', citations: [{ document: 'guide', section: 'result' }] });
  mapping.endpoints.observation = { ...mapping.endpoints.extra, citations: catalog.endpoints[1].citations };
  mapping.catalogDigest = catalogDigest(catalog);
  assert.throws(() => compileExtensions(catalog, mapping, [manifest]));
  manifest.evidence.push(...catalog.endpoints[1].citations);
  const report = compileExtensions(catalog, mapping, [manifest]);
  assert.deepEqual(report.actions[0].endpointIDs, ['extra', 'observation']);
  assert.equal(report.actions[0].effect, 'mutation');
  mapping.endpoints.observation.fit = 'requires-host-development';
  assert.throws(() => compileExtensions(catalog, mapping, [manifest]));
});

test('host development requirements remain accounted for and cannot masquerade as forms', () => {
  const { catalog, mapping, manifest } = sample();
  mapping.endpoints.extra.fit = 'requires-host-development';
  const report = compileExtensions(catalog, mapping, []);
  assert.equal(report.actions[0].state, 'requires-host-development');
  assert.equal(report.actions[0].available, false);
  assert.throws(() => compileExtensions(catalog, mapping, [manifest]));
});
