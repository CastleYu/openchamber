import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { registerMarkdownImageGrantRoutes } from './routes.js';
import { createKernelOperations } from '../opencode/kernel-operations.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);
const roots = [];
const servers = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

const createFixture = async ({ sources, markdown, getBackendSelection, getKernelRuntime, validateDirectoryPath, fsOverrides, kernelOps } = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-session-assets-'));
  roots.push(root);
  const approvedTempRoot = path.join(root, 'opencode');
  const directory = path.join(root, 'workspace');
  await Promise.all([
    fs.mkdir(approvedTempRoot, { recursive: true }),
    fs.mkdir(directory, { recursive: true }),
  ]);
  const defaultPath = path.join(approvedTempRoot, 'image.png');
  await fs.writeFile(defaultPath, PNG);
  const requestedSources = sources ?? [new URL(`file://${defaultPath}`).toString()];
  const text = markdown ?? requestedSources.map((source) => `![image](${source})`).join('\n');
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    info: { id: 'msg_1', role: 'assistant' },
    parts: [{ type: 'text', text }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const identity = { generation: 'oc1', profile: 'oc1', endpoint: 'http://opencode.test', epoch: 1 };
  const kernelOperations = kernelOps ?? {
    captureIdentity: vi.fn(() => identity),
    getMessageView: vi.fn(async ({ directory: requestedDirectory }) => {
      const response = await fetchMock();
      if (response.status === 404) return { ...identity, data: null };
      if (!response.ok) throw new Error(`OpenCode returned ${response.status}`);
      const record = await response.json();
      return { ...identity, data: {
        id: record.info.id,
        role: record.info.role,
        textParts: record.parts.filter((part) => part.type === 'text').map((part) => part.text),
      }, directory: requestedDirectory };
    }),
  };

  let fullReadCount = 0;
  const app = express();
  registerMarkdownImageGrantRoutes(app, {
    fsPromises: {
      ...fs,
      readFile: async (...args) => {
        fullReadCount += 1;
        return fs.readFile(...args);
      },
      ...fsOverrides,
    },
    path,
    os,
    crypto,
    approvedTempRoot,
    validateDirectoryPath: validateDirectoryPath ?? (async (candidate) => candidate === directory
      ? { ok: true, directory }
      : { ok: false, error: 'Invalid directory' }),
    kernelOperations,
    getBackendSelection: getBackendSelection ?? (() => ({ family: 'opencode' })),
    getKernelRuntime: getKernelRuntime ?? (() => ({ profile: 'oc1' })),
  });
  return {
    app,
    approvedTempRoot,
    directory,
    fetchMock,
    kernelOperations,
    fullReadCount: () => fullReadCount,
    root,
    sources: requestedSources,
  };
};

const prepare = (app, directory, sources) => request(app)
  .post('/api/openchamber/sessions/ses_1/markdown-image-grants')
  .send({ directory, messageId: 'msg_1', sources })
  .expect(200);

describe('session image assets', () => {
  it('passes the validated directory to the selected message owner', async () => {
    const fixture = await createFixture();
    await prepare(fixture.app, fixture.directory, ['image.png']);
    expect(fixture.kernelOperations.getMessageView).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'ses_1', messageID: 'msg_1', directory: fixture.directory,
    }));
  });

  it('prepares workspace and OpenCode temporary images with one message fetch', async () => {
    const fixture = await createFixture({ sources: ['workspace.png'] });
    await fs.writeFile(path.join(fixture.directory, 'workspace.png'), PNG);
    const temporaryPath = path.join(fixture.approvedTempRoot, 'temporary.png');
    await fs.writeFile(temporaryPath, PNG);
    const temporarySource = new URL(`file://${temporaryPath}`).toString();
    fixture.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      info: { id: 'msg_1', role: 'assistant' },
      parts: [{ type: 'text', text: `![workspace](workspace.png)\n![temporary](${temporarySource})` }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const response = await prepare(fixture.app, fixture.directory, ['workspace.png', temporarySource]);

    expect(fixture.fetchMock).toHaveBeenCalledTimes(1);
    expect(fixture.fullReadCount()).toBe(0);
    expect(response.body.results).toHaveLength(2);
    const canonicalTemporaryPath = await fs.realpath(temporaryPath);
    expect(response.body.results[0]).toEqual({
      source: 'workspace.png',
      status: 'ready',
      path: path.join(fixture.directory, 'workspace.png'),
    });
    expect(response.body.results[1]).toEqual(expect.objectContaining({
      source: temporarySource,
      status: 'ready',
      path: canonicalTemporaryPath,
      outsideFileGrant: expect.any(String),
      expiresAt: expect.any(Number),
    }));
  });

  it('returns partial results without letting one missing image block valid images', async () => {
    const fixture = await createFixture({ sources: ['present.png', 'deleted.png'] });
    await fs.writeFile(path.join(fixture.directory, 'present.png'), PNG);

    const response = await prepare(fixture.app, fixture.directory, fixture.sources);

    expect(response.body.results).toEqual([
      expect.objectContaining({ source: 'present.png', status: 'ready' }),
      { source: 'deleted.png', status: 'missing' },
    ]);
  });

  it('resolves encoded workspace paths without treating query or fragment text as a filename', async () => {
    const source = 'screen%20shot.png?version=1#preview';
    const fixture = await createFixture({ sources: [source] });
    await fs.writeFile(path.join(fixture.directory, 'screen shot.png'), PNG);

    const response = await prepare(fixture.app, fixture.directory, fixture.sources);

    expect(response.body.results).toEqual([
      expect.objectContaining({ source, status: 'ready' }),
    ]);
  });

  it('authorizes reference-style image syntax using its resolved destination', async () => {
    const source = 'reference.png';
    const fixture = await createFixture({
      sources: [source],
      markdown: '![screenshot][result]\n\n[result]: reference.png',
    });
    await fs.writeFile(path.join(fixture.directory, source), PNG);

    const response = await prepare(fixture.app, fixture.directory, fixture.sources);

    expect(response.body.results).toEqual([
      expect.objectContaining({ source, status: 'ready' }),
    ]);
  });

  it('authorizes inline image destinations containing balanced parentheses', async () => {
    const source = 'screen(1).png';
    const fixture = await createFixture({
      sources: [source],
      markdown: `![screenshot](${source})`,
    });
    await fs.writeFile(path.join(fixture.directory, source), PNG);

    const response = await prepare(fixture.app, fixture.directory, fixture.sources);

    expect(response.body.results).toEqual([
      expect.objectContaining({ source, status: 'ready' }),
    ]);
  });

  it('requires inline image destinations with titles to close', async () => {
    const sources = ['valid.png', 'malformed.png'];
    const fixture = await createFixture({
      sources,
      markdown: '![valid](valid.png "preview")\n![malformed](malformed.png "preview"',
    });
    await Promise.all(sources.map((source) => fs.writeFile(path.join(fixture.directory, source), PNG)));

    const response = await prepare(fixture.app, fixture.directory, sources);

    expect(response.body.results).toEqual([
      expect.objectContaining({ source: 'valid.png', status: 'ready' }),
      { source: 'malformed.png', status: 'error' },
    ]);
  });

  it('rejects a source that the message does not reference', async () => {
    const fixture = await createFixture({ markdown: 'No image here.' });
    const response = await prepare(fixture.app, fixture.directory, fixture.sources);
    expect(response.body.results).toEqual([{ source: fixture.sources[0], status: 'error' }]);
  });

  it('does not authorize image syntax inside fenced or inline code', async () => {
    const fixture = await createFixture({
      markdown: '```md\n![fenced](FENCED)\n```\n`![inline](INLINE)`',
    });
    const sources = ['FENCED', 'INLINE'];

    const response = await prepare(fixture.app, fixture.directory, sources);

    expect(response.body.results).toEqual(sources.map((source) => ({ source, status: 'error' })));
  });

  it('resets fenced-code state for each projected text part', async () => {
    const fixture = await createFixture({ sources: ['visible.png'] });
    await fs.writeFile(path.join(fixture.directory, 'visible.png'), PNG);
    fixture.kernelOperations.getMessageView.mockResolvedValueOnce({
      ...fixture.kernelOperations.captureIdentity(),
      data: { id: 'msg_1', role: 'assistant', textParts: ['```md\n![hidden](hidden.png)', '![visible](visible.png)'] },
    });
    const response = await prepare(fixture.app, fixture.directory, ['hidden.png', 'visible.png']);
    expect(response.body.results).toEqual([
      { source: 'hidden.png', status: 'error' },
      expect.objectContaining({ source: 'visible.png', status: 'ready' }),
    ]);
  });

  it('preserves missing-message 404 and upstream-failure 503', async () => {
    const fixture = await createFixture();
    fixture.kernelOperations.getMessageView.mockRejectedValueOnce(Object.assign(new Error('missing'), { status: 404 }));
    const payload = { directory: fixture.directory, messageId: 'msg_1', sources: fixture.sources };
    const missing = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants').send(payload);
    expect(missing.status).toBe(404);
    fixture.kernelOperations.getMessageView.mockRejectedValueOnce(new Error('offline'));
    const failed = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants').send(payload);
    expect(failed.status).toBe(503);
  });

  it('reads OC1 and OC2 assistant messages through their real SDK routes', async () => {
    for (const generation of ['oc1', 'oc2']) {
      const requests = [];
      let status = 200;
      const server = createServer((req, res) => {
        requests.push(req.url);
        const record = generation === 'oc1'
          ? { info: { id: 'msg_1', role: 'assistant' }, parts: [{ type: 'text', text: '![image](image.png)' }] }
          : { id: 'msg_1', type: 'assistant', content: [{ type: 'text', text: '![image](image.png)' }] };
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(status === 200 ? generation === 'oc1' ? record : { data: record }
          : status === 404 ? { _tag: 'MessageNotFoundError', message: 'missing' } : { error: 'unavailable' }));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      const endpoint = `http://127.0.0.1:${server.address().port}`;
      const kernelOps = createKernelOperations({
        getRuntime: () => ({ generation, profile: generation, endpoint, epoch: 1 }),
        getHeaders: () => ({}),
      });
      const fixture = await createFixture({ sources: ['image.png'], kernelOps, getKernelRuntime: () => ({ profile: generation }) });
      await fs.writeFile(path.join(fixture.directory, 'image.png'), PNG);
      const payload = { directory: fixture.directory, messageId: 'msg_1', sources: ['image.png'] };
      const ready = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants').send(payload);
      expect(ready.status).toBe(200);
      expect(ready.body.results[0]).toMatchObject({ source: 'image.png', status: 'ready' });
      expect(requests[0]).toContain(generation === 'oc1' ? '/session/ses_1/message/msg_1' : '/api/session/ses_1/message/msg_1');
      status = 404;
      const missing = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants').send(payload);
      expect(missing.status).toBe(404);
      status = 503;
      const failed = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants').send(payload);
      expect(failed.status).toBe(503);
    }
  });

  it('rejects paths outside the workspace and approved temporary root', async () => {
    const fixture = await createFixture();
    const outsidePath = path.join(fixture.root, 'outside.png');
    await fs.writeFile(outsidePath, PNG);
    const source = new URL(`file://${outsidePath}`).toString();
    fixture.fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      info: { id: 'msg_1', role: 'assistant' },
      parts: [{ type: 'text', text: `![outside](${source})` }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const response = await prepare(fixture.app, fixture.directory, [source]);
    expect(response.body.results).toEqual([{ source, status: 'error' }]);
  });

  it('rejects non-image bytes and symlink escapes per source', async () => {
    const fixture = await createFixture({ sources: ['invalid.png', 'linked.png'] });
    await fs.writeFile(path.join(fixture.directory, 'invalid.png'), 'not an image');
    await fs.writeFile(path.join(fixture.root, 'outside.png'), PNG);
    await fs.symlink(path.join(fixture.root, 'outside.png'), path.join(fixture.directory, 'linked.png'));

    const response = await prepare(fixture.app, fixture.directory, fixture.sources);
    expect(response.body.results).toEqual([
      { source: 'invalid.png', status: 'error' },
      { source: 'linked.png', status: 'error' },
    ]);
  });

  it.each([
    ['CAgent', () => ({ family: 'cagent' }), () => ({ profile: 'oc1' })],
    ['Legacy', () => ({ family: 'opencode' }), () => ({ profile: 'legacy-1.2.27' })],
  ])('refuses %s before directory or filesystem work', async (_name, getBackendSelection, getKernelRuntime) => {
    const validateDirectoryPath = vi.fn();
    const realpath = vi.fn();
    const fixture = await createFixture({ getBackendSelection, getKernelRuntime, validateDirectoryPath, fsOverrides: { realpath } });
    const response = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants')
      .send({ directory: fixture.directory, messageId: 'msg_1', sources: fixture.sources });
    expect(response.status).toBe(501);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(validateDirectoryPath).not.toHaveBeenCalled();
    expect(fixture.kernelOperations.getMessageView).not.toHaveBeenCalled();
    expect(realpath).not.toHaveBeenCalled();
  });

  it('does not read a message after the connection retires during directory validation', async () => {
    const fixture = await createFixture({ validateDirectoryPath: async (candidate) => {
      fixture.kernelOperations.captureIdentity.mockReturnValue({ generation: 'oc2', profile: 'oc2', endpoint: 'new', epoch: 2 });
      return { ok: true, directory: candidate };
    } });
    const response = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants')
      .send({ directory: fixture.directory, messageId: 'msg_1', sources: fixture.sources });
    expect(response.status).toBe(503);
    expect(fixture.kernelOperations.getMessageView).not.toHaveBeenCalled();
  });

  it('does not read a message after family selection changes during directory validation', async () => {
    let selection = { family: 'opencode', revision: 1 };
    const fixture = await createFixture({
      getBackendSelection: () => selection,
      validateDirectoryPath: async (candidate) => {
        selection = { family: 'cagent', revision: 2 };
        return { ok: true, directory: candidate };
      },
    });
    const response = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants')
      .send({ directory: fixture.directory, messageId: 'msg_1', sources: fixture.sources });
    expect(response.status).toBe(503);
    expect(fixture.kernelOperations.getMessageView).not.toHaveBeenCalled();
  });

  it('does not mint a grant after family selection changes during file inspection', async () => {
    let selection = { family: 'opencode', revision: 1 };
    const fixture = await createFixture({
      getBackendSelection: () => selection,
      fsOverrides: { realpath: async (...args) => {
        selection = { family: 'cagent', revision: 2 };
        return fs.realpath(...args);
      } },
    });
    const response = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants')
      .send({ directory: fixture.directory, messageId: 'msg_1', sources: fixture.sources });
    expect(response.status).toBe(503);
    expect(response.body.results).toBeUndefined();
  });

  it('does not return a grant after the connection retires during file inspection', async () => {
    let fixture;
    fixture = await createFixture({ fsOverrides: { realpath: async (...args) => {
      fixture.kernelOperations.captureIdentity.mockReturnValue({ generation: 'oc2', profile: 'oc2', endpoint: 'new', epoch: 2 });
      return fs.realpath(...args);
    } } });
    const response = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants')
      .send({ directory: fixture.directory, messageId: 'msg_1', sources: fixture.sources });
    expect(response.status).toBe(503);
    expect(response.body.results).toBeUndefined();
  });

  it('does not inspect files after the connection retires during message read', async () => {
    const realpath = vi.fn();
    const fixture = await createFixture({ fsOverrides: { realpath } });
    fixture.kernelOperations.getMessageView.mockImplementationOnce(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      fixture.kernelOperations.captureIdentity.mockReturnValue({ generation: 'oc2', profile: 'oc2', endpoint: 'new', epoch: 2 });
      return { generation: 'oc1', profile: 'oc1', endpoint: 'http://opencode.test', epoch: 1,
        data: { id: 'msg_1', role: 'assistant', textParts: [`![image](${fixture.sources[0]})`] } };
    });
    const response = await request(fixture.app).post('/api/openchamber/sessions/ses_1/markdown-image-grants')
      .send({ directory: fixture.directory, messageId: 'msg_1', sources: fixture.sources });
    expect(response.status).toBe(503);
    expect(realpath).not.toHaveBeenCalled();
  });
});
