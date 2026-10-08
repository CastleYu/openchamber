import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMappingCommand, MAPPING_COMMAND } from './check-mapping.mjs';
import { catalogDigest } from './mapping-intake.mjs';
import { AGENT_OPERATION } from '../../packages/web/server/lib/agent/constants.js';

const run = async (args) => {
  const lines = [];
  const code = await runMappingCommand(args, (line) => lines.push(line));
  assert.equal(lines.length, 1);
  return { code, line: lines[0] };
};

test('missing and unknown flags fail noninteractively without reading or exposing paths', async () => {
  for (const args of [[], ['--catalog', 'private-secret'], ['--unknown'], ['unexpected']]) {
    const result = await run([...args, '--json']);
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.line), { ok: false, error: MAPPING_COMMAND.INVALID });
    assert.equal(result.line.includes('private-secret'), false);
  }
  assert.equal((await run(['--quiet'])).line, MAPPING_COMMAND.INVALID);
});

test('unreadable, malformed, oversized and invalid schema input expose fixed errors only', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-intake-cli-'));
  try {
    const catalog = path.join(root, 'private-catalog.json');
    const mapping = path.join(root, 'private-mapping.json');
    await fs.writeFile(mapping, '{}');
    const args = ['--catalog', catalog, '--mapping', mapping, '--json'];
    let result = await run(args);
    assert.deepEqual(JSON.parse(result.line), { ok: false, error: MAPPING_COMMAND.INPUT });
    await fs.writeFile(catalog, 'private-invalid-json');
    result = await run(args);
    assert.deepEqual(JSON.parse(result.line), { ok: false, error: MAPPING_COMMAND.INPUT });
    await fs.writeFile(catalog, Buffer.alloc(MAPPING_COMMAND.MAX_BYTES + 1));
    result = await run(args);
    assert.deepEqual(JSON.parse(result.line), { ok: false, error: MAPPING_COMMAND.INPUT });
    await fs.writeFile(catalog, '{}');
    result = await run(args);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.line).error, 'invalid-catalog');
    assert.deepEqual(JSON.parse(result.line).details, { operation: null, check: 'schema', nextAction: 'review-catalog' });
    assert.equal(result.line.includes(root), false);
    assert.deepEqual(await fs.readdir(root), ['private-catalog.json', 'private-mapping.json']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native piped command produces one JSON failure and nonzero exit without a prompt', () => {
  const command = fileURLToPath(new URL('./check-mapping.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [command, '--unknown', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { ok: false, error: MAPPING_COMMAND.INVALID });
});

test('a complete unresolved inventory checks successfully while every feature remains unavailable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-intake-success-'));
  try {
    const catalog = { version: 1, revision: 'fixture-only', documents: [], endpoints: [] };
    const mapping = { version: 1, catalogRevision: catalog.revision, catalogDigest: catalogDigest(catalog),
      operations: Object.fromEntries(Object.values(AGENT_OPERATION).map((id) => [id, { kind: 'unverified', question: 'Document this operation' }])), endpoints: {} };
    const files = [path.join(root, 'catalog.json'), path.join(root, 'mapping.json')];
    await fs.writeFile(files[0], JSON.stringify(catalog));
    await fs.writeFile(files[1], JSON.stringify(mapping));
    const args = ['--catalog', files[0], '--mapping', files[1]];
    const checked = await run([...args, '--json']);
    const report = JSON.parse(checked.line);
    assert.equal(checked.code, 0);
    assert.equal(report.ok, true);
    assert.equal(Object.keys(report.coverage.operations).length, 22);
    assert.equal(Object.values(report.coverage.features).every((row) => row.available === false && row.state === 'blocked'), true);
    const command = fileURLToPath(new URL('./check-mapping.mjs', import.meta.url));
    const native = spawnSync(process.execPath, [command, ...args, '--json'], { encoding: 'utf8' });
    assert.equal(native.status, 0);
    assert.equal(native.stderr, '');
    assert.deepEqual(JSON.parse(native.stdout), report);
    assert.match((await run([...args, '--quiet'])).line, /activation:unavailable$/);
    assert.deepEqual(await fs.readdir(root), ['catalog.json', 'mapping.json']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
