import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AGENT_FEATURE_RULES } from '../../packages/web/server/lib/agent/features.js';
import { AGENT_MUTATIONS, AGENT_OPERATION, AGENT_SERVER_METHOD } from '../../packages/web/server/lib/agent/constants.js';

export const MAPPING = Object.freeze({
  VERSION: 1,
  CODEC: Object.freeze({ DECLARATIVE: 'declarative', CUSTOM: 'custom' }),
  EFFECT: Object.freeze({ READ: 'read', MUTATION: 'mutation' }),
  OPERATION_KIND: Object.freeze({ MAPPING: 'mapping', UNSUPPORTED: 'unsupported', UNVERIFIED: 'unverified' }),
  ENDPOINT_KIND: Object.freeze({ SHARED: 'shared', EXTENSION: 'extension', OUT_OF_SCOPE: 'out-of-scope' }),
  FIT: Object.freeze({ FORM: 'form-action-result', HOST: 'requires-host-development' }),
  STATE: Object.freeze({ READY: 'mapping-ready', CANDIDATE: 'candidate-ready', BLOCKED: 'blocked', EXTENSION: 'candidate-required' }),
  GATE: Object.freeze({ ACCEPTANCE: 'acceptance-required', INCOMPLETE: 'mapping-incomplete' }),
  CHECK: Object.freeze({ SCHEMA: 'schema', CATALOG: 'catalog-content', EVIDENCE: 'evidence-references', LINKS: 'endpoint-links', EFFECT: 'effect-consistency' }),
  NEXT: Object.freeze({ CATALOG: 'review-catalog', MAPPING: 'complete-mapping', REBIND: 'review-and-rebind-catalog', EVIDENCE: 'cite-reviewed-section', LINKS: 'repair-operation-mapping' }),
  ERROR: Object.freeze({ INVALID_CATALOG: 'invalid-catalog', INVALID_MAPPING: 'invalid-mapping', CATALOG_CHANGED: 'catalog-changed', MISSING_EVIDENCE: 'missing-evidence', INCONSISTENT_MAPPING: 'inconsistent-mapping' }),
});

const id = z.string().min(1).max(96).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const citation = z.object({ document: id, section: id }).strict();
const citations = z.array(citation).min(1).max(32);
const unique = (values) => new Set(values).size === values.length;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const segment = '(?:[A-Za-z0-9._~-]+|\\{[A-Za-z][A-Za-z0-9_]*\\})';
const apiPath = new RegExp(`^/(?:${segment})(?:/${segment})*$`);
const evidence = z.object({
  transport: citations, auth: citations, scope: citations, result: citations,
  failure: citations, completion: citations, cancellation: citations,
}).strict();
const methods = z.enum(Object.values(AGENT_SERVER_METHOD));
const operations = z.enum(Object.values(AGENT_OPERATION));
const opRow = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(MAPPING.OPERATION_KIND.MAPPING), endpointIDs: z.array(id).min(1).max(64), codec: z.enum(Object.values(MAPPING.CODEC)), evidence }).strict(),
  z.object({ kind: z.literal(MAPPING.OPERATION_KIND.UNSUPPORTED), reason: id, citations }).strict(),
  z.object({ kind: z.literal(MAPPING.OPERATION_KIND.UNVERIFIED), question: z.string().trim().min(1).max(500) }).strict(),
]);
const endpointRow = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(MAPPING.ENDPOINT_KIND.SHARED), operations: z.array(operations).min(1).max(Object.keys(AGENT_OPERATION).length) }).strict(),
  z.object({ kind: z.literal(MAPPING.ENDPOINT_KIND.EXTENSION), actionID: z.string().regex(/^cagent\.[A-Za-z0-9][A-Za-z0-9._-]{0,78}$/), fit: z.enum(Object.values(MAPPING.FIT)), citations }).strict(),
  z.object({ kind: z.literal(MAPPING.ENDPOINT_KIND.OUT_OF_SCOPE), reason: id, citations }).strict(),
]);

