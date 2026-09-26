import { describe, expect, test } from 'bun:test';
import { ensureChatsRootDirectory } from '@/lib/chatDirectories';
import { opencodeClient } from '@/lib/opencode/client';
import type { Session } from '@/lib/opencode/model';
import { filterManagedChatsForRuntime, listGlobalSessionPages, splitGlobalSessionsByArchived, type SessionPager } from './globalSessions';

type Page = Awaited<ReturnType<SessionPager['listSessionsPage']>>;
type Options = Parameters<SessionPager['listSessionsPage']>[0];
const session = (id: string, updated = 1, archived?: number): Session => {
  const value: Session = { id, projectID: 'project', directory: '/repo', title: id, time: { created: 1, updated } };
  if (archived !== undefined) value.time.archived = archived;
  return value;
};
const pager = (...pages: Page[]): SessionPager => {
  let index = 0;
  return { listSessionsPage: async () => {
    const page = pages[index++];
    if (!page) throw new Error('Unexpected extra page request');
    return page;
  } };
};
const ids = (items: Session[]) => items.map((item) => item.id);
const load = (client: SessionPager, archived = false, pageSize = 500) => listGlobalSessionPages(client, { archived, pageSize });

describe('managed Chats runtime visibility', () => {
  const chat = { ...session('chat'), directory: '/home/user/.config/openchamber/chats/2026-08-21/session-a' };
  const project = session('project');
  test('VS Code rejects managed Chats before they enter global state', () => {
    expect(filterManagedChatsForRuntime([chat, project], true)).toEqual([project]);
  });
  test('other runtimes retain managed Chats', () => {
    expect(filterManagedChatsForRuntime([chat, project], false)).toEqual([chat, project]);
  });
});

