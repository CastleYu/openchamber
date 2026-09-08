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

const createApp = ({ environment = {}, storedOptions = {} } = {}) => {
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
