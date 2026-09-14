import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('Windows detached shutdown stops a captured root and detached grandchild', {
  skip: process.platform !== 'win32', timeout: 20000,
}, async () => {
  // Execute the actual embedded script without booting or closing a user's app.
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8');
  const killer = source.slice(source.indexOf('const launchDetachedOpenCodeKiller ='));
  const start = killer.indexOf('const script = `') + 'const script = `'.length;
  const script = killer.slice(start, killer.indexOf('\n`;', start));
  assert.equal(script.match(/Get-CimInstance/g).length, 1);
  const root = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const leaf = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true });
    leaf.unref();
    process.send(leaf.pid);
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
  const [leaf] = await once(root, 'message');
  try {
    const command = script.replace('${normalizedPid}', String(root.pid))
      .replace('${Math.max(0, Math.trunc(OPENCODE_SHUTDOWN_GRACE_MS))}', '100');
    const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 10000,
    });
    await delay(100);
    assert.throws(() => process.kill(root.pid, 0), { code: 'ESRCH' });
    assert.throws(() => process.kill(leaf, 0), { code: 'ESRCH' });
  } finally {
    root.kill();
    try { process.kill(leaf); } catch { /* Already terminated by the script. */ }
  }
});
