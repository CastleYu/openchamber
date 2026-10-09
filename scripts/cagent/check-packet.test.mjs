import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_OPERATION } from '../../packages/web/server/lib/agent/constants.js';
import { catalogDigest } from './mapping-intake.mjs';
import { runPacketCommand } from './check-packet.mjs';

test('native preparation and checking freeze fixtures, preserve failures and refuse scope edits', async () => {
  const nodePath = process.env.CAGENT_TEST_NODE;
  assert.ok(nodePath, 'CAGENT_TEST_NODE must select the tested Node executable');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-packet-command-'));
  try {
    const citations = [{ document: 'guide', section: 'read' }];
    const catalog = { version: 1, revision: 'r1', documents: [{ id: 'guide', revision: 'r1', digest: 'a'.repeat(64), sections: ['read'] }],
      endpoints: [{ id: 'read', method: 'GET', path: '/fixture/session', requestRef: 'input', responseRef: 'output', effect: 'read', citations }] };
    const mapping = { version: 1, catalogRevision: 'r1', catalogDigest: catalogDigest(catalog),
      operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((operation) => [operation, operation === 'getSession'
        ? { kind: 'mapping', endpointIDs: ['read'], codec: 'custom', evidence: Object.fromEntries(['transport', 'auth', 'scope', 'result', 'failure', 'completion', 'cancellation'].map((key) => [key, citations])) }
        : { kind: 'unverified', question: 'Review locally' }])), endpoints: { read: { kind: 'shared', operations: ['getSession'] } } };
    const fixtures = { getSession: { version: 1, operation: 'getSession', cases: [{ id: 'scope',
      input: { workspaceID: 'space', sessionID: 'session' }, identity: { family: 'cagent', connectionID: 'fixture', epoch: 1, adapterRevision: 'a', capabilityRevision: 'c' },
      exchanges: [{ request: { method: 'GET', path: '/fixture/session' }, outcome: { kind: 'response', response: { status: 200, body: { id: 'session', workspaceID: 'space' } } } }],
      expected: { kind: 'result', result: { id: 'session', workspaceID: 'space' } },
    }] } };
    for (const [name, value] of Object.entries({ catalog, mapping, fixtures })) await fs.writeFile(path.join(root, `${name}.json`), JSON.stringify(value));
    const workspace = path.join(root, 'workspace');
    const prepare = fileURLToPath(new URL('./prepare-packets.mjs', import.meta.url));
    const prepared = spawnSync(process.execPath, [prepare, '--catalog', path.join(root, 'catalog.json'), '--mapping', path.join(root, 'mapping.json'),
      '--fixtures', path.join(root, 'fixtures.json'), '--out', workspace, '--json'], { encoding: 'utf8' });
    assert.equal(prepared.status, 0, prepared.stderr);
    const report = JSON.parse(prepared.stdout);
    assert.equal(report.checkScope, 'semantic-fixtures');
    const command = fileURLToPath(new URL('./check-packet.mjs', import.meta.url));
    const args = [command, '--workspace', workspace, '--operation', 'getSession', '--node', nodePath, '--kit-digest', report.digest, '--json'];
    const run = () => {
      const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20000 });
      assert.equal(result.stderr, '');
      assert.ok([0, 1].includes(result.status));
      assert.equal(result.stdout.includes(root), false);
      return JSON.parse(result.stdout);
    };
    assert.equal(run().state, 'fixtures-failed');
    await fs.writeFile(path.join(workspace, 'candidate/getSession/handler.mjs'), 'export function createOperation(context) { return async (input, identity, control) => (await context.request({method:"GET",path:"/fixture/session"},identity,control)).body; }');
    const passed = run();
    assert.equal(passed.ok, true);
    assert.equal(passed.failures, 1);
    assert.deepEqual(passed.fixtures, [{ id: 'scope', passed: true }]);
    const unexpected = path.join(workspace, 'candidate/getSession/extra.mjs');
    await fs.writeFile(unexpected, 'out of scope');
    assert.equal(run().reason, 'candidate-boundary');
    await fs.unlink(unexpected);
    await fs.appendFile(path.join(workspace, 'protected/getSession/fixtures.json'), ' ');
    assert.equal(run().error, 'protected-kit-changed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('invalid flags fail with one fixed JSON result before reading private paths', async () => {
  const lines = [];
  assert.equal(await runPacketCommand(['--workspace', 'private-secret', '--unknown', '--json'], (line) => lines.push(line)), 1);
  assert.deepEqual(lines, [JSON.stringify({ ok: false, error: 'invalid-arguments' })]);
});
