import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createAcpCallbacks, CALLBACK } from './callbacks.js';
import { spawnAcp } from './process.js';

const setup = async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'acp-callbacks-'));
  const root = join(folder, 'project');
  const outside = join(folder, 'outside');
  await Promise.all([mkdir(root), mkdir(outside)]);
  const output = [];
  const callbacks = createAcpCallbacks({ directory: (id) => ['a', 'b'].includes(id) ? root : undefined, onOutput: (event) => output.push(event) });
  t.after(async () => { await callbacks.stop(); await rm(folder, { recursive: true, force: true }); });
  const call = (method, params = {}) => callbacks.request(method, { sessionId: 'a', ...params });
  const run = (script, extra = {}) => call(CALLBACK.CREATE, { command: process.execPath, args: ['-e', script], ...extra });
  return { root, outside, callbacks, call, run, output };
};

test('ACP files preserve UTF-8 and line endings, support bounded reads and new files', async (t) => {
  const { root, call } = await setup(t);
  const path = join(root, 'text.txt');
  assert.deepEqual(await call(CALLBACK.WRITE, { path, content: '中文\r\nsecond\nlast' }), {});
  assert.deepEqual(await call(CALLBACK.READ, { path }), { content: '中文\r\nsecond\nlast' });
  assert.deepEqual(await call(CALLBACK.READ, { path, line: 2, limit: 1 }), { content: 'second\n' });
  assert.deepEqual(await call(CALLBACK.READ, { path, line: 3 }), { content: 'last' });
  assert.deepEqual(await call(CALLBACK.READ, { path, line: 50 }), { content: '' });
  assert.deepEqual(await call(CALLBACK.READ, { path, limit: 0 }), { content: '' });
  await assert.rejects(call(CALLBACK.READ, { path, line: 0 }));
  await assert.rejects(call(CALLBACK.READ, { path: 'text.txt' }));
});

test('ACP file and terminal paths reject outside roots and junction escapes', async (t) => {
  const { root, outside, call, run } = await setup(t);
  const path = join(outside, 'private.txt');
  await writeFile(path, 'private');
  await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const candidate of [path, join(root, 'escape', 'private.txt')]) {
    await assert.rejects(call(CALLBACK.READ, { path: candidate }), /outside/);
    await assert.rejects(call(CALLBACK.WRITE, { path: candidate, content: 'changed' }), /outside/);
  }
  await assert.rejects(call(CALLBACK.WRITE, { path: join(root, 'escape', 'new.txt'), content: 'changed' }), /outside/);
  await assert.rejects(run('', { cwd: outside }), /outside/);
  await assert.rejects(run('', { cwd: join(root, 'escape') }), /outside/);
  await assert.rejects(call(CALLBACK.READ, { sessionId: 'missing', path }), /Unknown ACP session/);
  assert.equal(await readFile(path, 'utf8'), 'private');
});

test('ACP terminal keeps literal argv, merged environment, UTF-8 output and exit status', { timeout: 15000 }, async (t) => {
  const { root, call, run, output } = await setup(t);
  const { terminalId } = await run('process.stdout.write(JSON.stringify([process.argv[1],process.env.ACP_CALLBACK_VALUE,process.cwd()]));process.stderr.write("末尾");process.exitCode=7', { args: ['-e', 'process.stdout.write(JSON.stringify([process.argv[1],process.env.ACP_CALLBACK_VALUE,process.cwd()]));process.stderr.write("末尾");process.exitCode=7', 'a&b%literal'], env: [{ name: 'ACP_CALLBACK_VALUE', value: 'value' }] });
  assert.deepEqual(await call(CALLBACK.WAIT, { terminalId }), { exitCode: 7, signal: null });
  const result = await call(CALLBACK.OUTPUT, { terminalId });
  assert.ok(result.output.includes(JSON.stringify(['a&b%literal', 'value', root])));
  assert.ok(result.output.includes('末尾'));
  assert.equal(result.truncated, false);
  assert.deepEqual(result.exitStatus, { exitCode: 7, signal: null });
  assert.ok(output.some((event) => event.terminalId === terminalId && event.exitStatus?.exitCode === 7));
  await assert.rejects(call(CALLBACK.OUTPUT, { sessionId: 'b', terminalId }), /Unknown ACP terminal/);
  await assert.rejects(call(CALLBACK.KILL, { sessionId: 'b', terminalId }), /Unknown ACP terminal/);
  await call(CALLBACK.RELEASE, { terminalId });
  await call(CALLBACK.RELEASE, { terminalId });
  await assert.rejects(call(CALLBACK.OUTPUT, { terminalId }), /Unknown ACP terminal/);
});

