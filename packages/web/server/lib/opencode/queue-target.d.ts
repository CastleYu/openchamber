import type { ConnectionRecord } from './connection.js';
import type { OpenCodeGenerationDescriptor } from './compatibility.js';
export const QUEUE_TARGET: Readonly<{ ROUTE: '/api/config/opencode-connection/queue-target'; HEADER: 'x-openchamber-queue-target'; CHANGED: 'queue_target_changed' }>;
export function describeQueueTarget(input: { connection: ConnectionRecord; identity: Pick<OpenCodeGenerationDescriptor, 'generation' | 'profile'>; binary?: string; directory?: string }): string;
