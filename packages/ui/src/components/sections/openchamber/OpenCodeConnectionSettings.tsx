import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SettingsSection, SettingsFieldRow, SettingsStackedField, SettingsChipGroup, SETTINGS_DESCRIPTION_CLASS } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { CONNECTION, CONNECTION_MODE, CONNECTION_ISSUE, connectionDraft, parseConnectionDraft, readConnections, type ConnectionRecord, type ConnectionDraft } from '@/lib/opencode/connection';
import { updateDesktopSettings } from '@/lib/persistence';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { opencodeClient } from '@/lib/opencode/client';
import { useConfigStore } from '@/stores/useConfigStore';

const MODE_KEYS = {
  [CONNECTION_MODE.EXTERNAL]: 'settings.openchamber.connection.external',
  [CONNECTION_MODE.COMMAND]: 'settings.openchamber.connection.command',
  [CONNECTION_MODE.PATH]: 'settings.openchamber.connection.path',
  [CONNECTION_MODE.CONFIGURED]: 'settings.openchamber.connection.configured',
  [CONNECTION_MODE.BUNDLED]: 'settings.openchamber.connection.bundled',
} as const;
const ISSUE_KEYS = {
  [CONNECTION_ISSUE.INVALID]: 'settings.openchamber.connection.invalid',
  [CONNECTION_ISSUE.UNAVAILABLE]: 'settings.openchamber.connection.unavailable',
  [CONNECTION_ISSUE.CONFLICT]: 'settings.openchamber.connection.conflict',
} as const;
type Choices = Awaited<ReturnType<typeof readConnections>> | { status: 'loading' | 'failed' };
export const OpenCodeConnectionSettings: React.FC = () => {
  const { t } = useI18n();
  const [choices, setChoices] = React.useState<Choices>({ status: 'loading' });
  const [draft, setDraft] = React.useState(connectionDraft);
  const [saved, setSaved] = React.useState<ConnectionRecord | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<'invalid' | 'saveFailed' | 'connectionFailed' | null>(null);
  const [revision, reload] = React.useReducer(value => value + 1, 0);
  const alive = React.useRef(false);
  const flight = React.useRef(false);
  const epoch = React.useRef(0);
  React.useEffect(() => subscribeRuntimeEndpointChanged(() => reload()), []);
  React.useEffect(() => {
    alive.current = true;
    flight.current = false;
    const owner = getRuntimeKey();
    const ticket = ++epoch.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    setChoices({ status: 'loading' }); setDraft(connectionDraft()); setSaved(null); setError(null); setBusy(false);
    void readConnections(controller.signal).then(result => {
      if (controller.signal.aborted || ticket !== epoch.current || owner !== getRuntimeKey()) return;
      setChoices(result);
      if (result.status === 'ready') { setSaved(result.data.saved); setDraft(connectionDraft(result.data.saved)); }
    }).catch(() => {
      if (alive.current && ticket === epoch.current && owner === getRuntimeKey()) setChoices({ status: 'failed' });
    }).finally(() => clearTimeout(timeout));
    return () => { alive.current = false; controller.abort(); clearTimeout(timeout); };
  }, [revision]);
  const connect = async (record: ConnectionRecord, persist: boolean) => {
    if (flight.current) return;
    flight.current = true;
    const owner = getRuntimeKey();
    const ticket = epoch.current;
    const current = () => alive.current && ticket === epoch.current && owner === getRuntimeKey();
    let durable = !persist;
    setBusy(true); setError(null);
    try {
      if (persist) {
        const result = await updateDesktopSettings({ [CONNECTION.SETTING]: record });
        if (!current()) return;
        if (!result.ok) { setError('saveFailed'); return; }
        durable = true; setSaved(record);
        setChoices(value => value.status === 'ready' ? { status: 'ready', data: { ...value.data, saved: record, candidates: [], error: null, recommendation: null } } : value);
      }
      const response = await runtimeFetch(CONNECTION.RELOAD, { method: 'POST' });
      if (!current()) return;
      if (!response.ok) throw new Error('OpenCode startup failed');
      opencodeClient.reconnectToRuntimeBaseUrl();
      const state = useConfigStore.getState();
      if (state.isInitialized) await state.checkConnection();
      else await state.initializeApp();
      if (!current()) return;
      const result = useConfigStore.getState();
      if (!result.isConnected || !result.isInitialized) setError('connectionFailed');
    } catch { if (current()) setError(durable ? 'connectionFailed' : 'saveFailed'); }
    finally { if (current()) { flight.current = false; setBusy(false); } }
  };
  const confirm = () => {
    const result = parseConnectionDraft(draft);
    if (!result.success) { setError('invalid'); return; }
    void connect(result.data, JSON.stringify(result.data) !== JSON.stringify(saved));
  };
  const edit = (changes: Partial<ConnectionDraft>) => { setDraft(value => ({ ...value, ...changes })); setError(null); };
  return <SettingsSection title={t('settings.openchamber.connection.title')} settingsItem={CONNECTION.ITEM}>
    {choices.status === 'loading' && <p role="status" className={SETTINGS_DESCRIPTION_CLASS}>{t('settings.openchamber.connection.loading')}</p>}
    {choices.status === 'unsupported' && <p role="status" className={SETTINGS_DESCRIPTION_CLASS}>{t('settings.openchamber.connection.unsupported')}</p>}
    {choices.status === 'failed' && <>
      <p role="alert" className={SETTINGS_DESCRIPTION_CLASS}>{t('settings.openchamber.connection.loadFailed')}</p>
      <Button variant="outline" onClick={() => reload()}>{t('startup.initRecovery.retry')}</Button>
    </>}
    {choices.status === 'ready' && <>
      <SettingsFieldRow label={t('settings.openchamber.connection.mode')} info={t('settings.openchamber.connection.info')}>
        <SettingsChipGroup value={draft.mode ?? ''} onChange={mode => edit({ mode: mode || null })} aria-label={t('settings.openchamber.connection.mode')}
          options={choices.data.modes.map(item => ({ value: item.mode, label: t(MODE_KEYS[item.mode]), disabled: busy || (!item.available && item.mode !== draft.mode) }))} />
      </SettingsFieldRow>
      {choices.data.error && <p role="status" className={SETTINGS_DESCRIPTION_CLASS}>{t(ISSUE_KEYS[choices.data.error])}</p>}
      {choices.data.recommendation && !saved && <p className={SETTINGS_DESCRIPTION_CLASS}>{t('settings.openchamber.connection.recommendation')}</p>}
      {choices.data.candidates.map(item => <SettingsFieldRow key={item.source + ':' + item.key} label={t(item.source === 'environment' ? 'settings.openchamber.connection.environment' : 'settings.openchamber.connection.settings')} description={item.key}>
        {item.record && <Button variant="outline" disabled={busy} onClick={() => { setDraft(connectionDraft(item.record)); setError(null); }}>{t('settings.openchamber.connection.candidate')}</Button>}
        <span className={SETTINGS_DESCRIPTION_CLASS}>{item.resolved ?? (item.record?.mode === CONNECTION_MODE.EXTERNAL ? item.record.endpoint : item.record?.mode === CONNECTION_MODE.CONFIGURED ? item.record.exe : '')}</span>
        {item.error && <span className={SETTINGS_DESCRIPTION_CLASS}>{t(ISSUE_KEYS[item.error])}</span>}
      </SettingsFieldRow>)}
      {draft.mode === CONNECTION_MODE.EXTERNAL && <SettingsFieldRow label={t('settings.openchamber.connection.endpoint')}>
        <Input className="h-9 max-w-[24rem]" aria-label={t('settings.openchamber.connection.endpoint')} value={draft.endpoint} disabled={busy} onChange={event => edit({ endpoint: event.target.value })} />
      </SettingsFieldRow>}
      {(draft.mode === CONNECTION_MODE.CONFIGURED || draft.mode === CONNECTION_MODE.COMMAND) && <SettingsFieldRow label={t('settings.openchamber.connection.exe')}>
        <Input className="h-9 max-w-[24rem]" aria-label={t('settings.openchamber.connection.exe')} value={draft.exe} disabled={busy} onChange={event => edit({ exe: event.target.value })} />
      </SettingsFieldRow>}
      {draft.mode === CONNECTION_MODE.COMMAND && <>
        <SettingsStackedField label={t('settings.openchamber.connection.args')}>
          <Textarea aria-label={t('settings.openchamber.connection.args')} value={draft.args} disabled={busy} onChange={event => edit({ args: event.target.value })} />
        </SettingsStackedField>
        <SettingsFieldRow label={t('settings.openchamber.connection.cwd')}>
          <Input className="h-9 max-w-[24rem]" aria-label={t('settings.openchamber.connection.cwd')} value={draft.cwd} disabled={busy} onChange={event => edit({ cwd: event.target.value })} />
        </SettingsFieldRow>
        <SettingsStackedField label={t('settings.openchamber.connection.env')}>
          <Textarea aria-label={t('settings.openchamber.connection.env')} value={draft.env} disabled={busy} onChange={event => edit({ env: event.target.value })} />
        </SettingsStackedField>
      </>}
      {error && <p role="alert" className={SETTINGS_DESCRIPTION_CLASS}>{t(error === 'invalid' ? 'settings.openchamber.connection.invalid' : error === 'saveFailed' ? 'settings.openchamber.connection.saveFailed' : 'settings.openchamber.connection.connectionFailed')}</p>}
      <SettingsFieldRow label={t('settings.openchamber.connection.confirm')}>
        <Button disabled={busy || draft.mode === null} onClick={confirm}>{busy ? t('startup.initRecovery.retrying') : t('settings.openchamber.connection.confirm')}</Button>
        {saved && <Button variant="outline" disabled={busy} onClick={() => { void connect(saved, false); }}>{t('startup.initRecovery.retry')}</Button>}
      </SettingsFieldRow>
    </>}
  </SettingsSection>;
};
