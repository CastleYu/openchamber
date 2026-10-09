import fs from 'node:fs';
import path from 'node:path';

const PATH_ERROR = 'Skill supporting file must stay inside its Skill directory';
const outside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
};

const resolveFile = (skillDir: string, relativePath: string): string => {
  if (!relativePath || relativePath.includes('\0') || relativePath.includes(':')
    || path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(PATH_ERROR);
  }
  const root = path.resolve(skillDir);
  const full = path.resolve(root, relativePath.replace(/\\/g, '/'));
  if (full === root || outside(root, full)) throw new Error(PATH_ERROR);
  const realRoot = fs.realpathSync(root);
  let current = root;
  for (const part of path.relative(root, full).split(path.sep)) {
    current = path.join(current, part);
    try {
      fs.lstatSync(current);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') break;
      throw error;
    }
    if (outside(realRoot, fs.realpathSync(current))) throw new Error(PATH_ERROR);
  }
  return full;
};

export const readSkillSupportingFile = (skillDir: string, relativePath: string): string | null => {
  const full = resolveFile(skillDir, relativePath);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
};

export const writeSkillSupportingFile = (skillDir: string, relativePath: string, content: string): void => {
  const full = resolveFile(skillDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
};

export const deleteSkillSupportingFile = (skillDir: string, relativePath: string): void => {
  const full = resolveFile(skillDir, relativePath);
  if (!fs.existsSync(full)) return;
  fs.unlinkSync(full);
  const root = path.resolve(skillDir);
  let parent = path.dirname(full);
  while (parent !== root) {
    try {
      if (fs.readdirSync(parent).length) break;
      fs.rmdirSync(parent);
      parent = path.dirname(parent);
    } catch {
      break;
    }
  }
};
