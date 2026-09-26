import type { DomainEvent } from '@/lib/opencode/events';
import type { SyncSource } from './source';

type EventSource = Pick<SyncSource, 'getSession'>;

/** Orders side effects and HTTP refreshes for one bound event source. */
export class DomainEventAuthority {
  private static readonly owners = new WeakMap<EventSource, DomainEventAuthority>();
  private readonly sequences = new Map<string, number>();
  private readonly revisions = new Map<string, number>();

  static for(source: EventSource): DomainEventAuthority {
    let authority = this.owners.get(source);
    if (!authority) {
      authority = new DomainEventAuthority();
      this.owners.set(source, authority);
    }
    return authority;
  }

  accept(event: DomainEvent, sessionID: string | undefined, committedSequence = 0): boolean {
    if (!sessionID) return true;
    if ('sequence' in event && event.sequence !== undefined) {
      const previous = Math.max(this.sequences.get(sessionID) ?? 0, committedSequence);
      if (event.sequence <= previous) return false;
      this.sequences.set(sessionID, event.sequence);
    }
    if (event.type === 'session-upsert' || event.type === 'session-refresh' || event.type === 'session-delete') {
      this.revisions.set(sessionID, this.revision(sessionID) + 1);
    }
    return true;
  }

  revision(sessionID: string): number {
    return this.revisions.get(sessionID) ?? 0;
  }
}
