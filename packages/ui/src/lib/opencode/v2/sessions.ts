import type {
  OpenCodeClient,
  SessionCreateInput,
  SessionListInput,
  SessionPromptInput,
  SessionCommandInput,
  SessionUpdateInput,
  SessionRevertStageInput,
  SessionMessageInfo,
  SessionCompactInput,
} from '@opencode/client';
import type { OperationScope } from '../operations';
import { compact, type Message, type Part, type Session } from '../model';
import { projectMessages, projectSession } from '../projection';
import { OpenCodeRuntimeBinding } from '../runtime';

export type V2SessionPage = {
  sessions: Session[];
  cursor: { previous?: string; next?: string };
};

export type V2MessagePage = {
  items: Array<{ info: Message; parts: Part[] }>;
  cursor: { previous?: string; next?: string };
};

export type V2MessagePageOptions = {
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
};

const DEFAULT_PAGE_LIMIT = 100;

const cursor = (value: { previous?: string | null; next?: string | null }) => compact({
  previous: value.previous ?? undefined,
  next: value.next ?? undefined,
});

/** OC2 wire calls and projection; projected values await the shared-model migration. */
export class V2SessionOperations {
  constructor(
    private readonly clientFor: (directory?: string | null) => OpenCodeClient,
    private readonly binding: OpenCodeRuntimeBinding,
  ) {}

  listPage(input: Omit<SessionListInput, 'directory'> = {}, scope: OperationScope = {}): Promise<V2SessionPage> {
    return this.binding.run('oc2', 'session.list', async () => {
      const result = await this.clientFor(scope.directory).session.list({ ...input, limit: input.limit ?? DEFAULT_PAGE_LIMIT, directory: scope.directory ?? undefined }, { signal: scope.signal });
      return { sessions: result.data.map(projectSession), cursor: cursor(result.cursor) };
    });
  }

  async list(scope: OperationScope = {}): Promise<Session[]> {
    return (await this.listPage({}, scope)).sessions;
  }

  create(input: SessionCreateInput = {}, scope: OperationScope = {}): Promise<Session> {
    return this.binding.run('oc2', 'session.create', async () => {
      const location = scope.directory ? { directory: scope.directory } : input.location;
      const info = await this.clientFor(scope.directory).session.create({ ...input, location }, { signal: scope.signal });
      return projectSession(info);
    });
  }

  get(id: string, scope: OperationScope = {}): Promise<Session> {
    return this.binding.run('oc2', 'session.get', async () => {
      const info = await this.clientFor(scope.directory).session.get({ sessionID: id }, { signal: scope.signal });
      return projectSession(info);
    });
  }

  remove(id: string, scope: OperationScope = {}): Promise<boolean> {
    return this.binding.run('oc2', 'session.remove', async () => {
      await this.clientFor(scope.directory).session.remove({ sessionID: id }, { signal: scope.signal });
      return true;
    });
  }

  update(id: string, patch: Omit<SessionUpdateInput, 'sessionID'>, scope: OperationScope = {}): Promise<Session> {
    return this.binding.run('oc2', 'session.update', async () => {
      const client = this.clientFor(scope.directory);
      await client.session.update({ sessionID: id, ...patch }, { signal: scope.signal });
      return projectSession(await client.session.get({ sessionID: id }, { signal: scope.signal }));
    });
  }

  messages(id: string, options: V2MessagePageOptions = {}, scope: OperationScope = {}): Promise<V2MessagePage> {
    return this.binding.run('oc2', 'message.list', async () => {
      const result = await this.clientFor(scope.directory).message.list({
        sessionID: id,
        limit: options.limit,
        cursor: options.cursor,
        order: options.cursor ? undefined : options.order,
      }, { signal: scope.signal });
      const items = projectMessages(result.data, id).map(({ message, parts }) => ({ info: message, parts }));
      const next = options.limit !== undefined && items.length < options.limit ? undefined : result.cursor.next;
      return { items, cursor: cursor({ ...result.cursor, next }) };
    });
  }

  message(id: string, messageID: string, scope: OperationScope = {}): Promise<{ info: Message; parts: Part[] }> {
    return this.binding.run('oc2', 'session.message.get', async () => {
      const info: SessionMessageInfo = await this.clientFor(scope.directory).session.message.get({ sessionID: id, messageID }, { signal: scope.signal });
      const [{ message, parts }] = projectMessages([info], id);
      return { info: message, parts };
    });
  }

  prompt(input: SessionPromptInput, scope: OperationScope = {}) {
    return this.binding.run('oc2', 'session.prompt', () => this.clientFor(scope.directory).session.prompt(input, { signal: scope.signal }));
  }

  command(input: SessionCommandInput, scope: OperationScope = {}): Promise<void> {
    return this.binding.run('oc2', 'session.command', () => this.clientFor(scope.directory).session.command(input, { signal: scope.signal }));
  }

  interrupt(id: string, scope: OperationScope = {}) {
    return this.binding.run('oc2', 'session.interrupt', () => this.clientFor(scope.directory).session.interrupt({ sessionID: id }, { signal: scope.signal }));
  }

  fork(id: string, before?: string, scope: OperationScope = {}): Promise<Session> {
    return this.binding.run('oc2', 'session.fork', async () => projectSession(
      await this.clientFor(scope.directory).session.fork({ sessionID: id, before }, { signal: scope.signal }),
    ));
  }

  compact(input: SessionCompactInput, scope: OperationScope = {}) {
    return this.binding.run('oc2', 'session.compact', () => this.clientFor(scope.directory).session.compact(input, { signal: scope.signal }));
  }

  stageRevert(input: SessionRevertStageInput, scope: OperationScope = {}) {
    return this.binding.run('oc2', 'session.revert.stage', () => this.clientFor(scope.directory).session.revert.stage(input, { signal: scope.signal }));
  }

  commitRevert(id: string, scope: OperationScope = {}): Promise<void> {
    return this.binding.run('oc2', 'session.revert.commit', () => this.clientFor(scope.directory).session.revert.commit({ sessionID: id }, { signal: scope.signal }));
  }

  clearRevert(id: string, scope: OperationScope = {}): Promise<void> {
    return this.binding.run('oc2', 'session.revert.clear', () => this.clientFor(scope.directory).session.revert.clear({ sessionID: id }, { signal: scope.signal }));
  }
}
