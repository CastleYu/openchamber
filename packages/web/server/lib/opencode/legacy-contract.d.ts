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
  SESSION_CREATE: 'session.create';
  SESSION_UPDATE: 'session.update';
  SESSION_SEND: 'session.prompt';
  SESSION_STOP: 'session.stop';
  PERMISSION_REPLY: 'permission.reply';
  QUESTION_REPLY: 'question.reply';
  QUESTION_REJECT: 'question.reject';
}>;

export declare function supportsLegacyOperation(operation: string): boolean;