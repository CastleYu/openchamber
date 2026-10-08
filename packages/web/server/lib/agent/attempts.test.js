import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_MUTATIONS } from './constants.js';
import { createAgentAttempts } from './attempts.js';

const roots = new Set();
const makeStore = async (fsPromises = fs) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-agent-attempts-'));
  roots.add(directory);
  return { directory, store: createAgentAttempts({ directory, fsPromises }) };
};
const identity = (overrides = {}) => ({
  family: AGENT_FAMILY.OPENCODE, connectionID: 'connection-a', epoch: 1,
  adapterRevision: 'adapter-1', capabilityRevision: 'capability-1', ...overrides,
});

afterEach(async () => {
  await Promise.all([...roots].map((directory) => fs.rm(directory, { recursive: true, force: true })));
  roots.clear();
});

describe('agent attempt ledger', () => {
  it('persists an unknown reservation without payload and reads it after restart', async () => {
    const { directory, store } = await makeStore();
    const who = identity();
    expect(await store.read(who, 'request-a')).toBeNull();
    const attempt = await store.begin(who, AGENT_MUTATIONS[0], 'request-a');
    const persisted = await fs.readFile(path.join(directory, (await fs.readdir(directory))[0]), 'utf8');
    expect(persisted).toContain('"state":"unknown"');
    expect(persisted).not.toContain('payload');
    expect(await createAgentAttempts({ directory }).read(who, 'request-a')).toMatchObject({ state: 'unknown', requestID: 'request-a' });
    await attempt.finish('unknown');
  });

  it.each(['accepted', 'complete', 'not-sent'])('persists the %s terminal state', async (state) => {
    const { directory, store } = await makeStore();
    const who = identity();
    const attempt = await store.begin(who, AGENT_MUTATIONS[0], `request-${state}`);
    expect(await attempt.finish(state)).toMatchObject({ state });
    expect(await createAgentAttempts({ directory }).read(who, `request-${state}`)).toMatchObject({ state });
    await expect(attempt.finish(state)).rejects.toMatchObject({ code: AGENT_ERROR.ATTEMPT_STORAGE });
  });

  it('reserves requests exclusively across store instances and identity revisions', async () => {
    const { directory, store } = await makeStore();
    const who = identity();
    await (await store.begin(who, AGENT_MUTATIONS[0], 'request-a')).finish('unknown');
    const restarted = createAgentAttempts({ directory });
    await expect(restarted.begin(identity({ epoch: 2, adapterRevision: 'adapter-2' }), AGENT_MUTATIONS[0], 'request-a'))
      .rejects.toMatchObject({ code: AGENT_ERROR.ATTEMPT_EXISTS });
    await (await restarted.begin(identity({ family: AGENT_FAMILY.CAGENT }), AGENT_MUTATIONS[0], 'request-a')).finish('unknown');
    await (await restarted.begin(identity({ connectionID: 'connection-b' }), AGENT_MUTATIONS[0], 'request-a')).finish('unknown');
  });

  it('allows exactly one concurrent reservation', async () => {
    const { directory, store } = await makeStore();
    const other = createAgentAttempts({ directory });
    const results = await Promise.allSettled([store.begin(identity(), AGENT_MUTATIONS[0], 'race'),
      other.begin(identity(), AGENT_MUTATIONS[0], 'race')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'fulfilled') await result.value.finish('unknown');
      else expect(result.reason).toMatchObject({ code: AGENT_ERROR.ATTEMPT_EXISTS });
    }
  });

  it.each([
    ['partial record', '{'], ['blank record', ''], ['extra newline', '{"unused":true}\n\n'],
    ['malformed record', '{"version":1}\n'],
  ])('reports %s as corrupt', async (_label, text) => {
    const { directory, store } = await makeStore();
    const who = identity();
    await (await store.begin(who, AGENT_MUTATIONS[0], 'request-a')).finish('unknown');
    const file = path.join(directory, (await fs.readdir(directory))[0]);
    await fs.writeFile(file, text);
    await expect(store.read(who, 'request-a')).rejects.toMatchObject({ code: AGENT_ERROR.ATTEMPT_CORRUPT });
  });

  it('rejects a tampered identity and invalid operation or request ID', async () => {
    const { directory, store } = await makeStore();
    const who = identity();
    await (await store.begin(who, AGENT_MUTATIONS[0], 'request-a')).finish('unknown');
    const file = path.join(directory, (await fs.readdir(directory))[0]);
    const record = JSON.parse((await fs.readFile(file, 'utf8')).split('\n')[0]);
    record.identity.connectionID = 'different-connection';
    await fs.writeFile(file, `${JSON.stringify(record)}\n`);
    await expect(store.read(who, 'request-a')).rejects.toMatchObject({ code: AGENT_ERROR.ATTEMPT_CORRUPT });
    await expect(store.begin(who, 'getSession', 'request-b')).rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
    await expect(store.begin(who, AGENT_MUTATIONS[0], '')).rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
    await expect(store.read(who, '')).rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
  });

  it('rejects an extra blank row after otherwise valid records', async () => {
    const { directory, store } = await makeStore();
    await (await store.begin(identity(), AGENT_MUTATIONS[0], 'r1')).finish('complete');
    const file = path.join(directory, (await fs.readdir(directory))[0]);
    await fs.appendFile(file, '\n');
    await expect(store.read(identity(), 'r1')).rejects.toMatchObject({ code: AGENT_ERROR.ATTEMPT_CORRUPT });
  });

  it('rejects a final row from a different operation', async () => {
    const { directory, store } = await makeStore();
    await (await store.begin(identity(), AGENT_MUTATIONS[0], 'r1')).finish('complete');
    const file = path.join(directory, (await fs.readdir(directory))[0]);
    const rows = (await fs.readFile(file, 'utf8')).trimEnd().split('\n').map((line) => JSON.parse(line));
    rows[1].operation = AGENT_MUTATIONS[1];
    await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await expect(store.read(identity(), 'r1')).rejects.toMatchObject({ code: AGENT_ERROR.ATTEMPT_CORRUPT });
  });

  it('normalizes sync and close failures while retaining reservations', async () => {
    const { directory } = await makeStore();
    const syncFailure = {
      ...fs,
      open: async (...args) => {
        const handle = await fs.open(...args);
        return { ...handle, writeFile: handle.writeFile.bind(handle), close: handle.close.bind(handle),
          sync: async () => { throw new Error('sync failed'); } };
      },
    };
    const syncStore = createAgentAttempts({ directory, fsPromises: syncFailure });
    await expect(syncStore.begin(identity(), AGENT_MUTATIONS[0], 'sync-request')).rejects.toMatchObject({ code: AGENT_ERROR.ATTEMPT_STORAGE });
    expect(await fs.readdir(directory)).toHaveLength(1);

    const closeFailure = {
      ...fs,
      open: async (...args) => {
        const handle = await fs.open(...args);
        return { ...handle, writeFile: handle.writeFile.bind(handle), sync: handle.sync.bind(handle),
          close: async () => { await handle.close(); throw new Error('close failed'); } };
      },
    };
    const closeStore = createAgentAttempts({ directory, fsPromises: closeFailure });
    const attempt = await closeStore.begin(identity(), AGENT_MUTATIONS[0], 'close-request');
    await expect(attempt.finish('complete')).rejects.toMatchObject({ code: AGENT_ERROR.ATTEMPT_STORAGE });
    expect(await fs.readdir(directory)).toHaveLength(2);
  });
});
