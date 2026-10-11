import { OPENCODE_GENERATION, OPENCODE_PROFILE } from './compatibility.js';

const LEGACY_STREAM_VERSION = '1.2.27';

const LEGACY_HTTP_METHOD = Object.freeze({ GET: 'GET', POST: 'POST' });
const LEGACY_HTTP_ROUTE = Object.freeze({
  GET: Object.freeze([
    '/event', '/global/event', '/path', '/project', '/project/current', '/vcs', '/lsp',
    '/global/config', '/config', '/config/providers', '/provider', '/agent', '/command',
    '/permission', '/question', '/session', '/session/status', '/experimental/session',
  ]),
  POST: Object.freeze([
    /^\/session\/[^/]+\/prompt_async$/,
    /^\/session\/[^/]+\/abort$/,
    /^\/permission\/[^/]+\/reply$/,
    /^\/question\/[^/]+\/reply$/,
    /^\/question\/[^/]+\/reject$/,
  ]),
  GET_PATTERN: Object.freeze([
    /^\/session\/[^/]+$/,
    /^\/session\/[^/]+\/message$/,
    /^\/session\/[^/]+\/message\/[^/]+$/,
    /^\/session\/[^/]+\/children$/,
  ]),
});

const LEGACY_OPERATION = Object.freeze({
  IDENTITY: 'identity',
  SESSION_LIST: 'session.list',
  SESSION_GET: 'session.get',
  SESSION_MESSAGES: 'session.messages',
  SESSION_MESSAGE: 'session.message',
  SESSION_CHILDREN: 'session.children',
  SESSION_STATUS: 'session.status',
  PERMISSION_LIST: 'permission.list',
  QUESTION_LIST: 'question.list',
  COMMAND_LIST: 'command.list',
  CATALOG_READ: 'catalog.read',
  SESSION_CREATE: 'session.create',
  SESSION_UPDATE: 'session.update',
  SESSION_SEND: 'session.prompt',
  SESSION_STOP: 'session.stop',
  PERMISSION_REPLY: 'permission.reply',
  QUESTION_REPLY: 'question.reply',
  QUESTION_REJECT: 'question.reject',
});

const supportedOperations = new Set(Object.values(LEGACY_OPERATION));

function supportsLegacyOperation(operation) {
  return supportedOperations.has(operation);
}

function supportsLegacyStream(runtime) {
  return runtime?.generation === OPENCODE_GENERATION.OC1
    && runtime?.profile === OPENCODE_PROFILE.LEGACY
    && runtime?.version === LEGACY_STREAM_VERSION;
}

function supportsLegacyRequest(runtime, method, route) {
  if (!supportsLegacyStream(runtime)) return false;
  if (method === LEGACY_HTTP_METHOD.GET && LEGACY_HTTP_ROUTE.GET.includes(route)) return true;
  const patterns = method === LEGACY_HTTP_METHOD.GET
    ? LEGACY_HTTP_ROUTE.GET_PATTERN
    : method === LEGACY_HTTP_METHOD.POST ? LEGACY_HTTP_ROUTE.POST : [];
  return patterns.some((pattern) => pattern.test(route));
}

export { LEGACY_OPERATION, supportsLegacyOperation, supportsLegacyStream, supportsLegacyRequest };
