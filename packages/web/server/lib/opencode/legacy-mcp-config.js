import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { z } from 'zod';
import { AGENT_FAMILY } from '../agent/constants.js';
import { LEGACY_CONFIG_KIND, parseLegacyConfig } from './legacy-config.js';
import { getLegacyMcpSource, readLegacyConfigLayers } from './legacy-config-layers.js';
import { supportsLegacyStream } from './legacy-contract.js';

const FIELD = Object.freeze({ MCP: 'mcp', NAME: 'name', SCOPE: 'scope', READ_ONLY: 'readOnly', USER: 'user', PROJECT: 'project', LOCAL: 'local', REMOTE: 'remote', TYPE: 'type', ENV: 'env', HOME: 'HOME', USERPROFILE: 'USERPROFILE' });
const FORMAT = Object.freeze({ JSON: 'opencode.json', TEMP_PREFIX: '.legacy-mcp-' });
const recordSchema = z.record(z.string(), z.json());
const requestSchema = z.record(z.string(), z.json());
const contextSchema = z.object({ id: z.symbol(), env: z.record(z.string(), z.string().optional()), cwd: z.string() });
const VALID_NAME = /^[a-z0-9_-]+$/;

function failure(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
function bad() { return failure(400, 'Invalid MCP configuration'); }
function unsupported() { return failure(501, 'Legacy MCP definition is read-only'); }
function safeRead() { return failure(500, 'Unable to read MCP configuration'); }
function ioFailure(error) { return error?.statusCode ? error : safeRead(); }
function current(input) {
  const parsed = contextSchema.safeParse(input.getNativeConfigContext());
  if (!parsed.success) return null;
  return { id: parsed.data.id, env: { ...parsed.data.env }, cwd: parsed.data.cwd };
}
function same(left, right) {
  return Boolean(left && right && left.id === right.id);
}
function nativeHome(env) {
  const home = process.platform === 'win32' ? env[FIELD.USERPROFILE] : env[FIELD.HOME];
  return path.resolve(home || os.homedir());
}
function safeEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}
function validateRequest(body) {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) throw bad();
  const value = { ...parsed.data };
  delete value[FIELD.NAME];
  delete value[FIELD.SCOPE];
  delete value[FIELD.READ_ONLY];
  return value;
}
function equal(a, b) { return isDeepStrictEqual(a, b); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function entryStructure(value) {
  if (Array.isArray(value)) return value.map(entryStructure);
  if (recordSchema.safeParse(value).success) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, entryStructure(child)]));
  if (z.string().safeParse(value).success) return 'string';
  if (z.number().safeParse(value).success) return 'number';
  if (z.boolean().safeParse(value).success) return 'boolean';
  return 'null';
}
function merge(base, override) {
  const left = recordSchema.safeParse(base);
  const right = recordSchema.safeParse(override);
  if (!left.success || !right.success) return clone(override);
  return Object.entries(right.data).reduce((result, [key, value]) => ({
    ...result,
    [key]: recordSchema.safeParse(value).success && recordSchema.safeParse(result[key]).success
      ? merge(result[key], value) : clone(value),
  }), { ...left.data });
}
function rawMcp(layer) {
  const document = parseDoc(layer.raw ?? '');
  const parsed = recordSchema.safeParse(document[FIELD.MCP] ?? {});
  if (!parsed.success) throw bad();
  return parsed.data;
}
function mergedRawMcp(layers) {
  return layers.reduce((result, layer) => merge(result, rawMcp(layer)), {});
}
function parseDoc(raw) {
  if (raw === '') return {};
  const errors = [];
  const value = parseJsonc(raw, errors, { allowTrailingComma: true });
  const parsed = recordSchema.safeParse(value);
  if (errors.length || !parsed.success) throw bad();
  return parsed.data;
}
function deepDiff(target, currentValue, desired) {
  if (equal(currentValue, desired)) return clone(target);
  if (!recordSchema.safeParse(currentValue).success || !recordSchema.safeParse(desired).success) return clone(desired);
  const result = {};
  for (const [key, value] of Object.entries(target)) {
    if (Object.hasOwn(desired, key)) result[key] = deepDiff(value, currentValue[key], desired[key]);
  }
  for (const [key, value] of Object.entries(desired)) {
    if (!Object.hasOwn(currentValue, key)) result[key] = clone(value);
    else if (!Object.hasOwn(target, key) && !equal(currentValue[key], value)) result[key] = clone(value);
  }
  return result;
}
function editRaw(raw, name, entry, remove) {
  const document = parseDoc(raw);
  const mcp = recordSchema.safeParse(document[FIELD.MCP]);
  if (document[FIELD.MCP] !== undefined && !mcp.success) throw bad();
  const edits = modify(raw, [FIELD.MCP, name], remove ? undefined : entry, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: raw.includes('\r\n') ? '\r\n' : '\n' } });
  return applyEdits(raw, edits);
}
function parseExpanded(entry) {
  try { return parseLegacyConfig(LEGACY_CONFIG_KIND.MCP, entry); }
  catch { throw bad(); }
}
function identity(input, snapshot) {
  const runtime = input.getRuntime();
  return Boolean(snapshot && runtime && supportsLegacyStream(runtime)
    && runtime.generation === snapshot.generation && runtime.profile === snapshot.profile
    && runtime.version === snapshot.version && runtime.endpoint === snapshot.endpoint && runtime.epoch === snapshot.epoch);
}
function capture(input) {
  const owner = current(input);
  const runtime = input.getRuntime();
  const backend = input.getBackendSelection?.();
  if (!owner || !supportsLegacyStream(runtime)) throw unsupported();
  if (input.getBackendSelection && (!backend || backend.family !== AGENT_FAMILY.OPENCODE)) throw unsupported();
  return { owner, backend: backend ? { family: backend.family, revision: backend.revision } : null, generation: runtime.generation, profile: runtime.profile, version: runtime.version, endpoint: runtime.endpoint, epoch: runtime.epoch };
}
function check(input, snapshot) {
  const backend = input.getBackendSelection?.();
  if (!same(current(input), snapshot.owner) || !identity(input, snapshot)
    || input.getBackendSelection && (!backend || backend.family !== snapshot.backend?.family || backend.revision !== snapshot.backend?.revision)) {
    throw failure(409, 'OpenCode configuration owner changed');
  }
}
async function readState(input, snapshot, directory, replacement) {
  const result = await input.operations.getLegacyConfiguration({ directory });
  check(input, snapshot);
  if (result.generation !== snapshot.generation || result.profile !== snapshot.profile || result.version !== snapshot.version
    || result.endpoint !== snapshot.endpoint || result.epoch !== snapshot.epoch) throw failure(409, 'OpenCode configuration owner changed');
  const paths = result.data.paths;
  const layerResult = await readLegacyConfigLayers({ paths, env: safeEnv(snapshot.owner.env), cwd: snapshot.owner.cwd, nativeHome: nativeHome(snapshot.owner.env) }, replacement ? { replacement } : undefined);
  check(input, snapshot);
  return { result, layerResult };
}
function rawView(layers) {
  try { return mergedRawMcp(layers); }
  catch (error) { if (error.statusCode === 400) return null; throw error; }
}
function record(layers, name, expanded, raw = rawView(layers)) {
  const source = getLegacyMcpSource(layers, name);
  const rawEntry = raw?.[name];
  const isReadOnly = !source || !source.writable || source.scope !== FIELD.USER && source.scope !== FIELD.PROJECT;
  parseExpanded(expanded);
  let value = rawEntry ?? expanded;
  let readOnly = isReadOnly || raw === null;
  if (raw !== null) {
    const validRaw = (() => { try { parseExpanded(rawEntry); return true; } catch { return false; } })();
    if (!validRaw || !equal(entryStructure(rawEntry), entryStructure(expanded))) { value = expanded; readOnly = true; }
  }
  const scope = source?.scope === FIELD.USER || source?.scope === FIELD.PROJECT ? source.scope : null;
  return { ...clone(value), [FIELD.NAME]: name, [FIELD.SCOPE]: scope, [FIELD.READ_ONLY]: readOnly };
}
function projectPath(directory) { return path.join(directory, '.opencode', FORMAT.JSON); }
function targetFor(result, directory, source, create) {
  if (create) return source === FIELD.USER ? result.layerResult.userPath : projectPath(directory);
  if (!source || !source.writable || source.scope !== FIELD.USER && source.scope !== FIELD.PROJECT || !source.path) throw unsupported();
  return source.path;
}
function rawFor(layers, file) { return layers.find((layer) => layer.path === file)?.raw ?? ''; }
function commit(input, snapshot, file, original, raw, existed) {
  check(input, snapshot);
  let mode = 0o600;
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw unsupported();
    if (!stat.isFile()) throw safeRead();
    if (!existed || fs.readFileSync(file, 'utf8') !== original) throw failure(409, 'MCP configuration changed externally');
    mode = stat.mode & 0o777;
  } catch (error) {
    if (error.code !== 'ENOENT') throw ioFailure(error);
    if (existed) throw failure(409, 'MCP configuration changed externally');
  }
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (error) { throw ioFailure(error); }
  const temp = path.join(path.dirname(file), `${FORMAT.TEMP_PREFIX}${randomUUID()}`);
  try {
    fs.writeFileSync(temp, raw, { flag: 'wx', mode });
    check(input, snapshot);
    fs.renameSync(temp, file);
  } catch (error) {
    throw ioFailure(error);
  } finally {
    try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw safeRead(); }
  }
}
function validateEntry(name, entry) {
  if (!VALID_NAME.test(name)) throw bad();
  return parseExpanded(entry);
}

