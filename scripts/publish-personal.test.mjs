import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publishPersonal } from './publish-personal.mjs';

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'changelog'));
  fs.mkdirSync(path.join(root, 'packages/ui/src/content'), { recursive: true });
  fs.writeFileSync(path.join(root, 'changelog/unreleased.md'), '---\ntitle: Update history\n---\n\n## App\n\n### New\n- Read update history.\n');
  fs.writeFileSync(path.join(root, 'packages/ui/src/content/update-history.md'), 'History');
  const directory = path.join(root, 'output');
  fs.mkdirSync(directory);
  const commit = 'a'.repeat(40);
  const version = '1.23.0-DIJIANG.3.2';
  const executable = `OpenChamber-${version}-win-x64.exe`;
  fs.writeFileSync(path.join(directory, executable), 'fixture portable bytes');
  fs.writeFileSync(path.join(directory, 'build-info.json'), JSON.stringify({
    version, sourceCommit: commit, target: 'portable', architecture: 'x64', debug: false,
    updatePolicy: 'notify-only', artifacts: [executable], ...options.info,
  }));
  const calls = [];
  let release = options.release;
  const gh = args => {
    calls.push(args);
    if (args[0] === 'api') return JSON.stringify(args[1].includes('/releases?') ? [[...(release ? [release] : [])]] : options.refs || []);
    if (args[1] === 'create') release = { tag_name: `v${version}`, draft: true, target_commitish: commit, assets: [], html_url: 'https://github.com/CastleYu/openchamber/releases/tag/v' + version };
    if (args[1] === 'upload') {
      release.assets = args.slice(3, args.indexOf('--repo')).map(file => ({
        name: path.basename(file), size: fs.statSync(file).size, state: 'uploaded',
        digest: 'sha256:' + createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      }));
      if (options.corrupt) release.assets[0].digest = 'sha256:incorrect';
      if (options.failUpload) throw new Error('Upload interrupted');
    }
    if (args[1] === 'edit') release.draft = false;
    return '';
  };
  return { calls, run: () => publishPersonal({ directory, commit, version, repository: 'CastleYu/openchamber', sourceRoot: root, gh }) };
}

test('uploads all artifacts, verifies digests, then publishes', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 'published');
  const upload = f.calls.find(args => args[1] === 'upload');
  assert.equal(upload.slice(3, upload.indexOf('--repo')).length, 4);
  assert.equal(f.calls.filter(args => args[1] === 'edit').length, 1);
});
test('never mutates an already published version', t => {
  const f = fixture(t, { release: { tag_name: 'v1.23.0-DIJIANG.3.2', draft: false, target_commitish: 'old' } });
  assert.equal(f.run().status, 'existing');
  assert(f.calls.every(args => args[0] === 'api'));
});
test('resumes a draft only at the same source commit', t => {
  const f = fixture(t, { release: { tag_name: 'v1.23.0-DIJIANG.3.2', draft: true, target_commitish: 'a'.repeat(40), assets: [] } });
  assert.equal(f.run().status, 'published');
  assert(!f.calls.some(args => args[1] === 'create'));
});
test('rejects a draft or tag owned by another commit', t => {
  const f = fixture(t, { release: { tag_name: 'v1.23.0-DIJIANG.3.2', draft: true, target_commitish: 'b'.repeat(40) } });
  assert.throws(f.run, /another source commit/);
  const g = fixture(t, { refs: [{ ref: 'refs/tags/v1.23.0-DIJIANG.3.2', object: { type: 'commit', sha: 'b'.repeat(40) } }] });
  assert.throws(g.run, /another commit/);
});
test('failed upload and mismatched digest remain unpublished', t => {
  for (const options of [{ failUpload: true }, { corrupt: true }]) {
    const f = fixture(t, options);
    assert.throws(f.run);
    assert(!f.calls.some(args => args[1] === 'edit'));
  }
});
test('rejects debug, foreign commit and unexpected artifacts before remote calls', t => {
  for (const info of [{ debug: true }, { version: '1.23.0-DIJIANG.4.0' }, { sourceCommit: 'b'.repeat(40) }, { artifacts: ['../secret.txt'] }]) {
    const f = fixture(t, { info });
    assert.throws(f.run);
    assert.equal(f.calls.length, 0);
  }
});
