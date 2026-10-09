import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_OPERATION } from '../../packages/web/server/lib/agent/constants.js';
import { compileMapping, catalogDigest } from './mapping-intake.mjs';
import { compileBindings, DeclarativeError, buildBindingSchema } from './declarative-codec.mjs';
import { buildPacketPlan } from './packet-plan.mjs';
import { assembleAdapter } from './adapter-assembly.mjs';
import { runFixtureProcess } from './fixture-process.mjs';

const op = AGENT_OPERATION.GET_SESSION;
const field = (from, path, optional) => {
  const result = { kind: 'field', from, path };
  if (optional !== undefined) result.optional = optional;
  return result;
};
const literal = (value) => ({ kind: 'literal', value });
const object = (fields) => ({ kind: 'object', fields });
function inputs(operation = op, method = 'GET') {
  const refs = [{ document: 'guide', section: 'read' }];
  const catalog = { version: 1, revision: 'r1', documents: [{ id: 'guide', revision: 'r1', digest: 'a'.repeat(64), sections: ['read'] }],
    endpoints: [{ id: 'read', method, path: '/records/{record}', requestRef: 'input', responseRef: 'output',
      effect: method === 'GET' ? 'read' : 'mutation', citations: refs }] };
  const mapping = { version: 1, catalogRevision: 'r1', catalogDigest: catalogDigest(catalog),
    operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((id) => [id, id === operation
      ? { kind: 'mapping', endpointIDs: ['read'], codec: 'declarative', evidence: Object.fromEntries(
        ['transport', 'auth', 'scope', 'result', 'failure', 'completion', 'cancellation'].map((key) => [key, refs])) }
      : { kind: 'unverified', question: 'Review locally' }])), endpoints: { read: { kind: 'shared', operations: [operation] } } };
  const bindings = { version: 1, mappingDigest: compileMapping(catalog, mapping).digest, operations: { [operation]: {
    endpointID: 'read', successStatuses: [200], path: { record: field('input', ['sessionID']) },
    query: { space: field('input', ['workspaceID']), cursor: field('input', ['cursor'], true) },
    result: object({ id: field('response', ['body', 'record']), workspaceID: field('input', ['workspaceID']),
      title: field('response', ['body', 'label'], true) }),
  } } };
  return { catalog, mapping, bindings };
}
const identity = { family: 'cagent', connectionID: 'fixture', epoch: 1, adapterRevision: 'r1', capabilityRevision: 'r1' };
const input = { workspaceID: 'workspace', sessionID: 'session 1' };
const request = { method: 'GET', path: '/records/session%201', query: { space: 'workspace' } };
const fixture = (operation, cases) => ({ version: 1, operation, cases: cases.map((value, index) => ({ id: `case-${index}`, identity, input, ...value })) });
async function checks(data, definition) {
  const generated = compileBindings(data.catalog, data.mapping, data.bindings);
  const built = await assembleAdapter([...generated.sources].map(([operation, text]) => ({ operation, text })));
  const checked = await runFixtureProcess({ source: built.source, definition, nodePath: process.env.CAGENT_TEST_NODE });
  return checked.checks.every((check) => check.passed);
}

test('generated structural reads preserve absent fields, identity, control and transport failure', async () => {
  const data = inputs();
  const definition = fixture(op, [
    { exchanges: [{ request, outcome: { kind: 'response', response: { status: 200, body: { record: 'session 1' } } } }],
      expected: { kind: 'result', result: { id: 'session 1', workspaceID: 'workspace' } } },
    { exchanges: [{ request, outcome: { kind: 'failure', error: 'backend-failed' } }], expected: { kind: 'failure', error: 'backend-failed' } },
    { exchanges: [{ request, outcome: { kind: 'response', response: { status: 500, body: { record: 'session 1' } } } }],
      expected: { kind: 'failure', error: 'backend-failed' } },
    { exchanges: [{ request, outcome: { kind: 'response', response: { status: 200, body: {} } } }],
      expected: { kind: 'failure', error: 'backend-failed' } },
  ]);
  assert.equal(await checks(data, definition), true);
  const plan = buildPacketPlan(data.catalog, data.mapping, { [op]: definition }, data.bindings);
  assert.equal(plan.packets[0].status, 'awaiting-validation');
  assert.equal(plan.packets[0].checkScope, 'semantic-fixtures');
  assert.ok(plan.files.has(`protected/${op}/bindings.json`));
  assert.ok(Object.values(JSON.parse(plan.files.get('protected/registration.json')).capabilities).every((value) => value.state === 'unverified'));
  assert.throws(() => buildPacketPlan(data.catalog, data.mapping, undefined, data.bindings));
});

