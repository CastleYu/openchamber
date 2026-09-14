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
const failureSchema = z.object({ diagnosticId: z.string().uuid().optional() });
type SampleDiagnostic = { time: string; stage: string; status?: number; diagnosticId?: string };
const diagnostics: SampleDiagnostic[] = [];

export function exportPerformanceDiagnostics(): void {
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, events: diagnostics }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'openchamber-performance.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function recordDiagnostic(entry: Omit<SampleDiagnostic, 'time'>) {
  diagnostics.push({ time: new Date().toISOString(), ...entry });
  if (diagnostics.length > 100) diagnostics.shift();
  console.warn('[performance-client]', JSON.stringify(diagnostics.at(-1)));
}

export async function readPerformance(signal: AbortSignal): Promise<PerformanceSnapshot> {
  let stage = 'transport';
  try {
    const response = await runtimeFetch('/api/system/performance', { signal });
    stage = 'http';
    if (!response.ok) {
      const failure = failureSchema.safeParse(await response.json().catch(() => null));
      recordDiagnostic({ stage, status: response.status, diagnosticId: failure.success ? failure.data.diagnosticId : undefined });
      throw new Error('Performance unavailable');
    }
    stage = 'json';
    const data = await response.json();
    stage = 'schema';
    const sample = snapshotSchema.parse(data);
    if (diagnostics.at(-1)?.stage !== 'recovered' && diagnostics.length) recordDiagnostic({ stage: 'recovered' });
    return sample;
  } catch (error) {
    if (!signal.aborted && stage !== 'http') recordDiagnostic({ stage });
    throw error;
  }
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
