import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactForPlatform } from './opencode-cli-artifact.mjs';
import { parseOpenCodeCliVersion, resolveOpenCodeCliVersion } from './opencode-cli-version.mjs';

const arch = (opencode) => ({ opencode });

describe('desktop OpenCode CLI selection', () => {
  test('uses the personal OC1 pin unless a valid version is selected explicitly', () => {
    assert.equal(resolveOpenCodeCliVersion({ environment: {} }), '1.18.31');
    assert.equal(resolveOpenCodeCliVersion({ environment: { OPENCHAMBER_OPENCODE_CLI_VERSION: '2.0.16' } }), '2.0.16');
    assert.throws(() => resolveOpenCodeCliVersion({ environment: { OPENCHAMBER_OPENCODE_CLI_VERSION: '^2.0.16' } }), /Invalid OpenCode CLI version/);
    assert.throws(() => resolveOpenCodeCliVersion({ environment: { OPENCHAMBER_OPENCODE_CLI_VERSION: '2.0.1' } }), /Invalid OpenCode CLI version/);
    assert.throws(() => resolveOpenCodeCliVersion({ environment: { OPENCHAMBER_OPENCODE_CLI_VERSION: '3.0.0' } }), /Invalid OpenCode CLI version/);
  });

  test('parses both bare OC1 and prefixed OC2 version output', () => {
    assert.equal(parseOpenCodeCliVersion('1.18.31\n'), '1.18.31');
    assert.equal(parseOpenCodeCliVersion('opencode v2.0.16\n'), '2.0.16');
    assert.equal(parseOpenCodeCliVersion('opencode v2.1.0-beta.3'), '2.1.0-beta.3');
    assert.equal(parseOpenCodeCliVersion('command not found'), '');
  });

  test('keeps OC1 GitHub assets and Windows ARM64 x64 fallback', () => {
    const windows = artifactForPlatform('1.18.31', 'win32', arch('arm64'));
    assert.equal(windows.name, 'opencode-windows-x64-baseline.zip');
    assert.equal(windows.binary, 'opencode.exe');
    assert.equal(windows.kind, 'github');
    assert.match(windows.url, /releases\/download\/v1\.18\.31/);
    assert.equal(artifactForPlatform('1.18.31', 'darwin', arch('arm64')).name, 'opencode-darwin-arm64.zip');
    assert.equal(artifactForPlatform('1.18.31', 'linux', arch('x64')).name, 'opencode-linux-x64-baseline.tar.gz');
  });

  test('selects OC2 npm platform tarballs', () => {
    const windows = artifactForPlatform('2.0.16', 'win32', arch('arm64'));
    assert.equal(windows.kind, 'npm');
    assert.equal(windows.name, 'cli-windows-arm64-2.0.16.tgz');
    assert.equal(windows.url, 'https://registry.npmjs.org/@opencode/cli-windows-arm64/-/cli-windows-arm64-2.0.16.tgz');
    assert.equal(artifactForPlatform('2.0.16', 'win32', arch('x64')).name, 'cli-windows-x64-baseline-2.0.16.tgz');
    assert.equal(artifactForPlatform('2.0.16', 'darwin', arch('arm64')).name, 'cli-darwin-arm64-2.0.16.tgz');
    assert.equal(artifactForPlatform('2.0.16', 'linux', arch('x64')).name, 'cli-linux-x64-baseline-2.0.16.tgz');
  });

  test('rejects unsupported platform or major version', () => {
    assert.throws(() => artifactForPlatform('3.0.0', 'win32', arch('x64')), /Unsupported OpenCode CLI major/);
    assert.throws(() => artifactForPlatform('2.0.16', 'freebsd', arch('x64')), /No OpenCode CLI artifact mapping/);
  });
});
