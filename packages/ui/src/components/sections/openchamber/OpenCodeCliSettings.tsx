import * as React from 'react';
import { Button } from '@/components/ui/button';
import { SettingsSection, SettingsCheckboxRow, SettingsFieldRow } from '@/components/sections/shared/SettingsSection';
import { updateDesktopSettings } from '@/lib/persistence';
import { restartOpenCodeWithFeedback } from '@/lib/restartOpenCode';
import { useUIStore } from '@/stores/useUIStore';
import { useI18n } from '@/lib/i18n';
import { isWindowsArm64 } from '@/lib/platform';

export const OpenCodeCliSettings: React.FC = () => {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const notifications = useUIStore(state => state.showOpenCodeUpdateNotifications);
  const setNotifications = useUIStore(state => state.setShowOpenCodeUpdateNotifications);
  return <SettingsSection title={t('settings.openchamber.opencodeCli.title')}>
    {!isWindowsArm64() && <SettingsCheckboxRow settingsItem="sessions.opencode-update-notifications" checked={notifications}
      onChange={enabled => { setNotifications(enabled); void updateDesktopSettings({ showOpenCodeUpdateNotifications: enabled }); }}
      label={t('settings.openchamber.opencodeCli.field.showUpdateNotifications')} ariaLabel={t('settings.openchamber.opencodeCli.field.showUpdateNotificationsAria')} />}
    <SettingsFieldRow settingsItem="sessions.opencode-restart" label={t('settings.openchamber.opencodeCli.actions.restart')}>
      <Button variant="outline" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await restartOpenCodeWithFeedback(t); } finally { setBusy(false); }
      }}>{t('settings.openchamber.opencodeCli.actions.restart')}</Button>
    </SettingsFieldRow>
  </SettingsSection>;
};
