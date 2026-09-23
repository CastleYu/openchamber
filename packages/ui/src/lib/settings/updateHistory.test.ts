import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { HistoryOrigin, HistorySurface, parseUpdateHistory } from './updateHistory';

describe('bundled update history', () => {
  test('the history cutoff matches the release identity', () => {
    const upstream = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(new URL('../../../../../package.json', import.meta.url), 'utf8')));
    const personal = z.object({ featureVersion: z.string() }).parse(JSON.parse(readFileSync(new URL('../../../../web/personal-build.json', import.meta.url), 'utf8')));
    const source = readFileSync(new URL('../../content/update-history.md', import.meta.url), 'utf8');
    expect(source).toContain(`This summary ends at ${upstream.version}-DIJIANG.${personal.featureVersion}`);
    const translated = readFileSync(new URL('../../content/update-history.zh-CN.md', import.meta.url), 'utf8');
    expect(translated).toContain(`本汇总截至 ${upstream.version}-DIJIANG.${personal.featureVersion}`);
  });
  test('keeps every authored entry and both platform scopes', () => {
    const source = readFileSync(new URL('../../content/update-history.md', import.meta.url), 'utf8');
    const entries = parseUpdateHistory(source);
    const bullets = source.split(/\r?\n/).filter(line => line.startsWith('- '));
    expect(entries.map(entry => entry.markdown)).toEqual(bullets);
    for (const surface of Object.values(HistorySurface)) {
      for (const origin of [HistoryOrigin.Official, HistoryOrigin.Personal]) {
        expect(entries.some(entry => entry.surface === surface && entry.origin === origin)).toBe(true);
      }
    }
    expect(entries.filter(entry => entry.markdown.includes('Official 1.23.1')).every(entry => !entry.markdown.includes('(not merged)'))).toBe(true);
    expect(entries.some(entry => entry.markdown.includes('Official v2 preview (not merged)'))).toBe(true);
  });

  test('Chinese history preserves every entry, classification, version and credit', () => {
    const source = readFileSync(new URL('../../content/update-history.md', import.meta.url), 'utf8');
    const translated = readFileSync(new URL('../../content/update-history.zh-CN.md', import.meta.url), 'utf8');
    const english = parseUpdateHistory(source);
    const chinese = parseUpdateHistory(translated);
    expect(chinese).toHaveLength(english.length);
    expect(chinese.map(entry => entry.markdown)).toEqual(translated.split(/\r?\n/).filter(line => line.startsWith('- ')));
    for (const [index, entry] of english.entries()) {
      const localized = chinese[index];
      expect({ ...localized, category: undefined, markdown: entry.markdown }).toEqual({ ...entry, category: undefined });
      expect(/[\u4e00-\u9fff]/.test(localized.markdown)).toBe(true);
      expect(localized.markdown.match(/@[\w-]+/g) || []).toEqual(entry.markdown.match(/@[\w-]+/g) || []);
      expect(localized.markdown.match(/\d+\.\d+(?:\.\d+)*(?:-DIJIANG\.\d+\.\d+|-preview\.\d+)?/g) || [])
        .toEqual(entry.markdown.match(/\d+\.\d+(?:\.\d+)*(?:-DIJIANG\.\d+\.\d+|-preview\.\d+)?/g) || []);
      expect(localized.markdown.includes('尚未合入')).toBe(entry.markdown.includes('not merged'));
      expect(localized.markdown.includes('wq.pan')).toBe(entry.markdown.includes('wq.pan'));
    }
    expect(translated.match(/\]\(([^)]+)\)/g)).toEqual(source.match(/\]\(([^)]+)\)/g));
  });

  test('rejects unclassified content rather than silently omitting it', () => {
    expect(() => parseUpdateHistory('## App\n### Unknown\n- Personal / Change')).toThrow();
    expect(() => parseUpdateHistory('## App\n### New\n- Unlabelled change')).toThrow();
    expect(() => parseUpdateHistory('## Unknown\n### New')).toThrow();
  });

  test('extracts categories for English and Chinese labels without losing entries', () => {
    const source = '## App\n### New\n- Official / 1.0: Added\n- Personal / 1.1：Updated\n- Official / No category';
    const entries = parseUpdateHistory(source);
    expect(entries).toHaveLength(3);
    expect(entries.map(entry => entry.category)).toEqual(['1.0', '1.1', undefined]);
    expect(entries.map(entry => entry.markdown)).toEqual(source.split('\n').filter(line => line.startsWith('- ')));
  });

  test('uses the first colon after the category separator', () => {
    const [entry] = parseUpdateHistory('## 应用\n### 新增\n- 个人版 / 性能: CPU: memory');
    expect(entry.category).toBe('性能');
  });
});
