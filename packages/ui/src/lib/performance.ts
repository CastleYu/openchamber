import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';

export const PerformanceMetric = { Memory: 'memory', Cpu: 'cpu', Processes: 'processes' } as const;
export type PerformanceMetric = typeof PerformanceMetric[keyof typeof PerformanceMetric];
export const PERFORMANCE_INTERVAL = 5000;
export const PERFORMANCE_HISTORY = 30;
const processSchema = z.object({
  pid: z.number().int(), parent: z.number().int(), name: z.string(),
  memory: z.number().nonnegative(), cpu: z.number().nonnegative().nullable(),
});
const snapshotSchema = z.object({
  timestamp: z.number(), root: z.number().int(), cores: z.number().positive(), interval: z.number().positive(),
  memory: z.number().nonnegative(), cpu: z.number().nonnegative().nullable(), processes: z.array(processSchema),
});
export type PerformanceSnapshot = z.infer<typeof snapshotSchema>;

export async function readPerformance(signal: AbortSignal): Promise<PerformanceSnapshot> {
  const response = await runtimeFetch('/api/system/performance', { signal });
  if (!response.ok) throw new Error('Performance unavailable');
  return snapshotSchema.parse(await response.json());
}

export function metricValue(snapshot: PerformanceSnapshot, metric: PerformanceMetric): number | null {
  if (metric === PerformanceMetric.Processes) return snapshot.processes.length;
  return snapshot[metric];
}

export function formatMetric(value: number | null, metric: PerformanceMetric): string {
  if (value === null) return '—';
  if (metric === PerformanceMetric.Cpu) return `${value.toFixed(1)}%`;
  if (metric === PerformanceMetric.Processes) return String(value);
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : `${(value / 1024 ** 2).toFixed(0)} MiB`;
}
