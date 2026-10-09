import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileDocuments, packetDocuments, buildDocumentSchema, DocumentError, DOCUMENT } from './document-excerpts.mjs';

const setup = (text = 'Document title\r\nRead returns an opaque ID.\r\nUnrelated capability.', format = DOCUMENT.FORMAT.TEXT,
  sections = [{ id: 'read', fromLine: 2, toLine: 2 }, { id: 'other', fromLine: 3, toLine: 3 }]) => {
  const digest = createHash('sha256').update(text).digest('hex');
  return { catalog: { version: 1, revision: 'r1', documents: [{ id: 'guide', revision: 'r1', digest, sections: sections.map((item) => item.id) }], endpoints: [] },
    input: { version: 1, documents: [{ id: 'guide', revision: 'r1', text, format, sections }] } };
};
const read = [{ id: 'guide', sections: ['read'] }];

test('captures exact source identity and includes only requested sections', () => {
  const { catalog, input } = setup();
  const docs = compileDocuments(catalog, input);
  const selected = JSON.parse(packetDocuments(docs, read));
  assert.equal(selected.documents[0].digest, catalog.documents[0].digest);
  assert.deepEqual(selected.documents[0].sections, [{ id: 'read', locator: { fromLine: 2, toLine: 2 }, text: 'Read returns an opaque ID.' }]);
  assert.equal(packetDocuments(docs, read).includes('Unrelated capability'), false);
  input.documents[0].text = 'changed';
  assert.equal(JSON.parse(packetDocuments(docs, read)).documents[0].sections[0].text, 'Read returns an opaque ID.');
  assert.ok(buildDocumentSchema().properties.documents);
});

test('extracts OpenAPI JSON through escaped pointers without resolving references or inventing fields', () => {
  const text = JSON.stringify({ openapi: '3.1.0', paths: { '/records/{record}': { get: { operationId: 'read',
    responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Record' } } } } } } } } });
  const { catalog, input } = setup(text, DOCUMENT.FORMAT.OPENAPI, [{ id: 'read', pointer: '/paths/~1records~1{record}/get' }]);
  const result = JSON.parse(packetDocuments(compileDocuments(catalog, input), read));
  const body = JSON.parse(result.documents[0].sections[0].text);
  assert.equal(body.operationId, 'read');
  assert.equal(body.responses[200].content['application/json'].schema.$ref, '#/components/schemas/Record');
  assert.deepEqual(Object.keys(body), ['operationId', 'responses']);
  assert.deepEqual(result.documents[0].sections[0].locator, { pointer: '/paths/~1records~1{record}/get' });
});

test('refuses stale identity, incomplete inventories, invalid ranges and arbitrary fields', () => {
  const changes = [
    (value) => { value.input.documents[0].text += ' edit'; },
    (value) => { value.input.documents[0].revision = 'r2'; },
    (value) => { value.input.documents.push(value.input.documents[0]); },
    (value) => { value.input.documents[0].sections.pop(); },
    (value) => { value.input.documents[0].sections[0].id = 'missing'; },
    (value) => { value.input.documents[0].sections[0].toLine = 1; },
    (value) => { value.input.documents[0].sections[0].toLine = 5; },
    (value) => { value.input.documents[0].sections[0].execute = 'ignored'; },
  ];
  for (const change of changes) {
    const value = setup();
    change(value);
    assert.throws(() => compileDocuments(value.catalog, value.input), DocumentError);
  }
  const { catalog, input } = setup();
  const docs = compileDocuments(catalog, input);
  assert.throws(() => packetDocuments(docs, [{ id: 'guide', sections: ['missing'] }]), DocumentError);
  assert.throws(() => packetDocuments(docs, [{ id: 'missing', sections: ['read'] }]), DocumentError);
});

test('rejects malformed OpenAPI selections and bounds selected input independently of uncited content', () => {
  for (const pointer of ['/missing', '/openapi/~2', '/constructor', `/paths/${'nested/'.repeat(17)}`]) {
    const { catalog, input } = setup('{"openapi":"3.1.0","paths":{}}', DOCUMENT.FORMAT.OPENAPI, [{ id: 'read', pointer }]);
    assert.throws(() => compileDocuments(catalog, input), DocumentError);
  }
  for (const text of ['{"swagger":"2.0"}', '{broken']) {
    const { catalog, input } = setup(text, DOCUMENT.FORMAT.OPENAPI, [{ id: 'read', pointer: '/paths' }]);
    assert.throws(() => compileDocuments(catalog, input), DocumentError);
  }
  const { catalog, input } = setup(`title\nsmall\n${'x'.repeat(DOCUMENT.MAX_PACKET_BYTES)}`);
  const docs = compileDocuments(catalog, input);
  assert.ok(packetDocuments(docs, read).includes('small'));
  assert.throws(() => packetDocuments(docs, [{ id: 'guide', sections: ['other'] }]), DocumentError);
  const oversized = setup('x'.repeat(DOCUMENT.MAX_SOURCE_BYTES + 1), DOCUMENT.FORMAT.TEXT, [{ id: 'read', fromLine: 1, toLine: 1 }]);
  assert.throws(() => compileDocuments(oversized.catalog, oversized.input), DocumentError);
});
