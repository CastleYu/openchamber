import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBundleKit } from './bundle-kit.mjs';
import { runVerifyKit } from './verify-kit.mjs';
import { catalogDigest } from './mapping-intake.mjs';
import { AGENT_OPERATION } from '../../packages/web/server/lib/agent/constants.js';

test('existing output and invalid flags fail without overwriting files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-bundle-existing-'));
  try {
    await fs.writeFile(path.join(root, 'keep'), 'keep');
    const lines = [];
    assert.equal(await runBundleKit(['--out', root, '--json'], (line) => lines.push(JSON.parse(line))), 1);
    assert.equal(lines[0].error, 'kit-exists');
    assert.equal(await fs.readFile(path.join(root, 'keep'), 'utf8'), 'keep');
    assert.equal(await runBundleKit(['--unknown', '--json'], (line) => lines.push(JSON.parse(line))), 1);
    assert.equal(lines[1].error, 'invalid-arguments');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('standalone bundle runs outside checkout without installed dependencies and refuses tampering', async () => {
  const node = process.env.CAGENT_TEST_NODE;
  assert.ok(node, 'CAGENT_TEST_NODE selects the tested Node executable');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-offline-'));
  try {
    const kit = path.join(root, 'kit');
    const bundle = spawnSync(process.execPath, [fileURLToPath(new URL('./bundle-kit.mjs', import.meta.url)), '--out', kit, '--json'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(bundle.status, 0, bundle.stderr + bundle.stdout);
    const built = JSON.parse(bundle.stdout);
    const protectedRoot = path.join(kit, 'protected');
    const run = (executable, name, args) => {
      const result = spawnSync(executable, [path.join(protectedRoot, 'scripts/cagent', `${name}.mjs`), ...args, '--json'],
        { cwd: protectedRoot, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, `${name}: ${result.stderr} ${result.stdout}`);
      assert.equal(result.stderr, '');
      return JSON.parse(result.stdout);
    };
    assert.equal(run(node, 'verify-kit', ['--kit', kit, '--digest', built.digest]).ok, true);
    assert.equal(run(node, 'build-contracts', ['--check']).ok, true);
    const citations = [{ document: 'guide', section: 'read' }];
    const catalog = { version: 1, revision: 'r1', documents: [{ id: 'guide', revision: 'r1', digest: 'a'.repeat(64), sections: ['read'] }],
      endpoints: [{ id: 'read', method: 'GET', path: '/fixture/session', requestRef: 'input', responseRef: 'output', effect: 'read', citations }] };
    const mapping = { version: 1, catalogRevision: 'r1', catalogDigest: catalogDigest(catalog),
      operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((operation) => [operation, operation === 'getSession'
        ? { kind: 'mapping', endpointIDs: ['read'], codec: 'custom', evidence: Object.fromEntries(['transport', 'auth', 'scope', 'result', 'failure', 'completion', 'cancellation'].map((key) => [key, citations])) }
        : { kind: 'unverified', question: 'Review locally' }])), endpoints: { read: { kind: 'shared', operations: ['getSession'] } } };
    const fixtures = { getSession: { version: 1, operation: 'getSession', cases: [{ id: 'scope', input: { workspaceID: 'space', sessionID: 'session' },
      identity: { family: 'cagent', connectionID: 'fixture', epoch: 1, adapterRevision: 'a', capabilityRevision: 'c' },
      exchanges: [{ request: { method: 'GET', path: '/fixture/session' }, outcome: { kind: 'response', response: { status: 200, body: { id: 'session', workspaceID: 'space' } } } }],
      expected: { kind: 'result', result: { id: 'session', workspaceID: 'space' } } }] } };
    for (const [name, value] of Object.entries({ catalog, mapping, fixtures })) await fs.writeFile(path.join(root, `${name}.json`), JSON.stringify(value));
    const inputs = ['--catalog', path.join(root, 'catalog.json'), '--mapping', path.join(root, 'mapping.json')];
    assert.equal(run(node, 'check-mapping', inputs).ok, true);
    const workspace = path.join(root, 'workspace');
    const prepared = run(node, 'prepare-packets', [...inputs, '--fixtures', path.join(root, 'fixtures.json'), '--out', workspace]);
    await fs.writeFile(path.join(workspace, 'candidate/getSession/handler.mjs'),
      'export function createOperation(context) { return async (input,identity,control) => (await context.request({method:"GET",path:"/fixture/session"},identity,control)).body; }');
    assert.equal(run(process.execPath, 'check-packet', ['--workspace', workspace, '--operation', 'getSession', '--node', node, '--kit-digest', prepared.digest]).ok, true);
    const artifact = run(process.execPath, 'finalize-adapter', ['--workspace', workspace, '--node', node, '--kit-digest', prepared.digest, '--out', path.join(root, 'artifact')]);
    assert.equal(artifact.ok, true);
    assert.equal(await fs.stat(path.join(root, 'node_modules')).then(() => true, () => false), false);
    await fs.appendFile(path.join(protectedRoot, 'START-HERE.md'), 'tampered');
    const results = [];
    assert.equal(await runVerifyKit(['--kit', kit, '--digest', built.digest, '--json'], (line) => results.push(JSON.parse(line))), 1);
    assert.equal(results[0].error, 'kit-verification-failed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('verification requires independent digest and emits one fixed JSON result', async () => {
  const lines = [];
  assert.equal(await runVerifyKit(['--kit', 'private-location', '--digest', 'wrong', '--json'], (line) => lines.push(line)), 1);
  assert.deepEqual(lines, ['{"ok":false,"error":"invalid-arguments"}']);
});
