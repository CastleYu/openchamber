import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { exportPerformanceDiagnostics } from '@/lib/performance';
import { PERFORMANCE_HISTORY, PERFORMANCE_INTERVAL, PerformanceMetric, formatMetric, metricValue, readPerformance, type PerformanceSnapshot } from '@/lib/performance';

const choices = [
  { value: PerformanceMetric.Memory, label: 'performance.memory' },
  { value: PerformanceMetric.Cpu, label: 'performance.cpu' },
  { value: PerformanceMetric.Processes, label: 'performance.processes' },
] as const;

export function PerformancePanel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [metric, setMetric] = useState<PerformanceMetric>(PerformanceMetric.Memory);
  const [history, setHistory] = useState<PerformanceSnapshot[]>([]);
  const [failed, setFailed] = useState(false);
  const [endpoint, setEndpoint] = useState(0);
  useEffect(() => subscribeRuntimeEndpointChanged(() => {
    setHistory([]);
    setFailed(false);
    setEndpoint((value) => value + 1);
  }), []);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    let disposed = false;
    const poll = async () => {
      if (disposed || document.hidden) return;
      controller = new AbortController();
      const current = controller;
      try {
        const sample = await readPerformance(current.signal);
        if (disposed || current.signal.aborted) return;
        setFailed(false);
        setHistory((values) => values.at(-1)?.timestamp === sample.timestamp ? values : [...values.slice(-(PERFORMANCE_HISTORY - 1)), sample]);
      } catch {
        if (!disposed && !current.signal.aborted) setFailed(true);
      } finally {
        if (!disposed && !current.signal.aborted) timer = setTimeout(() => void poll(), PERFORMANCE_INTERVAL);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [enabled, endpoint]);
  const sample = history.at(-1);
  const label = choices.find((choice) => choice.value === metric)!.label;
  const value = sample ? formatMetric(metricValue(sample, metric), metric) : '—';
  const values = history.map((entry) => metricValue(entry, metric));
  const max = Math.max(1, ...values.filter((entry) => entry !== null));
  const status = !enabled ? t('performance.paused') : failed ? t('performance.failed') : !sample ? t('performance.loading') : null;
  return <>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" className="app-region-no-drag gap-1.5 tabular-nums normal-case" onClick={() => setOpen(true)} aria-label={`${t('performance.title')}: ${t(label)} ${value}`}>
          <span className="flex h-4 w-5 items-end gap-0.5" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => <span key={index} className="h-full w-1 origin-bottom rounded-sm bg-current motion-safe:transition-transform" style={{ transform: `scaleY(${enabled && !failed ? Math.max(0.15, (values.at(index - 4) ?? 0) / max) : 0.15})` }} />)}
          </span>
          <span>{status ? '—' : value}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{t('performance.title')}</p>
        {status ? <p>{status}</p> : sample && choices.map((choice) => <p key={choice.value}>{t(choice.label)}: {formatMetric(metricValue(sample, choice.value), choice.value)}</p>)}
      </TooltipContent>
    </Tooltip>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t('performance.title')}</DialogTitle><DialogDescription>{t('performance.scope')}</DialogDescription></DialogHeader>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('performance.metric')}>
          {choices.map((choice) => <Button key={choice.value} variant="chip" size="sm" className="normal-case" aria-pressed={metric === choice.value} onClick={() => setMetric(choice.value)}>{t(choice.label)}</Button>)}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEnabled(!enabled)}>{t(enabled ? 'performance.pause' : 'performance.resume')}</Button>
        </div>
        {status && <p role="status" className="text-muted-foreground text-sm">{status}</p>}
        <Button variant="ghost" size="sm" onClick={exportPerformanceDiagnostics}>{t('performance.export')}</Button>
        {sample && <>
          <div className="grid grid-cols-3 gap-3">
            {choices.map((choice) => <div key={choice.value}><p className="text-xs text-muted-foreground">{t(choice.label)}</p><p className="text-lg tabular-nums">{formatMetric(metricValue(sample, choice.value), choice.value)}</p></div>)}
          </div>
          <figure className="space-y-2">
            <figcaption className="text-xs text-muted-foreground">{t(label)} · {t('performance.history')}</figcaption>
            <svg viewBox="0 0 580 80" className="h-20 w-full text-foreground" role="img" aria-label={t('performance.history')}>
              {values.map((entry, index) => entry !== null && <line key={history[index].timestamp} x1={index * 20} x2={index * 20} y1="78" y2={78 - entry / max * 74} stroke="currentColor" strokeWidth="3" />)}
            </svg>
          </figure>
          <p className="text-xs text-muted-foreground">{t('performance.accounting')}</p>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 bg-background text-muted-foreground"><tr><th className="text-left font-normal">{t('performance.processes')}</th><th className="text-right font-normal">PID</th><th className="text-right font-normal">{t('performance.cpu')}</th><th className="text-right font-normal">{t('performance.memory')}</th></tr></thead>
              <tbody>{sample.processes.map((row) => <tr key={row.pid} className="border-b border-border/50"><td className="max-w-56 truncate py-1.5" title={row.name}>{row.name}</td><td className="text-right">{row.pid}</td><td className="text-right">{formatMetric(row.cpu, PerformanceMetric.Cpu)}</td><td className="text-right">{formatMetric(row.memory, PerformanceMetric.Memory)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t('performance.updated', { time: new Date(sample.timestamp).toLocaleTimeString() })}</p>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
