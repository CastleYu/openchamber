import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAcpRuntime } from './runtime.js';

const fixture = fileURLToPath(new URL('./fixtures/batch-agent.mjs', import.meta.url));
const windows = { skip: process.platform !== 'win32', timeout: 15000 };
const args = ['space value', '', 'quote"value', 'trailing\\', 'space trailing\\', 'a&b|c<d>e(f)^g!h', '%ACP_TEST_SECRET%', 'semi;comma,star*question?', '中文'];
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };

for (const mode of ['bat', 'cmd', 'path', 'npm-shim', 'exe']) {
  test(`Windows ACP ${mode} preserves argv and stops its tree before cleanup`, windows, async (t) => {
    const folder = await mkdtemp(join(tmpdir(), 'openchamber ACP & %ACP_TEST_SECRET% batch-'));
    const bin = mode === 'npm-shim' ? join(folder, 'node_modules', '.bin') : folder;
    await mkdir(bin, { recursive: true });
    const entry = join(bin, mode === 'bat' ? 'agent.bat' : 'agent.cmd');
    await writeFile(entry, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
    const runtime = createAcpRuntime();
    const oldPath = process.env.PATH;
    const oldSecret = process.env.ACP_TEST_SECRET;
    process.env.ACP_TEST_SECRET = 'must-not-expand';
    if (mode === 'path') process.env.PATH = `${bin};${oldPath}`;
    t.after(async () => {
      await runtime.stop();
      if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
      if (oldSecret === undefined) delete process.env.ACP_TEST_SECRET; else process.env.ACP_TEST_SECRET = oldSecret;
      await rm(folder, { recursive: true, force: true });
    });
    await runtime.start({ command: mode === 'exe' ? process.execPath : mode === 'path' ? 'agent' : entry, args: mode === 'exe' ? [fixture, ...args] : args, cwd: folder });
    const info = JSON.parse(runtime.info().agentInfo.version);
    assert.deepEqual(info.args, args);
    assert.equal(alive(info.pid), true);
    assert.equal(alive(info.descendant), true);
    assert.equal((await runtime.createSession({ directory: folder })).id, 'batch-session');
    await runtime.stop();
    assert.equal(alive(info.pid), false);
    assert.equal(alive(info.descendant), false);
    await rm(folder, { recursive: true });
  });
}

test('Windows ACP missing BAT and PATH entries fail with setup guidance', windows, async (t) => {
  const runtime = createAcpRuntime();
  t.after(() => runtime.stop());
  for (const command of [join(tmpdir(), 'missing-acp-agent.bat'), 'missing-acp-agent-command']) {
    await assert.rejects(runtime.start({ command, args: [], cwd: process.cwd() }), /ENOENT.*existing executable.*PATH/);
    assert.equal(runtime.descriptor().generation, 'unreachable');
  }
});

test('Windows ACP malformed batch stdout closes the wrapper and agent descendants', windows, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'openchamber ACP failure-'));
  const entry = join(folder, 'agent.bat');
  const pidFile = join(folder, 'pids.json');
  await writeFile(entry, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
  const runtime = createAcpRuntime();
  t.after(async () => { await runtime.stop(); await rm(folder, { recursive: true, force: true }); });
  await assert.rejects(runtime.start({ command: entry, args: ['--malformed', '--pid-file', pidFile], cwd: folder }), /Invalid ACP message/);
  const info = JSON.parse(await readFile(pidFile, 'utf8'));
  assert.equal(alive(info.pid), false);
  assert.equal(alive(info.descendant), false);
  assert.equal(runtime.descriptor().generation, 'unreachable');
});
