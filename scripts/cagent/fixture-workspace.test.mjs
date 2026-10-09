import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { agentArtifactDigest } from '../../packages/web/server/lib/agent/artifacts.js';
import { createAgentPacketWorkspace } from '../../packages/web/server/lib/agent/packet-workspace.js';
import { createFixtureChecks } from './fixture-checks.mjs';
import { assembleAdapter } from './adapter-assembly.mjs';

test('real workspace resumes captured candidate checks and persists the correction ceiling', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-fixture-workspace-'));
  try {
    const operation = 'getSession';
    const definition = { version: 1, operation, cases: [{ id: 'session-scope',
      input: { workspaceID: 'space', sessionID: 'session' },
      identity: { family: 'cagent', connectionID: 'fixture', epoch: 1, adapterRevision: 'a', capabilityRevision: 'c' },
      exchanges: [{ request: { method: 'GET', path: '/fixture/session' }, outcome: { kind: 'response', response: { status: 200, body: { id: 'session', workspaceID: 'space' } } } }],
      expected: { kind: 'result', result: { id: 'session', workspaceID: 'space' } },
    }] };
    const protectedDirectory = path.join(root, 'protected');
    const directory = path.join(root, 'candidate');
    const progressDirectory = path.join(root, 'progress');
    await Promise.all([protectedDirectory, directory, progressDirectory].map((name) => fs.mkdir(name)));
    const fixtureText = JSON.stringify(definition);
    await fs.writeFile(path.join(protectedDirectory, 'fixtures.json'), fixtureText);
    const records = [{ path: 'fixtures.json', bytes: Buffer.byteLength(fixtureText), digest: createHash('sha256').update(fixtureText).digest('hex') }];
    const manifest = { version: 1, files: records, artifactDigest: agentArtifactDigest(records) };
    const checks = createFixtureChecks(definition, async (sources) => {
      const built = await assembleAdapter(sources.map(({ text }) => ({ operation, text })));
      const namespace = await import(`data:text/javascript;base64,${Buffer.from(built.source).toString('base64')}`);
      return async (context) => (await namespace.createAdapter(context)).handlers[operation];
    });
    const options = { protectedDirectory, manifest, progressDirectory,
      packets: [{ operation, directory, files: ['handler.mjs'], dependsOn: [], checks }] };
    const candidate = path.join(directory, 'handler.mjs');
    await fs.writeFile(candidate, 'export function createOperation() { return async () => ({id:"session",workspaceID:"space"}); }');
    let runner = createAgentPacketWorkspace(options);
    assert.equal((await runner.run(operation)).state, 'fixtures-failed');
    await fs.writeFile(candidate, 'export function createOperation(context) { return async (input,identity,control) => (await context.request({method:"GET",path:"/fixture/session"},identity,control)).body; }');
    runner = createAgentPacketWorkspace(options);
    const passed = await runner.run(operation);
    assert.equal(passed.state, 'fixtures-passed');
    assert.equal(passed.failures, 1);
    await fs.writeFile(candidate, 'export function createOperation() { return async () => ({id:"wrong",workspaceID:"space"}); }');
    assert.equal((await runner.run(operation)).failures, 2);
    assert.equal((await runner.run(operation)).state, 'blocked');
    runner = createAgentPacketWorkspace(options);
    assert.equal((await runner.run(operation)).reason, 'maintainer-required');
    await fs.appendFile(path.join(protectedDirectory, 'fixtures.json'), ' ');
    assert.equal((await runner.run(operation)).reason, 'protected-kit-changed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
