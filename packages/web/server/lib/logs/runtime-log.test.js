import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntimeLog, installConsoleTee, redactText } from './runtime-log.js';

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-runtime-log-'));

describe('redactText', () => {
  it('masks key=value and JSON-style secret values', () => {
    expect(redactText('token=abc123')).toBe('token="***"');
    expect(redactText('"apiKey": "sk-123"')).toBe('"apiKey": "***"');
    expect(redactText('password: hunter2')).toBe('password: "***"');
  });

  it('masks bearer tokens', () => {
    expect(redactText('Authorization: Bearer eyJhbGciOi.abc')).toBe('Authorization: Bearer ***');
  });

  it('leaves ordinary text untouched', () => {
    expect(redactText('Starting OpenChamber on port 3001')).toBe('Starting OpenChamber on port 3001');
  });
});

describe('createRuntimeLog', () => {
  let dataDir;

  beforeEach(() => {
    dataDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const readLines = (relative) => (
    fs.readFileSync(path.join(dataDir, 'logs', relative), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  );

  it('appends console args as redacted JSONL lines', async () => {
    const fixed = new Date('2026-03-04T05:06:07.000Z');
    const runtimeLog = createRuntimeLog({ dataDir, now: () => fixed });
    await runtimeLog.append('info', ['Starting on port', 3001, 'token=abc']);
    await runtimeLog.append('error', ['boom']);

    const lines = readLines('openchamber-2026-03-04.log');
    expect(lines).toHaveLength(2);
    expect(lines[0].level).toBe('info');
    expect(lines[0].ts).toBe('2026-03-04T05:06:07.000Z');
    expect(lines[0].msg).toBe('Starting on port 3001 token="***"');
    expect(lines[1].level).toBe('error');
    expect(lines[1].msg).toBe('boom');
  });

  it('stores structured entries with secrets masked', async () => {
    const fixed = new Date('2026-03-04T05:06:07.000Z');
    const runtimeLog = createRuntimeLog({ dataDir, now: () => fixed });
    await runtimeLog.appendEntry({
      scope: 'mcp',
      event: 'diagnostic',
      level: 'error',
      server: 'db',
      config: { apiKey: 'sk-secret', url: 'https://example.com' },
      error: 'HTTP 401',
    });

    const [entry] = readLines('openchamber-2026-03-04.log');
    expect(entry.scope).toBe('mcp');
    expect(entry.server).toBe('db');
    expect(entry.config.apiKey).toBe('***');
    expect(entry.config.url).toBe('https://example.com');
  });

  it('uses the provided clock for the file date', async () => {
    const fixed = new Date('2026-03-04T05:06:07.000Z');
    const runtimeLog = createRuntimeLog({ dataDir, now: () => fixed });
    await runtimeLog.append('info', ['hello']);

    const lines = readLines('openchamber-2026-03-04.log');
    expect(lines[0].ts).toBe('2026-03-04T05:06:07.000Z');
  });

  it('rolls to a suffixed file when the size limit is reached', async () => {
    const fixed = new Date('2026-03-04T05:06:07.000Z');
    const runtimeLog = createRuntimeLog({
      dataDir,
      now: () => fixed,
      maxFileBytes: 200,
    });
    for (let i = 0; i < 5; i += 1) {
      await runtimeLog.append('info', [`message-${i}`]);
    }

    const logsDir = path.join(dataDir, 'logs');
    const names = fs.readdirSync(logsDir).sort();
    expect(names).toEqual(['openchamber-2026-03-04.1.log', 'openchamber-2026-03-04.log']);
    expect(fs.readFileSync(path.join(logsDir, names[1]), 'utf8').trim().split('\n')).toHaveLength(3);
    expect(fs.readFileSync(path.join(logsDir, names[0]), 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('cleans up log files older than the retention window', async () => {
    const logsDir = path.join(dataDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(logsDir, 'openchamber-2020-01-01.log'), 'old\n');
    fs.writeFileSync(path.join(logsDir, 'openchamber-2020-01-01.1.log'), 'old2\n');
    fs.writeFileSync(path.join(logsDir, 'openchamber-2999-01-01.log'), 'new\n');

    const fixed = new Date('2026-03-04T05:06:07.000Z');
    const runtimeLog = createRuntimeLog({
      dataDir,
      now: () => fixed,
      keepDays: 7,
    });
    await runtimeLog.append('info', ['trigger cleanup']);

    const names = fs.readdirSync(logsDir).sort();
    expect(names).toEqual(['openchamber-2026-03-04.log', 'openchamber-2999-01-01.log']);
  });

  it('lists files and refuses to read outside the logs directory', async () => {
    const fixed = new Date('2026-03-04T05:06:07.000Z');
    const runtimeLog = createRuntimeLog({ dataDir, now: () => fixed });
    await runtimeLog.append('info', ['hello']);

    const info = await runtimeLog.getInfo();
    expect(info.directory).toBe(path.join(dataDir, 'logs'));
    expect(info.files).toHaveLength(1);
    expect(info.files[0].name).toBe('openchamber-2026-03-04.log');
    expect(info.files[0].size).toBeGreaterThan(0);

    await expect(runtimeLog.readLogFileName('../settings.json')).rejects.toThrow('Invalid log file name');
    await expect(runtimeLog.readLogFileName('other.txt')).rejects.toThrow('Invalid log file name');

    const content = await runtimeLog.readLogFileName('openchamber-2026-03-04.log');
    expect(content).toContain('hello');
  });
});

describe('installConsoleTee', () => {
  let dataDir;

  beforeEach(() => {
    dataDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('tees console output into the log file and restores the original console', async () => {
    const fixed = new Date('2026-03-04T05:06:07.000Z');
    const runtimeLog = createRuntimeLog({ dataDir, now: () => fixed });
    const { restore } = installConsoleTee({ runtimeLog });
    console.log('teed message', 42);
    restore();
    console.log('after restore');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const logPath = path.join(dataDir, 'logs', 'openchamber-2026-03-04.log');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0].msg).toBe('teed message 42');
  });

  it('reports append failures on stderr instead of throwing', async () => {
    const runtimeLog = {
      append: () => Promise.reject(new Error('disk full')),
    };
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { restore } = installConsoleTee({ runtimeLog });
    expect(() => console.log('anything')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
    restore();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[runtime-log] append failed: disk full'));
  });
});
