import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { z } from 'zod';
import { AGENT_FAMILY } from '../agent/constants.js';
import { readLegacyConfigLayers } from './legacy-config-layers.js';
import { supportsLegacyStream } from './legacy-contract.js';

const FIELD = Object.freeze({ PROVIDER: 'provider', HOME: 'USERPROFILE' });
const STATUS = Object.freeze({ INVALID: 400, CHANGED: 409, READ: 500, UNSUPPORTED: 501 });
const CREDENTIAL = Object.freeze({ RETAINED: 'retained', REMOVED: 'removed', UNKNOWN: 'unknown', ABSENT: 'absent' });
const nativeSchema = z.object({ id: z.symbol(), env: z.record(z.string(), z.string().optional()), cwd: z.string() });
const objectSchema = z.record(z.string(), z.json());
const nameSchema = z.string().min(1).max(256);
const evidenceSchema = z.object({ providerIds: z.array(z.string()), hasPlugins: z.boolean(), providerEnv: z.record(z.string(), z.array(z.string())) });
const RESIDUAL = Object.freeze({ ENV: 'environment', REMOTE: 'remote-config', PLUGINS: 'plugins', EFFECTIVE: 'effective-config' });
const APPLICATION = Object.freeze({ MATCHES: 'matches-persisted', PENDING: 'pending-restart', UNKNOWN: 'unknown' });

