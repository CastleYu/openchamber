import React from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { AGENT_FAMILY } from '../../../web/server/lib/agent/constants.js';
import { AGENT_BOOT_PENDING, AgentBootstrap } from './agentBootstrap';
import { CAgentApp } from './lazyBackendApps';

const noSubscribe = () => () => {};
const pending = () => AGENT_BOOT_PENDING;
const createBootstrap = () => new AgentBootstrap();

/** Authentication precedes this gate; OpenCode effects mount only after selection. */
export function BackendGate({ children, create = createBootstrap }: { children: React.ReactNode; create?: () => AgentBootstrap }) {
  const { t } = useI18n();
  const [owner, setOwner] = React.useState<AgentBootstrap | null>(null);
  React.useEffect(() => {
    const next = create();
    setOwner(next);
    void next.refresh();
    return () => { next.dispose(); };
  }, [create]);
  const state = React.useSyncExternalStore(owner?.subscribe ?? noSubscribe, owner?.getSnapshot ?? pending, pending);
  if (state.state === 'selected' && state.value.selection.family === AGENT_FAMILY.OPENCODE) {
    return <React.Suspense fallback={<p role="status">{t('common.loading')}</p>}>{children}</React.Suspense>;
  }
  if (state.state === 'selected' && state.value.selection.family === AGENT_FAMILY.CAGENT) {
    return <React.Suspense fallback={<p role="status">{t('common.loading')}</p>}><CAgentApp /></React.Suspense>;
  }
  const selected = state.state === 'selected';
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6">
        {state.state === 'loading' ? <p role="status">{t('common.loading')}</p> : (
          <>
            <h1 className="typography-ui-header" role={selected ? undefined : 'alert'}>
              {t(selected ? 'agent.bootstrap.cagent' : 'agent.bootstrap.failed')}
            </h1>
            {selected ? <p className="text-muted-foreground">{t('agent.bootstrap.closed')}</p> : null}
            <Button variant="outline" onClick={() => { void owner?.refresh(); }}>
              {t('agent.bootstrap.retry')}
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
