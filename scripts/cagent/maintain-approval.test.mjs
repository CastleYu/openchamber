import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runMaintainApproval } from './maintain-approval.mjs';
import { agentArtifactDigest } from '../../packages/web/server/lib/agent/artifacts.js';
import { createAgentApprovals } from '../../packages/web/server/lib/agent/approvals.js';

const invoke = async (args) => {
  const lines = [];
  const code = await runMaintainApproval(args, (line) => lines.push(line));
  assert.equal(lines.length, 1);
  return { code, text: lines[0], value: args.includes('--json') ? JSON.parse(lines[0]) : undefined };
};
const fixture = async (run) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-maintenance-'));
  try {
    const artifact = path.join(root, 'artifact');
    const directory = path.join(root, 'approvals');
    await fs.mkdir(artifact);
    await fs.mkdir(directory);
    const source = "throw new Error('maintenance must not execute candidates');\n";
    await fs.writeFile(path.join(artifact, 'adapter.mjs'), source);
    const files = [{ path: 'adapter.mjs', bytes: Buffer.byteLength(source), digest: createHash('sha256').update(source).digest('hex') }];
    const digest = agentArtifactDigest(files);
    const manifest = path.join(root, 'manifest.json');
    await fs.writeFile(manifest, JSON.stringify({ version: 1, artifactDigest: digest, files }));
    const value = { family: 'cagent', connectionID: 'connection', adapterID: 'adapter', adapterRevision: 'a', capabilityRevision: 'c',
      serverRevision: 's', artifactDigest: digest, operations: [{ operation: 'getSession', state: 'adapted', evidence: ['local-live:r1'] }],
      extensions: [{ actionID: 'cagent.sample', revision: 'r1', manifestDigest: 'a'.repeat(64), state: 'supported', evidence: ['local-live:extra'] }] };
    const review = path.join(root, 'review.json');
    await fs.writeFile(review, JSON.stringify(value));
    const args = ['--approve', '--review', review, '--artifact', artifact, '--manifest', manifest, '--digest', digest, '--directory', directory];
    const selection = { family: value.family, connectionID: value.connectionID, epoch: 1, adapterID: value.adapterID,
      adapterRevision: value.adapterRevision, capabilityRevision: value.capabilityRevision, serverRevision: value.serverRevision, ready: true, authorized: true };
    await run({ args, artifact, directory, manifest, review, value, selection });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
};

test('explicit reviewed approval persists and revokes only the CAgent connection', async () => fixture(async ({ args, directory, value, selection }) => {
  const approved = await invoke([...args, '--json']);
  assert.equal(approved.code, 0);
  assert.deepEqual(approved.value, { ok: true, action: 'approve', operations: 1, extensions: 1, evidenceScope: 'maintainer-reviewed', activation: 'host-gated' });
  const store = createAgentApprovals({ directory });
  assert.deepEqual(store.read(selection), value);
  assert.equal(store.read({ ...selection, family: 'opencode' }), null);
  const revoke = ['--revoke', '--connection', value.connectionID, '--directory', directory, '--json'];
  assert.deepEqual((await invoke(revoke)).value, { ok: true, action: 'revoke', removed: true });
  assert.equal(store.read(selection), null);
  assert.deepEqual((await invoke(revoke)).value, { ok: true, action: 'revoke', removed: false });
}));

test('missing explicit intent and mixed modes fail before reading or writing', async () => {
  for (const args of [[], ['--directory', 'private'], ['--approve', '--revoke', '--directory', 'private'],
    ['--revoke', '--connection', 'c', '--directory', 'private', '--review', 'private'], ['--unknown']]) {
    const result = await invoke([...args, '--json']);
    assert.deepEqual(result, { code: 1, text: '{"ok":false,"error":"invalid-arguments"}', value: { ok: false, error: 'invalid-arguments' } });
  }
});

test('invalid reviews preserve the existing reviewed record', async () => fixture(async ({ args, review, value, directory, selection }) => {
  assert.equal((await invoke([...args, '--json'])).code, 0);
  for (const changed of [{ ...value, family: 'opencode' }, { ...value, operations: [], extensions: [] },
    { ...value, operations: [{ operation: 'getSession', evidence: ['fixture'] }] },
    { ...value, operations: [{ operation: 'getSession', state: 'unverified', evidence: ['fixture'] }] },
    { ...value, operations: [{ operation: 'getSession', state: 'supported', evidence: [] }] },
    { ...value, unexpected: true }]) {
    await fs.writeFile(review, JSON.stringify(changed));
    assert.equal((await invoke([...args, '--json'])).value.error, 'invalid-maintainer-review');
    assert.deepEqual(createAgentApprovals({ directory }).read(selection), value);
  }
}));

test('independent digest mismatch and changed artifact refuse replacement', async () => fixture(async ({ args, artifact, directory, selection }) => {
  const changedArgs = [...args];
  changedArgs[changedArgs.indexOf('--digest') + 1] = 'b'.repeat(64);
  assert.equal((await invoke([...changedArgs, '--json'])).value.error, 'review-artifact-mismatch');
  assert.equal(createAgentApprovals({ directory }).read(selection), null);
  await fs.appendFile(path.join(artifact, 'adapter.mjs'), 'changed');
  assert.equal((await invoke([...args, '--json'])).value.error, 'review-artifact-mismatch');
  assert.equal(createAgentApprovals({ directory }).read(selection), null);
}));

test('human, quiet and noninteractive modes share validation without prompts', async () => fixture(async ({ args, review }) => {
  for (const flags of [[], ['--quiet']]) {
    const result = await invoke([...args, ...flags]);
    assert.equal(result.code, 0);
    assert.equal(result.text, 'approval recorded operations:1 extensions:1 activation:host-gated');
  }
  await fs.writeFile(review, 'invalid local content');
  for (const flags of [[], ['--quiet'], ['--json']]) {
    const result = await invoke([...args, ...flags]);
    assert.equal(result.code, 1);
    assert.equal(result.value?.error ?? result.text, 'review-input-unavailable');
  }
}));
