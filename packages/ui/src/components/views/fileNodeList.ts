export type FileNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  extension?: string;
  relativePath?: string;
};

const sameNode = (left: FileNode, right: FileNode): boolean => (
  left.name === right.name
  && left.path === right.path
  && left.type === right.type
  && left.extension === right.extension
  && left.relativePath === right.relativePath
);

export const reuseFileNodes = (previous: FileNode[] | undefined, next: FileNode[]): FileNode[] => {
  if (!previous || previous.length !== next.length) return next;
  for (let index = 0; index < next.length; index += 1) {
    if (!sameNode(previous[index], next[index])) return next;
  }
  return previous;
};
