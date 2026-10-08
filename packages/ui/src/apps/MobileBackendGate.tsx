import React from 'react';
import { useI18n } from '@/lib/i18n';
import { getRuntimeApiBaseUrl, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { BackendGate } from './BackendGate';
import { MobileConnectionWelcome, type MobileConnectionNotice } from './MobileConnectionWelcome';
import { autoConnectLastInstance, type AutoConnectOutcome } from './mobileConnections';

let connection: Promise<AutoConnectOutcome> | null = null;
const reconnect = (): Promise<AutoConnectOutcome> => {
  if (!connection) {
    connection = autoConnectLastInstance({ skipIfConnected: true })
      .catch((): AutoConnectOutcome => ({ status: 'no-candidate' }))
      .finally(() => { connection = null; });
  }
  return connection;
};

/** Native connection setup owns no backend discovery or OpenCode initialization. */
export function MobileBackendGate({ native, children }: { native: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  const endpoint = React.useSyncExternalStore(subscribeRuntimeEndpointChanged, getRuntimeApiBaseUrl, getRuntimeApiBaseUrl);
  const [ready, setReady] = React.useState(!native || Boolean(endpoint));
  const [notice, setNotice] = React.useState<MobileConnectionNotice | null>(null);
  React.useEffect(() => {
    if (!native || endpoint) return;
    let active = true;
    void reconnect().then((outcome) => {
      if (!active) return;
      if (outcome.status === 'unreachable') setNotice({ kind: 'unreachable', label: outcome.label });
      if (outcome.status === 'needs-login') setNotice({ kind: 'auth-expired', label: outcome.label });
      setReady(true);
    });
    return () => { active = false; };
  }, [native, endpoint]);
  if (native && !endpoint) {
    if (!ready) return <main className="flex min-h-dvh items-center justify-center bg-background text-foreground" role="status">{t('common.loading')}</main>;
    return <MobileConnectionWelcome notice={notice} onConnected={() => { setReady(true); }} />;
  }
  return <BackendGate>{children}</BackendGate>;
}
