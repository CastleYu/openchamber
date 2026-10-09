import { describe, expect, test } from 'bun:test';
import { AGENT_ERROR } from '../../../../web/server/lib/agent/constants.js';
import { AgentClientError } from './client';
import { AgentExtensionJournal, type AgentExtensionOwner, type AgentExtensionPending } from './extension-journal';

const FAILURE = Object.freeze({ GET: 'get', KEY: 'key', SET: 'set', REMOVE: 'remove' } as const);
class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> {
  private readonly values = new Map<string, string>();
  fail: string | undefined;
  get length(): number { return this.values.size; }
  key(index: number): string | null { if (this.fail === FAILURE.KEY) throw Error(); return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { if (this.fail === FAILURE.GET) throw Error(); return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.fail === FAILURE.SET) throw Error(); this.values.set(key, value); }
  removeItem(key: string): void { if (this.fail === FAILURE.REMOVE) throw Error(); this.values.delete(key); }
  corrupt(key: string, value: string): void { this.values.set(key, value); }
  keys(): readonly string[] { return [...this.values.keys()]; }
}

const OWNER = Object.freeze({
  family: 'cagent', connectionID: 'conn', principalID: `principal-${'a'.repeat(64)}`,
  workspaceID: 'work', sessionID: 'session',
} satisfies AgentExtensionOwner);
const PENDING = Object.freeze({ actionID: 'cagent.report', requestID: 'r1' } satisfies AgentExtensionPending);
const assertCode = (run: () => void, expected: string): void => {
  try { run(); throw Error('expected AgentClientError'); }
  catch (error) {
    if (!(error instanceof AgentClientError)) throw error;
    expect(error.code).toBe(expected);
  }
};

describe('AgentExtensionJournal', () => {
  test('round trips and recreates action-specific pending records', () => {
    const storage = new MemoryStorage();
    const journal = new AgentExtensionJournal(storage, 'runtime');
    journal.mark(OWNER, PENDING);
    expect(new AgentExtensionJournal(storage, 'runtime').read(OWNER)).toEqual([PENDING]);
  });

  test('isolates principal and global, workspace, and session contexts', () => {
    const storage = new MemoryStorage();
    const journal = new AgentExtensionJournal(storage, 'runtime');
    const otherPrincipal = { ...OWNER, principalID: `principal-${'b'.repeat(64)}` };
    const workspace = { ...OWNER, sessionID: undefined };
    const global = { family: OWNER.family, connectionID: OWNER.connectionID, principalID: OWNER.principalID };
    journal.mark(OWNER, PENDING); journal.mark(otherPrincipal, PENDING);
    journal.mark(workspace, { ...PENDING, requestID: 'w' });
    journal.mark(global, { ...PENDING, requestID: 'g' });
    expect(journal.read(OWNER)).toEqual([PENDING]);
    expect(journal.read(otherPrincipal)).toEqual([PENDING]);
    expect(journal.read(workspace)).toHaveLength(1);
    expect(journal.read(global)).toHaveLength(1);
  });

  test('separate instances preserve distinct requests and reject duplicate IDs', () => {
    const storage = new MemoryStorage();
    const first = new AgentExtensionJournal(storage, 'runtime');
    const second = new AgentExtensionJournal(storage, 'runtime');
    first.mark(OWNER, PENDING); second.mark(OWNER, { ...PENDING, requestID: 'r2' });
    assertCode(() => second.mark(OWNER, PENDING), AGENT_ERROR.ATTEMPT_EXISTS);
    expect(first.read(OWNER)).toHaveLength(2);
  });

  test('rejects invalid scope, action, namespace, and record size', () => {
    const storage = new MemoryStorage();
    const journal = new AgentExtensionJournal(storage, 'runtime');
    assertCode(() => new AgentExtensionJournal(storage, ''), AGENT_ERROR.INVALID_INPUT);
    assertCode(() => new AgentExtensionJournal(storage, 'n'.repeat(129)), AGENT_ERROR.INVALID_INPUT);
    assertCode(() => journal.mark({ ...OWNER, sessionID: 'orphan', workspaceID: undefined }, PENDING), AGENT_ERROR.INVALID_INPUT);
    assertCode(() => journal.mark({ ...OWNER, principalID: 'raw-secret' }, PENDING), AGENT_ERROR.INVALID_INPUT);
    assertCode(() => journal.mark(OWNER, { ...PENDING, actionID: 'other.action' }), AGENT_ERROR.INVALID_INPUT);
    assertCode(() => journal.mark(OWNER, { ...PENDING, requestID: 'x'.repeat(1025) }), AGENT_ERROR.INVALID_INPUT);
    journal.mark(OWNER, PENDING);
    storage.corrupt(storage.keys()[0], 'x'.repeat(16385));
    assertCode(() => journal.read(OWNER), AGENT_ERROR.ATTEMPT_CORRUPT);
  });

  test('strictly rejects extra keys, mismatched records, and malformed records only in requested context', () => {
    const storage = new MemoryStorage();
    const journal = new AgentExtensionJournal(storage, 'runtime');
    journal.mark(OWNER, PENDING);
    const key = storage.keys()[0];
    const other = { ...OWNER, sessionID: 'elsewhere' };
    journal.mark(other, PENDING);
    storage.corrupt(key, JSON.stringify({ version: 1, owner: OWNER, ...PENDING, extra: true }));
    assertCode(() => journal.read(OWNER), AGENT_ERROR.ATTEMPT_CORRUPT);
    expect(journal.read(other)).toEqual([PENDING]);
    storage.corrupt(key, JSON.stringify({ version: 1, owner: other, ...PENDING }));
    assertCode(() => journal.read(OWNER), AGENT_ERROR.ATTEMPT_CORRUPT);
    storage.corrupt(key, '{');
    assertCode(() => journal.read(OWNER), AGENT_ERROR.ATTEMPT_CORRUPT);
  });

  test('clear is idempotent, action-matched, and failed writes preserve records', () => {
    const storage = new MemoryStorage();
    const journal = new AgentExtensionJournal(storage, 'runtime');
    journal.mark(OWNER, PENDING);
    const before = storage.keys();
    storage.fail = FAILURE.SET;
    assertCode(() => journal.mark(OWNER, { ...PENDING, requestID: 'r2' }), AGENT_ERROR.ATTEMPT_STORAGE);
    storage.fail = undefined;
    assertCode(() => journal.clear(OWNER, { ...PENDING, actionID: 'cagent.other' }), AGENT_ERROR.INVALID_INPUT);
    expect(storage.keys()).toEqual(before);
    storage.fail = FAILURE.REMOVE;
    assertCode(() => journal.clear(OWNER, PENDING), AGENT_ERROR.ATTEMPT_STORAGE);
    storage.fail = undefined;
    expect(journal.read(OWNER)).toEqual([PENDING]);
    journal.clear(OWNER, PENDING); journal.clear(OWNER, PENDING);
    expect(journal.read(OWNER)).toEqual([]);
  });

  test('storage read failures remain explicit', () => {
    const storage = new MemoryStorage();
    const journal = new AgentExtensionJournal(storage, 'runtime');
    journal.mark(OWNER, PENDING);
    storage.fail = FAILURE.KEY;
    assertCode(() => journal.read(OWNER), AGENT_ERROR.ATTEMPT_STORAGE);
    storage.fail = FAILURE.GET;
    assertCode(() => journal.read(OWNER), AGENT_ERROR.ATTEMPT_STORAGE);
  });
});
