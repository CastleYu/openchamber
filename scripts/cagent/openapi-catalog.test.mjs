import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compileOpenAPI, OpenAPIError, buildOpenAPISchemas } from './openapi-catalog.mjs';
import { runImportOpenAPI, IMPORT } from './import-openapi.mjs';
import { compileDocuments, packetDocuments } from './document-excerpts.mjs';

const fixture = () => ({ source: { version: 1, id: 'api', revision: 'r1', text: JSON.stringify({ openapi: '3.1.0',
  paths: { '/records/{record}': { get: { operationId: 'read', responses: { 200: { description: 'record' } } },
    post: { operationId: 'create', responses: { 201: { description: 'accepted only' } } } } },
  components: { securitySchemes: { auth: { type: 'http', scheme: 'bearer' } } } }) },
  review: { version: 1, revision: 'catalog-r1', endpoints: {
    read: { effect: 'read', requestRef: 'read-input', responseRef: 'read-output' },
    create: { effect: 'mutation', requestRef: 'create-input', responseRef: 'create-output' },
  }, sections: [{ id: 'auth', pointer: '/components/securitySchemes' }] } });

test('imports exact routes and owner effects, retaining source identity and semantic gaps', () => {
  const { source, review } = fixture();
  const plan = compileOpenAPI(source, review);
  assert.deepEqual(plan.catalog.endpoints.map(({ id, method, path: route, effect }) => ({ id, method, route, effect })), [
    { id: 'read', method: 'GET', route: '/records/{record}', effect: 'read' },
    { id: 'create', method: 'POST', route: '/records/{record}', effect: 'mutation' },
  ]);
  assert.equal(plan.catalog.documents[0].digest, createHash('sha256').update(source.text).digest('hex'));
  const excerpts = packetDocuments(compileDocuments(plan.catalog, plan.documents), [{ id: 'api', sections: ['create', 'auth'] }]);
  assert.ok(excerpts.includes('accepted only'));
  assert.equal(excerpts.includes('completed'), false);
  assert.ok(buildOpenAPISchemas().review.properties.endpoints);
  review.endpoints.read.effect = 'mutation';
  assert.equal(compileOpenAPI(source, review).catalog.endpoints[0].effect, 'mutation');
});

test('refuses incomplete review, missing or duplicate operation IDs, unresolved path items and unsupported methods', () => {
  const changes = [
    (value, api) => { delete value.review.endpoints.read; },
    (value, api) => { value.review.endpoints.extra = value.review.endpoints.read; },
    (value, api) => { delete api.paths['/records/{record}'].get.operationId; },
    (value, api) => { api.paths['/records/{record}'].post.operationId = 'read'; },
    (value, api) => { api.paths['/records/{record}'].$ref = 'external.json'; },
    (value, api) => { api.paths['/records/{record}'].head = { operationId: 'head' }; value.review.endpoints.head = value.review.endpoints.read; },
    (value, api) => { value.review.sections.push({ id: 'read', pointer: '/paths' }); },
    (value, api) => { api.openapi = '2.0'; },
    (value, api) => { api.webhooks = {}; },
    (value, api) => { api.paths['/records/{record}'].get.callbacks = {}; },
  ];
  for (const change of changes) {
    const value = fixture();
    const api = JSON.parse(value.source.text);
    change(value, api);
    value.source.text = JSON.stringify(api);
    assert.throws(() => compileOpenAPI(value.source, value.review), OpenAPIError);
  }
});

test('local import produces reusable files, preserves existing output and exposes no source on failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-openapi-'));
  try {
    const { source, review } = fixture();
    const sourcePath = path.join(root, 'source.json');
    const reviewPath = path.join(root, 'review.json');
    const out = path.join(root, 'output');
    await fs.writeFile(sourcePath, JSON.stringify(source));
    await fs.writeFile(reviewPath, JSON.stringify(review));
    const args = ['--source', sourcePath, '--review', reviewPath, '--out', out, '--json'];
    const lines = [];
    const run = (values) => runImportOpenAPI(values, (line) => lines.push(line));
    assert.equal(await run(args), 0);
    assert.equal(JSON.parse(lines[0]).endpoints, 2);
    assert.equal(lines[0].includes(root), false);
    const catalog = JSON.parse(await fs.readFile(path.join(out, IMPORT.FILE.CATALOG), 'utf8'));
    const documents = JSON.parse(await fs.readFile(path.join(out, IMPORT.FILE.DOCUMENTS), 'utf8'));
    assert.equal(compileDocuments(catalog, documents).size, 1);
    assert.equal(await run(args), 1);
    assert.equal(JSON.parse(lines[1]).error, IMPORT.EXISTS);
    delete review.endpoints.read;
    await fs.writeFile(reviewPath, JSON.stringify(review));
    assert.equal(await run([...args.slice(0, 4), '--out', path.join(root, 'invalid'), '--json']), 1);
    assert.equal(JSON.parse(lines[2]).error, 'invalid-openapi-catalog');
    assert.equal(await fs.stat(path.join(root, 'invalid')).then(() => true, () => false), false);
    assert.equal(await run(['--unknown', '--json']), 1);
    assert.equal(JSON.parse(lines[3]).error, IMPORT.INVALID);
    assert.equal(await run([...args.filter((item) => item !== '--json'), '--quiet']), 1);
    assert.equal(lines[4], 'invalid-openapi-catalog');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
