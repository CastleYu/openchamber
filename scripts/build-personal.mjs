import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { personalVersion, PERSONAL_BUILD } from '../packages/web/server/lib/personal-build.js';
import { resolveBunExecutable } from './lib/bun-executable.mjs';

const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'packages/electron');
const upstream = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const debug = process.argv.includes('--debug');
const target = 'portable';
const version = personalVersion(upstream, process.env.OPENCHAMBER_BUILD_NUMBER || '') + (debug ? '-DEBUG' : '');
const output = path.join(desktop, 'dist/personal', version);
const bun = resolveBunExecutable();

function run(command, args) {
  const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build failed: ${command} ${args.join(' ')} (${result.status})`);
}

if (process.argv.includes('--version')) {
  console.log(version);
} else {
  if (process.platform !== 'win32') throw new Error('Personal portable packaging currently requires Windows.');
  if (process.arch !== 'x64') throw new Error('Personal portable packaging currently requires Windows x64.');
  if (!PERSONAL_BUILD.notifyOnly) throw new Error('Personal packages require notification-only updates.');
  for (const stage of ['build:web-assets', 'prepare:opencode-cli', 'verify:opencode-cli', 'bundle:main', 'rebuild:native']) {
    run(bun, ['run', stage]);
  }
  run(process.execPath, ['scripts/package.mjs', '--win', target, '--x64', '--publish=never',
    `--config.extraMetadata.version=${version}`, `--config.directories.output=${output}`]);
  const artifacts = fs.readdirSync(output).filter((name) => name.endsWith('.exe'));
  if (artifacts.length !== 1) throw new Error('Expected exactly one desktop executable.');
  fs.writeFileSync(path.join(output, 'build-info.json'), `${JSON.stringify({
    upstreamVersion: upstream,
    personalVersion: PERSONAL_BUILD.featureVersion,
    ciBuild: process.env.OPENCHAMBER_BUILD_NUMBER || null,
    version,
    debug,
    target,
    architecture: process.arch,
    updatePolicy: PERSONAL_BUILD.updatePolicy,
    sourceCommit: process.env.GITHUB_SHA || null,
    artifacts,
  }, null, 2)}\n`);
  console.log(`Desktop build: ${path.join(output, artifacts[0])}`);
}
