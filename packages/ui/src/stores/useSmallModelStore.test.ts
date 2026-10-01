import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from '@/lib/runtime-url';

import { selectSmallModelAvailability, useSmallModelStore } from './useSmallModelStore';

const previousResolver = getRuntimeUrlResolver();

beforeEach(() => {
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://small-model.test' });
  useSmallModelStore.getState().invalidate();
});

afterEach(() => {
  useSmallModelStore.getState().invalidate();
  setRuntimeUrlResolver(previousResolver);
});

describe('small model availability', () => {
  test('caches the server answer by directory and reuses it while fresh', async () => {
    const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ available: false }));
    try {
      expect(selectSmallModelAvailability(useSmallModelStore.getState(), '/project')).toBe('unknown');
      await useSmallModelStore.getState().ensureFresh('/project');
      expect(selectSmallModelAvailability(useSmallModelStore.getState(), '/project')).toBe('unavailable');
      expect(selectSmallModelAvailability(useSmallModelStore.getState(), '/other')).toBe('unknown');
      await useSmallModelStore.getState().ensureFresh('/project');
      expect(fetch.mock.calls).toHaveLength(1);
    } finally {
      fetch.mockRestore();
    }
  });

  test('an answer started before invalidation cannot repopulate the store', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    try {
      const oldRead = useSmallModelStore.getState().ensureFresh('/project');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      useSmallModelStore.getState().invalidate();
      const newRead = useSmallModelStore.getState().ensureFresh('/project');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(pending).toHaveLength(2);

      pending[0](Response.json({ available: false }));
      pending[1](Response.json({ available: true }));
      await Promise.all([oldRead, newRead]);
      expect(selectSmallModelAvailability(useSmallModelStore.getState(), '/project')).toBe('available');
    } finally {
      fetch.mockRestore();
    }
  });
});
