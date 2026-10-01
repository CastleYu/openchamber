import { afterEach, describe, expect, it, mock } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

mock.module('vscode', () => ({ extensions: { getExtension: () => undefined }, Uri: { file: (fsPath) => ({ fsPath }) } }));
const { removeWorktree, snapshotWorktree } = await import('./gitService.ts?worktree-remove-test');
const tempDirs = [];
const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-worktree-remove-'));
  tempDirs.push(dir);
  return dir;
};
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('VS Code worktree removal', () => {
  it('releases a registered instance before removal and leaves unregistered paths alone', async () => {
    const previous = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = temp();
    try {
      const repo = temp();
      git(repo, ['init', '-b', 'main']);
      git(repo, ['config', 'user.email', 'test@example.com']);
      git(repo, ['config', 'user.name', 'Test']);
      git(repo, ['commit', '--allow-empty', '-m', 'init']);
      const worktree = path.join(temp(), 'feature');
      git(repo, ['worktree', 'add', worktree, '-b', 'feature']);
      const unrelated = temp();
      fs.writeFileSync(path.join(unrelated, 'keep'), 'untouched');
      let sawDirectory = false;
      const disposeInstance = mock(async (directory) => { sawDirectory = fs.existsSync(directory); });

      await expect(removeWorktree(repo, { directory: worktree, disposeInstance })).resolves.toBe(true);
      expect(sawDirectory).toBe(true);
      expect(fs.existsSync(worktree)).toBe(false);
      await expect(removeWorktree(repo, { directory: unrelated, disposeInstance })).resolves.toBe(true);
      expect(fs.existsSync(path.join(unrelated, 'keep'))).toBe(true);
      expect(disposeInstance).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
    }
  });
});

describe('VS Code run snapshot', () => {
  it('stores a hidden ref without changing the user index or worktree', async () => {
    const repo = temp();
    git(repo, ['init', '-b', 'main']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'base');
    git(repo, ['add', 'tracked.txt']);
    git(repo, ['commit', '-m', 'init']);
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'changed');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'new');
    const before = git(repo, ['status', '--porcelain']);
    const ref = 'refs/openchamber/runs/group/lane';
    const result = await snapshotWorktree(repo, { ref });
    expect(result.ref).toBe(ref);
    expect(git(repo, ['show', `${ref}:tracked.txt`])).toBe('changed');
    expect(git(repo, ['show', `${ref}:new.txt`])).toBe('new');
    expect(git(repo, ['status', '--porcelain'])).toBe(before);
    await expect(snapshotWorktree(repo, { ref: 'refs/heads/main' })).rejects.toThrow('Invalid snapshot ref');
  });
});
