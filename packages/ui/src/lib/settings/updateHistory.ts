export const UPDATE_HISTORY_PAGE = 'update-history';
export const UPDATE_HISTORY_ANCHOR = 'update-history.entries';
export const HistorySurface = { App: 'App', VSCode: 'VS Code' } as const;
export const HistoryOrigin = { All: 'all', Official: 'Official', Personal: 'Personal' } as const;
export const HistoryGroup = { New: 'New', Improvements: 'Improvements', Fixes: 'Fixes', Misc: 'Misc' } as const;
export type HistorySurface = typeof HistorySurface[keyof typeof HistorySurface];
export type HistoryOrigin = typeof HistoryOrigin[keyof typeof HistoryOrigin];
type HistoryGroup = typeof HistoryGroup[keyof typeof HistoryGroup];
type Entry = { surface: HistorySurface; group: HistoryGroup; origin: HistoryOrigin; markdown: string };

export const HISTORY_GROUPS = [
  { value: HistoryGroup.New, label: 'settings.history.new' },
  { value: HistoryGroup.Improvements, label: 'settings.history.improvements' },
  { value: HistoryGroup.Fixes, label: 'settings.history.fixes' },
  { value: HistoryGroup.Misc, label: 'settings.history.misc' },
] as const;

export function parseUpdateHistory(markdown: string): Entry[] {
  const entries: Entry[] = [];
  let surface: HistorySurface | undefined;
  let group: HistoryGroup | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      surface = Object.values(HistorySurface).find(value => value === line.slice(3));
      group = undefined;
      if (!surface) throw new Error('Unknown update-history surface');
    } else if (line.startsWith('### ')) {
      group = Object.values(HistoryGroup).find(value => value === line.slice(4));
      if (!surface || !group) throw new Error('Unknown update-history group');
    } else if (line.startsWith('- ')) {
      const label = line.slice(2).replaceAll('**', '');
      const origin = [HistoryOrigin.Official, HistoryOrigin.Personal].find(value => label.startsWith(value + ' '));
      if (!surface || !group || !origin) throw new Error('Unclassified update-history entry');
      entries.push({ surface, group, origin, markdown: line });
    }
  }
  return entries;
}