test('ACP output cap drops oldest bytes at character boundaries, including split chunks', { timeout: 15000 }, async (t) => {
  const { call, run } = await setup(t);
  const { terminalId } = await run('const b=Buffer.from("旧中文新");process.stdout.write(b.subarray(0,5));setTimeout(()=>process.stdout.write(b.subarray(5)),20)', { outputByteLimit: 7 });
  await call(CALLBACK.WAIT, { terminalId });
  const result = await call(CALLBACK.OUTPUT, { terminalId });
  assert.equal(result.output, '文新');
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.output) <= 7);
  const zero = await run('process.stdout.write("hello")', { outputByteLimit: 0 });
  await call(CALLBACK.WAIT, zero);
  assert.equal((await call(CALLBACK.OUTPUT, zero)).output, '');
});

test('ACP terminal kill retains output and release closes a running command', { timeout: 15000 }, async (t) => {
  const { call, run, output } = await setup(t);
  const { terminalId } = await run('process.stdout.write("ready");setInterval(()=>{},1000)');
  await new Promise((resolve) => {
    const poll = () => output.some((event) => event.terminalId === terminalId && event.output.includes('ready')) ? resolve() : setTimeout(poll, 10);
    poll();
  });
  await call(CALLBACK.KILL, { terminalId });
  assert.equal((await call(CALLBACK.OUTPUT, { terminalId })).output, 'ready');
  assert.ok((await call(CALLBACK.OUTPUT, { terminalId })).exitStatus);
  await call(CALLBACK.KILL, { terminalId });
  await call(CALLBACK.RELEASE, { terminalId });
  const active = await run('setInterval(()=>{},1000)');
  await call(CALLBACK.RELEASE, active);
  await assert.rejects(call(CALLBACK.OUTPUT, active), /Unknown/);
});

test('ACP stop waits pending creates, owns session cleanup and rejects later global creates', { timeout: 15000 }, async (t) => {
  const { call, run, callbacks } = await setup(t);
  const peer = await run('setInterval(()=>{},1000)', { sessionId: 'b' });
  const pending = run('setInterval(()=>{},1000)');
  const stopped = callbacks.stop('a');
  await assert.rejects(pending, /stopp/);
  await stopped;
  assert.equal((await call(CALLBACK.OUTPUT, { ...peer, sessionId: 'b' })).exitStatus, undefined);
  await callbacks.stop();
  await callbacks.stop();
  await assert.rejects(run(''), /stopp/);
});

test('ACP terminal rejects missing commands and invalid callback payloads', async (t) => {
  const { call } = await setup(t);
  await assert.rejects(call(CALLBACK.CREATE, { command: 'missing-openchamber-acp-command' }), /ENOENT/);
  await assert.rejects(call(CALLBACK.CREATE, { command: process.execPath, args: ['\0'] }));
  await assert.rejects(call(CALLBACK.CREATE, { command: process.execPath, outputByteLimit: -1 }));
  await assert.rejects(call('terminal/unknown'), /Unsupported/);
});

test('Windows ACP command discovery uses supplied mixed-case environment keys', { skip: process.platform !== 'win32', timeout: 15000 }, async (t) => {
  const { root } = await setup(t);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (['path', 'pathext', 'comspec', 'systemroot'].includes(key.toLowerCase())) delete env[key];
  env.Path = dirname(process.execPath);
  env.Pathext = '.EXE;.CMD';
  env.sYsTeMrOoT = process.env.SystemRoot;
  env.cOmSpEc = process.env.ComSpec;
  const command = basename(process.execPath).replace(/\.exe$/i, '');
  for (const batch of [false, true]) {
    const entry = join(root, 'mixed-case.cmd');
    if (batch) await writeFile(entry, `@echo off\r\n"${process.execPath}" -e "process.stdout.write('resolved')"\r\n`);
    const child = await spawnAcp({ command: batch ? entry : command, args: batch ? [] : ['-e', 'process.stdout.write("resolved")'], cwd: root, env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.resume();
    child.stdin.end();
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0);
    assert.equal(output, 'resolved');
  }
});
