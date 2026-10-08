import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_OPERATION } from '../../packages/web/server/lib/agent/constants.js';
import { catalogDigest, compileMapping, MAPPING, MappingError } from './mapping-intake.mjs';

const doc = { id: 'guide', revision: 'r1', digest: 'a'.repeat(64), sections: ['routes', 'semantics'] };
const cite = [{ document: 'guide', section: 'routes' }];
const catalog = {
  version: 1, revision: 'catalog-r1', documents: [doc], endpoints: [
    { id: 'session-read', method: 'GET', path: '/api/sessions/{id}', requestRef: 'request-a', responseRef: 'response-a', effect: 'read', citations: cite },
    { id: 'prompt-post', method: 'POST', path: '/api/sessions/{id}/prompt', requestRef: 'request-b', responseRef: 'response-b', effect: 'mutation', citations: cite },
    { id: 'new-route', method: 'POST', path: '/api/actions/run', requestRef: 'request-c', responseRef: 'response-c', effect: 'mutation', citations: cite },
    { id: 'absent', method: 'GET', path: '/api/legacy', requestRef: 'request-d', responseRef: 'response-d', effect: 'read', citations: cite },
  ],
};
const evidence = Object.fromEntries(['transport', 'auth', 'scope', 'result', 'failure', 'completion', 'cancellation'].map((key) => [key, cite]));
const baseMapping = () => {
  const operations = Object.fromEntries(Object.values(AGENT_OPERATION).map((op) => [op, { kind: 'unverified', question: `Review ${op}` }]));
  operations.getSession = { kind: 'mapping', endpointIDs: ['session-read'], codec: 'custom', evidence };
  operations.sendPrompt = { kind: 'mapping', endpointIDs: ['prompt-post'], codec: 'declarative', evidence };
  return structuredClone({
    version: 1, catalogRevision: catalog.revision, catalogDigest: catalogDigest(catalog), operations,
    endpoints: {
      'session-read': { kind: 'shared', operations: ['getSession'] },
      'prompt-post': { kind: 'shared', operations: ['sendPrompt'] },
      'new-route': { kind: 'extension', actionID: 'cagent.newAction', fit: 'form-action-result', citations: cite },
      absent: { kind: 'out-of-scope', reason: 'documented-absent', citations: [{ document: 'guide', section: 'semantics' }] },
    },
  });
};
const failCode = (fn, code) => assert.throws(fn, (error) => error instanceof MappingError && error.code === code);

test('compiles deterministic sanitized candidate coverage without runtime authority', () => {
  const mapping = baseMapping();
  const report = compileMapping(catalog, mapping);
  assert.equal(report.operations.getSession, 'mapping-ready');
  assert.equal(report.operations.sendPrompt, 'mapping-ready');
  assert.equal(report.operations.createSession, 'unverified');
  assert.equal(report.features.history.state, 'blocked');
  assert.deepEqual(report.features.history.blockedBy, { all: ['listMessages'], any: [] });
  assert.equal(report.features.acquireSession.reason, MAPPING.GATE.ACCEPTANCE);
  assert.equal(report.features.sessionList.available, false);
  assert.deepEqual(report.endpoints['new-route'], { kind: 'extension', actionID: 'cagent.newAction', state: 'candidate-required', available: false });
  assert.equal(report.features.acquireSession.state, 'candidate-ready');
  assert.equal(report.features.acquireSession.available, false);
  assert.deepEqual(report.endpoints.absent, { kind: 'out-of-scope' });
  assert.equal(Object.isFrozen(report.features), true);
  assert.doesNotMatch(JSON.stringify(report), /request-a|response-a|Review getSession/);
  assert.doesNotMatch(JSON.stringify(report), /guide|routes/);
  const reordered = { ...mapping, operations: Object.fromEntries(Object.entries(mapping.operations).reverse()), endpoints: Object.fromEntries(Object.entries(mapping.endpoints).reverse()) };
  assert.equal(compileMapping(catalog, reordered).digest, report.digest);
  const reorderedCatalog = { ...catalog, endpoints: catalog.endpoints.map((row) => Object.fromEntries(Object.entries(row).reverse())) };
  assert.equal(catalogDigest(reorderedCatalog), catalogDigest(catalog));
  assert.throws(() => { report.features.sessionList.available = true; }, TypeError);
});

test('rejects stale revisions, extra or missing endpoint dispositions, and incomplete operation rows', () => {
  const stale = baseMapping(); stale.catalogRevision = 'old';
  failCode(() => compileMapping(catalog, stale), MAPPING.ERROR.CATALOG_CHANGED);
  const revised = baseMapping();
  const changedCatalog = structuredClone(catalog); changedCatalog.endpoints[0].path = '/api/sessions/{sessionID}';
  failCode(() => compileMapping(changedCatalog, revised), MAPPING.ERROR.CATALOG_CHANGED);
  const missing = baseMapping(); delete missing.endpoints.absent;
  failCode(() => compileMapping(catalog, missing), MAPPING.ERROR.INVALID_MAPPING);
  const extra = baseMapping(); extra.endpoints.unknown = { kind: 'out-of-scope', reason: 'x', citations: cite };
  failCode(() => compileMapping(catalog, extra), MAPPING.ERROR.INVALID_MAPPING);
  const incomplete = baseMapping(); delete incomplete.operations.getSession;
  failCode(() => compileMapping(catalog, incomplete), MAPPING.ERROR.INVALID_MAPPING);
});

