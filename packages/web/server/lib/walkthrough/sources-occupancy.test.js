import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSourceSections } from './sources.js';

const tempDirs = [];

const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-walkthrough-occupancy-'));
  tempDirs.push(dir);
  return dir;
};

const runGit = (cwd, args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const createTempRepo = () => {
  const tmpDir = createTempDir();
  runGit(tmpDir, ['init']);
  runGit(tmpDir, ['config', 'user.email', 'test@example.com']);
  runGit(tmpDir, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(tmpDir, 'tracked.txt'), 'tracked\n');
  runGit(tmpDir, ['add', 'tracked.txt']);
  runGit(tmpDir, ['commit', '-m', 'init']);
  return tmpDir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const POLICY = {
  walkthroughUntrackedDiffsEnabled: true,
  untrackedDiffConcurrency: 4,
  untrackedDiffMaxFiles: 50,
  untrackedDiffMaxFileBytes: 1024 * 1024,
};

describe('loadSourceSections occupancy', () => {
  it('skips untracked diffs when the occupancy toggle is off', async () => {
    const tmpDir = createTempRepo();
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'hello\n');
    const result = await loadSourceSections(tmpDir, { kind: 'working-tree', scope: 'working' }, {
      policy: { ...POLICY, walkthroughUntrackedDiffsEnabled: false },
    });
    expect(result.sections).toEqual([]);
  });

  it('includes untracked diffs when the occupancy toggle is on', async () => {
    const tmpDir = createTempRepo();
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'hello\n');
    const result = await loadSourceSections(tmpDir, { kind: 'working-tree', scope: 'working' }, {
      policy: { ...POLICY, untrackedDiffMaxFiles: 8 },
    });
    expect(result.sections.some((section) => section.patch.includes('new.txt'))).toBe(true);
  });
});
