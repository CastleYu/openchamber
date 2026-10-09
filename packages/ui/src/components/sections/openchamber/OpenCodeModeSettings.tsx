import * as React from 'react';
import { SettingsSection, SettingsFieldRow, SettingsChipGroup, SETTINGS_DESCRIPTION_CLASS } from '@/components/sections/shared/SettingsSection';
import { loadDesktopSettings, updateDesktopSettings } from '@/lib/persistence';
import { OPEN_CODE_SELECTION, OPEN_CODE_SETTING, OPEN_CODE_STATUS } from '@/lib/opencode/runtime';
import { opencodeClient } from '@/lib/opencode/client';
import { useConfigStore } from '@/stores/useConfigStore';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useI18n } from '@/lib/i18n';

type Selection = typeof OPEN_CODE_SELECTION[keyof typeof OPEN_CODE_SELECTION];

const STATUS_KEYS = {
  [OPEN_CODE_STATUS.READY]: 'settings.openchamber.opencodeMode.ready',
  [OPEN_CODE_STATUS.AUTH]: 'settings.openchamber.opencodeMode.auth',
  [OPEN_CODE_STATUS.UNREACHABLE]: 'settings.openchamber.opencodeMode.unreachable',
  [OPEN_CODE_STATUS.CONFLICT]: 'settings.openchamber.opencodeMode.conflict',
  [OPEN_CODE_STATUS.MISMATCH]: 'settings.openchamber.opencodeMode.mismatch',
  [OPEN_CODE_STATUS.UNSUPPORTED]: 'settings.openchamber.opencodeMode.unsupported',
  [OPEN_CODE_STATUS.UNVERIFIED]: 'settings.openchamber.opencodeMode.unverified',
  [OPEN_CODE_STATUS.INVALID_ENDPOINT]: 'settings.openchamber.opencodeMode.invalidEndpoint',
  [OPEN_CODE_STATUS.INVALID_SELECTION]: 'settings.openchamber.opencodeMode.invalidSelection',
} as const;

export const OpenCodeModeSettings: React.FC = () => {
  const { t } = useI18n();
  const runtime = React.useSyncExternalStore(
    React.useCallback(listener => opencodeClient.subscribeRuntime(listener), []),
    React.useCallback(() => opencodeClient.getRuntimeDescriptor(), []),
    () => null,
  );
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<'load' | 'save' | 'connection' | null>(null);
  React.useEffect(() => {
    let active = true;
    void loadDesktopSettings().then(data => {
      if (!active) return;
      if (!data) { setError('load'); return; }
      setSelection(data[OPEN_CODE_SETTING.SELECTION] ?? OPEN_CODE_SELECTION.AUTO);
    }).catch(() => { if (active) setError('load'); });
    return () => { active = false; };
  }, []);

  const save = async (value: Selection) => {
    if (saving || selection === null || value === selection) return;
    const owner = getRuntimeKey();
    let saved = false;
    setSaving(true);
    setError(null);
    try {
      const result = await updateDesktopSettings({ [OPEN_CODE_SETTING.SELECTION]: value });
      if (owner !== getRuntimeKey()) return;
      if (!result.ok) { setError('save'); return; }
      saved = true;
      setSelection(value);
      opencodeClient.reconnectToRuntimeBaseUrl();
      const state = useConfigStore.getState();
      if (state.isInitialized) await state.checkConnection();
      else await state.initializeApp();
      if (owner !== getRuntimeKey()) return;
      const current = useConfigStore.getState();
      if (!current.isConnected || !current.isInitialized) setError('connection');
    } catch {
      if (owner === getRuntimeKey()) setError(saved ? 'connection' : 'save');
    } finally {
      if (owner === getRuntimeKey()) setSaving(false);
    }
  };

  return <SettingsSection title={t('settings.openchamber.opencodeMode.title')}>
    <SettingsFieldRow settingsItem="general.opencode-mode" label={t('settings.openchamber.opencodeMode.label')} info={t('settings.openchamber.opencodeMode.info')}>
      <SettingsChipGroup<Selection | ""> value={selection ?? ""} onChange={value => { if (value) void save(value); }} aria-label={t('settings.openchamber.opencodeMode.label')} options={[
        { value: OPEN_CODE_SELECTION.AUTO, label: t('settings.openchamber.opencodeMode.auto'), disabled: selection === null || saving },
        { value: OPEN_CODE_SELECTION.OC1, label: 'OC1', disabled: selection === null || saving },
        { value: OPEN_CODE_SELECTION.OC2, label: 'OC2', disabled: selection === null || saving },
        { value: OPEN_CODE_SELECTION.LEGACY, label: t('settings.openchamber.opencodeMode.legacy'), disabled: selection === null || saving },
      ]} />
    </SettingsFieldRow>
    {runtime?.version && <p className={SETTINGS_DESCRIPTION_CLASS}>{t('settings.openchamber.opencodeMode.version', { version: runtime.version })}</p>}
    {runtime?.status === OPEN_CODE_STATUS.READY && runtime.profile && <p className={SETTINGS_DESCRIPTION_CLASS}>{t('settings.openchamber.opencodeMode.resolved', { mode: runtime.profile === OPEN_CODE_SELECTION.LEGACY ? t('settings.openchamber.opencodeMode.legacy') : runtime.profile.toUpperCase() })}</p>}
    {runtime?.status && <p role="status" className={SETTINGS_DESCRIPTION_CLASS}>{t(STATUS_KEYS[runtime.status])}</p>}
    {error && <p role="alert" className={SETTINGS_DESCRIPTION_CLASS}>{t(error === 'load' ? 'settings.openchamber.opencodeMode.loadFailed' : error === 'save' ? 'settings.openchamber.opencodeMode.saveFailed' : 'settings.openchamber.opencodeMode.connectionFailed')}</p>}
  </SettingsSection>;
};
