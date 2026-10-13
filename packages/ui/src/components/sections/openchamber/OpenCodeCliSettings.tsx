import * as React from 'react';
import { AgentConnectionSettings } from './AgentConnectionSettings';
import { SettingsCheckboxRow } from '@/components/sections/shared/SettingsSection';
import { updateDesktopSettings } from '@/lib/persistence';
import { useUIStore } from '@/stores/useUIStore';
import { useI18n } from '@/lib/i18n';
import { isWindowsArm64 } from '@/lib/platform';

export const OpenCodeCliSettings: React.FC = () => {
  const { t } = useI18n();
  const showUpdates = useUIStore((state) => state.showOpenCodeUpdateNotifications);
  const setShowUpdates = useUIStore((state) => state.setShowOpenCodeUpdateNotifications);
  return <>
    <AgentConnectionSettings />
    {!isWindowsArm64() && <SettingsCheckboxRow
      settingsItem="sessions.opencode-update-notifications"
      checked={showUpdates}
      onChange={(enabled) => { setShowUpdates(enabled); void updateDesktopSettings({ showOpenCodeUpdateNotifications: enabled }); }}
      label={t('settings.openchamber.opencodeCli.field.showUpdateNotifications')}
      ariaLabel={t('settings.openchamber.opencodeCli.field.showUpdateNotificationsAria')}
    />}
  </>;
};