function failure(statusCode, message) { return Object.assign(new Error(message), { statusCode }); }
function changed() { return failure(STATUS.CHANGED, 'OpenCode provider owner changed'); }
function unsupported() { return failure(STATUS.UNSUPPORTED, 'Native Legacy provider operation is unavailable'); }
function ioFailure() { return failure(STATUS.READ, 'Unable to access provider configuration'); }
function native(input) {
  const parsed = nativeSchema.safeParse(input.getNativeConfigContext());
  return parsed.success ? { ...parsed.data, env: { ...parsed.data.env } } : null;
}
function capture(input) {
  const owner = native(input);
  const runtime = input.getRuntime();
  const backend = input.getBackendSelection();
  if (process.platform !== 'win32' || !owner || !path.isAbsolute(owner.cwd)
    || !owner.env[FIELD.HOME] || !path.isAbsolute(owner.env[FIELD.HOME])
    || !supportsLegacyStream(runtime) || backend.family !== AGENT_FAMILY.OPENCODE) throw unsupported();
  return { owner, runtime: { ...runtime }, family: backend.family, revision: backend.revision };
}
function check(input, snapshot) {
  const owner = native(input);
  const runtime = input.getRuntime();
  const backend = input.getBackendSelection();
  if (!owner || owner.id !== snapshot.owner.id || owner.cwd !== snapshot.owner.cwd
    || !supportsLegacyStream(runtime) || runtime.generation !== snapshot.runtime.generation
    || runtime.profile !== snapshot.runtime.profile || runtime.version !== snapshot.runtime.version
    || runtime.endpoint !== snapshot.runtime.endpoint || runtime.epoch !== snapshot.runtime.epoch
    || backend.family !== snapshot.family || backend.revision !== snapshot.revision) throw changed();
}
function document(raw) {
  const errors = [];
  const parsed = objectSchema.safeParse(parseJsonc(raw, errors, { allowTrailingComma: true }));
  if (errors.length || !parsed.success) throw failure(STATUS.INVALID, 'Invalid provider configuration');
  return parsed.data;
}
function providers(config) {
  const parsed = objectSchema.safeParse(config[FIELD.PROVIDER] ?? {});
  if (!parsed.success) throw failure(STATUS.INVALID, 'Invalid provider configuration');
  return parsed.data;
}
function definitions(layers, name) {
  return layers.filter(layer => Object.hasOwn(providers(layer.config), name)).map(layer => {
    let represented = false;
    try { represented = Object.hasOwn(providers(document(layer.raw)), name); } catch { /* Expanded-only definitions are read-only. */ }
    return { layer, writable: layer.writable && represented && layer.path !== null };
  });
}
function merge(base, override) {
  const left = objectSchema.safeParse(base);
  const right = objectSchema.safeParse(override);
  if (!left.success || !right.success) return override;
  return Object.fromEntries([...new Set([...Object.keys(left.data), ...Object.keys(right.data)])]
    .map(key => [key, Object.hasOwn(right.data, key) ? merge(left.data[key], right.data[key]) : left.data[key]]));
}
async function read(input, snapshot, directory, name, signal, pending) {
  try {
    const result = await input.operations.getLegacyConfiguration({ directory, signal });
    check(input, snapshot);
    const runtime = snapshot.runtime;
    if (result.generation !== runtime.generation || result.profile !== runtime.profile
      || result.version !== runtime.version || result.endpoint !== runtime.endpoint || result.epoch !== runtime.epoch) throw changed();
    const context = snapshot.owner;
    const { layers } = await readLegacyConfigLayers({ paths: result.data.paths,
      env: Object.fromEntries(Object.entries(context.env).filter(([, value]) => value !== undefined)),
      cwd: context.cwd, nativeHome: context.env[FIELD.HOME] });
    check(input, snapshot);
    const credentials = await input.credentials.read();
    check(input, snapshot);
    const evidence = evidenceSchema.safeParse(result.data);
    if (!evidence.success) throw ioFailure();
    const residuals = [];
    if ((evidence.data.providerEnv[name] ?? []).some(key => Boolean(context.env[key]))) residuals.push(RESIDUAL.ENV);
    if (Object.values(credentials).some(entry => entry.type === 'wellknown')) residuals.push(RESIDUAL.REMOTE);
    if (evidence.data.hasPlugins) residuals.push(RESIDUAL.PLUGINS);
    const known = definitions(layers, name);
    const local = layers.reduce((value, layer) => merge(value, providers(layer.config)), {});
    const comparisonInput = { providerID: name, value: local[name], directory, signal, expectedIdentity: snapshot.runtime };
    if (pending) comparisonInput.baseline = { value: pending.baseline };
    const comparison = await input.operations.compareLegacyProvider(comparisonInput);
    check(input, snapshot);
    const sameLayers = pending?.layers === JSON.stringify(layers.map(layer => ({ path: layer.path, scope: layer.scope,
      origin: layer.origin, order: layer.order, raw: layer.raw })));
    const pendingKnown = sameLayers && comparison.data.matchesBaseline;
    if ((!comparison.data.matchesPersisted || comparison.data.present !== (known.length > 0)) && !pendingKnown) residuals.push(RESIDUAL.EFFECTIVE);
    const entries = known.map(entry => {
      if (!entry.writable) return entry;
      try { preflight({ file: entry.layer.path, original: entry.layer.raw }); return entry; }
      catch (error) { if (error.statusCode === STATUS.CHANGED) throw error; return { ...entry, writable: false }; }
    });
    return { layers, definitions: entries, auth: Object.hasOwn(credentials, name), residuals, comparison: comparison.data, local };
  } catch (error) {
    check(input, snapshot);
    signal?.throwIfAborted();
    throw failure(error.statusCode || STATUS.READ, 'Unable to inspect provider sources');
  }
}
function source({ layer, writable }) {
  return { path: layer.path, scope: layer.scope, origin: layer.origin, order: layer.order, writable };
}
function preflight(target) {
  try {
    const stat = fs.lstatSync(target.file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw unsupported();
    if (fs.readFileSync(target.file, 'utf8') !== target.original) throw failure(STATUS.CHANGED, 'Provider configuration changed externally');
    fs.accessSync(target.file, fs.constants.W_OK);
    fs.accessSync(path.dirname(target.file), fs.constants.W_OK);
    return stat.mode & 0o777;
  } catch (error) { throw error.statusCode ? error : ioFailure(); }
}
function commit(input, snapshot, target) {
  check(input, snapshot);
  const mode = preflight(target);
  const temp = path.join(path.dirname(target.file), `.legacy-provider-${randomUUID()}`);
  try {
    fs.writeFileSync(temp, target.next, { flag: 'wx', mode });
    check(input, snapshot);
    preflight(target);
    fs.renameSync(temp, target.file);
  } catch (error) { throw error.statusCode ? error : ioFailure(); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

export function createLegacyProviderConfig(input) {
  const evidence = new Map();
  const credentialUnknown = new Map();
  const locks = new Set();
  const ownerIds = new Map();
  let nextOwnerId = 0;
  const keyRevisions = new Map();
  let generation = 0;
  let credentialGeneration = 0;
  const revisionOf = key => keyRevisions.get(key) ?? 0;
  const bump = key => keyRevisions.set(key, revisionOf(key) + 1);
  const identityKey = snapshot => {
    if (!ownerIds.has(snapshot.owner.id)) ownerIds.set(snapshot.owner.id, nextOwnerId++);
    return `${ownerIds.get(snapshot.owner.id)}\0${snapshot.owner.cwd}\0${snapshot.runtime.generation}\0${snapshot.runtime.profile ?? ''}\0${snapshot.runtime.version}\0${snapshot.runtime.endpoint}\0${snapshot.runtime.epoch}\0${snapshot.family}\0${snapshot.revision}`;
  };
  const operationKey = (snapshot, directory, name) => `${identityKey(snapshot)}\0${path.resolve(directory ?? snapshot.owner.cwd)}\0${name}`;
  const stateKey = layers => JSON.stringify(layers.map(({ layer }) => ({ path: layer.path, scope: layer.scope, origin: layer.origin, order: layer.order, raw: layer.raw })));
  const ownerKey = snapshot => {
    if (!ownerIds.has(snapshot.owner.id)) ownerIds.set(snapshot.owner.id, nextOwnerId++);
    return `${ownerIds.get(snapshot.owner.id)}\0${snapshot.owner.cwd}`;
  };
  const credentialKey = (snapshot, name) => ownerKey(snapshot) + '\0' + name;
  const clear = (freshOwner = false) => { evidence.clear(); if (freshOwner) { credentialUnknown.clear(); credentialGeneration += 1; } keyRevisions.clear(); generation += 1; };
  return {
    clear,
    async sources(name, directory) {
      if (!nameSchema.safeParse(name).success) throw failure(STATUS.INVALID, 'Invalid provider ID');
      const snapshot = capture(input);
      const key = operationKey(snapshot, directory, name);
      const startGeneration = generation;
      const startRevision = revisionOf(key);
      const pending = evidence.get(key);
      const state = await read(input, snapshot, directory, name, undefined, pending);
      let application = APPLICATION.MATCHES;
      if (pending) {
        const sameLayers = pending.layers === stateKey(state.layers.map(layer => ({ layer })));
        const sameBaseline = state.comparison.matchesBaseline;
        if (generation === startGeneration && revisionOf(key) === startRevision && state.comparison.matchesPersisted) { evidence.delete(key); bump(key); }
        else if (generation === startGeneration && revisionOf(key) === startRevision && sameLayers && sameBaseline) application = APPLICATION.PENDING;
        else if (generation === startGeneration && revisionOf(key) === startRevision) { evidence.delete(key); bump(key); }
      }
      if (!pending && !state.comparison.matchesPersisted) {
        application = APPLICATION.UNKNOWN;
        if (!state.residuals.includes(RESIDUAL.EFFECTIVE)) state.residuals.push(RESIDUAL.EFFECTIVE);
      } else if (pending && application === APPLICATION.MATCHES && !state.comparison.matchesPersisted) {
        application = APPLICATION.UNKNOWN;
        if (!state.residuals.includes(RESIDUAL.EFFECTIVE)) state.residuals.push(RESIDUAL.EFFECTIVE);
      }
      return { providerId: name, layers: state.definitions.map(source), auth: { exists: state.auth },
        complete: state.residuals.length === 0, residuals: state.residuals, application: { configuration: application } };
    },
    async disconnect(name, directory, signal) {
      if (!nameSchema.safeParse(name).success) throw failure(STATUS.INVALID, 'Invalid provider ID');
      const snapshot = capture(input);
      const key = operationKey(snapshot, directory, name);
      const unknownKey = credentialKey(snapshot, name);
      if (locks.has(unknownKey)) throw failure(STATUS.CHANGED, 'Provider disconnect is already running');
      if (credentialUnknown.has(unknownKey)) {
        const error = failure(STATUS.CHANGED, 'Provider credential outcome is unknown for this owner');
        error.outcome = credentialUnknown.get(unknownKey);
        throw error;
      }
      const operationGeneration = generation;
      const operationCredentialGeneration = credentialGeneration;
      locks.add(unknownKey);
      try {
        signal?.throwIfAborted();
        const pending = evidence.get(key);
        const state = await read(input, snapshot, directory, name, signal, pending);
        const baseline = state.comparison.matchesPersisted ? state.local[name] : pending?.baseline;
        signal?.throwIfAborted();
        if (state.residuals.length > 0 || state.definitions.some(entry => !entry.writable)) throw unsupported();
        const targets = new Map();
        for (const { layer } of state.definitions) {
          if (targets.has(layer.path)) continue;
          const edits = modify(layer.raw, [FIELD.PROVIDER, name], undefined, {
            formattingOptions: { insertSpaces: true, tabSize: 2, eol: layer.raw.includes('\r\n') ? '\r\n' : '\n' },
          });
          targets.set(layer.path, { file: layer.path, original: layer.raw, next: applyEdits(layer.raw, edits) });
        }
        const changedTargets = [...targets.values()].filter(target => target.next !== target.original);
        for (const target of targets.values()) preflight(target);
        check(input, snapshot);
        const removed = [];
        const committed = new Map();
        let credential = state.auth ? CREDENTIAL.RETAINED : CREDENTIAL.ABSENT;
        try {
          for (const target of changedTargets) { signal?.throwIfAborted(); commit(input, snapshot, target); removed.push(target.file); committed.set(target.file, target.next); }
          if (state.auth) {
            check(input, snapshot);
            signal?.throwIfAborted();
            credential = CREDENTIAL.UNKNOWN;
            const result = await input.operations.removeLegacyCredential({ providerID: name, directory, signal, expectedIdentity: snapshot.runtime });
            if (result !== true) throw ioFailure();
            check(input, snapshot);
            credential = CREDENTIAL.REMOVED;
          }
          check(input, snapshot);
          const expected = state.layers.map(layer => ({ layer: { ...layer, raw: committed.get(layer.path) ?? layer.raw } }));
          if (generation === operationGeneration && changedTargets.length === 0 && state.comparison.matchesPersisted) {
            evidence.delete(key);
            bump(key);
          } else if (generation === operationGeneration && changedTargets.length > 0) {
            evidence.set(key, { baseline, layers: stateKey(expected) });
            bump(key);
          }
          return { persisted: true, requiresRestart: true, removed, credential,
            application: { configuration: evidence.has(key) ? APPLICATION.PENDING : APPLICATION.MATCHES } };
        } catch (error) {
          let status = error.statusCode || STATUS.READ;
          let ownerCurrent = true;
          try { check(input, snapshot); } catch { status = STATUS.CHANGED; ownerCurrent = false; }
          const currentRevision = generation === operationGeneration;
          const currentOwner = ownerCurrent && generation === operationGeneration;
          if (removed.length && currentOwner) {
            const expected = state.layers.map(layer => ({ layer: { ...layer, raw: committed.get(layer.path) ?? layer.raw } }));
            evidence.set(key, { baseline, layers: stateKey(expected) });
            bump(key);
          }
          const outcome = { persisted: false, partial: removed.length > 0 || credential === CREDENTIAL.UNKNOWN,
            requiresRestart: removed.length > 0 || credential === CREDENTIAL.UNKNOWN,
            removed, remaining: [...targets.keys()].filter(file => !removed.includes(file)), credential };
          if (credential === CREDENTIAL.UNKNOWN && credentialGeneration === operationCredentialGeneration) credentialUnknown.set(unknownKey, outcome);
          throw Object.assign(failure(status, 'Provider disconnect did not complete'), { outcome });
        }
      } finally {
        locks.delete(unknownKey);
      }
    },
  };
}
