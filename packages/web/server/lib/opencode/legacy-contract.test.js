import { describe, expect, it } from 'vitest';
import { LEGACY_OPERATION, supportsLegacyOperation, supportsLegacyStream } from './legacy-contract.js';

describe('Legacy operation contract', () => {
  it('admits the accepted read and minimum conversation operations', () => {
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
      'session.create',
      'session.update',
      'session.prompt',
      'session.stop',
      'permission.reply',
      'question.reply',
      'question.reject',
    ]);
    for (const operation of Object.values(LEGACY_OPERATION)) {
      expect(supportsLegacyOperation(operation)).toBe(true);
    }
  });

  it.each([
    'session.send',
    'config.update',
    'auth.login',
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
describe('Legacy stream descriptor', () => {
  const exact = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27' };
  it('admits only the exact Legacy OC1 descriptor', () => {
    expect(supportsLegacyStream(exact)).toBe(true);
    for (const change of [{ generation: 'oc2' }, { profile: 'oc1' }, { version: '1.2.28' }, { version: undefined }]) {
      expect(supportsLegacyStream({ ...exact, ...change })).toBe(false);
    }
  });
});
