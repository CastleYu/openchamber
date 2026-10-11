import { describe, expect, it } from 'vitest';
import { LEGACY_OPERATION, supportsLegacyOperation, supportsLegacyRequest, supportsLegacyStream } from './legacy-contract.js';

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

describe('Legacy HTTP admission contract', () => {
  const exact = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27' };
  it.each([
    ['GET', '/event'], ['GET', '/global/event'], ['GET', '/path'], ['GET', '/project'],
    ['GET', '/project/current'], ['GET', '/vcs'], ['GET', '/lsp'], ['GET', '/global/config'],
    ['GET', '/config'], ['GET', '/config/providers'], ['GET', '/provider'], ['GET', '/agent'],
    ['GET', '/command'], ['GET', '/permission'], ['GET', '/question'], ['GET', '/session'], ['GET', '/experimental/session'],
    ['GET', '/session/status'], ['GET', '/session/s1'], ['GET', '/session/s1/message'],
    ['GET', '/session/s1/message/m1'], ['GET', '/session/s1/children'],
    ['POST', '/session/s1/prompt_async'], ['POST', '/session/s1/abort'],
    ['POST', '/permission/p1/reply'], ['POST', '/question/q1/reply'], ['POST', '/question/q1/reject'],
  ])('admits %s %s on the exact Legacy descriptor', (method, route) => {
    expect(supportsLegacyRequest(exact, method, route)).toBe(true);
  });
  it.each([
    ['POST', '/session'], ['PATCH', '/session/s1'], ['DELETE', '/session/s1'],
    ['GET', '/session/s1/message/'], ['GET', '/session/s1/children/more'],
    ['POST', '/session/s1/prompt_async/more'], ['POST', '/question/q1/reply/extra'],
    ['GET', '/event/other'], ['GET', '/unknown'], ['POST', '/config'],
  ])('refuses %s %s', (method, route) => {
    expect(supportsLegacyRequest(exact, method, route)).toBe(false);
  });
  it('requires the exact supported Legacy descriptor', () => {
    expect(supportsLegacyRequest({ ...exact, version: '1.2.28' }, 'GET', '/session')).toBe(false);
    expect(supportsLegacyRequest({ ...exact, generation: 'oc2' }, 'POST', '/session/s1/abort')).toBe(false);
  });
});
