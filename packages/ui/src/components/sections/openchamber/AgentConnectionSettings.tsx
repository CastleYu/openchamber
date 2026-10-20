import * as React from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsSection, SettingsFieldRow, SettingsRadioGroup, SettingsRadioOption } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { applyAgentConnection, loadAgentConnection, CONNECTION_MODE, ACP_TRANSPORT, type AgentConnection, type AcpProjectMapping, type ConnectionSnapshot } from '@/lib/agent-connection';
import { AcpProjectMappings } from './AcpProjectMappings';
import { useAcpAuthentication } from './useAcpAuthentication';
import { AcpInteractionCard } from '@/components/chat/AcpInteractionCard';

const modeKeys = [
  { mode: CONNECTION_MODE.EXTERNAL, key: 'settings.agentConnection.external' },
  { mode: CONNECTION_MODE.COMMAND, key: 'settings.agentConnection.command' },
  { mode: CONNECTION_MODE.PATH, key: 'settings.agentConnection.path' },
  { mode: CONNECTION_MODE.BUNDLED, key: 'settings.agentConnection.bundled' },
  { mode: CONNECTION_MODE.ACP, key: 'settings.agentConnection.acp' },
  { mode: CONNECTION_MODE.ACP_SERVER, key: 'settings.agentConnection.acpServer' },
] as const;

