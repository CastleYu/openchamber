import React from 'react';
import { SettingsCheckboxRow } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { reportSettingsSaveState } from '@/lib/persistence';
import { opencodeClient } from '@/lib/opencode/client';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { z } from 'zod';

const warmingConfigSchema = z.object({ warming: z.unknown().optional() }).passthrough();

/**
 * OpenCode's `warming` config key: keeps an idle session's prompt cache alive
 * with small keep-alive requests. The checkbox shows the effective value
 * OpenCode reports and writes through `PUT /api/config/warming`.
 */
export const SessionWarmingCheckbox: React.FC = () => {
  const { t } = useI18n();
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const latestWrite = React.useRef(0);

  React.useEffect(() => {
    let cancelled = false;
    void opencodeClient.getConfig(null)
      .then((response) => {
        const config = warmingConfigSchema.parse(response);
        if (!cancelled && latestWrite.current === 0) setEnabled(Boolean(config.warming));
      })
      .catch(() => console.warn('[session-warming] failed to read config'));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = React.useCallback(async (next: boolean) => {
    const previous = enabled;
    const write = ++latestWrite.current;
    setEnabled(next);
    reportSettingsSaveState('saving');
    try {
      const response = await runtimeFetch('/api/config/warming', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      reportSettingsSaveState('saved');
      opencodeClient.clearConfigCache();
    } catch (error) {
      console.warn('[session-warming] failed to save', error);
      reportSettingsSaveState('error');
      if (write === latestWrite.current) setEnabled(previous);
    }
  }, [enabled]);

  return (
    <SettingsCheckboxRow
      settingsItem="sessions.warming"
      checked={enabled ?? false}
      disabled={enabled === null}
      onChange={(checked) => {
        void handleChange(checked);
      }}
      label={t('settings.openchamber.defaults.field.sessionWarming')}
      info={t('settings.openchamber.defaults.field.sessionWarmingInfo')}
    />
  );
};
