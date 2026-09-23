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

const createApp = ({ environment = {}, storedOptions = {}, desktopUpdater, platform = 'linux', execPath = '/usr/bin/node', notifyOnly = true } = {}) => {
  const app = express();
  const dependencies = {
    personalBuild: { notifyOnly },
    fs: {
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      openSync: vi.fn(() => 7),
      closeSync: vi.fn(),
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
      platform,
      execPath,
      exit: vi.fn(),
    },
    server: {
      address: () => ({ port: 7897 }),
      close: vi.fn(),
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

describe('OpenChamber web update route on Windows', () => {
  it('runs the install-and-restart script from a batch file instead of a cmd.exe /c argument', async () => {
    const { app, dependencies } = createApp({
      platform: 'win32',
      notifyOnly: false,
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      environment: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' },
      storedOptions: { launchMode: 'daemon', port: 7897, uiPassword: 'pa%ss' },
    });
    childProcess.spawn.mockReturnValue({ unref: vi.fn() });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await request(app).post('/api/openchamber/update-install').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 1300));

    const scriptPath = path.join('/tmp/openchamber', 'update-install.cmd');
    expect(dependencies.fs.writeFileSync).toHaveBeenCalledWith(scriptPath, expect.any(String), 'utf8');
    const script = dependencies.fs.writeFileSync.mock.calls[0][1];
    const lines = script.split('\r\n').map((line) => line.replaceAll(path.resolve('/opt/openchamber/server', '..', 'bin', 'cli.js'), '/opt/openchamber/bin/cli.js'));
    expect(lines[0]).toBe('@echo off');
    // Every preamble line is an echo; none is left to run as a command.
    expect(lines.filter((line) => line.startsWith('currentVersion=') || line.startsWith('restartCommand='))).toEqual([]);
    expect(lines).toContain('echo packageManager=npm');
    expect(lines).toContain('echo restartCommand=^("C:\\Program Files\\nodejs\\node.exe" "/opt/openchamber/bin/cli.js" serve --port 7897 --ui-password "pa%%ss"^) ^|^| ^(openchamber serve --port 7897 --ui-password "pa%%ss"^)');
    // A .cmd shim (npm, pnpm, yarn) must be `call`ed or the script ends there.
    expect(lines).toContain('call npm install -g @openchamber/web@latest');
    expect(lines).toContain('ping -n 3 127.0.0.1 >nul');
    expect(lines.some((line) => line.startsWith('timeout '))).toBe(false);
    expect(lines).toContain('if %ERRORLEVEL% EQU 0 (');
    expect(lines.at(-2)).toBe('del "%~f0"');
    // A `%` in the password survives batch expansion only when doubled.
    expect(lines).toContain('  ("C:\\Program Files\\nodejs\\node.exe" "/opt/openchamber/bin/cli.js" serve --port 7897 --ui-password "pa%%ss") || (openchamber serve --port 7897 --ui-password "pa%%ss")');

    expect(childProcess.spawn).toHaveBeenCalledWith(
      'C:\\Windows\\system32\\cmd.exe',
      ['/c', scriptPath],
      expect.objectContaining({ detached: true, windowsHide: true }),
    );
    // The listener is closed before the batch is spawned, so the detached
    // child cannot inherit the socket and hold the port against the restart.
    expect(dependencies.server.close).toHaveBeenCalledOnce();
    expect(dependencies.server.close.mock.invocationCallOrder[0]).toBeLessThan(childProcess.spawn.mock.invocationCallOrder[0]);
    expect(dependencies.process.exit).toHaveBeenCalledWith(0);
  });

  it('answers 500 and keeps the server up when the batch file cannot be written', async () => {
    const { app, dependencies } = createApp({ platform: 'win32', notifyOnly: false, storedOptions: { launchMode: 'daemon', port: 7897 } });
    dependencies.fs.writeFileSync.mockImplementation(() => { throw new Error('EACCES'); });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app).post('/api/openchamber/update-install').expect(500);
    await new Promise((resolve) => setTimeout(resolve, 1300));

    expect(response.body.error).toContain('update-install.cmd');
    expect(response.body.error).toContain('EACCES');
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(dependencies.process.exit).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledOnce();
  });
});
