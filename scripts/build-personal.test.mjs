import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const personal = JSON.parse(readFileSync(new URL('../packages/web/personal-build.json', import.meta.url), 'utf8'));
const version = `${manifest.version}-DIJIANG.${personal.featureVersion}`;

for (const debug of [false, true]) {
  test(`version-only build reports the ${debug ? 'debug' : 'release'} identity without packaging`, () => {
    const expected = `${version}${debug ? '-DEBUG' : ''}`;
    const output = path.join(root, 'packages/electron/dist/personal', expected, 'build-info.json');
    const existed = existsSync(output);
    const prior = existed ? readFileSync(output) : null;
    const printed = execFileSync(process.execPath, [
      'scripts/build-personal.mjs', '--version', ...(debug ? ['--debug'] : []),
    ], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
    assert.equal(printed, expected);
    assert.equal(existsSync(output), existed);
    if (existed) assert.deepEqual(readFileSync(output), prior);
  });
}
