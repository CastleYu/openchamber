import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import path from 'node:path';
import request from 'supertest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('../package-manager.js', () => ({
  checkForUpdates: vi.fn(),
  getUpdateCommand: vi.fn(),
  detectPackageManagerDetails: vi.fn(),
}));

const childProcess = await import('child_process');
const packageManager = await import('../package-manager.js');
const { registerOpenChamberRoutes } = await import('./openchamber-routes.js');

const createApp = ({ environment = {}, storedOptions = {}, desktopUpdater } = {}) => {
  const app = express();
  const dependencies = {
    fs: {
      existsSync: vi.fn(() => false),
      promises: {
        readFile: vi.fn(async () => JSON.stringify({
          launchMode: 'foreground',
          port: 7897,
          ...storedOptions,
        })),
      },
    },
    path,
    process: {
      env: environment,
      platform: 'linux',
      execPath: '/usr/bin/node',
    },
    server: {
      address: () => ({ port: 7897 }),
    },
    __dirname: '/opt/openchamber/server',
    openchamberDataDir: '/tmp/openchamber',
    modelsDevApiUrl: 'https://models.example.test',
    modelsMetadataCacheTtl: 0,
    readSettingsFromDiskMigrated: vi.fn(),
    fetchFreeZenModels: vi.fn(),
    getCachedZenModels: vi.fn(),
    desktopUpdater,
  };

  registerOpenChamberRoutes(app, dependencies);
  return { app, dependencies };
};

beforeEach(() => {
  packageManager.checkForUpdates.mockResolvedValue({
    available: true,
    version: '1.17.1',
  });
  packageManager.detectPackageManagerDetails.mockReturnValue({
    packageManager: 'npm',
  });
  packageManager.getUpdateCommand.mockReturnValue('npm install -g @openchamber/web@latest');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('OpenChamber desktop host update route', () => {
  it('personal policy denies installation before a rejecting native bridge runs', async () => {
    const desktopUpdater = {
      check: vi.fn(async () => ({ available: true, currentVersion: '1.23.0-DIJIANG.1', version: '1.24.0' })),
      install: vi.fn(async () => { throw new Error('Must not install'); }),
      restart: vi.fn(async () => { throw new Error('Must not restart'); }),
    };
    const { app } = createApp({ environment: { OPENCHAMBER_RUNTIME: 'desktop' }, desktopUpdater });
    await request(app).post('/api/openchamber/update-install').expect(403);
    const response = await request(app).get('/api/openchamber/update-check?appType=web&updateStatus=true').expect(200);
    expect(response.body.notifyOnly).toBe(true);
    expect(response.body.available).toBe(true);
    expect(desktopUpdater.install).not.toHaveBeenCalled();
    expect(desktopUpdater.restart).not.toHaveBeenCalled();
  });

  it('rejects native checks without a bridge and preserves explicit non-web checks', async () => {
    const { app } = createApp({ environment: { OPENCHAMBER_RUNTIME: 'desktop' } });
    await request(app).get('/api/openchamber/update-check?appType=web').expect(503, {
      available: false, code: 'DESKTOP_UPDATER_UNAVAILABLE', error: 'The desktop updater is not available.',
    });
    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
    await request(app).get('/api/openchamber/update-check?appType=desktop-electron').expect(200);
    expect(packageManager.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('uses electron-updater to check for Web client updates', async () => {
    const desktopUpdater = {
      check: vi.fn(async () => ({
        available: true,
        currentVersion: '1.17.0',
        version: '1.17.1',
      })),
      install: vi.fn(),
      restart: vi.fn(),
    };
    const { app } = createApp({
      environment: {
        OPENCHAMBER_RUNTIME: 'desktop',
      },
      desktopUpdater,
    });

    await request(app)
      .get('/api/openchamber/update-check?appType=web&reportUsage=false')
      .expect(200, {
        available: true,
        currentVersion: '1.17.0',
        version: '1.17.1',
        packageManager: 'electron',
        updateOwner: 'electron-updater',
        notifyOnly: true,
      });

    expect(desktopUpdater.check).toHaveBeenCalledOnce();
    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
  });

  it('personal policy denies native installation even when an update is available', async () => {
    const desktopUpdater = {
      check: vi.fn(async () => ({ available: true, version: '1.24.0' })),
      install: vi.fn(),
      restart: vi.fn(),
    };
    const { app } = createApp({ environment: { OPENCHAMBER_RUNTIME: 'desktop' }, desktopUpdater });
    await request(app).post('/api/openchamber/update-install').expect(403);
    expect(desktopUpdater.check).not.toHaveBeenCalled();
    expect(desktopUpdater.install).not.toHaveBeenCalled();
    expect(desktopUpdater.restart).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });

  it('fails safely when the Electron updater bridge is unavailable', async () => {
    const { app } = createApp({
      environment: {
        OPENCHAMBER_RUNTIME: 'desktop',
      },
    });

    await request(app)
      .post('/api/openchamber/update-install')
      .expect(403, {
        error: 'Personal builds only notify about updates. Sync the source and rebuild to keep personal features.',
      });

    expect(packageManager.checkForUpdates).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });
});

describe('OpenChamber foreground update route', () => {
  it('rejects a foreground update when the server is not owned by systemd', async () => {
    const { app } = createApp();

    await request(app)
      .post('/api/openchamber/update-install')
      .expect(403, {
        error: 'Personal builds only notify about updates. Sync the source and rebuild to keep personal features.',
      });

    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });

  it('rejects an unsafe systemd unit override before starting an update job', async () => {
    const { app } = createApp({
      environment: {
        INVOCATION_ID: 'systemd-invocation',
        OPENCHAMBER_SYSTEMD_UNIT: 'openchamber.service; rm -rf /',
      },
    });

    await request(app)
      .post('/api/openchamber/update-install')
      .expect(403, {
        error: 'Personal builds only notify about updates. Sync the source and rebuild to keep personal features.',
      });

    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });

  it('also denies installation for a valid systemd-managed personal build', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    childProcess.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    const { app } = createApp({
      environment: {
        INVOCATION_ID: 'systemd-invocation',
        OPENCHAMBER_SYSTEMD_UNIT: 'openchamber@wsl.service',
        PATH: '/home/syu/.npm-global/bin:/usr/bin:/bin',
      },
    });

    await request(app)
      .post('/api/openchamber/update-install')
      .expect(403, {
        error: 'Personal builds only notify about updates. Sync the source and rebuild to keep personal features.',
      });

    expect(childProcess.spawnSync).not.toHaveBeenCalled();
  });
});
