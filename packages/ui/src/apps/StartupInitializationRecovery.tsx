import { OpenCodeConnectionSettings } from '@/components/sections/openchamber/OpenCodeConnectionSettings';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { OpenCodeModeSettings } from '@/components/sections/openchamber/OpenCodeModeSettings';
import { useI18n } from '@/lib/i18n';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { fetchStartupDiagnostics, type StartupDiagnostics } from '@/lib/startupDiagnostics';

export const StartupInitializationRecovery: React.FC<{
  onRetry: () => void;
  isRetrying: boolean;
}> = ({ onRetry, isRetrying }) => {
  const { t } = useI18n();
  const [diagnostics, setDiagnostics] = React.useState<StartupDiagnostics | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    const runtimeKey = getRuntimeKey();
    const timeout = setTimeout(() => controller.abort(), 5000);
    void fetchStartupDiagnostics(controller.signal).then((result) => {
      if (!controller.signal.aborted && getRuntimeKey() === runtimeKey) {
        setDiagnostics(result);
      }
    }).catch(() => {
      // Keep generic recovery when the server cannot supply current diagnostics.
    }).finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-background px-6 py-6 text-foreground">
      <div className="my-auto flex w-full max-w-xl shrink-0 flex-col items-center gap-4 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="typography-title text-foreground">{t('startup.initRecovery.title')}</h1>
          <p className="typography-body text-muted-foreground">{t(diagnostics ? 'startup.initRecovery.openCodeUnavailable' : 'startup.initRecovery.description')}</p>
        </div>
        {diagnostics && (
          <dl className="w-full min-w-0 space-y-3 text-left" aria-live="polite">
            {diagnostics.binary && (
              <div>
                <dt className="typography-meta text-muted-foreground">{t('startup.initRecovery.binary')}</dt>
                <dd className="break-all font-mono typography-meta">{diagnostics.binary}</dd>
              </div>
            )}
            {diagnostics.error && (
              <div>
                <dt className="typography-meta text-muted-foreground">{t('startup.initRecovery.error')}</dt>
                <dd className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words font-mono typography-meta text-[var(--status-error)]">{diagnostics.error}</dd>
              </div>
            )}
          </dl>
        )}
        <div className="w-full text-left"><OpenCodeModeSettings /><OpenCodeConnectionSettings /></div>
        <Button type="button" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? t('startup.initRecovery.retrying') : t('startup.initRecovery.retry')}
        </Button>
      </div>
    </div>
  );
};

