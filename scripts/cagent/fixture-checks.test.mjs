import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureChecks, FixtureError } from './fixture-checks.mjs';

const definition = () => ({ version: 1, operation: 'getSession', cases: [{ id: 'renamed-session',
  input: { workspaceID: 'space', sessionID: 'session' },
  identity: { family: 'cagent', connectionID: 'fixture', epoch: 1, adapterRevision: 'a1', capabilityRevision: 'c1' },
  exchanges: [{ request: { method: 'GET', path: '/fixture/record', query: { space: 'space', record: 'session' } },
    outcome: { kind: 'response', response: { status: 200, body: { record: 'session', space: 'space' } } } }],
  expected: { kind: 'result', result: { id: 'session', workspaceID: 'space' } },
}] });
const factory = (context) => async (input, identity, control) => {
  const response = await context.request({ method: 'GET', path: '/fixture/record', query: { space: input.workspaceID, record: input.sessionID } }, identity, control);
  return { id: response.body.record, workspaceID: response.body.space };
};
const check = (value, handler = factory) => createFixtureChecks(value, async () => handler)[0].run([{ path: 'handler.mjs', text: 'captured' }]);

test('documented field projection preserves request, identity, abort control and neutral output', async () => {
  const value = definition();
  const checks = createFixtureChecks(value, async (sources) => {
    assert.equal(sources[0].text, 'captured');
    return factory;
  });
  value.cases[0].expected.result.id = 'changed-after-definition';
  assert.equal(await checks[0].run([{ path: 'handler.mjs', text: 'captured' }]), true);
});

test('matching output cannot mask missing, wrong or extra transport requests', async () => {
  for (const mutate of [
    (request) => ({ ...request, method: 'POST' }),
    (request) => ({ ...request, query: { ...request.query, space: 'wrong' } }),
  ]) {
    assert.equal(await check(definition(), (context) => async (input, identity, control) => {
      try { await context.request(mutate(definition().cases[0].exchanges[0].request), identity, control); } catch { /* deliberate bad candidate */ }
      return { id: input.sessionID, workspaceID: input.workspaceID };
    }), false);
  }
  assert.equal(await check(definition(), () => async () => ({ id: 'session', workspaceID: 'space' })), false);
  assert.equal(await check(definition(), (context) => async (input, identity, control) => {
    const result = await factory(context)(input, identity, control);
    try { await context.request(definition().cases[0].exchanges[0].request, identity, control); } catch { /* deliberate duplicate */ }
    return result;
  }), false);
});

test('wrong identity, absent signal, malformed and cross-scope outputs fail', async () => {
  assert.equal(await check(definition(), (context) => async (input, identity, control) => factory(context)(input, { ...identity, epoch: 2 }, control)), false);
  assert.equal(await check(definition(), (context) => async (input, identity) => factory(context)(input, identity, {})), false);
  for (const result of [{ id: 'session' }, { id: 'session', workspaceID: 'other' }]) {
    assert.equal(await check(definition(), (context) => async (input, identity, control) => {
      await factory(context)(input, identity, control);
      return result;
    }), false);
  }
});

test('backend failures must stay failures and fixture errors are setup errors', async () => {
  const value = definition();
  value.cases[0].exchanges[0].outcome = { kind: 'failure', error: 'backend-failed' };
  value.cases[0].expected = { kind: 'failure', error: 'backend-failed' };
  assert.equal(await check(value), true);
  assert.equal(await check(value, (context) => async (input, identity, control) => {
    try { await factory(context)(input, identity, control); } catch { return { id: 'session', workspaceID: 'space' }; }
  }), false);
  await assert.rejects(check(definition(), () => null), FixtureError);
  const invalid = definition(); invalid.cases[0].expected.result = { id: 'session' };
  assert.throws(() => createFixtureChecks(invalid, async () => factory), FixtureError);
  const duplicate = definition(); duplicate.cases.push(structuredClone(duplicate.cases[0]));
  assert.throws(() => createFixtureChecks(duplicate, async () => factory), FixtureError);
});
