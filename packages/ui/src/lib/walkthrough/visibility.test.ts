import { describe, expect, test } from 'bun:test';
import { applyWalkthroughVisibility } from './visibility';

describe('applyWalkthroughVisibility', () => {
  test('hidden surface aborts the load GET and does not start a new load', () => {
    const calls: string[] = [];
    applyWalkthroughVisibility(false, {
      abortLoad: () => { calls.push('abortLoad'); },
      load: () => { calls.push('load'); },
    });
    expect(calls).toEqual(['abortLoad']);
  });

  test('visible surface starts load and does not abort', () => {
    const calls: string[] = [];
    applyWalkthroughVisibility(true, {
      abortLoad: () => { calls.push('abortLoad'); },
      load: () => { calls.push('load'); },
    });
    expect(calls).toEqual(['load']);
  });
});
