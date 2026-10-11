import type { OpenCodeGenerationDescriptor } from './compatibility.js';

export declare const LEGACY_OPERATION: Readonly<{
  IDENTITY: 'identity';
  SESSION_LIST: 'session.list';
  SESSION_GET: 'session.get';
  SESSION_MESSAGES: 'session.messages';
  SESSION_MESSAGE: 'session.message';
  SESSION_CHILDREN: 'session.children';
  SESSION_STATUS: 'session.status';
  PERMISSION_LIST: 'permission.list';
  QUESTION_LIST: 'question.list';
  COMMAND_LIST: 'command.list';
  CATALOG_READ: 'catalog.read';
  CONFIG_READ: 'config.read';
  SESSION_CREATE: 'session.create';
  SESSION_FORK: 'session.fork';
  SESSION_REMOVE: 'session.delete';
  SESSION_COMMAND: 'session.command';
  SESSION_UPDATE: 'session.update';
  SESSION_SEND: 'session.prompt';
  SESSION_STOP: 'session.stop';
  PERMISSION_REPLY: 'permission.reply';
  QUESTION_REPLY: 'question.reply';
  QUESTION_REJECT: 'question.reject';
}>;

export declare function supportsLegacyOperation(operation: string): boolean;
export declare function supportsLegacyStream(runtime: OpenCodeGenerationDescriptor): boolean;
export declare function supportsLegacyRequest(runtime: OpenCodeGenerationDescriptor, method: string, route: string): boolean;
