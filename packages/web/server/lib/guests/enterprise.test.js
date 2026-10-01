import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';

import { listInstalledGuests } from './catalog.js';
import { enterpriseBlockedCapabilities } from './enterprise.js';
import { guestGrantScope } from './grant-scope.js';
import { installGuestFromPath } from './install.js';
import { setCapabilityGrants } from './persist.js';
import { getServiceStatus } from './service.js';
import { registerGuestRoutes } from './routes.js';

const enterprise = (allowedExtensions = []) => ({ enterpriseMode: true, allowedExtensions, allowLocalExtensions: false });
const withOrigins = { origins: ['https://api.acme.test'] };

describe('enterpriseBlockedCapabilities', () => {
  test('refuses nothing outside enterprise mode', () => {
    expect(enterpriseBlockedCapabilities(withOrigins, { source: 'zip' }, { enterpriseMode: false, allowedExtensions: [] })).toEqual([]);
  });

  test('refuses egress-capable packages from unlisted sources', () => {
    expect(enterpriseBlockedCapabilities(withOrigins, { source: 'zip' }, enterprise())).toEqual(['origins']);
    expect(enterpriseBlockedCapabilities(withOrigins, { source: 'path' }, enterprise(['https://github.com/acme/ext']))).toEqual(['origins']);
    expect(enterpriseBlockedCapabilities(withOrigins, { source: 'git', gitUrl: 'https://github.com/other/ext' }, enterprise(['https://github.com/acme/ext']))).toEqual(['origins']);
  });

  test('matches an allowlisted repository regardless of common URL spelling', () => {
    const policy = enterprise(['https://github.com/acme/ext']);
    for (const gitUrl of ['https://github.com/acme/ext.git', 'https://GitHub.com/acme/ext/', 'git@github.com:acme/ext.git']) {
      expect(enterpriseBlockedCapabilities(withOrigins, { source: 'git', gitUrl }, policy)).toEqual([]);
    }
  });

  test('a trailing slash allows descendants, not similarly prefixed repositories', () => {
    const policy = enterprise(['https://github.com/acme/']);
    expect(enterpriseBlockedCapabilities(withOrigins, { source: 'git', gitUrl: 'https://github.com/acme/new-ext#branch' }, policy)).toEqual([]);
    expect(enterpriseBlockedCapabilities(withOrigins, { source: 'git', gitUrl: 'https://github.com/acme-other/ext' }, policy)).toEqual(['origins']);
  });

  test('allowLocalExtensions permits local folders, not ZIPs', () => {
    const policy = { enterpriseMode: true, allowedExtensions: [], allowLocalExtensions: true };
    expect(enterpriseBlockedCapabilities(withOrigins, { source: 'path' }, policy)).toEqual([]);
    expect(enterpriseBlockedCapabilities(withOrigins, { source: 'zip' }, policy)).toEqual(['origins']);
  });

  test('leaves packages without gated capabilities alone', () => {
    expect(enterpriseBlockedCapabilities({}, { source: 'zip' }, enterprise())).toEqual([]);
  });
});

const writeGuest = async (root, id, contributes = {}) => {
  await fs.mkdir(path.join(root, 'panel'), { recursive: true });
  await fs.writeFile(path.join(root, 'panel', 'index.html'), '<html></html>');
  if (contributes.service?.entry) {
    const servicePath = path.join(root, contributes.service.entry);
    await fs.mkdir(path.dirname(servicePath), { recursive: true });
    await fs.writeFile(servicePath, 'export {};');
  }
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: `@openchamber/${id}`,
    version: '1.0.0',
    openchamber: { apiVersion: 1, contributes: { panel: { id, name: id, icon: 'window', entry: 'panel/index.html' }, ...contributes } },
  }));
};

describe('extensions in enterprise mode', () => {
  const roots = [];
  afterEach(async () => {
    delete process.env.OPENCHAMBER_ENTERPRISE_MODE;
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  test('refuses egress-capable installs and accepts packages without gated capabilities', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-ext-enterprise-')); roots.push(dir);
    const persistPath = path.join(dir, 'extensions.json');
    await writeGuest(path.join(dir, 'reach'), 'reach-out', withOrigins);
    await writeGuest(path.join(dir, 'quiet'), 'stay-home');
    process.env.OPENCHAMBER_ENTERPRISE_MODE = '1';

    expect(await installGuestFromPath(path.join(dir, 'reach'), persistPath)).toEqual({ ok: false, code: 'enterprise-mode', capabilities: ['origins'] });
    expect((await installGuestFromPath(path.join(dir, 'quiet'), persistPath)).ok).toBe(true);
    expect((await listInstalledGuests({ persistPath })).map((guest) => guest.id)).toEqual(['stay-home']);
  });

  test('removes gated grants at read time when enterprise mode is enabled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-ext-enterprise-')); roots.push(dir);
    const persistPath = path.join(dir, 'extensions.json');
    await writeGuest(path.join(dir, 'reach'), 'reach-later', withOrigins);
    expect((await installGuestFromPath(path.join(dir, 'reach'), persistPath)).ok).toBe(true);
    const [installed] = await listInstalledGuests({ persistPath });
    await setCapabilityGrants(installed.id, persistPath, ['origins'], guestGrantScope(installed));
    expect((await listInstalledGuests({ persistPath }))[0].capabilityGrants).toEqual(['origins']);

    process.env.OPENCHAMBER_ENTERPRISE_MODE = '1';
    const [blocked] = await listInstalledGuests({ persistPath });
    expect(blocked.enterpriseBlocked).toEqual(['origins']);
    expect(blocked.capabilityGrants).not.toContain('origins');

    delete process.env.OPENCHAMBER_ENTERPRISE_MODE;
    const [restored] = await listInstalledGuests({ persistPath });
    expect(restored.enterpriseBlocked).toBeUndefined();
    expect(restored.capabilityGrants).toEqual(['origins']);
  });

  test('a direct service route cannot activate a grant blocked by enterprise policy', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-ext-enterprise-')); roots.push(dir);
    const persistPath = path.join(dir, 'extensions.json');
    const root = path.join(dir, 'service-guest');
    await writeGuest(root, 'service-guest', { service: { entry: 'service/main.js', runtime: 'host' } });
    expect((await installGuestFromPath(root, persistPath)).ok).toBe(true);
    const [installed] = await listInstalledGuests({ persistPath });
    await setCapabilityGrants(installed.id, persistPath, ['service'], guestGrantScope(installed));
    process.env.OPENCHAMBER_ENTERPRISE_MODE = '1';

    const app = express();
    registerGuestRoutes(app, { openchamberDataDir: dir });
    const response = await request(app).post('/api/guests/service-guest/service/request').send({ method: 'GET', path: '/health' }).expect(400);
    expect(response.body).toMatchObject({ error: 'NO_SERVICE' });
    expect(getServiceStatus('service-guest')).toBe('stopped');
  });
});
