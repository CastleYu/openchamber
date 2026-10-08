import { describe, expect, test } from 'bun:test';
import { AGENT_ERROR } from '../../../../web/server/lib/agent/constants.js';
import { AgentClientError } from './client';
import { AgentRequestJournal, type AgentRequestOwner } from './journal';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> {
  private readonly values = new Map<string, string>();
  fail: 'get' | 'key' | 'set' | 'remove' | undefined;
  get length(): number { return this.values.size; }
  key(index: number): string | null {
    if (this.fail === 'key') throw new Error('storage failure');
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    if (this.fail === 'get') throw new Error('storage failure');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.fail === 'set') throw new Error('storage failure');
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    if (this.fail === 'remove') throw new Error('storage failure');
    this.values.delete(key);
  }
  corrupt(key: string, value: string): void { this.values.set(key, value); }
  keys(): readonly string[] { return [...this.values.keys()]; }
}

const owner: AgentRequestOwner = Object.freeze({ family: 'cagent', connectionID: 'conn', workspaceID: 'work', sessionID: 'session' });
const code = (run: () => void, expected: string) => {
  try { run(); throw new Error('expected AgentClientError'); }
  catch (error) {
    if (!(error instanceof AgentClientError)) throw error;
    expect(error.code).toBe(expected);
  }
};

describe('AgentRequestJournal', () => {
  test('corruption blocks its own session without blocking another complete owner', () => {
    const storage = new MemoryStorage();
    const journal = new AgentRequestJournal(storage, 'opaque-hash');
    journal.mark(owner, 'bad');
    const damaged = storage.keys()[0];
    const other = { ...owner, sessionID: 'other' };
    journal.mark(other, 'keep');
    storage.corrupt(damaged, '{');
    code(() => journal.read(owner), AGENT_ERROR.ATTEMPT_CORRUPT);
    code(() => journal.clear(owner, 'bad'), AGENT_ERROR.ATTEMPT_CORRUPT);
    code(() => journal.mark(owner, 'bad'), AGENT_ERROR.ATTEMPT_CORRUPT);
    expect(journal.read(other)).toEqual(['keep']);
    journal.clear(other, 'keep');
    expect(journal.read(other)).toEqual([]);
    expect(storage.keys()).toEqual([damaged]);
  });

  test('invalid scopes and oversized identities do not write or erase records', () => {
    const storage = new MemoryStorage();
    const journal = new AgentRequestJournal(storage, 'opaque-hash');
    journal.mark(owner, 'keep');
    code(() => new AgentRequestJournal(storage, ''), AGENT_ERROR.INVALID_INPUT);
    code(() => journal.mark({ ...owner, sessionID: '' }, 'new'), AGENT_ERROR.INVALID_INPUT);
    code(() => journal.mark(owner, 'x'.repeat(1025)), AGENT_ERROR.INVALID_INPUT);
    code(() => journal.clear(owner, ''), AGENT_ERROR.INVALID_INPUT);
    expect(journal.read(owner)).toEqual(['keep']);
    storage.corrupt(storage.keys()[0], 'x'.repeat(16385));
    code(() => journal.read(owner), AGENT_ERROR.ATTEMPT_CORRUPT);
  });
  test('recreation retains unresolved requests and clear removes only the selected identity', () => {
    const storage = new MemoryStorage();
    const first = new AgentRequestJournal(storage, 'opaque-hash');
    first.mark(owner, 'r1'); first.mark(owner, 'r2');
    expect(new AgentRequestJournal(storage, 'opaque-hash').read(owner)).toEqual(['r1', 'r2']);
    first.clear(owner, 'r1'); first.clear(owner, 'missing');
    expect(first.read(owner)).toEqual(['r2']);
  });

  test('independent instances preserve distinct writes and owner scopes stay separate', () => {
    const storage = new MemoryStorage();
    const a = new AgentRequestJournal(storage, 'opaque-hash');
    const b = new AgentRequestJournal(storage, 'opaque-hash');
    a.mark(owner, 'r1'); b.mark(owner, 'r2');
    expect(a.read(owner)).toEqual(['r1', 'r2']);
    expect(a.read({ ...owner, sessionID: 'other' })).toEqual([]);
    expect(new AgentRequestJournal(storage, 'other-hash').read(owner)).toEqual([]);
  });

  test('rejects duplicate marks and corrupt, mismatched, or extra fields', () => {
    const storage = new MemoryStorage();
    const journal = new AgentRequestJournal(storage, 'opaque-hash');
    journal.mark(owner, 'r1');
    code(() => journal.mark(owner, 'r1'), AGENT_ERROR.ATTEMPT_EXISTS);
    const key = storage.keys()[0];
    storage.corrupt(key, '{');
    code(() => journal.read(owner), AGENT_ERROR.ATTEMPT_CORRUPT);
    storage.corrupt(key, JSON.stringify({ version: 1, owner, requestID: 'different' }));
    code(() => journal.read(owner), AGENT_ERROR.ATTEMPT_CORRUPT);
    storage.corrupt(key, JSON.stringify({ version: 1, owner, requestID: 'r1', extra: true }));
    code(() => journal.read(owner), AGENT_ERROR.ATTEMPT_CORRUPT);
  });

  test('storage failures refuse reads and preserve records after failed mutations', () => {
    const storage = new MemoryStorage();
    const journal = new AgentRequestJournal(storage, 'opaque-hash');
    journal.mark(owner, 'keep');
    const before = storage.keys();
    storage.fail = 'set'; code(() => journal.mark(owner, 'new'), AGENT_ERROR.ATTEMPT_STORAGE);
    storage.fail = 'remove'; code(() => journal.clear(owner, 'keep'), AGENT_ERROR.ATTEMPT_STORAGE);
    storage.fail = 'key'; code(() => journal.read(owner), AGENT_ERROR.ATTEMPT_STORAGE);
    storage.fail = 'get'; code(() => journal.read(owner), AGENT_ERROR.ATTEMPT_STORAGE);
    storage.fail = undefined;
    expect(storage.keys()).toEqual(before);
    expect(journal.read(owner)).toEqual(['keep']);
  });
});
