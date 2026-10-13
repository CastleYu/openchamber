import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ACP = Object.freeze({
  repository: 'CastleYu/openchamber',
  branch: 'refs/heads/codex/acp-integration',
  info: 'build-info.json',
  sums: 'SHA256SUMS.txt',
});
const root = path.resolve(import.meta.dirname, '..');
const runGh = args => execFileSync('gh', args, { encoding: 'utf8', windowsHide: true });
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function publishAcp({ directory, repository, commit, version, ref, gh = runGh }) {
  if (repository !== ACP.repository || ref !== ACP.branch || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('ACP publication requires CastleYu/openchamber codex/acp-integration and a source commit.');
  }
  const info = JSON.parse(fs.readFileSync(path.join(directory, ACP.info), 'utf8'));
  const executable = `OpenChamber-${version}-win-x64.exe`;
  if (!/^\d+\.\d+\.\d+-DIJIANG\.[1-9]\d*\.(?:0|[1-9]\d*)-ACP\.[1-9]\d*\.[1-9]\d*$/.test(version)
    || info.version !== version || info.channel !== 'acp' || info.sourceCommit !== commit
    || info.debug !== false || info.target !== 'portable' || info.architecture !== 'x64'
    || info.updatePolicy !== 'notify-only' || info.artifacts?.length !== 1 || info.artifacts[0] !== executable) {
    throw new Error('Build identity does not match the ACP release.');
  }
  const files = [executable, ACP.info];
  fs.writeFileSync(path.join(directory, ACP.sums), files.map(name => `${digest(path.join(directory, name))}  ${name}\n`).join(''));
  files.push(ACP.sums);
  const tag = `v${version}`;
  const endpoint = `repos/${repository}/releases`;
  const notes = `ACP integration Windows x64 portable build ${version}.\n\nSource: ${commit}.\n\nSee docs/maintenance/ACP-BUILD.md for build and replacement instructions.`;
  // A fresh run number gives each publication its own tag. Failed uploads leave a draft.
  let release = JSON.parse(gh(['api', endpoint, '--method', 'POST',
    '-f', `tag_name=${tag}`, '-f', `target_commitish=${commit}`, '-f', `name=OpenChamber ACP ${version}`,
    '-f', `body=${notes}`, '-F', 'draft=true', '-F', 'prerelease=true', '-f', 'make_latest=false']));
  gh(['release', 'upload', tag, ...files.map(name => path.join(directory, name)), '--repo', repository]);
  release = JSON.parse(gh(['api', `${endpoint}/${release.id}`]));
  if (!release.draft || release.target_commitish !== commit || !release.prerelease) throw new Error('ACP draft identity changed.');
  for (const name of files) {
    const asset = release.assets.find(item => item.name === name);
    const file = path.join(directory, name);
    if (asset?.state !== 'uploaded' || asset.size !== fs.statSync(file).size || asset.digest !== `sha256:${digest(file)}`) {
      throw new Error(`Uploaded ACP asset verification failed: ${name}`);
    }
  }
  release = JSON.parse(gh(['api', `${endpoint}/${release.id}`, '--method', 'PATCH',
    '-F', 'draft=false', '-F', 'prerelease=true', '-f', 'make_latest=false']));
  if (release.draft || !release.prerelease) throw new Error('ACP prerelease publication was not confirmed.');
  return { tag, url: release.html_url };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.env.ACP_BUILD_VERSION || '';
  console.log(JSON.stringify(publishAcp({
    directory: path.join(root, 'packages/electron/dist/acp', version),
    repository: process.env.GITHUB_REPOSITORY || '', commit: process.env.GITHUB_SHA || '',
    version, ref: process.env.GITHUB_REF || '',
  })));
}
