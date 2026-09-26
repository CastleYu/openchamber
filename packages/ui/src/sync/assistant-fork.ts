import type { Message } from '@/lib/opencode/model';

/** OC2 forks before a user message, so retain the selected assistant turn. */
export function assistantForkBoundary(messages: readonly Message[], messageID: string): string | undefined {
  const index = messages.findIndex(message => message.id === messageID);
  if (index < 0 || messages[index].role !== 'assistant') throw new Error('Fork source answer is not loaded');
  return messages.slice(index + 1).find(message => message.role === 'user')?.id;
}

/** A running turn is excluded even when one of its assistant steps completed. */
export function findLastCompletedTurnMessageId(messages: readonly Message[], turnRunning: boolean): string | null {
  let end = messages.length;
  if (turnRunning) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') { end = index; break; }
    }
  }
  for (let index = end - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && message.time.completed !== undefined) return message.id;
  }
  return null;
}
