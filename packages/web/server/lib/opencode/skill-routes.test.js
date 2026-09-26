import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer } from 'node:http';
import { registerSkillRoutes } from './skill-routes.js';
import {
  createSkill,
  deleteSkill,
  discoverSkills,
  getSkillSources,
  isManagedSkillPath,
  mergeDiscoveredSkills,
  renameSkill,
  updateSkill,
} from './skills.js';
import {
  SKILL_DIR,
  SKILL_SCOPE,
  deleteSkillSupportingFile,
  readSkillSupportingFile,
  writeSkillSupportingFile,
} from './shared.js';

const createTempProject = (prefix = 'oc-skill-routes-') => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(projectRoot, '.git'));
  return projectRoot;
};

const startSkillsApp = ({ projectRoot, kernelRuntime = { get: () => ({ generation: 'oc1', endpoint: 'http://127.0.0.1:9', epoch: 1 }) } }) => {
  const app = express();
  app.use(express.json());

  registerSkillRoutes(app, {
    fs,
    path,
    os,
    resolveProjectDirectory: async () => ({ directory: projectRoot, error: null }),
    resolveOptionalProjectDirectory: async (req) => {
      const queryDirectory = Array.isArray(req.query?.directory)
        ? req.query.directory[0]
        : req.query?.directory;
      if (!queryDirectory) {
        return { directory: null, error: null };
      }
      return { directory: String(queryDirectory), error: null };
    },
    readSettingsFromDisk: async () => ({}),
    sanitizeSkillCatalogs: (value) => value,
    isUnsafeSkillRelativePath: () => false,
    refreshOpenCodeAfterConfigChange: async () => {},
    clientReloadDelayMs: 0,
    buildOpenCodeUrl: () => 'http://127.0.0.1:9/',
    getOpenCodeAuthHeaders: () => ({}),
    getOpenCodePort: () => 0,
    kernelRuntime,
    getSkillSources,
    discoverSkills,
    mergeDiscoveredSkills,
    createSkill,
    updateSkill,
    deleteSkill,
    renameSkill,
    isManagedSkillPath,
    readSkillSupportingFile,
    writeSkillSupportingFile,
    deleteSkillSupportingFile,
    SKILL_SCOPE,
    SKILL_DIR,
    getCuratedSkillsSources: () => [],
    getCacheKey: () => 'k',
    scanWithCache: async (_key, loader) => loader(),
    parseSkillRepoSource: () => ({ ok: false }),
    scanSkillsRepository: async () => ({ ok: false }),
    installSkillsFromRepository: async () => ({ ok: false }),
    fetchGitHubRepoMetas: async () => ({}),
    getProfiles: () => [],
    getProfile: () => null,
  });

  const server = app.listen(0);
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

const startKernel = async (handler) => {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};

describe('skill-routes directory soft fallback', () => {
  /** @type {string | null} */
  let projectRoot = null;
  /** @type {{ close: () => Promise<void> } | null} */
  let appHandle = null;
  let kernelHandle = null;

  afterEach(async () => {
    if (appHandle) {
      await appHandle.close();
      appHandle = null;
    }
    if (kernelHandle) {
      await kernelHandle.close();
      kernelHandle = null;
    }
    if (projectRoot) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      projectRoot = null;
    }
  });

  it('lists repository-local .agents skills after create even when list omits directory', async () => {
    projectRoot = createTempProject();
    appHandle = startSkillsApp({ projectRoot });

    const createResponse = await fetch(`${appHandle.baseUrl}/api/config/skills/repo-local-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Created without list directory',
        instructions: 'Do the thing.',
        scope: 'project',
        source: 'agents',
      }),
    });
    expect(createResponse.status).toBe(200);
    expect(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'repo-local-skill', 'SKILL.md'))).toBe(true);

    const listResponse = await fetch(`${appHandle.baseUrl}/api/config/skills`);
    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json();
    expect(payload.skills.map((skill) => skill.name)).toContain('repo-local-skill');
    const skill = payload.skills.find((entry) => entry.name === 'repo-local-skill');
    expect(skill.scope).toBe('project');
    expect(skill.source).toBe('agents');
  });

  it('lists manually created repository-local .agents skills via active-project fallback', async () => {
    projectRoot = createTempProject();
    const skillDir = path.join(projectRoot, '.agents', 'skills', 'manual-repo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: manual-repo-skill',
        'description: Manual repository skill',
        '---',
        '',
        'Instructions',
        '',
      ].join('\n'),
      'utf8',
    );

    appHandle = startSkillsApp({ projectRoot });
    const listResponse = await fetch(`${appHandle.baseUrl}/api/config/skills`);
    expect(listResponse.status).toBe(200);
    const payload = await listResponse.json();
    expect(payload.skills.map((skill) => skill.name)).toContain('manual-repo-skill');
  });

  it('marks managed-root skills renamable and cache skills not renamable', async () => {
    projectRoot = createTempProject();
    const managedDir = path.join(projectRoot, '.opencode', 'skills', 'managed-list-skill');
    fs.mkdirSync(managedDir, { recursive: true });
    fs.writeFileSync(
      path.join(managedDir, 'SKILL.md'),
      [
        '---',
        'name: managed-list-skill',
        'description: Managed list skill',
        '---',
        '',
        'Managed body',
        '',
      ].join('\n'),
      'utf8',
    );

    const cacheStamp = `oc-skill-routes-${Date.now()}`;
    const cacheDir = path.join(os.homedir(), '.cache', 'opencode', 'skills', cacheStamp, 'cache-list-skill');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'SKILL.md'),
      [
        '---',
        'name: cache-list-skill',
        'description: Cache list skill',
        '---',
        '',
        'Cache body',
        '',
      ].join('\n'),
      'utf8',
    );

    try {
      appHandle = startSkillsApp({ projectRoot });
      const listResponse = await fetch(
        `${appHandle.baseUrl}/api/config/skills?directory=${encodeURIComponent(projectRoot)}`,
      );
      expect(listResponse.status).toBe(200);
      const payload = await listResponse.json();

      const managed = payload.skills.find((entry) => entry.name === 'managed-list-skill');
      const cached = payload.skills.find((entry) => entry.name === 'cache-list-skill');

      expect(managed).toBeTruthy();
      expect(managed.renamable).toBe(true);
      expect(cached).toBeTruthy();
      expect(cached.renamable).toBe(false);
    } finally {
      fs.rmSync(path.join(os.homedir(), '.cache', 'opencode', 'skills', cacheStamp), {
        recursive: true,
        force: true,
      });
    }
  });

  it('reads the OC2 skill.list envelope while retaining local skills', async () => {
    projectRoot = createTempProject('oc~skill-routes-');
    const localDir = path.join(projectRoot, '.agents', 'skills', 'local-skill');
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, 'SKILL.md'), '---\nname: local-skill\ndescription: local\n---\n\nLocal body\n');
    const requests = [];
    kernelHandle = await startKernel((req, res) => {
      requests.push(req.url);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        location: { directory: projectRoot },
        data: [{ id: 'remote-skill', name: 'remote-skill', path: path.join(projectRoot, '.opencode', 'skills', 'remote-skill', 'SKILL.md'), content: 'Remote body', description: 'remote' }],
      }));
    });
    const kernelRuntime = { get: () => ({ generation: 'oc2', endpoint: kernelHandle.endpoint, epoch: 1 }) };
    appHandle = startSkillsApp({ projectRoot, kernelRuntime });
    const response = await fetch(`${appHandle.baseUrl}/api/config/skills?directory=${encodeURIComponent(projectRoot)}`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.partial).toBeUndefined();
    expect(payload.skills.map((skill) => skill.name)).toEqual(expect.arrayContaining(['local-skill', 'remote-skill']));
    expect(requests).toHaveLength(1);
    const requestedSkillList = new URL(requests[0], kernelHandle.endpoint);
    expect(requestedSkillList.pathname).toBe('/api/skill');
    expect(requestedSkillList.searchParams.get('location[directory]')).toBe(projectRoot);
  });

  it('marks OC2 discovery failure partial without erasing local skills', async () => {
    projectRoot = createTempProject();
    const localDir = path.join(projectRoot, '.agents', 'skills', 'local-skill');
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, 'SKILL.md'), '---\nname: local-skill\ndescription: local\n---\n\nLocal body\n');
    kernelHandle = await startKernel((_req, res) => {
      res.statusCode = 503;
      res.end('unavailable');
    });
    const kernelRuntime = { get: () => ({ generation: 'oc2', endpoint: kernelHandle.endpoint, epoch: 1 }) };
    appHandle = startSkillsApp({ projectRoot, kernelRuntime });
    const response = await fetch(`${appHandle.baseUrl}/api/config/skills`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.partial).toEqual({ source: 'opencode', reason: 'discovery-unavailable' });
    expect(payload.skills.map((skill) => skill.name)).toContain('local-skill');
  });

  it('marks a malformed OC2 skill envelope partial instead of empty success', async () => {
    projectRoot = createTempProject();
    kernelHandle = await startKernel((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ location: { directory: projectRoot }, data: { unexpected: true } }));
    });
    const kernelRuntime = { get: () => ({ generation: 'oc2', endpoint: kernelHandle.endpoint, epoch: 1 }) };
    appHandle = startSkillsApp({ projectRoot, kernelRuntime });
    const response = await fetch(`${appHandle.baseUrl}/api/config/skills`);
    expect(response.status).toBe(200);
    expect((await response.json()).partial).toEqual({ source: 'opencode', reason: 'discovery-unavailable' });
  });

  it('keeps local skills visible before the kernel generation is known', async () => {
    projectRoot = createTempProject();
    const localDir = path.join(projectRoot, '.agents', 'skills', 'offline-skill');
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, 'SKILL.md'), '---\nname: offline-skill\ndescription: offline\n---\n\nLocal body\n');
    appHandle = startSkillsApp({ projectRoot, kernelRuntime: { get: () => ({ generation: 'unknown', endpoint: null, epoch: 1 }) } });
    const response = await fetch(`${appHandle.baseUrl}/api/config/skills`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.skills.map((skill) => skill.name)).toContain('offline-skill');
    expect(payload.partial).toEqual({ source: 'opencode', reason: 'discovery-unavailable' });
    const detail = await fetch(`${appHandle.baseUrl}/api/config/skills/offline-skill`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).exists).toBe(true);
  });

  it('does not present a stale OC2 skill response as a current listing', async () => {
    projectRoot = createTempProject();
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    let started;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    kernelHandle = await startKernel(async (_req, res) => {
      started();
      await waiting;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ location: { directory: projectRoot }, data: [] }));
    });
    let epoch = 1;
    const kernelRuntime = { get: () => ({ generation: 'oc2', endpoint: kernelHandle.endpoint, epoch }) };
    appHandle = startSkillsApp({ projectRoot, kernelRuntime });
    const pending = fetch(`${appHandle.baseUrl}/api/config/skills`);
    await startedPromise;
    epoch = 2;
    release();
    const response = await pending;
    expect(response.status).toBe(500);
  });
});
