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
    expect(entries.filter(entry => entry.markdown.includes('Official 1.23.1')).every(entry => entry.markdown.includes('(not merged)'))).toBe(true);
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
      expect({ ...localized, markdown: entry.markdown }).toEqual(entry);
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
});
