import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AGENT_ADAPTER, AGENT_ARTIFACT, AGENT_FAMILY, AGENT_OPERATION, AGENT_SUPPORT } from '../../packages/web/server/lib/agent/constants.js';
import { agentArtifactDigest } from '../../packages/web/server/lib/agent/artifacts.js';
import { loadAgentAdapter } from '../../packages/web/server/lib/agent/loader.js';
import { assembleAdapter, ASSEMBLY, AssemblyError } from './adapter-assembly.mjs';

const source = (operation, body = 'return () => 1;') => ({
  operation, text: `export function createOperation() { ${body} }`,
});
const digest = (text) => createHash('sha256').update(text).digest('hex');

test('bundles multiple operations deterministically without evaluating candidate code', async () => {
  globalThis.__assemblyRuns = 0;
  const first = source(AGENT_OPERATION.GET_SESSION, 'globalThis.__assemblyRuns += 1; return () => 1;');
  const second = source(AGENT_OPERATION.LIST_SESSIONS, 'return () => 2;');
  const built = await assembleAdapter([first, second]);
  const reordered = await assembleAdapter([second, first]);
  assert.equal(globalThis.__assemblyRuns, 0);
  assert.equal(built.source, reordered.source);
  assert.equal(built.digest, digest(built.source));
  assert.equal(built.bytes, Buffer.byteLength(built.source));
  assert.deepEqual(Object.keys(await import(`data:text/javascript;base64,${Buffer.from(built.source).toString('base64')}`)), [AGENT_ADAPTER.FACTORY]);
  delete globalThis.__assemblyRuns;
});

test('refuses duplicates, unknown or empty inputs, oversize source and imports with fixed errors', async () => {
  const valid = source(AGENT_OPERATION.GET_SESSION);
  await assert.rejects(assembleAdapter([]), (error) => error instanceof AssemblyError && error.code === ASSEMBLY.ERROR.INPUT);
  await assert.rejects(assembleAdapter([valid, valid]), (error) => error instanceof AssemblyError && error.code === ASSEMBLY.ERROR.INPUT);
  await assert.rejects(assembleAdapter([source('unknown')]), (error) => error instanceof AssemblyError && error.code === ASSEMBLY.ERROR.SOURCE);
  await assert.rejects(assembleAdapter([{ ...valid, text: ' ' }]), (error) => error instanceof AssemblyError && error.code === ASSEMBLY.ERROR.SOURCE);
  await assert.rejects(assembleAdapter([{ ...valid, text: 'x'.repeat(ASSEMBLY.LIMIT.SOURCE_BYTES + 1) }]), (error) => error instanceof AssemblyError && error.code === ASSEMBLY.ERROR.SOURCE);
  await assert.rejects(assembleAdapter([{ ...valid, text: "import fs from 'node:fs'; export function createOperation() {}" }]),
    (error) => error instanceof AssemblyError && error.code === ASSEMBLY.ERROR.SOURCE);
  await assert.rejects(assembleAdapter([{ operation: valid.operation, text: `${valid.text}\nexport const surprise = 1;` }]),
    (error) => error instanceof AssemblyError && error.code === ASSEMBLY.ERROR.SOURCE);
});

test('parser accepts comments and async factory syntax while rejecting static dynamic imports', async () => {
  const valid = { operation: AGENT_OPERATION.GET_SESSION, text: '// export default and import("example") are documentation\nexport async function createOperation() { return () => "from source"; }' };
  const result = await assembleAdapter([valid]);
  assert.ok(result.bytes > 0);
  const namespace = await import(`data:text/javascript;base64,${Buffer.from(result.source).toString('base64')}`);
  const adapter = await namespace.createAdapter({});
  assert.equal(adapter.handlers[AGENT_OPERATION.GET_SESSION](), 'from source');
  for (const text of [
    'export function createOperation() { return () => import("node:fs"); }',
    'export function createOperation() { return () => require("node:fs"); }',
    'export function createOperation() { return () => 1; } export default 2;',
  ]) {
    await assert.rejects(assembleAdapter([{ ...valid, text }]), AssemblyError);
  }
});

test('loader creates fresh operation state and keeps every capability unverified', async (t) => {
  const first = source(AGENT_OPERATION.GET_SESSION, 'let calls = 0; return () => ++calls;');
  const second = source(AGENT_OPERATION.LIST_SESSIONS, 'return () => 2;');
  const built = await assembleAdapter([first, second]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-assembly-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, AGENT_ADAPTER.ENTRY), built.source);
  const files = [{ path: AGENT_ADAPTER.ENTRY, bytes: built.bytes, digest: built.digest }];
  const manifest = { version: AGENT_ARTIFACT.VERSION, files, artifactDigest: agentArtifactDigest(files) };
  const profile = { adapterID: 'test', family: AGENT_FAMILY.CAGENT, adapterRevision: 'r1', capabilityRevision: 'c1' };
  const transport = { request: async () => ({ status: 200, body: null }) };
  const loadedA = await loadAgentAdapter({ directory, manifest, profile, transport });
  const loadedB = await loadAgentAdapter({ directory, manifest, profile, transport });
  assert.equal(loadedA.handlers[AGENT_OPERATION.GET_SESSION](), 1);
  assert.equal(loadedA.handlers[AGENT_OPERATION.GET_SESSION](), 2);
  assert.equal(loadedB.handlers[AGENT_OPERATION.GET_SESSION](), 1);
  assert.equal(Object.keys(loadedA.capabilities).length, 22);
  assert.ok(Object.values(loadedA.capabilities).every(({ state, evidence }) => state === AGENT_SUPPORT.UNVERIFIED && evidence.length === 0));
});
