import { z } from 'zod';

export const absoluteDirectorySchema = z.string().trim().min(1).refine((value) =>
  [...value].every((char) => char.charCodeAt(0) >= 32) && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(value)),
'ACP project and working directories must be absolute');

export const projectMappingsSchema = z.array(z.object({
  directory: absoluteDirectorySchema,
  cwd: absoluteDirectorySchema,
})).superRefine((values, ctx) => {
  const directories = new Set();
  values.forEach((value, index) => {
    if (directories.has(value.directory)) ctx.addIssue({ code: 'custom', message: 'Each ACP project directory needs one mapping', path: [index, 'directory'] });
    directories.add(value.directory);
  });
});

/** Exact project matches only; a child project keeps the configured default. */
export const resolveProjectCwd = (config, directory) =>
  config.projectMappings?.find((value) => value.directory === directory)?.cwd ?? config.cwd;
