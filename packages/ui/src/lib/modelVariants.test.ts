import { describe, expect, test } from 'bun:test';
import { modelVariantNames } from './modelVariants';

describe('modelVariantNames', () => {
  test('reads OC1 keyed variants', () => {
    expect(modelVariantNames({ variants: { low: {}, high: {} } })).toEqual(['low', 'high']);
  });

  test('reads OC2 variant ids rather than array indexes', () => {
    expect(modelVariantNames({ variants: [{ id: 'thinking' }, { id: 'fast' }] })).toEqual(['thinking', 'fast']);
  });

  test('rejects malformed OC2 variant arrays without making up ids', () => {
    expect(modelVariantNames({ variants: [{ label: 'missing id' }] })).toEqual([]);
  });
});
