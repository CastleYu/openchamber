import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureOpenCodeCredentials, getProviderAuth, readOpenCodeCredentials } from './auth.js';

describe('dual OC2 credential owner', () => {
  let directory;
  let previousDb;
  let identity;
  let source;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-credential-generation-'));
    previousDb = process.env.OPENCODE_DB;
    process.env.OPENCODE_DB = path.join(directory, 'opencode.db');
    const db = new DatabaseSync(process.env.OPENCODE_DB);
    db.exec('CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT NOT NULL, value TEXT NOT NULL, active INTEGER, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)');
    db.prepare('INSERT INTO credential VALUES (?, ?, ?, ?, ?, ?, ?)').run('cred_1', 'openai', 'old', JSON.stringify({ type: 'key', key: 'legacy-key' }), 1, 1, 1);
    db.close();
    identity = { generation: 'oc2', version: '2.0.18', endpoint: 'http://local', epoch: 1 };
    source = { list: async () => [{ id: 'cred_2', integrationID: 'openai', label: 'new', active: true, value: { type: 'key', key: 'api-key' } }] };
    configureOpenCodeCredentials(() => identity, source);
  });

  afterEach(() => {
    configureOpenCodeCredentials(() => ({ generation: 'oc1' }), null);
    if (previousDb === undefined) delete process.env.OPENCODE_DB;
    else process.env.OPENCODE_DB = previousDb;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('keeps the pre-2.0.20 read-only database owner, then uses the official API', async () => {
    await expect(readOpenCodeCredentials()).resolves.toEqual({ openai: { type: 'api', key: 'legacy-key' } });
    await expect(getProviderAuth('openai')).resolves.toEqual({ type: 'api', key: 'legacy-key' });
    identity = { ...identity, version: '2.0.20', epoch: 2 };
    await expect(readOpenCodeCredentials()).resolves.toEqual({ openai: { type: 'api', key: 'api-key' } });
    await expect(getProviderAuth('openai')).resolves.toEqual({ type: 'api', key: 'api-key' });
  });

  it('does not fall back to the old database after an official API failure or an unknown version', async () => {
    identity = { ...identity, version: '2.0.20', epoch: 2 };
    configureOpenCodeCredentials(() => identity, { list: async () => { throw new Error('credential API unavailable'); } });
    await expect(readOpenCodeCredentials()).rejects.toThrow('credential API unavailable');
    identity = { ...identity, version: null, epoch: 3 };
    await expect(readOpenCodeCredentials()).rejects.toThrow('version is not known');
  });

  it('rejects a response completed after the runtime epoch moved', async () => {
    let finish;
    identity = { ...identity, version: '2.0.20', epoch: 2 };
    configureOpenCodeCredentials(() => identity, { list: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = readOpenCodeCredentials();
    await Promise.resolve();
    identity = { ...identity, epoch: 3 };
    finish([]);
    await expect(pending).rejects.toThrow('runtime changed');
  });
});
