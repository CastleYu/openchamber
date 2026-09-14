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

  test('rejects unclassified content rather than silently omitting it', () => {
    expect(() => parseUpdateHistory('## App\n### Unknown\n- Personal / Change')).toThrow();
    expect(() => parseUpdateHistory('## App\n### New\n- Unlabelled change')).toThrow();
    expect(() => parseUpdateHistory('## Unknown\n### New')).toThrow();
  });
});
