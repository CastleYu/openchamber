import * as React from 'react';
import { SettingsSection, SettingsFieldRow, SettingsChipGroup, SETTINGS_DESCRIPTION_CLASS } from '@/components/sections/shared/SettingsSection';
import { loadDesktopSettings, updateDesktopSettings } from '@/lib/persistence';
import { OPEN_CODE_SELECTION, OPEN_CODE_SETTING } from '@/lib/opencode/runtime';
import { opencodeClient } from '@/lib/opencode/client';
import { useConfigStore } from '@/stores/useConfigStore';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useI18n } from '@/lib/i18n';

type Selection = typeof OPEN_CODE_SELECTION[keyof typeof OPEN_CODE_SELECTION];

export const OpenCodeModeSettings: React.FC = () => {
  const { t } = useI18n();
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
    setSaving(true);
    setError(null);
    try {
      const result = await updateDesktopSettings({ [OPEN_CODE_SETTING.SELECTION]: value });
      if (owner !== getRuntimeKey()) return;
      if (!result.ok) { setError('save'); return; }
      setSelection(value);
      opencodeClient.reconnectToRuntimeBaseUrl();
      const connected = await useConfigStore.getState().checkConnection();
      if (owner === getRuntimeKey() && !connected) setError('connection');
    } catch {
      if (owner === getRuntimeKey()) setError('save');
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
    {error && <p role="alert" className={SETTINGS_DESCRIPTION_CLASS}>{t(error === 'load' ? 'settings.openchamber.opencodeMode.loadFailed' : error === 'save' ? 'settings.openchamber.opencodeMode.saveFailed' : 'settings.openchamber.opencodeMode.connectionFailed')}</p>}
  </SettingsSection>;
};
