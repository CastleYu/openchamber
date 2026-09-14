import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRelease, renderReleaseNotes } from './changelog/lib.mjs';

const FILES = { info: 'build-info.json', sums: 'SHA256SUMS.txt', notes: 'release-notes.md', history: 'update-history.md', chineseHistory: 'update-history.zh-CN.md' };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runGh = args => execFileSync('gh', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function publishPersonal({ directory, repository, commit, version, gh = runGh, sourceRoot = root }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid release repository or source commit');
  const info = JSON.parse(fs.readFileSync(path.join(directory, FILES.info), 'utf8'));
  if (!/^\d+\.\d+\.\d+-DIJIANG\.[1-9]\d*\.(?:0|[1-9]\d*)$/.test(info.version)
    || info.version !== version || info.sourceCommit !== commit || info.target !== 'portable' || info.architecture !== 'x64'
    || info.debug !== false || info.updatePolicy !== 'notify-only') throw new Error('Build identity does not match the release');
  const executable = `OpenChamber-${info.version}-win-x64.exe`;
  if (info.artifacts?.length !== 1 || info.artifacts[0] !== executable) throw new Error('Unexpected release artifacts');
  const tag = `v${info.version}`;
  const endpoint = `repos/${repository}`;
  const list = () => JSON.parse(gh(['api', `${endpoint}/releases?per_page=100`, '--paginate', '--slurp'])).flat();
  const find = () => list().find(release => release.tag_name === tag);
  let release = find();
  if (release && !release.draft) return { status: 'existing', tag, url: release.html_url };
  if (release && release.target_commitish !== commit) throw new Error('Draft belongs to another source commit; increment the personal version');
  const refs = JSON.parse(gh(['api', `${endpoint}/git/matching-refs/tags/${tag}`]));
  const ref = refs.find(item => item.ref === `refs/tags/${tag}`);
  if (ref && (ref.object.type !== 'commit' || ref.object.sha !== commit)) throw new Error('Release tag belongs to another commit');

  const notes = parseRelease(fs.readFileSync(path.join(sourceRoot, 'changelog/unreleased.md'), 'utf8'), 'changelog/unreleased.md');
  if (!notes.title || !Object.values(notes.app || {}).flat().length) throw new Error('Personal release notes are empty');
  const notesFile = path.join(directory, FILES.notes);
  fs.writeFileSync(notesFile, `Windows x64 portable build ${info.version}.\n\n${renderReleaseNotes(notes)}\n\nSource: ${commit}. Upstream updates remain notification-only.\n`);
  fs.copyFileSync(path.join(sourceRoot, 'packages/ui/src/content/update-history.md'), path.join(directory, FILES.history));
  fs.copyFileSync(path.join(sourceRoot, 'packages/ui/src/content/update-history.zh-CN.md'), path.join(directory, FILES.chineseHistory));
  const names = [executable, FILES.info, FILES.history, FILES.chineseHistory];
  fs.writeFileSync(path.join(directory, FILES.sums), names.map(name => `${digest(path.join(directory, name))}  ${name}\n`).join(''));
  names.push(FILES.sums);
  if (!release) {
    release = JSON.parse(gh(['api', `${endpoint}/releases`, '--method', 'POST',
      '-f', `tag_name=${tag}`, '-f', `target_commitish=${commit}`, '-f', `name=OpenChamber ${info.version}`,
      '-F', 'draft=true', '-F', `body=@${notesFile}`]));
  }
  if (!release?.draft || release.target_commitish !== commit || !Number.isSafeInteger(release.id)) throw new Error('Release changed before upload');
  const releaseEndpoint = `${endpoint}/releases/${release.id}`;
  gh(['release', 'upload', tag, ...names.map(name => path.join(directory, name)), '--repo', repository, '--clobber']);
  release = JSON.parse(gh(['api', releaseEndpoint]));
  if (!release?.draft || release.target_commitish !== commit) throw new Error('Release changed during upload');
  for (const name of names) {
    const asset = release.assets.find(item => item.name === name);
    const file = path.join(directory, name);
    if (asset?.state !== 'uploaded' || asset.size !== fs.statSync(file).size || asset.digest !== `sha256:${digest(file)}`) {
      throw new Error(`Uploaded asset verification failed: ${name}`);
    }
  }
  release = JSON.parse(gh(['api', releaseEndpoint, '--method', 'PATCH', '-F', `body=@${notesFile}`, '-F', 'draft=false', '-f', 'make_latest=true']));
  if (!release || release.draft) throw new Error('Release publication was not confirmed');
  return { status: 'published', tag, url: release.html_url };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'packages/web/personal-build.json'), 'utf8')).featureVersion;
  const upstream = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  console.log(JSON.stringify(publishPersonal({
    directory: path.join(root, 'packages/electron/dist/personal', `${upstream}-DIJIANG.${version}`),
    repository: process.env.GITHUB_REPOSITORY || '', commit: process.env.GITHUB_SHA || '', version: `${upstream}-DIJIANG.${version}`,
  })));
}
