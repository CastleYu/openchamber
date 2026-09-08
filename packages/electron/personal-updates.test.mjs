import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { checkPersonalUpdate } from './personal-updates.mjs';
import { PERSONAL_BUILD, personalVersion, assertUpdatesAllowed } from '../web/server/lib/personal-build.js';
import { executeUpdate } from '../web/server/lib/package-manager.js';

const compareVersions = (a, b) => a.localeCompare(b, undefined, { numeric: true });

test('personal and CI versions retain independent upstream and feature components', () => {
  assert.equal(personalVersion('1.22.2'), `1.22.2-personal.${PERSONAL_BUILD.featureVersion}`);
  assert.equal(personalVersion('1.23.0', '12.2'), `1.23.0-personal.${PERSONAL_BUILD.featureVersion}.ci.12.2`);
  assert.throws(() => personalVersion('latest'));
  assert.throws(() => personalVersion('1.22.2', '../bad'));
});

test('checks release metadata only and compares against upstream, not the personal suffix', async () => {
  let calls = 0;
  const info = await checkPersonalUpdate({
    currentVersion: personalVersion('1.22.2'), upstreamVersion: '1.22.2', compareVersions,
    request: async (url) => {
      calls++;
      assert.equal(url, 'https://api.github.com/repos/openchamber/openchamber/releases/latest');
      return Response.json({ tag_name: 'v1.22.2', body: 'Notes' });
    },
  });
  assert.equal(calls, 1);
  assert.equal(info.available, false);
  assert.equal(info.notifyOnly, true);
  const newer = await checkPersonalUpdate({
    currentVersion: personalVersion('1.22.2'), upstreamVersion: '1.22.2', compareVersions,
    request: async () => Response.json({ tag_name: 'v1.23.0' }),
  });
  assert.equal(newer.available, true);
  assert.equal(newer.releaseUrl, 'https://github.com/openchamber/openchamber/releases/tag/v1.23.0');
});

test('network and invalid metadata fail instead of reporting no update', async () => {
  for (const response of [new Response('', { status: 403 }), Response.json({ tag_name: 'invalid' })]) {
    await assert.rejects(checkPersonalUpdate({
      currentVersion: '1.22.2', upstreamVersion: '1.22.2', compareVersions,
      request: async () => response,
    }));
  }
});

test('runtime update execution is denied before spawning installers', () => {
  assert.throws(assertUpdatesAllowed, /Personal builds only notify/);
  assert.throws(() => executeUpdate('npm', { silent: true }), /Personal builds only notify/);
});

test('desktop guards download and pending install and disables automatic installation', () => {
  const main = readFileSync(new URL('./main.mjs', import.meta.url), 'utf8');
  assert.match(main, /case 'desktop_download_and_install_update':\s*assertUpdatesAllowed\(\)/);
  assert.match(main, /if \(applyUpdate\) \{\s*assertUpdatesAllowed\(\)/);
  assert.match(main, /autoUpdater.autoInstallOnAppQuit = false;\s*if \(PERSONAL_BUILD.notifyOnly\) return;/);
});