const sectionSchema = z.array(id).max(128).refine(unique);
export const MAPPING_CATALOG_SCHEMA = z.object({
  version: z.literal(MAPPING.VERSION), revision: id,
  documents: z.array(z.object({ id, revision: id, digest: sha, sections: sectionSchema }).strict()).max(128),
  endpoints: z.array(z.object({ id, method: methods, path: z.string().min(2).max(256).regex(apiPath), requestRef: id, responseRef: id, effect: z.enum(Object.values(MAPPING.EFFECT)), citations }).strict()).max(256),
}).strict().superRefine((catalog, ctx) => {
  if (!unique(catalog.documents.map((doc) => doc.id))) ctx.addIssue({ code: 'custom', path: ['documents'], message: 'duplicate' });
  if (!unique(catalog.endpoints.map((item) => item.id))) ctx.addIssue({ code: 'custom', path: ['endpoints'], message: 'duplicate' });
  const docs = new Map(catalog.documents.map((doc) => [doc.id, new Set(doc.sections)]));
  catalog.endpoints.forEach((endpoint, index) => endpoint.citations.forEach((ref) => {
    if (!docs.get(ref.document)?.has(ref.section)) ctx.addIssue({ code: 'custom', path: ['endpoints', index, 'citations'], message: 'unknown reference' });
  }));
});

export const MAPPING_SCHEMA = z.object({
  version: z.literal(MAPPING.VERSION), catalogRevision: id, catalogDigest: sha,
  operations: z.record(operations, opRow),
  endpoints: z.record(id, endpointRow),
}).strict();

export class MappingError extends Error {
  constructor(code, operation = null, check = MAPPING.CHECK.SCHEMA) {
    super('Mapping intake rejected');
    this.name = 'MappingError';
    this.code = code;
    const next = {
      [MAPPING.ERROR.INVALID_CATALOG]: MAPPING.NEXT.CATALOG,
      [MAPPING.ERROR.INVALID_MAPPING]: MAPPING.NEXT.MAPPING,
      [MAPPING.ERROR.CATALOG_CHANGED]: MAPPING.NEXT.REBIND,
      [MAPPING.ERROR.MISSING_EVIDENCE]: MAPPING.NEXT.EVIDENCE,
      [MAPPING.ERROR.INCONSISTENT_MAPPING]: MAPPING.NEXT.LINKS,
    };
    this.details = Object.freeze({ operation, check, nextAction: next[code] });
  }
}

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function catalogDigest(catalogInput) {
  const catalog = parse(MAPPING_CATALOG_SCHEMA, catalogInput, MAPPING.ERROR.INVALID_CATALOG);
  return digest(catalog);
}
const deepFreeze = (value) => {
  if (value !== null && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype) && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
const parse = (schema, value, code) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues.find((item) => item.path[0] === 'operations' && Object.values(AGENT_OPERATION).includes(item.path[1]));
    throw new MappingError(code, issue ? issue.path[1] : null);
  }
  return result.data;
};
const refExists = (refs, docs) => refs.every((ref) => docs.get(ref.document)?.has(ref.section));

