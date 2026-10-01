import { describe, expect, test } from 'bun:test';
import { isSameProjectConfigError, readProjectConfigError } from './configError';

describe('readProjectConfigError', () => {
  test('extracts the file and schema issue from a direct OpenCode error', () => {
    const result = readProjectConfigError({
      name: 'ConfigInvalidError',
      data: {
        path: '/workspace/project/opencode.json',
        issues: [{ path: ['model'], message: 'Expected a model reference' }],
      },
    });
    expect(result).toEqual({
      name: 'ConfigInvalidError',
      path: '/workspace/project/opencode.json',
      message: 'model: Expected a model reference',
    });
  });

  test('finds OpenCode errors through generated-client causes and rejects unrelated failures', () => {
    const error = new Error('request failed', {
      cause: { name: 'ConfigJsonError', data: { path: 'config', message: 'Unexpected token' } },
    });
    expect(readProjectConfigError(error)).toEqual({
      name: 'ConfigJsonError',
      path: undefined,
      message: 'Unexpected token',
    });
    expect(readProjectConfigError(new Error('offline'))).toBeNull();
    expect(readProjectConfigError({ name: 'NotFoundError', data: { message: 'missing' } })).toBeNull();
  });

  test('compares project errors by their displayed identity', () => {
    const first = { name: 'ConfigJsonError', path: 'opencode.json', message: 'bad json' };
    expect(isSameProjectConfigError(first, { ...first })).toBe(true);
    expect(isSameProjectConfigError(first, { ...first, message: 'fixed elsewhere' })).toBe(false);
  });
});
