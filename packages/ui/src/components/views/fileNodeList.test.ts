import { describe, expect, test } from 'bun:test';

import { reuseFileNodes, type FileNode } from './fileNodeList';

const node = (overrides: Partial<FileNode> = {}): FileNode => ({
  name: 'README.md',
  path: '/repo/README.md',
  type: 'file',
  extension: 'md',
  ...overrides,
});

describe('reuseFileNodes', () => {
  test('reuses the previous list when the render data is unchanged', () => {
    const previous = [node()];
    const next = [node()];

    expect(reuseFileNodes(previous, next)).toBe(previous);
  });

  test('reuses an empty successful result', () => {
    const previous: FileNode[] = [];

    expect(reuseFileNodes(previous, [])).toBe(previous);
  });

  test('invalidates when order or any render field changes', () => {
    const previous = [node(), node({ name: 'src', path: '/repo/src', type: 'directory', extension: undefined })];
    expect(reuseFileNodes(previous, [previous[1], previous[0]])).not.toBe(previous);
    const original = [node()];
    const changes: Partial<FileNode>[] = [
      { name: 'README.txt' },
      { path: '/other/README.md' },
      { type: 'directory' },
      { extension: 'txt' },
      { relativePath: 'README.md' },
    ];
    for (const change of changes) {
      const next = [node(change)];
      expect(reuseFileNodes(original, next)).toBe(next);
    }
  });

  test('invalidates a missing or newly listed entry', () => {
    const previous = [node()];

    expect(reuseFileNodes(previous, [])).not.toBe(previous);
    expect(reuseFileNodes([], [node()])).not.toEqual([]);
    const empty: FileNode[] = [];
    expect(reuseFileNodes(undefined, empty)).toBe(empty);
  });

  test('keeps one list identity through repeated unchanged large-directory refreshes', () => {
    const original = Array.from({ length: 1000 }, (_, index) => node({ name: `${index}.md`, path: `/repo/${index}.md` }));
    let current = original;
    let changes = 0;
    for (let refresh = 0; refresh < 100; refresh += 1) {
      const next = reuseFileNodes(current, original.map((entry) => ({ ...entry })));
      if (next !== current) changes += 1;
      current = next;
    }
    expect(changes).toBe(0);
    expect(current).toBe(original);
  });
});
