import type { Session } from '@/lib/opencode/model';
import type { ChatDraftIdentity } from '@/lib/chatDraftPersistence';

export interface ForkSendSelection {
  providerID: string;
  modelID: string;
  agent?: string;
  variant?: string;
}

export interface ForkCommandDeps {
  fork: (sessionId: string) => Promise<Session | null>;
  directoryFor: (session: Session) => string | null;
  send: (text: string, selection: ForkSendSelection, target: { sessionId: string; directory?: string }) => Promise<void>;
  draftIdentity: (directory: string | null, sessionId: string) => ChatDraftIdentity | null;
  restoreText: (target: ChatDraftIdentity, text: string) => void;
  isCurrent: () => boolean;
}

export type ForkCommandOutcome = 'forked' | 'sent' | 'send-failed' | 'stale';

/** Fork a finished turn; on send failure, return the text to the new composer. */
export async function runForkCommand(
  sourceSessionId: string, prompt: string, selection: ForkSendSelection, deps: ForkCommandDeps,
): Promise<ForkCommandOutcome> {
  const fork = await deps.fork(sourceSessionId);
  if (!fork || !deps.isCurrent()) return 'stale';
  const text = prompt.trim();
  if (!text) return 'forked';
  const directory = deps.directoryFor(fork);
  try {
    await deps.send(text, selection, { sessionId: fork.id, directory: directory ?? undefined });
    return deps.isCurrent() ? 'sent' : 'stale';
  } catch {
    if (!deps.isCurrent()) return 'stale';
    const target = deps.draftIdentity(directory, fork.id);
    if (target) deps.restoreText(target, text);
    return 'send-failed';
  }
}
