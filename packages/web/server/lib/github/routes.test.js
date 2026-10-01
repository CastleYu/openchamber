import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';

import { registerGitHubRoutes } from './routes.js';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-github-pulls-'));
const previousDataDir = process.env.OPENCHAMBER_DATA_DIR;
const repository = path.join(testDir, 'project');
const response = (data, status = 200) => Response.json(data, { status });

describe('GitHub PR search enrichment', () => {
  let app;
  beforeAll(async () => {
    process.env.OPENCHAMBER_DATA_DIR = testDir;
    fs.mkdirSync(repository);
    execFileSync('git', ['init', '-q', repository]);
    execFileSync('git', ['-C', repository, 'remote', 'add', 'origin', 'https://github.com/example/project.git']);
    const { setGitHubAuth, setGhCliDisabled } = await import('./auth.js');
    setGhCliDisabled(true);
    setGitHubAuth({ accessToken: 'fake-test-token', accountId: 'test' });
    app = express();
    registerGitHubRoutes(app);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
    else process.env.OPENCHAMBER_DATA_DIR = previousDataDir;
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('fails a page when one PR cannot be enriched', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/repos/example/project') return response({ full_name: 'example/project' });
      if (pathname === '/search/issues') return response({ total_count: 2, items: [1, 2].map((number) =>
        ({ number, repository_url: 'https://api.github.com/repos/example/project' })) });
      if (pathname === '/repos/example/project/pulls/2') return response({ message: 'GitHub enrichment unavailable' }, 503);
      if (pathname === '/repos/example/project/pulls/1') return response({ number: 1, title: 'PR 1',
        html_url: 'https://github.com/example/project/pull/1', state: 'open',
        base: { ref: 'main' }, head: { ref: 'feature', sha: 'sha-1' } });
      throw new Error(`Unexpected GitHub path: ${pathname}`);
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await request(app).get('/api/github/pulls/list').query({ directory: repository, query: 'fix' });
    expect(result.status).toBe(500);
    expect(result.body).not.toHaveProperty('prs');
  });
});

describe('POST /api/github/pr/summaries', () => {
  let app;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-github-summaries-'));

  beforeAll(async () => {
    process.env.OPENCHAMBER_DATA_DIR = dataDir;
    const { setGitHubAuth, setGhCliDisabled } = await import('./auth.js');
    setGhCliDisabled(true);
    setGitHubAuth({ accessToken: 'fake-test-token', accountId: 'test' });
    app = express();
    app.use(express.json());
    registerGitHubRoutes(app);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
    else process.env.OPENCHAMBER_DATA_DIR = previousDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const summaries = (refs) => request(app).post('/api/github/pr/summaries').send({ refs });

  const serveGraphql = (body) => {
    const fetch = vi.fn(async () => response(body));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('rejects malformed refs before asking GitHub', async () => {
    const fetch = serveGraphql({ data: {} });

    const res = await summaries([{ owner: 'example', repo: 'project', number: 'seven' }]);

    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers with the live state of each resolved PR', async () => {
    serveGraphql({
      data: {
        p0: { pullRequest: { number: 7, title: 'Fix', state: 'MERGED', isDraft: false, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', headRefOid: 'abc', commits: { nodes: [] } } },
        p1: null,
      },
      errors: [{ type: 'NOT_FOUND', path: ['p1'], message: 'Could not resolve to a Repository' }],
    });

    const res = await summaries([
      { owner: 'example', repo: 'project', number: 7 },
      { owner: 'example', repo: 'gone', number: 8 },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.summaries).toEqual([
      expect.objectContaining({ owner: 'example', repo: 'project', number: 7, state: 'merged', checks: null }),
    ]);
  });

  // Last in the file: the rate-limit cooldown it records is process-global.
  it('reports a GraphQL rate limit as a transient failure', async () => {
    serveGraphql({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] });

    const res = await summaries([{ owner: 'example', repo: 'project', number: 7 }]);

    expect(res.status).toBe(503);
  });
});
