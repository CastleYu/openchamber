import type { Session } from '@/lib/opencode/model';
import { runSessionListNetworkTask } from '@/lib/background-network';
import { retry } from "@/sync/retry";
import { stripSessionListDetails } from "@/sync/sanitize";
import { startSessionLoadPerformanceEvent } from "@/sync/session-load-performance";
import { isChatDirectoryPath } from '@/lib/chatDirectories';

export type GlobalSessionRecord = Session & {
    project?: {
        id: string;
        name?: string;
        worktree?: string;
    } | null;
};

export const filterManagedChatsForRuntime = (sessions: Session[], vscode: boolean): Session[] => (
    vscode
        ? sessions.filter((session) => !isChatDirectoryPath(session.directory))
        : sessions
);

export type SessionPager = {
    listSessionsPage(options?: {
        global?: boolean; directory?: string | null; archived?: boolean; roots?: boolean;
        limit?: number; cursor?: string; signal?: AbortSignal;
    }): Promise<{ sessions: Session[]; cursor: { next?: string } }>;
};

/**
 * OpenCode's `archived` query flag means "also include archived sessions", not
 * "return only archived sessions": the server simply drops its
 * `time_archived IS NULL` condition. Callers that ask for the archived list
 * expect archived-only records, so narrow the response here, at the data
 * boundary, instead of leaving every consumer to re-derive it.
 */
const isArchivedSession = (session: GlobalSessionRecord): boolean => Boolean(session.time?.archived);

/**
 * Split an inclusive (`archived: true`) session page stream into active and
 * archived buckets. Restored sessions carry `time.archived === 0` (see
 * `UNARCHIVED_TIMESTAMP` in `sync/session-actions.ts`); the truthiness check
 * classifies them as active even though the server's own
 * `time_archived IS NULL` filter would still exclude them, which is why the
 * global cache must split client-side instead of issuing an
 * `archived: false` request for its active list.
 */
export const splitGlobalSessionsByArchived = <T extends GlobalSessionRecord>(
    sessions: T[],
): { active: T[]; archived: T[] } => {
    const active: T[] = [];
    const archived: T[] = [];
    for (const session of sessions) {
        if (isArchivedSession(session)) archived.push(session);
        else active.push(session);
    }
    return { active, archived };
};

export async function listGlobalSessionPages(
    apiClient: SessionPager,
    options: {
        directory?: string;
        archived: boolean;
        /**
         * When `archived` is true, narrow results to records carrying a truthy
         * `time.archived` (default true). Pass false to receive the inclusive
         * server response unfiltered, e.g. to split active/archived locally.
         */
        narrowToArchived?: boolean;
        roots?: boolean;
        pageSize: number;
        onPage?: (sessions: GlobalSessionRecord[]) => void;
    },
): Promise<GlobalSessionRecord[]> {
    const all: GlobalSessionRecord[] = [];
    const seenIds = new Set<string>();
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    const narrowToArchived = options.narrowToArchived !== false;
    let operation: string;
    if (!options.directory) {
        operation = `global-sessions.${options.archived ? (narrowToArchived ? "archived" : "all") : "active"}`;
    } else if (options.roots === true) {
        operation = "bootstrap.sessions.roots";
    } else if (options.archived) {
        operation = narrowToArchived ? "bootstrap.sessions.archived" : "bootstrap.sessions.all";
    } else {
        operation = "bootstrap.sessions.all";
    }
    while (true) {
        let attempts = 0;
        const finishPerformanceEvent = startSessionLoadPerformanceEvent({
            operation,
            caller: cursor === undefined ? "initial-page" : "pagination",
        });
        const { nextCursor, payload } = await retry(
            () => runSessionListNetworkTask(async () => {
                attempts += 1;
                const response = await apiClient.listSessionsPage({
                    global: !options.directory,
                    ...(options.directory ? { directory: options.directory } : {}),
                    archived: options.archived,
                    ...(options.roots !== undefined ? { roots: options.roots } : {}),
                    limit: options.pageSize,
                    ...(cursor !== undefined ? { cursor } : {}),
                });
                const payload = response.sessions.map((session) => stripSessionListDetails(session));
                return { nextCursor: response.cursor.next, payload };
            }),
            { attempts: 3, delay: 500, retryIf: () => true },
        ).catch((error) => {
            finishPerformanceEvent("error", { retryCount: Math.max(0, attempts - 1) });
            throw error;
        });

        finishPerformanceEvent("complete", {
            retryCount: Math.max(0, attempts - 1),
            recordCount: payload.length,
        });
        if (payload.length === 0) break;

        // `appended` tracks pagination progress over the raw response, while
        // `accepted` holds the records this call actually returns. Filtering
        // must not feed the pagination guards below, otherwise a page that is
        // full upstream but mostly non-archived would look like a last page.
        let appended = 0;
        const accepted: GlobalSessionRecord[] = [];
        for (const session of payload) {
            if (!session?.id || seenIds.has(session.id)) continue;
            seenIds.add(session.id);
            appended += 1;
            if (options.archived && narrowToArchived && !isArchivedSession(session)) continue;
            all.push(session);
            accepted.push(session);
        }
        if (accepted.length > 0) {
            options.onPage?.(accepted);
        }

        // Protocol adapters own cursor meaning; OC2 cursors are opaque strings.
        if (nextCursor === undefined || seenCursors.has(nextCursor)) break;
        // Every id in this page already seen — stop to avoid spinning.
        if (appended === 0) break;
        seenCursors.add(nextCursor);
        cursor = nextCursor;
    }

    return all;
}
