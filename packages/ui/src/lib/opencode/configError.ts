import { z } from 'zod';

/** A project config OpenCode refused to load; this is transient UI state, not a connection failure. */
export type ProjectConfigError = {
  name: string;
  path: string | undefined;
  message: string;
};

const CONFIG_ERROR_NAMES = new Set([
  'ConfigInvalidError',
  'ConfigJsonError',
  'ConfigFrontmatterError',
  'ConfigDirectoryTypoError',
]);

const issueSchema = z.object({ message: z.string(), path: z.array(z.string()).optional() });
const namedConfigErrorSchema = z.object({
  name: z.string(),
  data: z.object({
    path: z.string().optional(),
    message: z.string().optional(),
    issues: z.array(issueSchema).optional(),
    dir: z.string().optional(),
    suggestion: z.string().optional(),
  }),
});
const causeCarrierSchema = z.object({ cause: z.unknown() });

const describe = (data: z.infer<typeof namedConfigErrorSchema>['data']): string => {
  const issues = (data.issues ?? [])
    .map((issue) => {
      const message = issue.message.trim();
      return issue.path && issue.path.length > 0 ? `${issue.path.join('.')}: ${message}` : message;
    })
    .filter((line) => line.length > 0);
  if (issues.length > 0) return issues.join('\n');
  const message = data.message?.trim() ?? '';
  if (message.length > 0) return message;
  if (data.dir && data.suggestion) return `${data.dir} → ${data.suggestion}`;
  return '';
};

/** Finds a named OpenCode config error in the generated client's error/cause chain. */
export function readProjectConfigError(cause: unknown): ProjectConfigError | null {
  let current: unknown = cause;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    const named = namedConfigErrorSchema.safeParse(current);
    if (named.success && CONFIG_ERROR_NAMES.has(named.data.name)) {
      const path = named.data.data.path;
      return {
        name: named.data.name,
        path: path && path !== 'config' ? path : undefined,
        message: describe(named.data.data),
      };
    }
    const carrier = causeCarrierSchema.safeParse(current);
    current = carrier.success ? carrier.data.cause : null;
  }
  return null;
}

export const isSameProjectConfigError = (a: ProjectConfigError | undefined, b: ProjectConfigError | undefined): boolean => (
  a === b || (a !== undefined && b !== undefined && a.name === b.name && a.path === b.path && a.message === b.message)
);
