import { describe, expect, test } from 'bun:test';

import { guestFileScope, isGuestFilePath } from './contract';

describe('guest file path contract', () => {
  test('classifies shared project and filesystem path forms', () => {
    expect(guestFileScope('README.md')).toBe('project');
    expect(guestFileScope('C:/Users/ada/config.json')).toBe('filesystem');
    expect(guestFileScope('C:\\Users\\ada\\config.json')).toBe('filesystem');
    expect(guestFileScope('~/config.json')).toBe('filesystem');
    expect(guestFileScope('/tmp/config.json')).toBe('filesystem');
  });

  test('keeps protocol path validation strict for traversal and backslashes', () => {
    expect(isGuestFilePath('C:/Users/ada/config.json')).toBe(true);
    expect(isGuestFilePath('C:\\Users\\ada\\config.json')).toBe(false);
    expect(isGuestFilePath('../config.json')).toBe(true);
    expect(isGuestFilePath('safe\0.json')).toBe(false);
  });
});
