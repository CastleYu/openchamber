import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishAcp } from './publish-acp.mjs';

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-acp-release-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const commit = 'a'.repeat(40);
  const version = '2.0.4-DIJIANG.4.0-ACP.12.3';
  const executable = `OpenChamber-${version}-win-x64.exe`;
  fs.writeFileSync(path.join(directory, executable), 'portable fixture');
  fs.writeFileSync(path.join(directory, 'build-info.json'), JSON.stringify({
    version, channel: 'acp', sourceCommit: commit, target: 'portable', architecture: 'x64',
    debug: false, updatePolicy: 'notify-only', artifacts: [executable], ...options.info,
  }));
  const calls = [];
  let release;
  const gh = args => {
    calls.push(args);
    if (args.includes('POST')) {
      release = { id: 123, draft: true, prerelease: true, target_commitish: commit, assets: [], html_url: `https://github.com/CastleYu/openchamber/releases/tag/v${version}` };
    } else if (args[1] === 'upload') {
      if (options.failUpload) throw new Error('Upload interrupted');
      release.assets = args.slice(3, args.indexOf('--repo')).map(file => ({
        name: path.basename(file), state: 'uploaded', size: fs.statSync(file).size,
        digest: `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`,
      }));
      if (options.corrupt) release.assets[0].digest = 'sha256:wrong';
    } else if (args.includes('PATCH')) {
      release.draft = false;
    }
    return JSON.stringify(release);
  };
  return {
    calls,
    run: overrides => publishAcp({ directory, repository: 'CastleYu/openchamber', commit, version,
      ref: 'refs/heads/codex/acp-integration', gh, ...overrides }),
  };
}

test('ACP publication uploads checked artifacts and always requests a prerelease without latest', t => {
  const f = fixture(t);
  assert.equal(f.run().tag, 'v2.0.4-DIJIANG.4.0-ACP.12.3');
  const mutations = f.calls.filter(args => args.includes('POST') || args.includes('PATCH'));
  assert.equal(mutations.length, 2);
  for (const args of mutations) {
    assert(args.includes('prerelease=true'));
    assert(args.includes('make_latest=false'));
  }
  const upload = f.calls.find(args => args[1] === 'upload');
  assert.equal(upload.slice(3, upload.indexOf('--repo')).length, 3);
  assert(upload.some(file => file.endsWith('SHA256SUMS.txt')));
});

test('ACP publication rejects the stable branch, foreign repository and mismatched build before remote calls', t => {
  for (const overrides of [{ ref: 'refs/heads/codex/personal' }, { repository: 'openchamber/openchamber' }, { version: '2.0.4-DIJIANG.4.0' }]) {
    const f = fixture(t);
    assert.throws(() => f.run(overrides));
    assert.equal(f.calls.length, 0);
  }
  for (const info of [{ channel: 'personal' }, { debug: true }, { sourceCommit: 'b'.repeat(40) }, { artifacts: ['../secret'] }, { updatePolicy: 'automatic' }]) {
    const f = fixture(t, { info });
    assert.throws(() => f.run());
    assert.equal(f.calls.length, 0);
  }
});

test('upload or digest failure leaves the ACP draft unpublished', t => {
  for (const options of [{ failUpload: true }, { corrupt: true }]) {
    const f = fixture(t, options);
    assert.throws(() => f.run());
    assert(!f.calls.some(args => args.includes('PATCH')));
  }
});