/** Produces review coverage only. It never grants runtime authority or availability. */
export function compileMapping(catalogInput, mappingInput) {
  const catalog = parse(MAPPING_CATALOG_SCHEMA, catalogInput, MAPPING.ERROR.INVALID_CATALOG);
  const mapping = parse(MAPPING_SCHEMA, mappingInput, MAPPING.ERROR.INVALID_MAPPING);
  if (mapping.catalogRevision !== catalog.revision || mapping.catalogDigest !== digest(catalog)) throw new MappingError(MAPPING.ERROR.CATALOG_CHANGED, null, MAPPING.CHECK.CATALOG);
  const endpointIDs = catalog.endpoints.map(({ id: endpointID }) => endpointID);
  if (Object.keys(mapping.endpoints).length !== endpointIDs.length || endpointIDs.some((endpointID) => !Object.hasOwn(mapping.endpoints, endpointID))) {
    throw new MappingError(MAPPING.ERROR.INVALID_MAPPING);
  }
  const docSections = new Map(catalog.documents.map((doc) => [doc.id, new Set(doc.sections)]));
  const endpointByID = new Map(catalog.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const opIDs = Object.values(AGENT_OPERATION);
  if (Object.keys(mapping.operations).length !== opIDs.length || opIDs.some((opID) => !Object.hasOwn(mapping.operations, opID))) {
    throw new MappingError(MAPPING.ERROR.INVALID_MAPPING);
  }
  const reverse = new Map(opIDs.map((opID) => [opID, []]));
  for (const [endpointID, row] of Object.entries(mapping.endpoints)) {
    const endpoint = endpointByID.get(endpointID);
    if (!endpoint) throw new MappingError(MAPPING.ERROR.INVALID_MAPPING);
    if (row.kind === MAPPING.ENDPOINT_KIND.SHARED) {
      if (!unique(row.operations)) throw new MappingError(MAPPING.ERROR.INCONSISTENT_MAPPING);
      for (const opID of row.operations) reverse.get(opID).push(endpointID);
    } else if (row.kind === MAPPING.ENDPOINT_KIND.EXTENSION && !refExists(row.citations, docSections)) {
      throw new MappingError(MAPPING.ERROR.MISSING_EVIDENCE);
    } else if (row.kind === MAPPING.ENDPOINT_KIND.OUT_OF_SCOPE && !refExists(row.citations, docSections)) {
      throw new MappingError(MAPPING.ERROR.MISSING_EVIDENCE);
    }
  }
  for (const opID of opIDs) {
    const row = mapping.operations[opID];
    if (row.kind === MAPPING.OPERATION_KIND.MAPPING) {
      if (!unique(row.endpointIDs)) throw new MappingError(MAPPING.ERROR.INCONSISTENT_MAPPING);
      if (!Object.values(row.evidence).every((refs) => refExists(refs, docSections))) throw new MappingError(MAPPING.ERROR.MISSING_EVIDENCE, opID, MAPPING.CHECK.EVIDENCE);
      if (row.endpointIDs.some((endpointID) => !endpointByID.has(endpointID))) throw new MappingError(MAPPING.ERROR.INVALID_MAPPING);
      const reverseIDs = reverse.get(opID).sort();
      if (row.endpointIDs.slice().sort().join('\0') !== reverseIDs.join('\0')) throw new MappingError(MAPPING.ERROR.INCONSISTENT_MAPPING, opID, MAPPING.CHECK.LINKS);
      const mutates = row.endpointIDs.some((endpointID) => endpointByID.get(endpointID).effect === MAPPING.EFFECT.MUTATION);
      if (AGENT_MUTATIONS.includes(opID) !== mutates) throw new MappingError(MAPPING.ERROR.INCONSISTENT_MAPPING, opID, MAPPING.CHECK.EFFECT);
    } else if (row.kind === MAPPING.OPERATION_KIND.UNSUPPORTED && !refExists(row.citations, docSections)) {
      throw new MappingError(MAPPING.ERROR.MISSING_EVIDENCE);
    } else if (reverse.get(opID).length) {
      throw new MappingError(MAPPING.ERROR.INCONSISTENT_MAPPING);
    }
  }
  const states = Object.fromEntries(opIDs.map((opID) => [opID, mapping.operations[opID].kind === MAPPING.OPERATION_KIND.MAPPING ? MAPPING.STATE.READY : mapping.operations[opID].kind]));
  const features = Object.fromEntries(Object.entries(AGENT_FEATURE_RULES).map(([featureID, rule]) => {
    const missing = (ids) => ids.filter((opID) => states[opID] !== MAPPING.STATE.READY);
    const all = missing(rule.all);
    const anyReady = !rule.any.length || rule.any.some((group) => group.every((opID) => states[opID] === MAPPING.STATE.READY));
    const ready = !all.length && anyReady;
    return [featureID, { state: ready ? MAPPING.STATE.CANDIDATE : MAPPING.STATE.BLOCKED, available: false,
      reason: ready ? MAPPING.GATE.ACCEPTANCE : MAPPING.GATE.INCOMPLETE,
      blockedBy: { all, any: anyReady ? [] : rule.any.map(missing) } }];
  }));
  const endpoints = Object.fromEntries(endpointIDs.map((endpointID) => {
    const row = mapping.endpoints[endpointID];
    if (row.kind !== MAPPING.ENDPOINT_KIND.EXTENSION) return [endpointID, { kind: row.kind }];
    return [endpointID, { kind: row.kind, actionID: row.actionID, state: row.fit === MAPPING.FIT.FORM ? MAPPING.STATE.EXTENSION : MAPPING.FIT.HOST, available: false }];
  }));
  return deepFreeze({ version: MAPPING.VERSION, catalogRevision: catalog.revision, catalogDigest: digest(catalog), digest: digest({ catalog, mapping }), operations: states, endpoints, features });
}