export function AgentConnectionSettings({ initial, onReady }: { initial?: ConnectionSnapshot; onReady?: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = React.useState<AgentConnection['mode'] | null>(initial?.config?.mode || null);
  const [url, setUrl] = React.useState('');
  const [command, setCommand] = React.useState('');
  const [args, setArgs] = React.useState('[]');
  const [cwd, setCwd] = React.useState('');
  const [remoteCwd, setRemoteCwd] = React.useState('');
  const [projectMappings, setProjectMappings] = React.useState<AcpProjectMapping[]>([]);
  const [transport, setTransport] = React.useState<typeof ACP_TRANSPORT[keyof typeof ACP_TRANSPORT] | null>(null);
  const [busy, setBusy] = React.useState(!initial);
  const [error, setError] = React.useState<string | null>(initial?.error || null);
  const auth = useAcpAuthentication(!busy && (mode === CONNECTION_MODE.ACP || mode === CONNECTION_MODE.ACP_SERVER));
  React.useEffect(() => {
    let active = true;
    const adopt = (snapshot: ConnectionSnapshot) => {
      if (!active) return;
      const config = snapshot.config;
      setMode(config?.mode || null);
      setUrl(config?.mode === CONNECTION_MODE.EXTERNAL || config?.mode === CONNECTION_MODE.ACP_SERVER ? config.url : snapshot.prefill.url || '');
      setCommand(config && 'command' in config ? config.command : snapshot.prefill.command || '');
      setArgs(config && 'args' in config ? JSON.stringify(config.args) : '[]');
      setCwd(config?.mode === CONNECTION_MODE.ACP ? config.cwd || snapshot.prefill.cwd || '' : snapshot.prefill.cwd || '');
      setRemoteCwd(config?.mode === CONNECTION_MODE.ACP_SERVER ? config.cwd : '');
      setProjectMappings(config?.mode === CONNECTION_MODE.ACP_SERVER ? config.projectMappings ?? [] : []);
      setTransport(config?.mode === CONNECTION_MODE.ACP_SERVER ? config.transport : null);
      setError(snapshot.error);
      setBusy(false);
    };
    if (initial) adopt(initial);
    else void loadAgentConnection().then(adopt).catch((cause: Error) => { if (active) { setError(cause.message); setBusy(false); } });
    return () => { active = false; };
  }, [initial]);
  const apply = async () => {
    if (!mode || mode === CONNECTION_MODE.ACP_SERVER && !transport) return;
    setBusy(true);
    setError(null);
    try {
      let config: AgentConnection;
      if (mode === CONNECTION_MODE.ACP_SERVER) {
        if (!transport) return;
        config = { mode, transport, url, cwd: remoteCwd, ...(projectMappings.length ? { projectMappings } : {}) };
      } else config = mode === CONNECTION_MODE.EXTERNAL ? { mode, url }
        : mode === CONNECTION_MODE.COMMAND || mode === CONNECTION_MODE.ACP
          ? { mode, command, args: z.array(z.string()).parse(JSON.parse(args)) }
          : { mode };
      if (config.mode === CONNECTION_MODE.ACP && cwd.trim()) config.cwd = cwd.trim();
      await applyAgentConnection(config);
      if (onReady) onReady();
      else window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return (
    <SettingsSection title={t('settings.agentConnection.title')} divider={false}>
      <div className="space-y-4" data-settings-item="sessions.opencode-binary">
        <SettingsRadioGroup aria-label={t('settings.agentConnection.title')}>
          {modeKeys.map((item) => <SettingsRadioOption key={item.mode} selected={mode === item.mode} onSelect={() => setMode(item.mode)} label={t(item.key)} ariaLabel={t(item.key)} disabled={busy} />)}
        </SettingsRadioGroup>
        {mode === CONNECTION_MODE.EXTERNAL && <SettingsFieldRow label={t('settings.agentConnection.url')}><Input aria-label={t('settings.agentConnection.url')} value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} className="h-8 max-w-96 font-mono" /></SettingsFieldRow>}
        {mode === CONNECTION_MODE.ACP_SERVER && <>
          <SettingsFieldRow label={t('settings.agentConnection.transport')} info={t('settings.agentConnection.serverInfo')}>
            <SettingsRadioGroup aria-label={t('settings.agentConnection.transport')}>
              <SettingsRadioOption selected={transport === ACP_TRANSPORT.WEBSOCKET} onSelect={() => setTransport(ACP_TRANSPORT.WEBSOCKET)} label="WebSocket" ariaLabel="WebSocket" disabled={busy} />
              <SettingsRadioOption selected={transport === ACP_TRANSPORT.HTTP} onSelect={() => setTransport(ACP_TRANSPORT.HTTP)} label={t('settings.agentConnection.http')} ariaLabel={t('settings.agentConnection.http')} disabled={busy} />
            </SettingsRadioGroup>
          </SettingsFieldRow>
          <SettingsFieldRow label={t('settings.agentConnection.url')} info={t('settings.agentConnection.serverUrlInfo')}><Input aria-label={t('settings.agentConnection.url')} value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} className="h-8 max-w-96 font-mono" /></SettingsFieldRow>
          <SettingsFieldRow label={t('settings.agentConnection.remoteCwd')} info={t('settings.agentConnection.remoteCwdInfo')}><Input aria-label={t('settings.agentConnection.remoteCwd')} value={remoteCwd} onChange={(event) => setRemoteCwd(event.target.value)} disabled={busy} className="h-8 max-w-96 font-mono" /></SettingsFieldRow>
          <AcpProjectMappings value={projectMappings} onChange={setProjectMappings} disabled={busy} />
        </>}
        {(mode === CONNECTION_MODE.COMMAND || mode === CONNECTION_MODE.ACP) && <>
          <SettingsFieldRow label={t('settings.agentConnection.executable')}><Input aria-label={t('settings.agentConnection.executable')} value={command} onChange={(event) => setCommand(event.target.value)} disabled={busy} className="h-8 max-w-96 font-mono" /></SettingsFieldRow>
          <SettingsFieldRow label={t('settings.agentConnection.args')}><Input aria-label={t('settings.agentConnection.args')} value={args} onChange={(event) => setArgs(event.target.value)} disabled={busy} className="h-8 max-w-96 font-mono" /></SettingsFieldRow>
        </>}
        {mode === CONNECTION_MODE.ACP && <SettingsFieldRow label={t('settings.agentConnection.cwd')}><Input aria-label={t('settings.agentConnection.cwd')} value={cwd} onChange={(event) => setCwd(event.target.value)} disabled={busy} className="h-8 max-w-96 font-mono" /></SettingsFieldRow>}
        {error && <p role="alert" className="typography-meta text-[var(--status-error-text)] break-words">{error}</p>}
        <Button disabled={!mode || busy || mode === CONNECTION_MODE.ACP_SERVER && (!transport || !url.trim() || !remoteCwd.trim())} size="sm" onClick={() => { void apply(); }} data-settings-item="sessions.opencode-restart">{t(busy ? 'settings.agentConnection.connecting' : 'settings.agentConnection.apply')}</Button>
        {auth.info?.authMethods.map((method) => <SettingsFieldRow key={method.id} label={method.name} info={method.description}>
          {!method.type || method.type === 'agent'
            ? <Button size="sm" variant="outline" disabled={auth.status === 'authenticating' || !auth.connected} onClick={() => void auth.authenticate(method.id)}>{t('chat.acp.authenticate')}</Button>
            : <p className="typography-meta text-muted-foreground">{t('chat.acp.cliLogin')}</p>}
        </SettingsFieldRow>)}
        {auth.status === 'authenticating' && <p role="status" className="typography-meta text-muted-foreground">{t('chat.acp.authenticating')}</p>}
        {auth.status === 'authenticated' && <p role="status" className="typography-meta text-muted-foreground">{t('chat.acp.authenticated')}</p>}
        {auth.inputs.map((request) => <AcpInteractionCard key={request.id} request={request} respond={auth.respond} />)}
        {auth.error && <p role="alert" className="typography-meta text-[var(--status-error-text)]">{auth.error}</p>}
        {auth.error && !auth.connected && <Button size="sm" variant="outline" onClick={auth.reconnect}>{t('chat.acp.retry')}</Button>}
      </div>
    </SettingsSection>
  );
}

export function AgentConnectionGate({ children, disabled = false }: { children: React.ReactNode; disabled?: boolean }) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = React.useState<ConnectionSnapshot | null>(null);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const read = React.useCallback(async () => {
    try {
      const value = await loadAgentConnection();
      setSnapshot(value);
      setReady(value.status === 'ready');
      setError(null);
      return value.status;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return 'failed'; }
  }, []);
  React.useEffect(() => {
    if (disabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => { const status = await read(); if (active && status === 'starting') timer = setTimeout(() => { void load(); }, 500); };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [read, disabled]);
  React.useEffect(() => { if (snapshot && !ready || error) document.getElementById('initial-loading')?.remove(); }, [snapshot, ready, error]);
  if (disabled || ready) return children;
  return <main className="h-full overflow-y-auto bg-background text-foreground"><div className="@container mx-auto max-w-3xl p-6">
    {snapshot ? <AgentConnectionSettings initial={snapshot} onReady={() => window.location.reload()} /> : <p role="status">{error || t('settings.agentConnection.connecting')}</p>}
    {error && <Button variant="outline" onClick={() => { void read(); }}>{t('settings.agentConnection.apply')}</Button>}
  </div></main>;
}
