import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import request from 'supertest';
import { expect, test } from 'vitest';

import { registerBuiltInGuests } from './catalog.js';
import { registerGuestRoutes } from './routes.js';

const ID = 'openchamber-builtin-file-route-fixture';

test('guest file route refuses a Windows drive-relative path before project resolution', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-file-route-'));
  const bundle = path.join(root, 'bundle');
  const packageRoot = path.join(bundle, 'fixture');
  const project = path.join(root, 'project');
  const data = path.join(root, 'data');
  await fs.mkdir(path.join(packageRoot, 'panel'), { recursive: true });
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'README.md'), 'Project text');
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: 'fixture', version: '1.0.0', type: 'module',
    openchamber: { apiVersion: 1, contributes: {
      panel: { id: ID, name: 'Fixture', icon: 'puzzle', entry: 'panel/index.html' },
      capabilities: ['files'],
    } },
  }));
  await fs.writeFile(path.join(packageRoot, 'panel', 'index.html'), '<script src="main.js"></script>');
  await fs.writeFile(path.join(packageRoot, 'panel', 'main.js'), '');
  await fs.writeFile(path.join(bundle, 'registry.json'), JSON.stringify({
    version: 1, extensions: [{ id: ID, directory: 'fixture' }],
  }));
  const release = await registerBuiltInGuests({ persistPath: path.join(data, 'extensions.json'), root: bundle });
  try {
    const app = express();
    registerGuestRoutes(app, {
      openchamberDataDir: data,
      resolveOptionalProjectDirectory: async () => ({ directory: project }),
    });
    const good = await request(app).post(`/api/guests/${ID}/files`)
      .send({ op: 'read', path: 'README.md' }).expect(200);
    expect(good.body.result.content).toBe('Project text');
    const bad = await request(app).post(`/api/guests/${ID}/files`)
      .send({ op: 'read', path: 'C:notes.txt' }).expect(400);
    expect(bad.body.error).toBe('BAD_PATH');
  } finally {
    release();
    await fs.rm(root, { recursive: true, force: true });
  }
});
