import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launchNativeApp } from './native-app-launch.mjs';

test('propagates a missing executable without an unhandled spawn error', async () => {
  await assert.rejects(launchNativeApp(path.join(os.tmpdir(), 'oc-missing-app-' + process.pid, 'app.exe'), []), { code: 'ENOENT' });
});

test('hands arguments to a real process unchanged, including spaces and shell characters', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'oc-launch-test-'));
  const script = path.join(folder, 'writer.cjs');
  const output = path.join(folder, 'arguments.json');
  const target = 'C:\\A & %B%\\中文 name.txt';
  try {
    await writeFile(script, "require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))");
    await launchNativeApp(process.execPath, [script, output, target]);
    let content;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      content = await readFile(output, 'utf8').catch(() => null);
      if (content) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual(JSON.parse(content), [target]);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
