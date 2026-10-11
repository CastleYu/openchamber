import { describe, expect, it } from 'vitest';
import { LEGACY_OPERATION, supportsLegacyOperation } from './legacy-contract.js';

describe('Legacy read operation contract', () => {
  it('admits the canonical read operations', () => {
    expect(Object.values(LEGACY_OPERATION)).toEqual([
      'identity',
      'session.list',
      'session.get',
      'session.messages',
      'session.message',
      'session.children',
      'session.status',
      'permission.list',
      'question.list',
      'command.list',
      'catalog.read',
    ]);
    for (const operation of Object.values(LEGACY_OPERATION)) {
      expect(supportsLegacyOperation(operation)).toBe(true);
    }
  });

  it.each([
    'session.send',
    'session.create',
    'session.update',
    'config.update',
    'auth.login',
    'permission.reply',
    'question.reply',
    'experimental.session.import',
    'session.fork',
    'session.list ',
    '',
  ])('refuses unsupported operation %j', (operation) => {
    expect(supportsLegacyOperation(operation)).toBe(false);
  });

  it('exposes frozen operation constants', () => {
    expect(Object.isFrozen(LEGACY_OPERATION)).toBe(true);
  });
});