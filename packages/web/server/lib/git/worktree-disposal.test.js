import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_FAMILY } from '../agent/constants.js';
import { OPENCODE_GENERATION, OPENCODE_PROFILE } from '../opencode/compatibility.js';
import { registerGitRoutes } from './routes.js';

const temporaryDirectories = [];
const servers = [];
const runGit = (directory, args) => execFileSync('git', args, {
  cwd: directory,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const createWorktree = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-disposal-'));
  temporaryDirectories.push(directory);
  const repository = path.join(directory, 'repo');
  const worktree = path.join(directory, 'feature');
  fs.mkdirSync(repository);
  runGit(repository, ['init', '-b', 'main']);
  runGit(repository, ['config', 'user.email', 'test@example.com']);
  runGit(repository, ['config', 'user.name', 'Test']);
  runGit(repository, ['commit', '--allow-empty', '-m', 'init']);
  runGit(repository, ['worktree', 'add', worktree, '-b', 'feature']);
  return { repository, worktree };
};

const appFor = ({ family, runtime, authHeaders, getSelection = () => ({ family, revision: 1 }), getKernelRuntime = () => runtime }) => {
  const app = express();
  app.use(express.json());
  registerGitRoutes(app, {
    getBackendSelection: getSelection,
    getKernelRuntime,
    getOpenCodeAuthHeaders: authHeaders,
  });
  return app;
};

const remove = async (app, repository, worktree) => request(app)
  .delete('/api/git/worktrees')
  .query({ directory: repository })
  .send({ directory: worktree })
  .expect(200, { success: true });

const startKernel = async (onRequest) => {
  const server = http.createServer(onRequest);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('worktree instance disposal route', () => {
  it('evicts through the OC2 SDK before removing a real Git worktree', async () => {
    const { repository, worktree } = createWorktree();
    let requestCount = 0;
    let requestUrl = '';
    const endpoint = await startKernel((req, res) => {
      requestCount += 1;
      requestUrl = decodeURIComponent(req.url || '');
      res.writeHead(204);
      res.end();
    });
    const authHeaders = () => ({ authorization: 'Bearer test' });
    const app = appFor({
      family: AGENT_FAMILY.OPENCODE,
      runtime: { generation: OPENCODE_GENERATION.OC2, profile: OPENCODE_PROFILE.OC2, endpoint, epoch: 1 },
      authHeaders,
    });

    await remove(app, repository, worktree);
    expect(requestCount).toBe(1);
    expect(requestUrl).toContain(worktree.replaceAll('\\', '/'));
    expect(fs.existsSync(worktree)).toBe(false);
  }, 15_000);

  it.each([
    [AGENT_FAMILY.CAGENT, { generation: OPENCODE_GENERATION.OC2, profile: OPENCODE_PROFILE.OC2, endpoint: 'http://127.0.0.1:1', epoch: 1 }],
    [AGENT_FAMILY.OPENCODE, { generation: OPENCODE_GENERATION.OC1, profile: OPENCODE_PROFILE.OC1, endpoint: 'http://127.0.0.1:1', epoch: 1 }],
    [AGENT_FAMILY.OPENCODE, { generation: OPENCODE_GENERATION.OC1, profile: OPENCODE_PROFILE.LEGACY, endpoint: 'http://127.0.0.1:1', epoch: 1 }],
  ])('keeps local removal for family/profile %s/%s', async (family, runtime) => {
    const { repository, worktree } = createWorktree();
    let selectionReads = 0;
    let kernelReads = 0;
    const getSelection = () => { selectionReads += 1; return { family, revision: 1 }; };
    const authHeaders = () => { throw new Error('Unexpected OpenCode auth lookup'); };
    const getKernelRuntime = () => { kernelReads += 1; return runtime; };
    await remove(appFor({ family, runtime, authHeaders, getSelection, getKernelRuntime }), repository, worktree);
    expect(selectionReads).toBe(1);
    expect(kernelReads).toBe(family === AGENT_FAMILY.CAGENT ? 0 : 1);
    expect(fs.existsSync(worktree)).toBe(false);
  });

  it('skips a retired backend before dispatch and still removes the worktree', async () => {
    const { repository, worktree } = createWorktree();
    let selection = { family: AGENT_FAMILY.OPENCODE, revision: 1 };
    let requestCount = 0;
    const endpoint = await startKernel((_req, res) => { requestCount += 1; res.end('{}'); });
    const app = appFor({
      family: AGENT_FAMILY.OPENCODE,
      runtime: { generation: OPENCODE_GENERATION.OC2, profile: OPENCODE_PROFILE.OC2, endpoint, epoch: 1 },
      getSelection: () => selection,
      authHeaders: () => {
        selection = { family: AGENT_FAMILY.CAGENT, revision: 2 };
        return {};
      },
    });

    await remove(app, repository, worktree);
    expect(requestCount).toBe(0);
    expect(fs.existsSync(worktree)).toBe(false);
  });
});

it('skips disposal when only the kernel profile changes before SDK dispatch', async () => {
  const { repository, worktree } = createWorktree();
  let runtime;
  let requests = 0;
  const endpoint = await startKernel((_req, res) => { requests += 1; res.end(); });
  runtime = { generation: OPENCODE_GENERATION.OC2, profile: OPENCODE_PROFILE.OC2, endpoint, epoch: 1 };
  const app = appFor({
    family: AGENT_FAMILY.OPENCODE,
    getKernelRuntime: () => runtime,
    authHeaders: () => { runtime = { ...runtime, profile: OPENCODE_PROFILE.LEGACY }; return {}; },
  });
  await remove(app, repository, worktree);
  expect(requests).toBe(0);
  expect(fs.existsSync(worktree)).toBe(false);
});

it.each(['family', 'profile'])('reports retired disposal after a response-time %s change while preserving local removal', async (change) => {
  const { repository, worktree } = createWorktree();
  let selection = { family: AGENT_FAMILY.OPENCODE, revision: 1 };
  let runtime;
  let requests = 0;
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const endpoint = await startKernel((_req, res) => {
    requests += 1;
    if (change === 'family') selection = { family: AGENT_FAMILY.CAGENT, revision: 2 };
    else runtime = { ...runtime, profile: OPENCODE_PROFILE.LEGACY };
    res.writeHead(204);
    res.end();
  });
  runtime = { generation: OPENCODE_GENERATION.OC2, profile: OPENCODE_PROFILE.OC2, endpoint, epoch: 1 };
  const app = appFor({
    family: AGENT_FAMILY.OPENCODE,
    getSelection: () => selection,
    getKernelRuntime: () => runtime,
    authHeaders: () => ({}),
  });
  await remove(app, repository, worktree);
  expect(requests).toBe(1);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining('Failed to dispose the OpenCode instance'),
    expect.stringContaining('OpenCode connection changed during worktree disposal'));
  expect(fs.existsSync(worktree)).toBe(false);
});