test('generated list projections preserve order and missing pagination', async () => {
  const data = inputs(AGENT_OPERATION.LIST_CHILDREN);
  data.bindings.operations.listChildren.result = object({ items: { kind: 'list', from: 'response', path: ['body', 'rows'],
    item: object({ id: field('item', ['record']), workspaceID: field('input', ['workspaceID']) }) }, next: field('response', ['body', 'next'], true) });
  const definition = fixture(AGENT_OPERATION.LIST_CHILDREN, [{ exchanges: [{ request,
    outcome: { kind: 'response', response: { status: 200, body: { rows: [{ record: 'b' }, { record: 'a' }] } } } }],
    expected: { kind: 'result', result: { items: [{ id: 'b', workspaceID: 'workspace' }, { id: 'a', workspaceID: 'workspace' }] } } }]);
  assert.equal(await checks(data, definition), true);
});

test('generated mutation builds explicit body without fabricating optional input', async () => {
  const data = inputs(AGENT_OPERATION.UPDATE_SESSION, 'PATCH');
  data.bindings.operations.updateSession.body = object({ name: field('input', ['title']), request: field('input', ['requestID']),
    unused: field('input', ['metadata', 'absent'], true), tags: { kind: 'list', from: 'input', path: ['metadata', 'tags'], item: object({ text: field('item', ['name']) }) } });
  const definition = fixture(AGENT_OPERATION.UPDATE_SESSION, [{ input: { ...input, title: 'new', requestID: 'write-1', metadata: { tags: [{ name: 'tag' }] } },
    exchanges: [{ request: { ...request, method: 'PATCH', body: { name: 'new', request: 'write-1', tags: [{ text: 'tag' }] } },
      outcome: { kind: 'response', response: { status: 200, body: { record: 'session 1', label: 'new' } } } }],
    expected: { kind: 'result', result: { id: 'session 1', workspaceID: 'workspace', title: 'new' } } }]);
  assert.equal(await checks(data, definition), true);
});

test('catalog-bound generation rejects stale, incomplete, executable and semantically invalid recipes', () => {
  assert.ok(buildBindingSchema().properties.operations);
  const changes = [
    (data) => { data.bindings.mappingDigest = 'b'.repeat(64); },
    (data) => { data.bindings.operations = {}; },
    (data) => { data.bindings.operations[op].path = {}; },
    (data) => { data.bindings.operations[op].query.space.from = 'response'; },
    (data) => { data.bindings.operations[op].result.fields.id = field('item', ['record']); },
    (data) => { data.bindings.operations[op].body = literal('invalid GET body'); },
    (data) => { data.bindings.operations[op].successStatuses = [500]; },
    (data) => { data.bindings.operations[op].result = { kind: 'expression', code: 'fetch()' }; },
    (data) => { data.bindings.operations[op].result = field('response', ['body', '__proto__']); },
    (data) => { let value = literal('deep'); for (let depth = 0; depth < 9; depth++) value = object({ value }); data.bindings.operations[op].result = value; },
    (data) => { data.mapping.operations[op].codec = 'custom'; data.bindings.mappingDigest = compileMapping(data.catalog, data.mapping).digest; },
  ];
  for (const change of changes) { const data = inputs(); change(data); assert.throws(() => compileBindings(data.catalog, data.mapping, data.bindings), DeclarativeError); }
});

test('equivalent bindings generate identical source and literal text cannot introduce code', async () => {
  const data = inputs();
  const text = '${globalThis.injected = true}; " quoted';
  data.bindings.operations[op].result.fields.title = literal(text);
  const generated = compileBindings(data.catalog, data.mapping, data.bindings);
  data.bindings.operations[op].result.fields = Object.fromEntries(Object.entries(data.bindings.operations[op].result.fields).reverse());
  assert.equal(generated.sources.get(op), compileBindings(data.catalog, data.mapping, data.bindings).sources.get(op));
  const definition = fixture(op, [{ exchanges: [{ request, outcome: { kind: 'response', response: { status: 200, body: { record: 'session 1' } } } }],
    expected: { kind: 'result', result: { id: 'session 1', workspaceID: 'workspace', title: text } } }]);
  assert.equal(await checks(data, definition), true);
});