describe('listGlobalSessionPages', () => {
  test('passes opaque cursors without deriving them from timestamps', async () => {
    const calls: Options[] = [];
    const client: SessionPager = { listSessionsPage: async (options) => {
      calls.push(options);
      return options?.cursor === undefined
        ? { sessions: [session('first', 20), session('second', 10)], cursor: { next: 'opaque:8/next' } }
        : { sessions: [session('last', 5)], cursor: {} };
    } };
    expect(ids(await load(client, false, 2))).toEqual(['first', 'second', 'last']);
    expect(calls.map((call) => call?.cursor)).toEqual([undefined, 'opaque:8/next']);
    expect(calls[0]?.global).toBe(true);
  });
  test('sanitizes list details while retaining metadata', async () => {
    const record: Session = {
      ...session('ses_1'), metadata: { openchamber: { kind: 'review', originalSessionID: 'ses_original' } },
      permission: [{ permission: 'todowrite', pattern: '*', action: 'allow' }],
      revert: { messageID: 'msg_1', snapshot: 'abc123', diff: 'diff --git a/x b/x' },
      summary: { additions: 5, deletions: 3, files: 2, diffs: [{ file: 'x', patch: '@@ -1 +1 @@', additions: 5, deletions: 3 }] },
    };
    const [result] = await load(pager({ sessions: [record], cursor: {} }));
    expect(result.metadata).toEqual(record.metadata);
    expect(result.permission).toBe(undefined);
    expect(result.revert).toEqual({ messageID: 'msg_1' });
    expect(result.summary).toEqual({ additions: 5, deletions: 3, files: 2 });
  });
  test('preserves directory and root scope across pages', async () => {
    const calls: Options[] = [];
    const client: SessionPager = { listSessionsPage: async (options) => {
      calls.push(options);
      return options?.cursor === undefined
        ? { sessions: [session('root'), session('child1')], cursor: { next: '10' } }
        : { sessions: [session('child2')], cursor: {} };
    } };
    const result = await listGlobalSessionPages(client, { directory: '/repo', archived: false, roots: false, pageSize: 2 });
    expect(calls).toEqual([
      { global: false, directory: '/repo', archived: false, roots: false, limit: 2 },
      { global: false, directory: '/repo', archived: false, roots: false, limit: 2, cursor: '10' },
    ]);
    expect(ids(result)).toEqual(['root', 'child1', 'child2']);
  });
  test('narrows inclusive archived pages', async () => {
    expect(ids(await load(pager({ sessions: [session('active'), session('archived', 10, 15)], cursor: {} }), true))).toEqual(['archived']);
  });
  test('keeps every active-page record', async () => {
    expect(ids(await load(pager({ sessions: [session('a'), session('b')], cursor: {} })))).toEqual(['a', 'b']);
  });
  test('keeps inclusive records when narrowing is disabled', async () => {
    const result = await listGlobalSessionPages(pager({ sessions: [session('active'), session('archived', 10, 15), session('restored', 5, 0)], cursor: {} }), { archived: true, narrowToArchived: false, pageSize: 500 });
    expect(ids(result)).toEqual(['active', 'archived', 'restored']);
  });
  test('continues after a full page with no archived records', async () => {
    const result = await load(pager(
      { sessions: [session('a'), session('b')], cursor: { next: 'next' } },
      { sessions: [session('archived', 10, 12)], cursor: {} },
    ), true, 2);
    expect(ids(result)).toEqual(['archived']);
  });
  test('reports only accepted records to onPage', async () => {
    const pages: string[][] = [];
    await listGlobalSessionPages(pager({ sessions: [session('active'), session('archived', 10, 12)], cursor: {} }), {
      archived: true, pageSize: 500, onPage: (items) => pages.push(ids(items)),
    });
    expect(pages).toEqual([['archived']]);
  });
  test('does not notify onPage when every record was filtered', async () => {
    const pages: Session[][] = [];
    const result = await listGlobalSessionPages(pager({ sessions: [session('active')], cursor: {} }), {
      archived: true, pageSize: 500, onPage: (items) => pages.push(items),
    });
    expect(result).toEqual([]);
    expect(pages).toEqual([]);
  });
  test('dedupes records and stops pages containing only known IDs', async () => {
    const records = [session('a', 30, 31), session('b', 20, 21)];
    expect(ids(await load(pager(
      { sessions: records, cursor: { next: 'first' } },
      { sessions: records, cursor: { next: 'second' } },
    ), true, 2))).toEqual(['a', 'b']);
  });
  test('stops repeated cursors even when a page has new records', async () => {
    expect(ids(await load(pager(
      { sessions: [session('a')], cursor: { next: 'loop' } },
      { sessions: [session('b')], cursor: { next: 'loop' } },
    ), false, 1))).toEqual(['a', 'b']);
  });
  test('follows an authoritative cursor even after a short page', async () => {
    expect(ids(await load(pager(
      { sessions: [session('a')], cursor: { next: 'next' } },
      { sessions: [session('b')], cursor: {} },
    ), false, 100))).toEqual(['a', 'b']);
  });
  test('retries rejected adapter requests', async () => {
    let calls = 0;
    const client: SessionPager = { listSessionsPage: async () => {
      if (++calls === 1) throw new Error('warming up');
      return { sessions: [session('ready')], cursor: {} };
    } };
    expect(ids(await load(client))).toEqual(['ready']);
    expect(calls).toBe(2);
  });
});

describe('splitGlobalSessionsByArchived', () => {
  test('classifies restored records as active', () => {
    const result = splitGlobalSessionsByArchived([session('active'), session('archived', 10, 15), session('restored', 5, 0)]);
    expect(ids(result.active)).toEqual(['active', 'restored']);
    expect(ids(result.archived)).toEqual(['archived']);
  });
});

const originalHomeInfo = opencodeClient.getFilesystemHomeInfo;
opencodeClient.getFilesystemHomeInfo = async () => ({ home: '/home/user' });
await ensureChatsRootDirectory();
opencodeClient.getFilesystemHomeInfo = originalHomeInfo;
