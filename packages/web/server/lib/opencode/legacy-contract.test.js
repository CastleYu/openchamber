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
      'session.fork',
      'session.delete',
      'session.command',
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
    'session.share',
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
    ['GET', '/session/s1/todo'], ['GET', '/session/s1/diff'],
    ['GET', '/file'], ['GET', '/file/content'], ['GET', '/file/status'], ['GET', '/mcp'],
    ['POST', '/mcp/server/connect'], ['POST', '/mcp/server/disconnect'],
    ['GET', '/find/file'], ['GET', '/find'], ['GET', '/find/symbol'],
    ['POST', '/session/s1/fork'], ['POST', '/session/s1/command'],
    ['POST', '/session/s1/shell'], ['POST', '/session/s1/summarize'],
    ['POST', '/session/s1/revert'], ['POST', '/session/s1/unrevert'],
    ['POST', '/session/s1/prompt_async'], ['POST', '/session/s1/abort'],
    ['POST', '/permission/p1/reply'], ['POST', '/question/q1/reply'], ['POST', '/question/q1/reject'],
  ])('admits %s %s on the exact Legacy descriptor', (method, route) => {
    expect(supportsLegacyRequest(exact, method, route)).toBe(true);
  });
  it.each([
    ['POST', '/session'], ['PATCH', '/session/s1'], ['DELETE', '/session/s1'],
    ['GET', '/session/s1/fork'], ['GET', '/session/s1/command'],
    ['GET', '/session/s1/shell'], ['GET', '/session/s1/summarize'],
    ['GET', '/session/s1/revert'], ['GET', '/session/s1/unrevert'],
    ['POST', '/session/s1/todo'], ['POST', '/session/s1/diff'],
    ['POST', '/file'], ['POST', '/find'],
    ['GET', '/mcp/status'], ['GET', '/mcp/server/connect'], ['POST', '/mcp'],
    ['POST', '/mcp/server'], ['POST', '/mcp/server/auth'],
    ['POST', '/mcp//connect'], ['POST', '/mcp/server/extra/connect'],
    ['POST', '/mcp/server/connect/'], ['POST', '/mcp/server/disconnect/extra'],
    ['POST', '/session/s1/fork/extra'], ['POST', '/session/s1/command/extra'],
    ['POST', '/session/s1/shell/extra'], ['POST', '/session/s1/summarize/extra'],
    ['POST', '/session/s1/revert/extra'], ['POST', '/session/s1/unrevert/extra'],
    ['GET', '/session/s1/todo/extra'], ['GET', '/session/s1/diff/extra'],
    ['GET', '/file/extra'], ['GET', '/find/extra'],
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