test('rejects invalid citations, catalog paths, and duplicate catalog identities', () => {
  const badRef = baseMapping(); badRef.endpoints['new-route'].citations = [{ document: 'missing', section: 'x' }];
  failCode(() => compileMapping(catalog, badRef), MAPPING.ERROR.MISSING_EVIDENCE);
  for (const path of ['https://host/api/x', '/api/x?query', '/api/x#hash', '/api//x']) {
    const badCatalog = structuredClone(catalog); badCatalog.endpoints[0].path = path;
    failCode(() => compileMapping(badCatalog, baseMapping()), MAPPING.ERROR.INVALID_CATALOG);
  }
  const duplicate = structuredClone(catalog); duplicate.documents.push(structuredClone(doc));
  failCode(() => compileMapping(duplicate, baseMapping()), MAPPING.ERROR.INVALID_CATALOG);
});

test('rejects false authority fields and inconsistent or unsafe operation links', () => {
  const claimed = baseMapping(); claimed.available = true;
  failCode(() => compileMapping(catalog, claimed), MAPPING.ERROR.INVALID_MAPPING);
  const mismatch = baseMapping(); mismatch.operations.getSession.endpointIDs = ['prompt-post'];
  failCode(() => compileMapping(catalog, mismatch), MAPPING.ERROR.INCONSISTENT_MAPPING);
  const readOnlyWrite = baseMapping();
  readOnlyWrite.operations.createSession = { kind: 'mapping', endpointIDs: ['session-read'], codec: 'custom', evidence };
  readOnlyWrite.endpoints['session-read'].operations.push('createSession');
  failCode(() => compileMapping(catalog, readOnlyWrite), MAPPING.ERROR.INCONSISTENT_MAPPING);
  const unlinked = baseMapping(); unlinked.endpoints['session-read'].operations = [];
  failCode(() => compileMapping(catalog, unlinked), MAPPING.ERROR.INVALID_MAPPING);
  const falselyMapped = baseMapping(); falselyMapped.endpoints['session-read'].operations.push('listSessions');
  failCode(() => compileMapping(catalog, falselyMapped), MAPPING.ERROR.INCONSISTENT_MAPPING);
});

test('accepts explicit unsupported mapping and requires all seven evidence dimensions', () => {
  const mapping = baseMapping();
  mapping.operations.createSession = { kind: 'unsupported', reason: 'documented-absent', citations: cite };
  assert.equal(compileMapping(catalog, mapping).operations.createSession, 'unsupported');
  const missing = baseMapping(); delete missing.operations.sendPrompt.evidence.cancellation;
  failCode(() => compileMapping(catalog, missing), MAPPING.ERROR.INVALID_MAPPING);
});

test('read contracts cannot hide a remote mutation behind a shared mapping', () => {
  const mapping = baseMapping();
  mapping.operations.getSession.endpointIDs = ['prompt-post'];
  mapping.endpoints['session-read'] = { kind: 'out-of-scope', reason: 'unused', citations: cite };
  mapping.endpoints['prompt-post'].operations.push('getSession');
  failCode(() => compileMapping(catalog, mapping), MAPPING.ERROR.INCONSISTENT_MAPPING);
  assert.throws(() => compileMapping(catalog, mapping), (error) => {
    assert.deepEqual(error.details, { operation: 'getSession', check: MAPPING.CHECK.EFFECT, nextAction: MAPPING.NEXT.LINKS });
    return true;
  });
});

test('a changed document digest invalidates mappings without changing the catalog revision label', () => {
  const changed = structuredClone(catalog);
  changed.documents[0].digest = 'b'.repeat(64);
  failCode(() => compileMapping(changed, baseMapping()), MAPPING.ERROR.CATALOG_CHANGED);
  const refreshed = baseMapping();
  refreshed.catalogDigest = catalogDigest(changed);
  const report = compileMapping(changed, refreshed);
  assert.equal(report.catalogDigest, refreshed.catalogDigest);
  assert.notEqual(report.digest, compileMapping(catalog, baseMapping()).digest);
});

test('new interactions requiring host development stay identified and unavailable', () => {
  const mapping = baseMapping();
  mapping.endpoints['new-route'].fit = MAPPING.FIT.HOST;
  const row = compileMapping(catalog, mapping).endpoints['new-route'];
  assert.equal(row.actionID, 'cagent.newAction');
  assert.equal(row.state, MAPPING.FIT.HOST);
  assert.equal(row.available, false);
});

test('blocked alternatives report every missing branch while a ready alternative is sufficient', () => {
  const mapping = baseMapping();
  mapping.operations.getSession = { kind: 'unverified', question: 'Conflicting identity semantics' };
  mapping.endpoints['session-read'] = { kind: 'out-of-scope', reason: 'contract-conflict', citations: cite };
  const report = compileMapping(catalog, mapping);
  assert.deepEqual(report.features.acquireSession.blockedBy, { all: [], any: [['createSession'], ['getSession']] });
  assert.equal(report.features.acquireSession.reason, MAPPING.GATE.INCOMPLETE);
  assert.equal(report.features.prompt.available, false);
});
