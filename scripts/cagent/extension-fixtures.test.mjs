import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureChecks, FixtureError } from './fixture-checks.mjs';
import { runFixtureProcess } from './fixture-process.mjs';

const manifest = () => ({ version: 1, actionID: 'cagent.lookup', revision: 'r1',
  label: { key: 'cagent.lookup', en: 'Lookup', zhCN: '查询' }, context: { workspace: true, session: false },
  effect: 'read', authorization: 'current-principal', cancellation: 'none', outcome: 'observed',
  input: [{ key: 'query', label: { key: 'cagent.query', en: 'Query', zhCN: '查询词' }, required: true,
    value: { kind: 'text', maxLength: 32 } }],
  output: { kind: 'text', maxLength: 64 }, evidence: [{ document: 'guide', section: 'lookup' }],
});
const identity = () => ({ family: 'cagent', connectionID: 'fixture', epoch: 1,
  adapterRevision: 'a1', capabilityRevision: 'c1', principalID: `principal-${'a'.repeat(64)}` });
const definition = () => ({ version: 1, actionID: 'cagent.lookup', manifest: manifest(), cases: [{ id: 'read',
  input: { workspaceID: 'space', values: { query: 'hello' } }, identity: identity(), exchanges: [],
  expected: { kind: 'result', result: { result: { text: 'hello' } } },
}] });
const source = (actionID = 'cagent.lookup', result = 'hello') => `export async function createAdapter() {
  return { capabilities: {}, handlers: {}, extensions: [{ manifest: ${JSON.stringify({ ...manifest(), actionID })}, capability: { state: 'supported', evidence: ['fixture'] },
    handler: async (input, identity) => ({ result: { text: ${JSON.stringify(result)} } }) }] };
}`;

test('extension fixture runs a finite read handler in the native permission worker', async () => {
  const result = await runFixtureProcess({ definition: definition(), source: source(), nodePath: process.execPath });
  assert.deepEqual(result.checks, [{ id: 'read', passed: true }]);
});

test('extension fixture rejects invalid input scope, manifest, response, receipt and exchange', async () => {
  for (const mutate of [
    (value) => { value.cases[0].input.sessionID = 'unexpected'; },
    (value) => { value.manifest.actionID = 'cagent.other'; },
    (value) => { value.cases[0].expected.result.extra = true; },
    (value) => { value.cases[0].expected.result.receipt = { requestID: 'x', state: 'complete' }; },

  ]) {
    const value = definition(); mutate(value);
    assert.throws(() => createFixtureChecks(value, async () => null), FixtureError);
  }
});

test('wrong extension registration and output fail without accepting a matching core handler', async () => {
  const task = definition();
  const run = async (adapterSource) => runFixtureProcess({ definition: task, source: adapterSource, nodePath: process.execPath });
  await assert.rejects(run(source('cagent.other')), (error) => error.code === 'fixture-process-exit');
  assert.deepEqual((await run(source('cagent.lookup', 'different'))).checks[0].passed, false);
});

test('mutation receipts require the declared request and observed completion', () => {
  const value = definition();
  value.manifest.effect = 'mutation';
  value.manifest.outcome = 'observed';
  value.cases[0].input.requestID = 'request-1';
  value.cases[0].expected.result.receipt = { requestID: 'request-1', state: 'complete' };
  assert.equal(createFixtureChecks(value, async () => async () => value.cases[0].expected.result).length, 1);
  value.cases[0].expected.result.receipt.state = 'accepted';
  assert.throws(() => createFixtureChecks(value, async () => null), FixtureError);
});

test('extension requests preserve identity, exact exchanges and empty transport control', async () => {
  const value = definition();
  value.cases[0].exchanges = [{ request: { method: 'GET', path: '/synthetic/lookup' },
    outcome: { kind: 'response', response: { status: 200, body: { text: 'hello' } } } }];
  const factory = (alter = '') => async (context) => async (_input, current) => {
    try {
      const response = await context.request({ method: 'GET', path: '/synthetic/lookup' },
        alter === 'identity' ? { ...current, epoch: 2 } : current, alter === 'control' ? { signal: new AbortController().signal } : {});
      return { result: response.body };
    } catch { return { result: { text: 'hello' } }; }
  };
  assert.equal(await createFixtureChecks(value, async () => factory())[0].run([]), true);
  for (const alter of ['identity', 'control']) assert.equal(await createFixtureChecks(value, async () => factory(alter))[0].run([]), false);
  value.cases[0].exchanges.push(structuredClone(value.cases[0].exchanges[0]));
  assert.equal(await createFixtureChecks(value, async () => factory())[0].run([]), false);
});

test('extension failure cases cannot be replaced by empty success', async () => {
  const value = definition();
  value.cases[0].expected = { kind: 'failure', error: 'backend-failed' };
  const checks = (handler) => createFixtureChecks(value, async () => async () => handler);
  assert.equal(await checks(async () => { throw new Error('backend-failed'); })[0].run([]), true);
  assert.equal(await checks(async () => ({ result: { text: '' } }))[0].run([]), false);
});

test('native mutation fixtures require matching completed receipts', async () => {
  const value = definition();
  value.manifest.effect = 'mutation';
  value.cases[0].input.requestID = 'request-1';
  value.cases[0].expected.result.receipt = { requestID: 'request-1', state: 'complete' };
  const adapter = `export function createAdapter() { return { capabilities: {}, handlers: {}, extensions: [{
    manifest: ${JSON.stringify(value.manifest)}, capability: { state: 'unverified', evidence: [] },
    handler: async (input) => ({ result: { text: 'hello' }, receipt: { requestID: input.requestID, state: 'complete' } }) }] }; }`;
  assert.equal((await runFixtureProcess({ definition: value, source: adapter, nodePath: process.execPath })).checks[0].passed, true);
  assert.equal((await runFixtureProcess({ definition: value, source: adapter.replace("state: 'complete'", "state: 'accepted'"), nodePath: process.execPath })).checks[0].passed, false);
});
