export const isPlantUmlFile = (path: string): boolean => {
  const extension = path.toLowerCase().split('.').pop();
  return extension === 'puml' || extension === 'plantuml' || extension === 'pu';
};

const longestBacktickRun = (source: string): number => {
  let longest = 0;
  for (const match of source.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
};

export const fencePlantUmlSource = (source: string): string => {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(source) + 1));
  const suffix = source.endsWith('\n') ? '' : '\n';
  return `${fence}plantuml\n${source}${suffix}${fence}`;
};
