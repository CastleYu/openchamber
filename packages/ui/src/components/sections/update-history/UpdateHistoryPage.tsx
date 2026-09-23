import React from 'react';
import history from '@/content/update-history.md?raw';
import chineseHistory from '@/content/update-history.zh-CN.md?raw';
import { useI18n } from '@/lib/i18n';
import { isVSCodeRuntime } from '@/lib/desktop';
import { SimpleMarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { SettingsPageLayout } from '../shared/SettingsPageLayout';
import { SettingsSection, SettingsControlGroup, SettingsFieldRow, SettingsChipGroup } from '../shared/SettingsSection';
import {
  HISTORY_GROUPS, HistoryOrigin, HistorySurface, UPDATE_HISTORY_ANCHOR, parseUpdateHistory,
} from '@/lib/settings/updateHistory';
import type { UpdateHistoryEntry } from '@/lib/settings/updateHistory';

const entries = parseUpdateHistory(history);
const chineseEntries = parseUpdateHistory(chineseHistory);

function groupByCategory(items: UpdateHistoryEntry[]) {
  const grouped = new Map<string | undefined, UpdateHistoryEntry[]>();
  for (const entry of items) {
    const group = grouped.get(entry.category) ?? [];
    group.push(entry);
    grouped.set(entry.category, group);
  }
  return grouped;
}

export function UpdateHistoryPage() {
  const { t, locale } = useI18n();
  const [origin, setOrigin] = React.useState<HistoryOrigin>(HistoryOrigin.All);
  const [surface, setSurface] = React.useState<HistorySurface>(() => isVSCodeRuntime() ? HistorySurface.VSCode : HistorySurface.App);
  const localized = locale === 'zh-CN' ? chineseEntries : entries;
  const selected = localized.filter(entry => entry.surface === surface && (origin === HistoryOrigin.All || entry.origin === origin));

  return <SettingsPageLayout title={t('settings.page.update-history.title')} description={t('settings.page.update-history.description')}>
    <SettingsSection divider={false} settingsItem={UPDATE_HISTORY_ANCHOR}>
      <SettingsFieldRow label={t('settings.history.source')}>
        <SettingsChipGroup value={origin} onChange={setOrigin} aria-label={t('settings.history.source')} options={[
          { value: HistoryOrigin.All, label: t('settings.history.all') },
          { value: HistoryOrigin.Official, label: t('settings.history.official') },
          { value: HistoryOrigin.Personal, label: t('settings.history.personal') },
        ]} />
      </SettingsFieldRow>
      <SettingsFieldRow label={t('settings.history.surface')}>
        <SettingsChipGroup value={surface} onChange={setSurface} aria-label={t('settings.history.surface')} options={[
          { value: HistorySurface.App, label: t('settings.history.app') },
          { value: HistorySurface.VSCode, label: 'VS Code' },
        ]} />
      </SettingsFieldRow>
    </SettingsSection>
    {HISTORY_GROUPS.map(group => {
      const grouped = groupByCategory(selected.filter(entry => entry.group === group.value));
      return grouped.size ? <SettingsSection key={group.value} title={t(group.label)} contentClassName="space-y-6">
        {[...grouped].map(([category, categoryEntries]) => <SettingsControlGroup key={category ?? group.value} title={category}>
          <SimpleMarkdownRenderer content={categoryEntries.map(entry => entry.markdown).join('\n')} enableFileReferences={false} />
        </SettingsControlGroup>)}
      </SettingsSection> : null;
    })}
  </SettingsPageLayout>;
}
