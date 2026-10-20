import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import { z } from 'zod';

const CONFIG_FILE = Object.freeze({ JSONC: 'opencode.jsonc', JSON: 'opencode.json', LEGACY: 'config.json' });
const ENV = Object.freeze({ CONFIG: 'OPENCODE_CONFIG', DISABLE_PROJECT: 'OPENCODE_DISABLE_PROJECT_CONFIG', CONFIG_DIR: 'OPENCODE_CONFIG_DIR', CONTENT: 'OPENCODE_CONFIG_CONTENT', MANAGED_DIR: 'OPENCODE_TEST_MANAGED_CONFIG_DIR' });
const SCOPE = Object.freeze({ USER: 'user', PROJECT: 'project', INLINE: 'inline', MANAGED: 'managed' });
const ORIGIN = Object.freeze({ GLOBAL: 'global', EXPLICIT_CONFIG: 'explicit-config', PROJECT_ROOT: 'project-root', DOT_DIRECTORY: 'dot-directory', EXPLICIT_CONFIG_DIR: 'explicit-config-dir', INLINE: 'inline', MANAGED: 'managed' });
const FILES = Object.freeze([CONFIG_FILE.JSONC, CONFIG_FILE.JSON]);
const GLOBAL = Object.freeze([CONFIG_FILE.LEGACY, CONFIG_FILE.JSON, CONFIG_FILE.JSONC]);
const MCP = 'mcp';
const objectSchema = z.record(z.string(), z.json());
const inputSchema = z.object({
  paths: z.object({ config: z.string(), home: z.string(), directory: z.string(), worktree: z.string() }),
  env: z.record(z.string(), z.string()),
  cwd: z.string(),
  nativeHome: z.string(),
});

function badConfig() {
  return Object.assign(new Error('Invalid OpenCode configuration'), { statusCode: 400 });
}

function safeReadError() {
  return Object.assign(new Error('Unable to read OpenCode configuration'), { statusCode: 500 });
}

function validateInputs(input) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success || Object.values(parsed.data.paths).some((value) => !path.isAbsolute(value))
    || !path.isAbsolute(parsed.data.cwd) || !path.isAbsolute(parsed.data.nativeHome)) {
    throw new TypeError('Invalid child OpenCode path context');
  }
  return {
    ...parsed.data,
    paths: Object.fromEntries(Object.entries(parsed.data.paths).map(([key, value]) => [key, path.resolve(value)])),
  };
}
async function substitute(text, base, env, nativeHome) {
  const expanded = text.replace(/\{env:([^}]+)\}/g, (_match, name) => env[name] ?? '');
  let output = '';
  let cursor = 0;
  for (const match of expanded.matchAll(/\{file:([^}]+)\}/g)) {
    output += expanded.slice(cursor, match.index);
    const lineStart = expanded.lastIndexOf('\n', match.index - 1) + 1;
    const prefix = expanded.slice(lineStart, match.index).trimStart();
    if (prefix.startsWith('//')) {
      output += match[0];
    } else {
      const name = match[1];
      const target = name.startsWith('~/') ? path.join(nativeHome, name.slice(2)) : path.resolve(base, name);
      let replacement;
      try {
        replacement = (await fs.readFile(target, 'utf8')).trim();
      } catch {
        throw badConfig();
      }
      output += JSON.stringify(replacement).slice(1, -1);
    }
    cursor = match.index + match[0].length;
  }
  return output + expanded.slice(cursor);
}

function parseConfig(text, empty = false) {
  const errors = [];
  const parsed = objectSchema.safeParse(empty ? {} : parseJsonc(text, errors, { allowTrailingComma: true }));
  if (errors.length || !parsed.success) throw badConfig();
  const mcp = parsed.data[MCP];
  if (mcp !== undefined && !objectSchema.safeParse(mcp).success) throw badConfig();
  return parsed.data;
}

async function readFile(file, scope, origin, order, env, nativeHome) {
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw safeReadError();
  }
  const expanded = await substitute(raw, path.dirname(file), env, nativeHome);
  const config = parseConfig(expanded, raw === '');
  return { path: file, scope, writable: scope === SCOPE.USER || scope === SCOPE.PROJECT, raw, config, origin, order };
}

function dedupe(values) {
  return values.filter((value, index) => values.findIndex((candidate) => candidate.path === value.path) === index);
}

function ancestors(from, stop) {
  const result = [];
  let current = from;
  while (true) {
    result.push(current);
    if (current === stop || path.dirname(current) === current) break;
    current = path.dirname(current);
  }
  return result;
}

