import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extensionManifestSchema, parseExtensionInput, parseExtensionResult, buildExtensionSchema } from './extensions.js';
import { buildExtensionTemplate } from '../../../../../scripts/cagent/extension-template.mjs';
import { runCheckExtension } from '../../../../../scripts/cagent/check-extension.mjs';

const manifest = () => JSON.parse(buildExtensionTemplate().get('templates/extension/manifest.json'));
const field = (key, value, required = true) => ({ key, required, label: { key: `cagent.sample.${key}`, en: key, zhCN: key }, value });

test('extension checker refuses invalid contracts without exposing local inputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cagent-extension-check-'));
  try {
    const source = path.join(root, 'manifest.json');
    const input = path.join(root, 'input.json');
    await fs.writeFile(source, JSON.stringify(manifest()));
    await fs.writeFile(input, JSON.stringify({ query: 123, privateValue: 'private-source-marker' }));
    for (const flag of ['--json', '--quiet']) {
      const lines = [];
      assert.equal(await runCheckExtension(['--manifest', source, '--input', input, flag], (line) => lines.push(line)), 1);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].includes(root), false);
      assert.equal(lines[0].includes('private-source-marker'), false);
      assert.equal(flag === '--json' ? JSON.parse(lines[0]).error : lines[0], 'invalid-extension-contract');
    }
    await fs.writeFile(source, JSON.stringify({ ...manifest(), version: 2 }));
    const lines = [];
    assert.equal(await runCheckExtension(['--manifest', source, '--json'], (line) => lines.push(line)), 1);
    assert.deepEqual(JSON.parse(lines[0]), { ok: false, error: 'invalid-extension-contract' });
    lines.length = 0;
    assert.equal(await runCheckExtension(['--enable', '--json'], (line) => lines.push(line)), 1);
    assert.deepEqual(JSON.parse(lines[0]), { ok: false, error: 'invalid-arguments' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('strict finite manifest and values keep authority outside candidate data', () => {
  const value = manifest();
  const input = { query: 'sample' };
  const parsed = parseExtensionInput(value, input);
  input.query = 'changed';
  assert.deepEqual(parsed, { query: 'sample' });
  assert.deepEqual(parseExtensionResult(value, { text: 'result' }), { text: 'result' });
  for (const extension of [{ ...value, enabled: true }, { ...value, version: 2 }, { ...value, actionID: 'opencode.sample' },
    { ...value, authorization: 'allow-all' }, { ...value, context: { workspace: false, session: true } }]) {
    assert.equal(extensionManifestSchema.safeParse(extension).success, false);
  }
  assert.throws(() => parseExtensionInput(value, { query: 'sample', shell: 'run' }));
  assert.throws(() => parseExtensionResult(value, { text: 'result', html: '<script>' }));
  assert.ok(buildExtensionSchema().properties.input);
});

test('finite scalars and bounded lists reject coercion, unsafe keys and nested controls', () => {
  const value = manifest();
  value.input = [field('count', { kind: 'number', min: 0, max: 4 }), field('flag', { kind: 'boolean' }),
    field('tags', { kind: 'list', item: { kind: 'text', maxLength: 3 }, maxItems: 2 }, false),
    field('mode', { kind: 'choice', choices: [{ value: 'one', label: { key: 'cagent.sample.one', en: 'One', zhCN: '一' } }] })];
  assert.deepEqual(parseExtensionInput(value, { count: 2, flag: true, mode: 'one' }), { count: 2, flag: true, mode: 'one' });
  for (const input of [{ count: '2', flag: true, mode: 'one' }, { count: 5, flag: true, mode: 'one' },
    { count: 2, flag: 1, mode: 'one' }, { count: 2, flag: true, mode: 'two' }, { count: 2, flag: true, mode: 'one', tags: ['long'] },
    { count: 2, flag: true, mode: 'one', tags: ['a', 'b', 'c'] }, { count: NaN, flag: true, mode: 'one' }]) assert.throws(() => parseExtensionInput(value, input));
  for (const fields of [[field('constructor', { kind: 'boolean' })], [field('x', { kind: 'list', item: { kind: 'list' }, maxItems: 2 })],
    [field('x', { kind: 'number', min: 2, max: 1 })], [field('x', { kind: 'boolean' }), field('x', { kind: 'boolean' })],
    [field('x', { kind: 'html' })]]) assert.equal(extensionManifestSchema.safeParse({ ...value, input: fields }).success, false);
});

test('structured fields and tables bound output and preserve missing versus empty values', () => {
  const value = manifest();
  const columns = [field('name', { kind: 'text', maxLength: 8 }), field('score', { kind: 'number', min: 0, max: 10 }, false)];
  value.output = { kind: 'fields', fields: columns };
  assert.deepEqual(parseExtensionResult(value, { fields: { name: '' } }), { fields: { name: '' } });
  assert.throws(() => parseExtensionResult(value, { fields: {} }));
  value.output = { kind: 'table', columns, maxRows: 1 };
  assert.deepEqual(parseExtensionResult(value, { rows: [{ name: 'row', score: 2 }] }), { rows: [{ name: 'row', score: 2 }] });
  for (const result of [{ rows: [{ name: null }] }, { rows: [{ name: 'row', extra: true }] }, { rows: [{ name: 'a' }, { name: 'b' }] }]) {
    assert.throws(() => parseExtensionResult(value, result));
  }
});

test('synthetic template handler refuses before transport and cannot claim support', async () => {
  const files = buildExtensionTemplate();
  const source = files.get('templates/extension/handler.mjs');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let calls = 0;
  const handler = module.createExtension({ request: () => { calls += 1; } });
  await assert.rejects(handler({}, {}, {}), /unverified/);
  assert.equal(calls, 0);
});
