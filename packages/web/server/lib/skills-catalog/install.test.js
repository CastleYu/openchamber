import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSkillsFromRepository } from './install.js';
import { AGENT_ERROR } from '../agent/constants.js';
import express from 'express';
import request from 'supertest';
import { registerSkillRoutes } from '../opencode/skill-routes.js';
import { walkSkillMdFiles } from '../opencode/shared.js';

describe('skill installation commit boundary', () => {
  let root;
  let project;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-install-test-'));
    project = path.join(root, 'project');
    const repo = path.join(root, 'repo');
    const hooks = path.join(root, 'empty-hooks');
    fs.mkdirSync(hooks);
    fs.mkdirSync(repo);
    for (const name of ['alpha', 'beta']) {
      fs.mkdirSync(path.join(repo, name));
      fs.writeFileSync(path.join(repo, name, 'SKILL.md'), 'new ' + name);
    }
    const git = (args) => execFileSync('git', args, { cwd: repo, windowsHide: true, stdio: 'pipe' });
    git(['init', '--quiet']);
    git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
      '-c', 'core.hooksPath=' + hooks, 'commit', '--quiet', '-m', 'fixture']);
    // Rewrite only this fixture remote in child processes; never contact GitHub.
    vi.stubEnv('GIT_CONFIG_COUNT', '2');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'url.' + pathToFileURL(repo).href + '.insteadOf');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'https://github.com/openchamber-fixture/skills.git');
    vi.stubEnv('GIT_CONFIG_KEY_1', 'protocol.file.allow');
    vi.stubEnv('GIT_CONFIG_VALUE_1', 'always');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    const resolved = path.resolve(root);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  const target = (name) => path.join(project, '.opencode', 'skills', name);
  const seed = (name) => {
    fs.mkdirSync(target(name), { recursive: true });
    fs.writeFileSync(path.join(target(name), 'SKILL.md'), 'old ' + name);
  };
  const body = (name) => fs.readFileSync(path.join(target(name), 'SKILL.md'), 'utf8');
  const install = (options = {}) => installSkillsFromRepository({
    source: 'openchamber-fixture/skills', scope: 'project', targetSource: 'opencode',
    workingDirectory: project, userSkillDir: path.join(root, 'user'),
    selections: [{ skillDir: 'alpha' }], conflictPolicy: 'overwriteAll', ...options,
  });
  const changed = () => { throw Object.assign(new Error('OpenCode changed during installation'), { statusCode: 409 }); };
  const expectClean = () => {
    expect(fs.readdirSync(path.dirname(path.dirname(target('alpha')))).filter(name => name.startsWith('.openchamber-skill-'))).toEqual([]);
  };

  it('installs new files and overwrites an existing skill after preparation', async () => {
    seed('alpha');
    const result = await install();
    expect(result).toMatchObject({ ok: true, installed: [{ skillName: 'alpha' }], skipped: [] });
    expect(body('alpha')).toBe('new alpha');
    expectClean();
  });

  it('rejects a changed mode after real copying without replacing the old skill', async () => {
    seed('alpha');
    let retired = false;
    const copy = fs.promises.copyFile;
    vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (...args) => {
      await copy(...args);
      expect(walkSkillMdFiles(path.dirname(target('alpha')))).toEqual([path.join(target('alpha'), 'SKILL.md')]);
      retired = true;
    });
    const result = await install({ assertCurrent: () => { if (retired) changed(); } });
    expect(result).toMatchObject({ ok: false, installed: [], error: { kind: AGENT_ERROR.CHANGED } });
    expect(body('alpha')).toBe('old alpha');
    expectClean();
  });

  it('retains the original skill when copying fails', async () => {
    seed('alpha');
    vi.spyOn(fs.promises, 'copyFile').mockRejectedValue(new Error('copy failure'));
    const result = await install();
    expect(result).toMatchObject({ ok: true, installed: [], skipped: [{ skillName: 'alpha', reason: 'copy failure' }] });
    expect(body('alpha')).toBe('old alpha');
    expectClean();
  });

  it('returns earlier committed skills when a later copy loses its owner', async () => {
    seed('beta');
    let retired = false;
    const copy = fs.promises.copyFile;
    vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (...args) => {
      await copy(...args);
      if (String(args[0]).includes(path.sep + 'beta' + path.sep)) retired = true;
    });
    const result = await install({ selections: [{ skillDir: 'alpha' }, { skillDir: 'beta' }],
      assertCurrent: () => { if (retired) changed(); } });
    expect(result).toMatchObject({ ok: false, installed: [{ skillName: 'alpha' }], error: { kind: AGENT_ERROR.CHANGED } });
    expect(body('alpha')).toBe('new alpha');
    expect(body('beta')).toBe('old beta');
    expectClean();
  });

  it('returns HTTP 409 and completed progress through the real Skill route', async () => {
    seed('beta');
    let runtime = { generation: 'oc1', endpoint: 'http://127.0.0.1:9', epoch: 1 };
    const copy = fs.promises.copyFile;
    vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (...args) => {
      await copy(...args);
      if (String(args[0]).includes(path.sep + 'beta' + path.sep)) runtime = { ...runtime, epoch: 2 };
    });
    const app = express();
    app.use(express.json());
    registerSkillRoutes(app, {
      kernelRuntime: { get: () => runtime },
      resolveProjectDirectory: async () => ({ directory: project }),
      SKILL_DIR: path.join(root, 'user'),
      installSkillsFromRepository,
    });
    const result = await request(app).post('/api/config/skills/install').send({
      source: 'openchamber-fixture/skills', scope: 'project', targetSource: 'opencode',
      selections: [{ skillDir: 'alpha' }, { skillDir: 'beta' }], conflictPolicy: 'overwriteAll',
    }).expect(409);
    expect(result.body).toMatchObject({ ok: false, installed: [{ skillName: 'alpha' }], error: { kind: AGENT_ERROR.CHANGED } });
    expect(result.body.error.message).toContain('Installed before the change: alpha');
    expect(body('alpha')).toBe('new alpha');
    expect(body('beta')).toBe('old beta');
    expectClean();
  });

  it('rejects a retired request before clone or destination creation', async () => {
    await expect(install({ assertCurrent: changed })).rejects.toMatchObject({ statusCode: 409 });
    expect(fs.existsSync(project)).toBe(false);
  });

  it('keeps skipAll skills unchanged', async () => {
    seed('alpha');
    const result = await install({ conflictPolicy: 'skipAll' });
    expect(result).toMatchObject({ ok: true, installed: [], skipped: [{ skillName: 'alpha' }] });
    expect(body('alpha')).toBe('old alpha');
    expectClean();
  });

  it('restores the original when the final replacement fails', async () => {
    seed('alpha');
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (path.basename(from) === 'skill') throw new Error('replacement failure');
      return rename(from, to);
    });
    const result = await install();
    expect(result).toMatchObject({ ok: true, installed: [], skipped: [{ reason: 'replacement failure' }] });
    expect(body('alpha')).toBe('old alpha');
    expectClean();
  });

  it('keeps the original backup when restoration also fails', async () => {
    seed('alpha');
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (path.basename(from) === 'skill' || path.basename(from) === 'backup') throw new Error('rename failure');
      return rename(from, to);
    });
    const result = await install();
    expect(result.installed).toEqual([]);
    expect(result.skipped[0].reason).toContain('original files remain at');
    const scratch = fs.readdirSync(path.dirname(path.dirname(target('alpha')))).find(name => name.startsWith('.openchamber-skill-'));
    expect(fs.readFileSync(path.join(path.dirname(path.dirname(target('alpha'))), scratch, 'backup', 'SKILL.md'), 'utf8')).toBe('old alpha');
  });
});