function merge(base, override) {
  const left = objectSchema.safeParse(base);
  const right = objectSchema.safeParse(override);
  if (!left.success || !right.success) return override;
  return Object.entries(right.data).reduce((result, [key, value]) => ({
    ...result,
    [key]: merge(Object.hasOwn(result, key) ? result[key] : undefined, value),
  }), { ...left.data });
}

function mergeMcp(layers) {
  return layers.reduce((result, layer) => merge(result, layer.config[MCP] ?? {}), {});
}

export async function readLegacyConfigLayers(input, options = {}) {
  const { paths, env, cwd, nativeHome } = validateInputs(input);
  const replacement = options?.replacement;
  const layers = [];
  const load = async (file, scope, origin) => {
    if (replacement?.path === file) {
      const expanded = await substitute(replacement.raw, path.dirname(file), env, nativeHome);
      const config = parseConfig(expanded, replacement.raw === '');
      layers.push({ path: file, scope, writable: scope === SCOPE.USER || scope === SCOPE.PROJECT, raw: replacement.raw, config, origin, order: layers.length });
      return;
    }
    const result = await readFile(file, scope, origin, layers.length, env, nativeHome);
    if (result) layers.push(result);
  };
  const userFiles = GLOBAL.map((name) => path.join(paths.config, name));
  for (const file of userFiles) await load(file, SCOPE.USER, ORIGIN.GLOBAL);

  const custom = env[ENV.CONFIG] ? path.resolve(cwd, env[ENV.CONFIG]) : null;
  if (custom) await load(custom, SCOPE.USER, ORIGIN.EXPLICIT_CONFIG);

  const projectDisabled = env[ENV.DISABLE_PROJECT] === 'true' || env[ENV.DISABLE_PROJECT] === '1';
  const projectRoots = ancestors(paths.directory, paths.worktree);
  if (!projectDisabled) {
    for (const root of projectRoots.slice().reverse()) await load(path.join(root, CONFIG_FILE.JSONC), SCOPE.PROJECT, ORIGIN.PROJECT_ROOT);
    for (const root of projectRoots.slice().reverse()) await load(path.join(root, CONFIG_FILE.JSON), SCOPE.PROJECT, ORIGIN.PROJECT_ROOT);
  }

  const customDir = env[ENV.CONFIG_DIR] ? path.resolve(cwd, env[ENV.CONFIG_DIR]) : null;
  const projectDirs = projectDisabled ? [] : projectRoots.map((root) => path.join(root, '.opencode'));
  const dirs = dedupe([
    { path: paths.config, scope: SCOPE.USER, origin: ORIGIN.DOT_DIRECTORY },
    ...projectDirs.map((dir) => ({ path: dir, scope: SCOPE.PROJECT, origin: ORIGIN.DOT_DIRECTORY })),
    { path: path.join(paths.home, '.opencode'), scope: SCOPE.USER, origin: ORIGIN.DOT_DIRECTORY },
    ...(customDir ? [{ path: customDir, scope: SCOPE.USER, origin: ORIGIN.EXPLICIT_CONFIG_DIR }] : []),
  ]);
  for (const dir of dirs) {
    if (!dir.path.endsWith('.opencode') && dir.path !== customDir) continue;
    const origin = dir.path === customDir ? ORIGIN.EXPLICIT_CONFIG_DIR : dir.origin;
    for (const name of FILES) await load(path.join(dir.path, name), dir.scope, origin);
  }

  if (env[ENV.CONTENT]?.length) {
    const raw = env[ENV.CONTENT];
    const expanded = await substitute(raw, paths.directory, env, nativeHome);
    const config = parseConfig(expanded);
    layers.push({ path: null, scope: SCOPE.INLINE, writable: false, raw, config, origin: ORIGIN.INLINE, order: layers.length });
  }

  const managedDir = env[ENV.MANAGED_DIR]
    ? path.resolve(cwd, env[ENV.MANAGED_DIR])
    : process.platform === 'win32' ? path.join(env.ProgramData || 'C:\\ProgramData', 'opencode')
      : process.platform === 'darwin' ? '/Library/Application Support/opencode' : '/etc/opencode';
  for (const name of FILES) await load(path.join(managedDir, name), SCOPE.MANAGED, ORIGIN.MANAGED);

  const userCandidates = [userFiles[2], userFiles[1], userFiles[0]];
  let userPath = userFiles[2];
  for (const candidate of userCandidates) {
    try {
      await fs.access(candidate);
      userPath = candidate;
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw safeReadError();
    }
  }
  return { layers, mergedMcp: mergeMcp(layers), userPath };
}

export function getLegacyMcpSource(layers, name) {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (Object.hasOwn(layer.config[MCP] ?? {}, name)) return layer;
  }
  return null;
}
