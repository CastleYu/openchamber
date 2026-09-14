import React from 'react';
import { updateDesktopSettings } from '@/lib/persistence';
import { useI18n } from '@/lib/i18n';
import {
  isOccupancyScenario,
  OCCUPANCY_SCENARIOS,
  OCCUPANCY_SLIDER_BOUNDS,
  scenarioEnabled,
  withScenarioEnabled,
  type OccupancyScenario,
} from '@/lib/performance/occupancyPolicy';
import { useOccupancyPolicyStore } from '@/stores/useOccupancyPolicyStore';
import {
  SettingsSection,
  SettingsFieldRow,
  SettingsCheckboxRow,
  SettingsSlider,
  SETTINGS_SELECT_SIZE,
  SETTINGS_SELECT_ROW_TRIGGER_CLASS,
  SETTINGS_NUMBER_STEPPER_ROW_CLASS,
  SETTINGS_NUMBER_UNIT_CLASS,
  SETTINGS_FIELDS_STACK_CLASS,
} from '@/components/sections/shared/SettingsSection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const SCENARIO_LABEL_KEY = {
  gitDiffPrefetch: 'settings.openchamber.occupancy.scenario.gitDiffPrefetch',
  walkthroughUntrackedDiffs: 'settings.openchamber.occupancy.scenario.walkthroughUntrackedDiffs',
  hiddenSurfaceWork: 'settings.openchamber.occupancy.scenario.hiddenSurfaceWork',
  browserTabKeepAlive: 'settings.openchamber.occupancy.scenario.browserTabKeepAlive',
  idlePolling: 'settings.openchamber.occupancy.scenario.idlePolling',
} as const satisfies Record<OccupancyScenario, string>;

const SCENARIO_INFO_KEY = {
  gitDiffPrefetch: 'settings.openchamber.occupancy.info.gitDiffPrefetch',
  walkthroughUntrackedDiffs: 'settings.openchamber.occupancy.info.walkthroughUntrackedDiffs',
  hiddenSurfaceWork: 'settings.openchamber.occupancy.info.hiddenSurfaceWork',
  browserTabKeepAlive: 'settings.openchamber.occupancy.info.browserTabKeepAlive',
  idlePolling: 'settings.openchamber.occupancy.info.idlePolling',
} as const satisfies Record<OccupancyScenario, string>;

export const OccupancySettings: React.FC = () => {
  const { t } = useI18n();
  const policy = useOccupancyPolicyStore((state) => state.policy);
  const setPolicy = useOccupancyPolicyStore((state) => state.setPolicy);
  const [scenario, setScenario] = React.useState<OccupancyScenario>('gitDiffPrefetch');

  const save = React.useCallback((next: typeof policy) => {
    setPolicy(next);
    void updateDesktopSettings({ occupancy: next });
  }, [setPolicy]);

  const enabled = scenarioEnabled(scenario, policy);

  return (
    <SettingsSection title={t('settings.openchamber.occupancy.title')}>
      <div className={SETTINGS_FIELDS_STACK_CLASS}>
        <SettingsFieldRow
          label={t('settings.openchamber.occupancy.scenario.label')}
          info={t('settings.openchamber.occupancy.scenario.info')}
          settingsItem="general.occupancy-scenario"
        >
          <Select value={scenario} onValueChange={(value) => {
            if (isOccupancyScenario(value)) setScenario(value);
          }}>
            <SelectTrigger
              size={SETTINGS_SELECT_SIZE}
              className={SETTINGS_SELECT_ROW_TRIGGER_CLASS}
              aria-label={t('settings.openchamber.occupancy.scenario.aria')}
            >
              <SelectValue>{t(SCENARIO_LABEL_KEY[scenario])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {OCCUPANCY_SCENARIOS.map((item) => (
                <SelectItem key={item} value={item}>
                  {t(SCENARIO_LABEL_KEY[item])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsFieldRow>

        <SettingsCheckboxRow
          settingsItem="general.occupancy-enabled"
          checked={enabled}
          onChange={(checked) => save(withScenarioEnabled(policy, scenario, checked))}
          label={t('settings.openchamber.occupancy.enabled')}
          ariaLabel={t('settings.openchamber.occupancy.enabledAria')}
          info={t(SCENARIO_INFO_KEY[scenario])}
        />

        {scenario === 'gitDiffPrefetch' ? (
          <SettingsFieldRow
            label={t('settings.openchamber.occupancy.concurrency')}
            info={t('settings.openchamber.occupancy.concurrencyInfo')}
            settingsItem="general.occupancy-git-concurrency"
          >
            <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}>
              <SettingsSlider
                value={policy.gitDiffConcurrency}
                min={OCCUPANCY_SLIDER_BOUNDS.gitDiffConcurrency.min}
                max={OCCUPANCY_SLIDER_BOUNDS.gitDiffConcurrency.max}
                onValueChange={(value) => save({ ...policy, gitDiffConcurrency: value })}
                ariaLabel={t('settings.openchamber.occupancy.concurrencyAria')}
              />
              <span className={SETTINGS_NUMBER_UNIT_CLASS}>{policy.gitDiffConcurrency}</span>
            </div>
          </SettingsFieldRow>
        ) : null}

        {scenario === 'walkthroughUntrackedDiffs' ? (
          <>
            <SettingsFieldRow
              label={t('settings.openchamber.occupancy.concurrency')}
              info={t('settings.openchamber.occupancy.untrackedConcurrencyInfo')}
              settingsItem="general.occupancy-untracked-concurrency"
            >
              <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}>
                <SettingsSlider
                  value={policy.untrackedDiffConcurrency}
                  min={OCCUPANCY_SLIDER_BOUNDS.untrackedDiffConcurrency.min}
                  max={OCCUPANCY_SLIDER_BOUNDS.untrackedDiffConcurrency.max}
                  onValueChange={(value) => save({ ...policy, untrackedDiffConcurrency: value })}
                  ariaLabel={t('settings.openchamber.occupancy.concurrencyAria')}
                />
                <span className={SETTINGS_NUMBER_UNIT_CLASS}>{policy.untrackedDiffConcurrency}</span>
              </div>
            </SettingsFieldRow>
            <SettingsFieldRow
              label={t('settings.openchamber.occupancy.maxFiles')}
              info={t('settings.openchamber.occupancy.maxFilesInfo')}
              settingsItem="general.occupancy-untracked-max-files"
            >
              <div className={SETTINGS_NUMBER_STEPPER_ROW_CLASS}>
                <SettingsSlider
                  value={policy.untrackedDiffMaxFiles}
                  min={OCCUPANCY_SLIDER_BOUNDS.untrackedDiffMaxFiles.min}
                  max={OCCUPANCY_SLIDER_BOUNDS.untrackedDiffMaxFiles.max}
                  onValueChange={(value) => save({ ...policy, untrackedDiffMaxFiles: value })}
                  ariaLabel={t('settings.openchamber.occupancy.maxFilesAria')}
                />
                <span className={SETTINGS_NUMBER_UNIT_CLASS}>{policy.untrackedDiffMaxFiles}</span>
              </div>
            </SettingsFieldRow>
          </>
        ) : null}
      </div>
    </SettingsSection>
  );
};
