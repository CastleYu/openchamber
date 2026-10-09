import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SettingsSection, SettingsControlGroup, SettingsCheckboxRow, SettingsFieldRow, SettingsStackedField, SettingsChipGroup, SETTINGS_DESCRIPTION_CLASS } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { CONNECTION, CONNECTION_MODE, CONNECTION_ISSUE, CONNECTION_SOURCE, CONNECTION_DECISION, ACTIVITY_STATE, ACTIVITY_SCOPE, prepareConnection, applyConnection, type ConnectionReview, type ConnectionRequest, connectionDraft, parseConnectionDraft, readConnections, type ConnectionRecord, type ConnectionDraft } from '@/lib/opencode/connection';
import { reportSettingsSaveState } from '@/lib/persistence';
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
const ERROR_KEYS = {
  invalid: 'settings.openchamber.connection.invalid', reviewFailed: 'settings.openchamber.connection.reviewFailed',
  switchFailed: 'settings.openchamber.connection.switchFailed', activityChanged: 'settings.openchamber.connection.activityChanged',
  connectionFailed: 'settings.openchamber.connection.connectionFailed',
} as const;
type Choices = Awaited<ReturnType<typeof readConnections>> | { status: 'loading' | 'failed' };
export const OpenCodeConnectionSettings: React.FC = () => {
  const { t } = useI18n();
  const [choices, setChoices] = React.useState<Choices>({ status: 'loading' });
  const [draft, setDraft] = React.useState(connectionDraft);
  const [saved, setSaved] = React.useState<ConnectionRecord | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<'invalid' | 'reviewFailed' | 'switchFailed' | 'activityChanged' | 'connectionFailed' | null>(null);
  const [review, setReview] = React.useState<ConnectionReview | null>(null);
  const [request, setRequest] = React.useState<ConnectionRequest | null>(null);
  const [acknowledged, acknowledge] = React.useState(false);
  const blocked = busy || review !== null;
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
    setChoices({ status: 'loading' }); setDraft(connectionDraft()); setSaved(null); setError(null); setBusy(false); setReview(null); setRequest(null); acknowledge(false);
    void readConnections(controller.signal).then(result => {
      if (controller.signal.aborted || ticket !== epoch.current || owner !== getRuntimeKey()) return;
      setChoices(result);
      if (result.status === 'ready') { setSaved(result.data.saved); setDraft(connectionDraft(result.data.saved)); }
    }).catch(() => {
      if (alive.current && ticket === epoch.current && owner === getRuntimeKey()) setChoices({ status: 'failed' });
    }).finally(() => clearTimeout(timeout));
    return () => { alive.current = false; controller.abort(); clearTimeout(timeout); };
  }, [revision]);
  const inspect = async (candidate: ConnectionRequest) => {
    if (flight.current) return;
    flight.current = true;
    const owner = getRuntimeKey();
    const ticket = epoch.current;
    const current = () => alive.current && ticket === epoch.current && owner === getRuntimeKey();
    setBusy(true); setError(null); acknowledge(false); setReview(null);
    try {
      const result = await prepareConnection(candidate, AbortSignal.timeout(60000));
      if (!current()) return;
      if (result.status === 'unsupported') { setChoices({ status: 'unsupported' }); return; }
      if (result.status !== 'ready') { setError(result.status === 'changed' ? 'activityChanged' : 'reviewFailed'); return; }
      setRequest(candidate); setReview(result.review);
    } catch { if (current()) setError('reviewFailed'); }
    finally { if (current()) { flight.current = false; setBusy(false); } }
  };
  const connect = async (decision: typeof CONNECTION_DECISION[keyof typeof CONNECTION_DECISION]) => {
    if (flight.current || !review || !acknowledged) return;
    flight.current = true;
    const owner = getRuntimeKey();
    const ticket = epoch.current;
    const current = () => alive.current && ticket === epoch.current && owner === getRuntimeKey();
    setBusy(true); setError(null); reportSettingsSaveState('saving');
    try {
      const result = await applyConnection(review, decision, AbortSignal.timeout(90000));
      if (!current()) return;
      setReview(null); acknowledge(false);
      if (result.status !== 'ready') {
        reportSettingsSaveState('error');
        if (result.status === 'unsupported') { setChoices({ status: 'unsupported' }); return; }
        setError(result.status === 'changed' ? 'activityChanged' : 'switchFailed');
        // Failure may follow a durable write. Re-read without overwriting the draft.
        const discovered = await readConnections(AbortSignal.timeout(10000));
        if (!current()) return;
        setChoices(discovered);
        if (discovered.status === 'ready') setSaved(discovered.data.saved);
        if (result.status === 'failed') {
          opencodeClient.reconnectToRuntimeBaseUrl();
          await useConfigStore.getState().checkConnection();
        }
        return;
      }
      reportSettingsSaveState('saved'); setSaved(result.connection); setDraft(connectionDraft(result.connection));
      setChoices(value => value.status === 'ready' ? { status: 'ready', data: { ...value.data, saved: result.connection, candidates: [], error: null, recommendation: null } } : value);
      opencodeClient.reconnectToRuntimeBaseUrl();
      const state = useConfigStore.getState();
      if (state.isInitialized) await state.checkConnection(); else await state.initializeApp();
      if (!current()) return;
      const connected = useConfigStore.getState();
      if (!connected.isConnected || !connected.isInitialized) setError('connectionFailed');
    } catch { if (current()) { reportSettingsSaveState('error'); setReview(null); acknowledge(false); setError('switchFailed'); } }
    finally { if (current()) { flight.current = false; setBusy(false); } }
  };
  const confirm = () => {
    const result = parseConnectionDraft(draft);
    if (!result.success) { setError('invalid'); return; }
    void inspect({ source: CONNECTION_SOURCE.CANDIDATE, connection: result.data });
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
          options={choices.data.modes.map(item => ({ value: item.mode, label: t(MODE_KEYS[item.mode]), disabled: blocked || (!item.available && item.mode !== draft.mode) }))} />
      </SettingsFieldRow>
      {choices.data.error && <p role="status" className={SETTINGS_DESCRIPTION_CLASS}>{t(ISSUE_KEYS[choices.data.error])}</p>}
      {choices.data.recommendation && !saved && <p className={SETTINGS_DESCRIPTION_CLASS}>{t('settings.openchamber.connection.recommendation')}</p>}
      {choices.data.candidates.map(item => <SettingsFieldRow key={item.source + ':' + item.key} label={t(item.source === 'environment' ? 'settings.openchamber.connection.environment' : 'settings.openchamber.connection.settings')} description={item.key}>
        {item.record && <Button variant="outline" disabled={blocked} onClick={() => { setDraft(connectionDraft(item.record)); setError(null); }}>{t('settings.openchamber.connection.candidate')}</Button>}
        <span className={SETTINGS_DESCRIPTION_CLASS}>{item.resolved ?? (item.record?.mode === CONNECTION_MODE.EXTERNAL ? item.record.endpoint : item.record?.mode === CONNECTION_MODE.CONFIGURED ? item.record.exe : '')}</span>
        {item.error && <span className={SETTINGS_DESCRIPTION_CLASS}>{t(ISSUE_KEYS[item.error])}</span>}
      </SettingsFieldRow>)}
      {draft.mode === CONNECTION_MODE.EXTERNAL && <SettingsFieldRow label={t('settings.openchamber.connection.endpoint')}>
        <Input className="h-9 max-w-[24rem]" aria-label={t('settings.openchamber.connection.endpoint')} value={draft.endpoint} disabled={blocked} onChange={event => edit({ endpoint: event.target.value })} />
      </SettingsFieldRow>}
      {(draft.mode === CONNECTION_MODE.CONFIGURED || draft.mode === CONNECTION_MODE.COMMAND) && <SettingsFieldRow label={t('settings.openchamber.connection.exe')}>
        <Input className="h-9 max-w-[24rem]" aria-label={t('settings.openchamber.connection.exe')} value={draft.exe} disabled={blocked} onChange={event => edit({ exe: event.target.value })} />
      </SettingsFieldRow>}
      {draft.mode === CONNECTION_MODE.COMMAND && <>
        <SettingsStackedField label={t('settings.openchamber.connection.args')}>
          <Textarea aria-label={t('settings.openchamber.connection.args')} value={draft.args} disabled={blocked} onChange={event => edit({ args: event.target.value })} />
        </SettingsStackedField>
        <SettingsFieldRow label={t('settings.openchamber.connection.cwd')}>
          <Input className="h-9 max-w-[24rem]" aria-label={t('settings.openchamber.connection.cwd')} value={draft.cwd} disabled={blocked} onChange={event => edit({ cwd: event.target.value })} />
        </SettingsFieldRow>
        <SettingsStackedField label={t('settings.openchamber.connection.env')}>
          <Textarea aria-label={t('settings.openchamber.connection.env')} value={draft.env} disabled={blocked} onChange={event => edit({ env: event.target.value })} />
        </SettingsStackedField>
      </>}
      {error && <p role="alert" className={SETTINGS_DESCRIPTION_CLASS}>{t(ERROR_KEYS[error])}</p>}
      {review && <SettingsControlGroup title={t('settings.openchamber.connection.review')}>
        <p className={SETTINGS_DESCRIPTION_CLASS}>{t(MODE_KEYS[review.connection.mode])}</p>
        {review.connection.mode === CONNECTION_MODE.EXTERNAL && <p className={SETTINGS_DESCRIPTION_CLASS}>{review.connection.endpoint}</p>}
        {(review.connection.mode === CONNECTION_MODE.CONFIGURED || review.connection.mode === CONNECTION_MODE.COMMAND) && <p className={SETTINGS_DESCRIPTION_CLASS}>{review.connection.exe}</p>}
        <p role="status" className={SETTINGS_DESCRIPTION_CLASS}>
          {t(review.activity.scope.busy === ACTIVITY_SCOPE.GLOBAL ? 'settings.openchamber.connection.activityBusyGlobal' : 'settings.openchamber.connection.activityBusy', { count: review.activity.busy.state === ACTIVITY_STATE.KNOWN ? review.activity.busy.count : t('settings.openchamber.connection.unknown') })}<br />
          {t('settings.openchamber.connection.activityPermissions', { count: review.activity.permissions.state === ACTIVITY_STATE.KNOWN ? review.activity.permissions.count : t('settings.openchamber.connection.unknown') })}<br />
          {t('settings.openchamber.connection.activityQuestions', { count: review.activity.questions.state === ACTIVITY_STATE.KNOWN ? review.activity.questions.count : t('settings.openchamber.connection.unknown') })}<br />
          {t('settings.openchamber.connection.activityQueue', { count: review.activity.queue.state === ACTIVITY_STATE.KNOWN ? review.activity.queue.count : t('settings.openchamber.connection.unknown') })}
        </p>
        <p className={SETTINGS_DESCRIPTION_CLASS}>{t('settings.openchamber.connection.coverage')}</p>
        {review.activity.scope.directories.map(directory => <p key={directory} className={SETTINGS_DESCRIPTION_CLASS}>{directory}</p>)}
        <p className={SETTINGS_DESCRIPTION_CLASS}>{t('settings.openchamber.connection.clients')}</p>
        <p className={SETTINGS_DESCRIPTION_CLASS}>{t('settings.openchamber.connection.consequences')}</p>
        <SettingsCheckboxRow checked={acknowledged} onChange={acknowledge} disabled={busy} label={t('settings.openchamber.connection.acknowledge')} ariaLabel={t('settings.openchamber.connection.acknowledge')} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !acknowledged} onClick={() => { void connect(CONNECTION_DECISION.WAIT); }}>{t('settings.openchamber.connection.wait')}</Button>
          <Button variant="outline" disabled={busy || !acknowledged} onClick={() => { void connect(CONNECTION_DECISION.STOP); }}>{t('settings.openchamber.connection.stop')}</Button>
          <Button variant="outline" disabled={busy || !request} onClick={() => { if (request) void inspect(request); }}>{t('settings.openchamber.connection.refresh')}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { setReview(null); setRequest(null); acknowledge(false); }}>{t('settings.common.actions.cancel')}</Button>
        </div>
      </SettingsControlGroup>}
      <SettingsFieldRow label={t('settings.openchamber.connection.confirm')}>
        <Button disabled={blocked || draft.mode === null} onClick={confirm}>{busy ? t('startup.initRecovery.retrying') : t('settings.openchamber.connection.confirm')}</Button>
        {saved && <Button variant="outline" disabled={blocked} onClick={() => { void inspect({ source: CONNECTION_SOURCE.CANDIDATE, connection: saved }); }}>{t('startup.initRecovery.retry')}</Button>}
        {saved && <Button variant="outline" disabled={blocked} onClick={() => { void inspect({ source: CONNECTION_SOURCE.PREVIOUS }); }}>{t('settings.openchamber.connection.previous')}</Button>}
      </SettingsFieldRow>
    </>}
  </SettingsSection>;
};
