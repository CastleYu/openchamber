import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_OPERATION } from '../../packages/web/server/lib/agent/constants.js';
import { verifyAgentArtifacts } from '../../packages/web/server/lib/agent/artifacts.js';
import { catalogDigest } from './mapping-intake.mjs';
import { runPrepareCommand, PREPARE_COMMAND } from './prepare-packets.mjs';

const fixture = async (root, ready = true) => {
  const citations = [{ document: 'guide', section: 'read' }];
  const catalog = { version: 1, revision: 'r1', documents: [{ id: 'guide', revision: 'r1', digest: 'a'.repeat(64), sections: ['read'] }],
    endpoints: [{ id: 'read', method: 'GET', path: '/sessions/{id}', requestRef: 'input', responseRef: 'output', effect: 'read', citations }] };
  const mapping = { version: 1, catalogRevision: catalog.revision, catalogDigest: catalogDigest(catalog),
    operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((operation) => [operation,
      ready && operation === AGENT_OPERATION.GET_SESSION
        ? { kind: 'mapping', endpointIDs: ['read'], codec: 'custom', evidence: Object.fromEntries(['transport', 'auth', 'scope', 'result', 'failure', 'completion', 'cancellation'].map((key) => [key, citations])) }
        : { kind: 'unverified', question: 'Review locally' }])),
    endpoints: { read: ready ? { kind: 'shared', operations: [AGENT_OPERATION.GET_SESSION] } : { kind: 'out-of-scope', reason: 'unresolved', citations } } };
  const catalogPath = path.join(root, 'catalog.json');
  const mappingPath = path.join(root, 'mapping.json');
  await fs.writeFile(catalogPath, JSON.stringify(catalog));
  await fs.writeFile(mappingPath, JSON.stringify(mapping));
  return ['--catalog', catalogPath, '--mapping', mappingPath, '--out', path.join(root, 'workspace'), '--json'];
};
const run = async (args) => {
  const lines = [];
  const code = await runPrepareCommand(args, (line) => lines.push(line));
  assert.equal(lines.length, 1);
  return { code, report: JSON.parse(lines[0]), line: lines[0] };
};

test('native preparation creates verifiable protected files and preserves candidate work on repeat', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-prepare-'));
  try {
    const args = await fixture(root);
    const command = fileURLToPath(new URL('./prepare-packets.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [command, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.equal(report.packets, 1);
    assert.equal(report.activation, 'unavailable');
    assert.equal(report.checkScope, 'syntax-only');
    assert.equal(result.stdout.includes(root), false);
    const workspace = path.join(root, 'workspace');
    const manifest = JSON.parse(await fs.readFile(path.join(workspace, PREPARE_COMMAND.MANIFEST), 'utf8'));
    const verify = () => verifyAgentArtifacts({ directory: path.join(workspace, 'protected'), manifest });
    assert.equal((await verify()).artifactDigest, report.digest);
    const candidate = path.join(workspace, 'candidate/getSession/handler.mjs');
    await fs.writeFile(candidate, '// completed local work\n');
    await verify();
    const repeated = await run(args);
    assert.equal(repeated.code, 1);
    assert.equal(repeated.report.error, PREPARE_COMMAND.EXISTS);
    assert.equal(await fs.readFile(candidate, 'utf8'), '// completed local work\n');
    await fs.appendFile(path.join(workspace, 'protected/getSession/packet.json'), ' ');
    await assert.rejects(verify());
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('unresolved mapping creates no workspace and setup failures expose fixed errors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-unresolved-'));
  try {
    const args = await fixture(root, false);
    const result = await run(args);
    assert.equal(result.code, 1);
    assert.equal(result.report.error, 'no-ready-operations');
    assert.deepEqual((await fs.readdir(root)).sort(), ['catalog.json', 'mapping.json']);
    await fs.writeFile(path.join(root, 'catalog.json'), 'private-invalid-content');
    const invalid = await run(args);
    assert.equal(invalid.report.error, PREPARE_COMMAND.INPUT);
    assert.equal(invalid.line.includes('private'), false);
    assert.equal(invalid.line.includes(root), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
  for (const args of [[], ['--unknown'], ['positional']]) {
    assert.equal((await run([...args, '--json'])).report.error, PREPARE_COMMAND.INVALID);
  }
});