export function createLegacyMcpConfig(input) {
  const list = async (directory) => {
    const snapshot = capture(input);
    const { layerResult } = await readState(input, snapshot, directory);
    const raw = rawView(layerResult.layers);
    return Object.entries(layerResult.mergedMcp).map(([name, entry]) => record(layerResult.layers, name, entry, raw));
  };
  const get = async (name, directory) => {
    if (!VALID_NAME.test(name)) throw bad();
    const snapshot = capture(input);
    const { layerResult } = await readState(input, snapshot, directory);
    if (!Object.hasOwn(layerResult.mergedMcp, name)) return null;
    return record(layerResult.layers, name, layerResult.mergedMcp[name]);
  };
  const save = async (name, body, directory, scope, creating) => {
    const submitted = validateRequest(body);
    if (!VALID_NAME.test(name)) throw bad();
    const snapshot = capture(input);
    const { layerResult } = await readState(input, snapshot, directory);
    const expandedCurrent = layerResult.mergedMcp[name];
    const rawCurrent = mergedRawMcp(layerResult.layers)[name];
    const source = getLegacyMcpSource(layerResult.layers, name);
    if (creating && expandedCurrent !== undefined) throw failure(409, 'MCP definition already exists');
    if (!creating && expandedCurrent === undefined) throw failure(404, 'MCP definition not found');
    const view = source ? record(layerResult.layers, name, expandedCurrent) : null;
    if (view?.[FIELD.READ_ONLY]) throw unsupported();
    const next = creating ? submitted : { ...rawCurrent };
    if (!creating) {
      for (const [key, value] of Object.entries(submitted)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
    }
    const desiredRaw = validateEntry(name, next);
    let target;
    if (creating) {
      if (scope !== FIELD.USER && scope !== FIELD.PROJECT) throw bad();
      if (scope === FIELD.PROJECT && (snapshot.owner.env.OPENCODE_DISABLE_PROJECT_CONFIG === 'true' || snapshot.owner.env.OPENCODE_DISABLE_PROJECT_CONFIG === '1')) throw unsupported();
      target = targetFor({ layerResult }, directory, scope, true);
    } else {
      target = targetFor({ layerResult }, directory, source, false);
    }
    const raw = rawFor(layerResult.layers, target);
    const existed = layerResult.layers.some((layer) => layer.path === target);
    const ownRawEntry = creating ? desiredRaw : deepDiff(rawMcp(source)[name], rawCurrent, desiredRaw);
    const nextRaw = editRaw(raw, name, ownRawEntry, false);
    const projected = await readState(input, snapshot, directory, { path: target, raw: nextRaw });
    const actualRaw = mergedRawMcp(projected.layerResult.layers)[name];
    const actual = projected.layerResult.mergedMcp[name];
    check(input, snapshot);
    parseExpanded(actual);
    if (!equal(actualRaw, desiredRaw)) throw bad();
    commit(input, snapshot, target, raw, nextRaw, existed);
    return { saved: true };
  };
  return {
    list,
    get,
    create: (name, body, directory, scope) => save(name, body, directory, scope, true),
    update: (name, body, directory) => save(name, body, directory, undefined, false),
    remove: async (name, directory) => {
      if (!VALID_NAME.test(name)) throw bad();
      const snapshot = capture(input);
      const { layerResult } = await readState(input, snapshot, directory);
      const source = getLegacyMcpSource(layerResult.layers, name);
      if (!source) throw failure(404, 'MCP definition not found');
      if (record(layerResult.layers, name, layerResult.mergedMcp[name])[FIELD.READ_ONLY]) throw unsupported();
      const target = targetFor({ layerResult }, directory, source, false);
      const original = rawFor(layerResult.layers, target);
      const existed = layerResult.layers.some((layer) => layer.path === target);
      const nextRaw = editRaw(original, name, undefined, true);
      const projected = await readState(input, snapshot, directory, { path: target, raw: nextRaw });
      const revealed = Object.hasOwn(projected.layerResult.mergedMcp, name);
      check(input, snapshot);
      commit(input, snapshot, target, original, nextRaw, existed);
      return { revealed };
    },
  };
}
