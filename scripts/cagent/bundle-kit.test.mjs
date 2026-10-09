import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBundleKit } from './bundle-kit.mjs';
import { runVerifyKit } from './verify-kit.mjs';
import { catalogDigest, compileMapping } from './mapping-intake.mjs';
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

test('standalone bundle runs outside checkout without installed dependencies and refuses tampering', { timeout: 120000 }, async () => {
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
    const extension = run(node, 'check-extension', ['--manifest', 'templates/extension/manifest.json',
      '--input', 'templates/extension/input.json', '--result', 'templates/extension/result.json']);
    assert.equal(extension.activation, 'unavailable');
    assert.equal(extension.checkScope, 'structural-only');
    assert.ok(JSON.parse(await fs.readFile(path.join(protectedRoot, 'schemas/declarative-bindings.json'), 'utf8')).properties.operations);
    const citations = [{ document: 'guide', section: 'read' }];
    const text = JSON.stringify({ openapi: '3.1.0', paths: { '/fixture/session': { get: { operationId: 'read', responses: { 200: { description: 'Synthetic session' } } } } } });
    await fs.writeFile(path.join(root, 'source.json'), JSON.stringify({ version: 1, id: 'guide', revision: 'r1', text }));
    await fs.writeFile(path.join(root, 'review.json'), JSON.stringify({ version: 1, revision: 'r1',
      endpoints: { read: { effect: 'read', requestRef: 'input', responseRef: 'output' } }, sections: [] }));
    const intake = path.join(root, 'intake');
    assert.equal(run(node, 'import-openapi', ['--source', path.join(root, 'source.json'), '--review', path.join(root, 'review.json'), '--out', intake]).endpoints, 1);
    const catalog = JSON.parse(await fs.readFile(path.join(intake, 'catalog.json'), 'utf8'));
    const documents = JSON.parse(await fs.readFile(path.join(intake, 'documents.json'), 'utf8'));
    const mapping = { version: 1, catalogRevision: 'r1', catalogDigest: catalogDigest(catalog),
      operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((operation) => [operation, operation === 'getSession'
        ? { kind: 'mapping', endpointIDs: ['read'], codec: 'declarative', evidence: Object.fromEntries(['transport', 'auth', 'scope', 'result', 'failure', 'completion', 'cancellation'].map((key) => [key, citations])) }
        : { kind: 'unverified', question: 'Review locally' }])), endpoints: { read: { kind: 'shared', operations: ['getSession'] } } };
    const fixtures = { getSession: { version: 1, operation: 'getSession', cases: [{ id: 'scope', input: { workspaceID: 'space', sessionID: 'session' },
      identity: { family: 'cagent', connectionID: 'fixture', epoch: 1, adapterRevision: 'a', capabilityRevision: 'c' },
      exchanges: [{ request: { method: 'GET', path: '/fixture/session' }, outcome: { kind: 'response', response: { status: 200, body: { id: 'session', workspaceID: 'space' } } } }],
      expected: { kind: 'result', result: { id: 'session', workspaceID: 'space' } } }] } };
    const bindings = { version: 1, mappingDigest: compileMapping(catalog, mapping).digest, operations: { getSession: {
      endpointID: 'read', successStatuses: [200], path: {}, result: { kind: 'field', from: 'response', path: ['body'] },
    } } };
    for (const [name, value] of Object.entries({ catalog, mapping, fixtures, bindings })) await fs.writeFile(path.join(root, `${name}.json`), JSON.stringify(value));
    const inputs = ['--catalog', path.join(root, 'catalog.json'), '--mapping', path.join(root, 'mapping.json')];
    assert.equal(run(node, 'check-mapping', inputs).ok, true);
    const extensionCatalog = structuredClone(catalog);
    extensionCatalog.endpoints.push({ id: 'extra', method: 'POST', path: '/synthetic/action', requestRef: 'input', responseRef: 'result', effect: 'mutation', citations });
    const extensionMapping = structuredClone(mapping);
    extensionMapping.catalogDigest = catalogDigest(extensionCatalog);
    extensionMapping.endpoints.extra = { kind: 'extension', actionID: 'cagent.sample', fit: 'form-action-result', citations };
    const extensionManifest = JSON.parse(await fs.readFile(path.join(protectedRoot, 'templates/extension/manifest.json'), 'utf8'));
    extensionManifest.effect = 'mutation';
    extensionManifest.evidence = citations;
    for (const [name, value] of Object.entries({ 'extension-catalog': extensionCatalog, 'extension-mapping': extensionMapping, manifests: [extensionManifest] })) {
      await fs.writeFile(path.join(root, `${name}.json`), JSON.stringify(value));
    }
    const extensionInventory = run(node, 'check-extension', ['--catalog', path.join(root, 'extension-catalog.json'),
      '--mapping', path.join(root, 'extension-mapping.json'), '--manifests', path.join(root, 'manifests.json')]);
    assert.equal(extensionInventory.checkScope, 'inventory-and-structure-only');
    assert.equal(extensionInventory.coverage.actions.length, 1);
    assert.equal(extensionInventory.coverage.actions[0].available, false);
    const workspace = path.join(root, 'workspace');
    await fs.writeFile(path.join(root, 'documents.json'), JSON.stringify(documents));
    const prepared = run(node, 'prepare-packets', [...inputs, '--fixtures', path.join(root, 'fixtures.json'),
      '--bindings', path.join(root, 'bindings.json'), '--documents', path.join(root, 'documents.json'), '--out', workspace]);
    assert.equal(JSON.parse(JSON.parse(await fs.readFile(path.join(workspace, 'protected/getSession/api-excerpts.json'), 'utf8')).documents[0].sections[0].text).operationId, 'read');
    assert.equal(JSON.parse(await fs.readFile(path.join(workspace, 'protected/getSession/packet.json'), 'utf8')).status, 'awaiting-validation');
    assert.equal(run(process.execPath, 'check-packet', ['--workspace', workspace, '--operation', 'getSession', '--node', node, '--kit-digest', prepared.digest]).ok, true);
    const artifact = run(process.execPath, 'finalize-adapter', ['--workspace', workspace, '--node', node, '--kit-digest', prepared.digest, '--out', path.join(root, 'artifact')]);
    assert.equal(artifact.ok, true);
    const calibration = path.join(root, 'calibration');
    const modelRecord = path.join(root, 'model.json');
    const trialRecord = path.join(root, 'trial.json');
    await fs.writeFile(modelRecord, JSON.stringify({ version: 1, id: 'scripted', build: 'r1', language: 'en', execution: 'scripted',
      inputBudget: { unit: 'bytes', limit: 8000, method: 'utf8' } }));
    await fs.writeFile(trialRecord, JSON.stringify({ version: 1, modelID: 'scripted', modelBuild: 'r1', language: 'en',
      input: { mapping: 400, codec: 600, gap: 400 }, elapsedMs: 0, interventions: 0 }));
    const calibrated = run(process.execPath, 'calibrate', ['--prepare', '--model-record', modelRecord, '--out', calibration]);
    await fs.writeFile(path.join(calibration, 'candidate/getSession/answer.json'), JSON.stringify({ method: 'GET', path: '/training/records',
      query: { space: 'workspaceID', record: 'sessionID' }, result: { id: 'record', workspaceID: 'space' } }));
    await fs.writeFile(path.join(calibration, 'candidate/interruptSession/answer.json'), JSON.stringify({ operation: 'interruptSession',
      missing: 'confirmed-cancellation', section: 'training.cancel-gap', question: 'Please supply cancellation documentation.' }));
    await fs.writeFile(path.join(calibration, 'candidate/getSessionStatus/handler.mjs'),
      `export function createOperation(context) { return async (input,identity,control) => {
        const response = await context.request({method:'GET',path:'/training/status',query:{space:input.workspaceID,record:input.sessionID}},identity,control);
        const states = {0:'idle',1:'busy',2:'waiting'};
        return {sessionID:response.body.record,state:states[response.body.phase] ?? 'unknown'};
      }; }`);
    const calibratedResult = run(process.execPath, 'calibrate', ['--check', '--workspace', calibration,
      '--kit-digest', calibrated.digest, '--node', node, '--trial-record', trialRecord]);
    assert.equal(calibratedResult.assignment, 'bounded-codec');
    assert.equal(calibratedResult.activation, 'unavailable');
    const extraFixtures = { version: 1, actionID: extensionManifest.actionID, manifest: extensionManifest, cases: [{ id: 'completed',
      input: { workspaceID: 'space', requestID: 'request-1', values: { query: 'hello' } }, identity: fixtures.getSession.cases[0].identity,
      exchanges: [{ request: { method: 'POST', path: '/synthetic/action', body: { query: 'hello' } },
        outcome: { kind: 'response', response: { status: 200, body: { text: 'hello' } } } }],
      expected: { kind: 'result', result: { result: { text: 'hello' }, receipt: { requestID: 'request-1', state: 'complete' } } },
    }] };
    await fs.writeFile(path.join(root, 'extensions.json'), JSON.stringify({ manifests: [extensionManifest], fixtures: { [extensionManifest.actionID]: extraFixtures } }));
    const extraWorkspace = path.join(root, 'extra-workspace');
    const extraPrepared = run(node, 'prepare-packets', ['--catalog', path.join(root, 'extension-catalog.json'),
      '--mapping', path.join(root, 'extension-mapping.json'), '--fixtures', path.join(root, 'fixtures.json'),
      '--extensions', path.join(root, 'extensions.json'), '--out', extraWorkspace]);
    await fs.copyFile(path.join(workspace, 'candidate/getSession/handler.mjs'), path.join(extraWorkspace, 'candidate/getSession/handler.mjs'));
    await fs.writeFile(path.join(extraWorkspace, 'candidate/cagent.sample/handler.mjs'), `export function createExtension(context) {
      return async (input, identity) => { const response = await context.request({ method: 'POST', path: '/synthetic/action', body: { query: input.values.query } }, identity);
        return { result: response.body, receipt: { requestID: input.requestID, state: 'complete' } }; }; }`);
    assert.equal(run(process.execPath, 'check-packet', ['--workspace', extraWorkspace, '--operation', 'cagent.sample', '--node', node, '--kit-digest', extraPrepared.digest]).ok, true);
    const extraOutput = path.join(root, 'extra-output');
    const extraFinalized = run(process.execPath, 'finalize-adapter', ['--workspace', extraWorkspace, '--node', node, '--kit-digest', extraPrepared.digest, '--out', extraOutput]);
    assert.equal(extraFinalized.extensions, 1);
    assert.equal(extraFinalized.activation, 'unavailable');
    const approvals = path.join(root, 'approvals');
    await fs.mkdir(approvals);
    const approvalFile = path.join(root, 'maintainer-approval.json');
    await fs.writeFile(approvalFile, JSON.stringify({ family: 'cagent', connectionID: 'synthetic', adapterID: 'offline-test',
      adapterRevision: 'r1', capabilityRevision: 'c1', serverRevision: 's1', artifactDigest: extraFinalized.artifactDigest,
      operations: [{ operation: 'getSession', state: 'adapted', evidence: ['synthetic-owner-review'] }] }));
    const reviewed = run(node, 'maintain-approval', ['--approve', '--review', approvalFile, '--artifact', path.join(extraOutput, 'artifact'),
      '--manifest', path.join(extraOutput, 'control/manifest.json'), '--digest', extraFinalized.artifactDigest, '--directory', approvals]);
    assert.equal(reviewed.activation, 'host-gated');
    assert.equal(reviewed.operations, 1);
    assert.equal((await fs.readdir(approvals)).length, 1);
    assert.equal(run(node, 'maintain-approval', ['--revoke', '--connection', 'synthetic', '--directory', approvals]).removed, true);
    assert.deepEqual(await fs.readdir(approvals), []);
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
