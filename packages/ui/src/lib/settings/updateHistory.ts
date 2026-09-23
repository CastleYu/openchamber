export const UPDATE_HISTORY_PAGE = 'update-history';
export const UPDATE_HISTORY_ANCHOR = 'update-history.entries';
export const HistorySurface = { App: 'App', VSCode: 'VS Code' } as const;
export const HistoryOrigin = { All: 'all', Official: 'Official', Personal: 'Personal' } as const;
export const HistoryGroup = { New: 'New', Improvements: 'Improvements', Fixes: 'Fixes', Misc: 'Misc' } as const;
const CHINESE_LABELS = { App: '应用', 'VS Code': 'VS Code', New: '新增', Improvements: '改进', Fixes: '修复', Misc: '其他', Official: '官方', Personal: '个人版' } as const;
const CATEGORY_SEPARATOR = ' / ';
const CATEGORY_MARKERS = [':', '：'] as const;
export type HistorySurface = typeof HistorySurface[keyof typeof HistorySurface];
export type HistoryOrigin = typeof HistoryOrigin[keyof typeof HistoryOrigin];
type HistoryGroup = typeof HistoryGroup[keyof typeof HistoryGroup];
export type UpdateHistoryEntry = {
  surface: HistorySurface;
  group: HistoryGroup;
  origin: HistoryOrigin;
  category?: string;
  markdown: string;
};

export const HISTORY_GROUPS = [
  { value: HistoryGroup.New, label: 'settings.history.new' },
  { value: HistoryGroup.Improvements, label: 'settings.history.improvements' },
  { value: HistoryGroup.Fixes, label: 'settings.history.fixes' },
  { value: HistoryGroup.Misc, label: 'settings.history.misc' },
] as const;

export function parseUpdateHistory(markdown: string): UpdateHistoryEntry[] {
  const entries: UpdateHistoryEntry[] = [];
  let surface: HistorySurface | undefined;
  let group: HistoryGroup | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      surface = Object.values(HistorySurface).find(value => value === line.slice(3) || CHINESE_LABELS[value] === line.slice(3));
      group = undefined;
      if (!surface) throw new Error('Unknown update-history surface');
    } else if (line.startsWith('### ')) {
      group = Object.values(HistoryGroup).find(value => value === line.slice(4) || CHINESE_LABELS[value] === line.slice(4));
      if (!surface || !group) throw new Error('Unknown update-history group');
    } else if (line.startsWith('- ')) {
      const label = line.slice(2).replaceAll('**', '');
      const origin = [HistoryOrigin.Official, HistoryOrigin.Personal].find(value => label.startsWith(value + ' ') || label.startsWith(CHINESE_LABELS[value] + ' '));
      if (!surface || !group || !origin) throw new Error('Unclassified update-history entry');
      const categoryStart = label.indexOf(CATEGORY_SEPARATOR);
      const categoryLabel = categoryStart >= 0 ? label.slice(categoryStart + CATEGORY_SEPARATOR.length) : '';
      const categoryEnds = CATEGORY_MARKERS.map(marker => {
        const index = categoryLabel.indexOf(marker);
        return index >= 0 ? index : undefined;
      }).filter((index): index is number => index !== undefined);
      const category = categoryEnds.length
        ? categoryLabel.slice(0, Math.min(...categoryEnds)).trim() || undefined
        : undefined;
      entries.push({ surface, group, origin, category, markdown: line });
    }
  }
  return entries;
}
