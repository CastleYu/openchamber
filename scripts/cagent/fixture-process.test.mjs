import test from 'node:test';
import assert from 'node:assert/strict';
import { runFixtureProcess, FixtureProcessError, PROCESS } from './fixture-process.mjs';

const nodePath = process.execPath;
const definition = () => ({ version: 1, operation: 'getSession', cases: [{ id: 'case-1',
  input: { workspaceID: 'space', sessionID: 'session' },
  identity: { family: 'cagent', connectionID: 'fixture', epoch: 1, adapterRevision: 'a1', capabilityRevision: 'c1' },
  exchanges: [{ request: { method: 'GET', path: '/fixture/record', query: { space: 'space', record: 'session' } },
    outcome: { kind: 'response', response: { status: 200, body: { record: 'session', space: 'space' } } } }],
  expected: { kind: 'result', result: { id: 'session', workspaceID: 'space' } },
}] });
const good = `export async function createAdapter(context) { return { handlers: { getSession: async (input, identity, control) => {
  const response = await context.request({ method: 'GET', path: '/fixture/record', query: { space: input.workspaceID, record: input.sessionID } }, identity, control);
  return { id: response.body.record, workspaceID: response.body.space };
} } }; }`;
const run = (source = good, timeoutMs) => runFixtureProcess({ definition: definition(), source, nodePath, timeoutMs });

test('runs the bundled adapter in Node and returns only mapped fixture checks', async () => {
  assert.deepEqual(await run(), { checks: [{ id: 'case-1', passed: true }] });
});

test('redacts setup, process-exit and malformed-output failures', async () => {
  for (const source of ['process.exit(7);', `throw new Error('PRIVATE_MARKER');`, `console.log('not-json'); process.exitCode = 0;`]) {
    await assert.rejects(run(source), (error) => error instanceof FixtureProcessError
      && [PROCESS.CODE.EXIT, PROCESS.CODE.OUTPUT].includes(error.code)
      && !error.message.includes('PRIVATE_MARKER'));
  }
});

test('timeout kills and reaps a blocked worker, then a new fixture still runs', async () => {
  await assert.rejects(run('while (true) {}', 800), (error) => error.code === PROCESS.CODE.TIMEOUT);
  assert.deepEqual(await run(), { checks: [{ id: 'case-1', passed: true }] });
});

test('bounds combined stdout and stderr without returning raw output', async () => {
  await assert.rejects(run(`process.stdout.write('x'.repeat(${PROCESS.MAX_OUTPUT + 1}));`),
    (error) => error.code === PROCESS.CODE.OUTPUT && error.message === PROCESS.CODE.OUTPUT);
});

test('Node permission model blocks filesystem writes and child processes', async () => {
  const source = `export async function createAdapter(context) { const fs = await import('node:fs'); const child = await import('node:child_process');
let writeDenied = false; let childDenied = false;
try { fs.writeFileSync('forbidden.tmp', 'x'); } catch (error) { writeDenied = error.code === 'ERR_ACCESS_DENIED'; }
try { child.spawnSync(process.execPath, ['--eval','0']); } catch (error) { childDenied = error.code === 'ERR_ACCESS_DENIED'; }
return { handlers: { getSession: async (input, identity, control) => {
await context.request({method:'GET',path:'/fixture/record',query:{space:input.workspaceID,record:input.sessionID}},identity,control);
return { id: writeDenied && childDenied ? 'session' : 'wrong', workspaceID: 'space' }; } } }; }`;
  assert.deepEqual(await run(source), { checks: [{ id: 'case-1', passed: true }] });
});

test('does not inherit environment secrets into the fixture process', async () => {
  const previous = process.env.CAGENT_TEST_SECRET;
  process.env.CAGENT_TEST_SECRET = 'fixture-canary';
  try {
    const source = `export async function createAdapter(context) { return { handlers: { getSession: async (input,identity,control) => {
await context.request({method:'GET',path:'/fixture/record',query:{space:input.workspaceID,record:input.sessionID}},identity,control);
return { id: process.env.CAGENT_TEST_SECRET || process.env.NODE_OPTIONS ? 'wrong' : 'session', workspaceID: 'space' }; } } }; }`;
    assert.deepEqual(await run(source), { checks: [{ id: 'case-1', passed: true }] });
  } finally {
    if (previous === undefined) delete process.env.CAGENT_TEST_SECRET;
    else process.env.CAGENT_TEST_SECRET = previous;
  }
});

test('rejects oversized input before spawning', async () => {
  await assert.rejects(run('x'.repeat(PROCESS.MAX_INPUT + 1)), (error) => error.code === PROCESS.CODE.INPUT);
});
