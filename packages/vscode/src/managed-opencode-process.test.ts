import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveManagedLaunch, spawnManagedOpenCodeProcess } from './managed-opencode-process';

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const readPids = async (marker: string) => (await fs.readFile(marker, 'utf8').catch(() => ''))
  .trim().split('\n').filter(Boolean).map(Number);

for (const mode of ['timeout', 'malformed', 'abort', 'ready', 'oc2-ready']) {
  test(`managed ${mode} reaps parent and SIGTERM-resistant descendant`, async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-managed-'));
    const marker = path.join(cwd, 'pids');
    const registry = path.join(cwd, 'registry');
    const previous = process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
    process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = registry;
    const descendant = `process.on('SIGTERM', () => {}); require('node:fs').appendFileSync(${JSON.stringify(marker)}, process.pid + '\\n'); process.stdout.write('ready'); setInterval(() => {}, 1000);`;
    let message = '';
    if (mode === 'malformed') message = 'opencode server listening without URL\n';
    if (mode === 'ready') message = 'opencode server listening on http://127.0.0.1:45678\n';
    if (mode === 'oc2-ready') message = 'server listening on http://127.0.0.1:45678\n';
    const script = `
      require('node:fs').appendFileSync(${JSON.stringify(marker)}, process.pid + '\\n');
      const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout.once('data', () => process.stdout.write(${JSON.stringify(message)}));
      setInterval(() => {}, 1000);
    `;
    const controller = new AbortController();
    const server = spawnManagedOpenCodeProcess(process.execPath, ['-e', script], {
      cwd, env: process.env, port: 45678, timeoutMs: 1500,
      signal: controller.signal, sourceBinary: process.execPath, appBundleHint: '',
    });
    const result = server.ready.then(() => null, (error: Error) => error);
    try {
      let pids: number[] = [];
      for (let attempt = 0; attempt < 150; attempt++) {
        pids = await readPids(marker);
        if (pids.length === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(pids.length, 2, 'both fixture processes must run');
      if (mode === 'abort' || mode === 'timeout') {
        assert.equal(server.url, null);
        assert.ok(await fs.stat(path.join(registry, `${pids[0]}.json`)), 'ownership must exist before readiness');
      }
      if (mode === 'abort') controller.abort();
      const error = await result;
      if (mode === 'ready' || mode === 'oc2-ready') {
        assert.equal(error, null);
        assert.equal(server.url, 'http://127.0.0.1:45678');
        await Promise.all([server.close(), server.close()]);
      } else {
        assert.ok(error);
      }
      for (let attempt = 0; attempt < 100 && pids.some(alive); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual(pids.filter(alive), []);
      assert.deepEqual(await fs.readdir(registry), []);
    } finally {
      await server.close().catch(() => {});
      for (const pid of await readPids(marker)) if (alive(pid)) process.kill(pid, 'SIGKILL');
      if (previous === undefined) delete process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
      else process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = previous;
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
}


test('managed command preserves literal argv, cwd and child environment', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-command-'));
  const marker = path.join(cwd, 'result.json');
  const registry = path.join(cwd, 'registry');
  const key = 'OC_COMMAND_FIXTURE';
  const value = 'fixture-child-value';
  const previous = process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
  const parentValue = process.env[key];
  const parentCwd = process.cwd();
  const args = ['', 'two words', '中文', '&echo unexpected', '$HOME', 'a"b', 'tail\\'];
  process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = registry;
  const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ pid: process.pid, args: process.argv.slice(1), cwd: process.cwd(), value: process.env[${JSON.stringify(key)}] })); process.stdout.write('opencode server listening on http://127.0.0.1:45678\\n'); setInterval(() => {}, 1000);`;
  const server = spawnManagedOpenCodeProcess(process.execPath, ['-e', script, ...args], {
    cwd, env: { ...process.env, [key]: value }, port: 45678, timeoutMs: 3000,
    signal: new AbortController().signal, sourceBinary: process.execPath, appBundleHint: '',
  });
  try {
    await server.ready;
    const result = JSON.parse(await fs.readFile(marker, 'utf8'));
    assert.deepEqual(result.args, args);
    assert.equal(path.resolve(result.cwd), path.resolve(cwd));
    assert.equal(result.value, value);
    assert.equal(process.env[key], parentValue);
    assert.equal(process.cwd(), parentCwd);
    assert.equal(server.url, 'http://127.0.0.1:45678');
    assert.equal(server.closed, false);
    assert.ok(await fs.stat(path.join(registry, result.pid + '.json')));
    await Promise.all([server.close(), server.close()]);
    assert.equal(server.closed, true);
    assert.equal(alive(result.pid), false);
    assert.deepEqual(await fs.readdir(registry), []);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
    else process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = previous;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('managed process reports a natural exit after readiness', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-natural-exit-'));
  const registry = path.join(cwd, 'registry');
  const previous = process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
  process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = registry;
  const server = spawnManagedOpenCodeProcess(process.execPath, ['-e', "process.stdout.write('server listening on http://127.0.0.1:45678\\n'); setTimeout(() => process.exit(0), 30);"], {
    cwd, env: process.env, port: 45678, timeoutMs: 3000,
    signal: new AbortController().signal, sourceBinary: process.execPath, appBundleHint: '',
  });
  try {
    await server.ready;
    assert.equal(server.closed, false, 'readiness does not imply process exit');
    for (let attempt = 0; attempt < 100 && !server.closed; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(server.closed, true, 'the handle follows the actual child close event');
    assert.equal(server.url, 'http://127.0.0.1:45678');
  } finally {
    await server.close().catch(() => {});
    if (previous === undefined) delete process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
    else process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = previous;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('failed startup excludes child stdout and stderr from diagnostics', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-diagnostics-'));
  const registry = path.join(cwd, 'registry');
  const secret = 'fixture-private-output';
  const previous = process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
  process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = registry;
  const script = `process.stderr.write(process.env.OC_DIAGNOSTIC_FIXTURE); process.stdout.write(process.env.OC_DIAGNOSTIC_FIXTURE + '\\nopencode server listening without URL\\n'); setInterval(() => {}, 1000);`;
  const server = spawnManagedOpenCodeProcess(process.execPath, ['-e', script], {
    cwd, env: { ...process.env, OC_DIAGNOSTIC_FIXTURE: secret }, port: 45678, timeoutMs: 3000,
    signal: new AbortController().signal, sourceBinary: process.execPath, appBundleHint: '',
  });
  try {
    await assert.rejects(server.ready, (error: Error) => {
      assert.match(error.message, /Failed to parse server URL/);
      assert.equal(error.message.includes(secret), false);
      assert.match(error.message, /output bytes received/);
      return true;
    });
    assert.equal(server.url, null);
    assert.deepEqual(await fs.readdir(registry), []);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
    else process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = previous;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('failed Windows termination retains ownership and allows explicit retry', { skip: process.platform !== 'win32' }, async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-close-retry-'));
  const registry = path.join(cwd, 'registry');
  const previous = process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
  const previousPath = process.env.PATH;
  process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = registry;
  const server = spawnManagedOpenCodeProcess(process.execPath, ['-e', "process.stdout.write('server listening on http://127.0.0.1:45678\\n'); setInterval(() => {}, 1000);"], {
    cwd, env: process.env, port: 45678, timeoutMs: 3000,
    signal: new AbortController().signal, sourceBinary: process.execPath, appBundleHint: '',
  });
  let pid: number | undefined;
  try {
    await server.ready;
    const entries = await fs.readdir(registry);
    assert.equal(entries.length, 1);
    pid = Number(path.basename(entries[0], '.json'));
    process.env.PATH = cwd;
    try {
      await assert.rejects(server.close(), { code: 'ENOENT' });
    } finally {
      process.env.PATH = previousPath;
    }
    assert.equal(alive(pid), true, 'failed termination retains the live process');
    assert.deepEqual(await fs.readdir(registry), entries, 'failed termination retains ownership');
    await Promise.all([server.close(), server.close()]);
    assert.equal(alive(pid), false);
    assert.deepEqual(await fs.readdir(registry), []);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await server.close().catch(() => {});
    if (pid && alive(pid)) {
      process.kill(pid, 'SIGKILL');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (previous === undefined) delete process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
    else process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = previous;
    await fs.rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

for (const ext of ['.cmd', '.bat']) {
  test('managed Windows ' + ext + ' preserves literal arguments through a forwarding shim', { skip: process.platform !== 'win32' }, async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-vscode-shim-'));
    const registry = path.join(cwd, 'registry');
    const previous = process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
    process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = registry;
    const binary = path.join(cwd, 'launcher space & (test) %OC_TEST% !OC_TEST!' + ext);
    const capture = path.join(cwd, 'capture.cjs');
    const result = path.join(cwd, 'args.json');
    const args = ['serve', 'space value', '', 'quote"value', 'trailing\\', '%OC_TEST%', '!OC_TEST!', '& echo injected', 'a|b', '(x)', '^caret', 'semi;comma,'];
    await fs.writeFile(capture, "require('node:fs').writeFileSync(" + JSON.stringify(result) + ", JSON.stringify(process.argv.slice(2))); process.stdout.write('server listening on http://127.0.0.1:45678\\n'); setInterval(() => {}, 1000);");
    await fs.writeFile(binary, '@echo off\r\n"' + process.execPath + '" "' + capture + '" %*\r\n');
    const server = spawnManagedOpenCodeProcess(binary, args, {
      cwd, env: { ...process.env, OC_TEST: 'expanded-sentinel' }, port: 45678, timeoutMs: 3000,
      signal: new AbortController().signal, sourceBinary: binary, appBundleHint: '',
    });
    try {
      await server.ready;
      assert.deepEqual(JSON.parse(await fs.readFile(result, 'utf8')), args);
      assert.equal(server.url, 'http://127.0.0.1:45678');
    } finally {
      await server.close();
      if (previous === undefined) delete process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
      else process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = previous;
      await fs.rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
}

test('Windows batch rejects unrepresentable input before launch', { skip: process.platform !== 'win32' }, () => {
  assert.throws(() => resolveManagedLaunch('C:\\launcher.cmd', ['line\nvalue']), /line breaks/);
  assert.throws(() => resolveManagedLaunch('C:\\launcher.bat', ['x'.repeat(8192)]), /command-line limit/);
  const native = resolveManagedLaunch('C:\\launcher.exe', ['line\nvalue']);
  assert.deepEqual(native.args, ['line\nvalue']);
});
