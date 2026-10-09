import { z } from 'zod';
import { AGENT_OPERATION, AGENT_ERROR, AGENT_SERVER_METHOD } from '../../packages/web/server/lib/agent/constants.js';
import { compileMapping, MAPPING, MAPPING_CATALOG_SCHEMA, MAPPING_SCHEMA } from './mapping-intake.mjs';

export const DECLARATIVE = Object.freeze({ VERSION: 1, ERROR: 'invalid-declarative-bindings',
  KIND: Object.freeze({ FIELD: 'field', LITERAL: 'literal', OBJECT: 'object', LIST: 'list' }),
  FROM: Object.freeze({ INPUT: 'input', RESPONSE: 'response', ITEM: 'item' }),
  MAX_DEPTH: 8, MAX_NODES: 256, FILE: 'bindings.json' });
const key = z.string().regex(/^[A-Za-z0-9._-]{1,96}$/).refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value));
const fieldPath = z.array(key).min(1).max(DECLARATIVE.MAX_DEPTH);
const field = z.object({ kind: z.literal(DECLARATIVE.KIND.FIELD), from: z.enum(Object.values(DECLARATIVE.FROM)),
  path: fieldPath, optional: z.boolean().optional() }).strict();
const literal = z.object({ kind: z.literal(DECLARATIVE.KIND.LITERAL), value: z.union([z.string().max(8192), z.number().finite(), z.boolean(), z.null()]) }).strict();
const node = z.lazy(() => z.discriminatedUnion('kind', [field, literal,
  z.object({ kind: z.literal(DECLARATIVE.KIND.OBJECT), fields: z.record(key, node).refine((value) => Object.keys(value).length <= 64) }).strict(),
  z.object({ kind: z.literal(DECLARATIVE.KIND.LIST), from: z.enum(Object.values(DECLARATIVE.FROM)), path: fieldPath, item: node }).strict(),
]));
const recipe = z.object({ endpointID: z.string().min(1).max(96), successStatuses: z.array(z.number().int().min(200).max(299)).min(1).max(16)
  .refine((values) => new Set(values).size === values.length),
  path: z.record(key, z.union([field, literal])).refine((value) => Object.keys(value).length <= 32),
  query: z.record(key, z.union([field, literal])).refine((value) => Object.keys(value).length <= 64).optional(),
  body: node.optional(), result: node,
}).strict();
const schema = z.object({ version: z.literal(DECLARATIVE.VERSION), mappingDigest: z.string().regex(/^[a-f0-9]{64}$/),
  operations: z.partialRecord(z.enum(Object.values(AGENT_OPERATION)), recipe) }).strict();
export function buildBindingSchema() { return z.toJSONSchema(schema, { cycles: 'ref' }); }
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value !== null && Object.getPrototypeOf(value) === Object.prototype
    ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, canonical(value[name])])) : value;

export class DeclarativeError extends Error {
  constructor() { super(DECLARATIVE.ERROR); this.code = DECLARATIVE.ERROR; }
}
const invalid = () => { throw new DeclarativeError(); };
// Bound raw nesting before the recursive schema runs.
const bound = (input) => {
  const pending = [{ value: input, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (++count > 20000 || depth > 32) invalid();
    if (value !== null && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)) {
      pending.push(...Object.values(value).map((child) => ({ value: child, depth: depth + 1 })));
    }
  }
};
const inspect = (root, request) => {
  const pending = [{ value: root, depth: 1, item: false }];
  let count = 0;
  while (pending.length) {
    const { value, depth, item } = pending.pop();
    if (++count > DECLARATIVE.MAX_NODES || depth > DECLARATIVE.MAX_DEPTH) invalid();
    if (value.from && (request && value.from === DECLARATIVE.FROM.RESPONSE || value.from === DECLARATIVE.FROM.ITEM && !item)) invalid();
    if (value.kind === DECLARATIVE.KIND.OBJECT) pending.push(...Object.values(value.fields).map((child) => ({ value: child, depth: depth + 1, item })));
    if (value.kind === DECLARATIVE.KIND.LIST) pending.push({ value: value.item, depth: depth + 1, item: true });
  }
};

const source = (endpoint, binding) => `const MAP = Object.freeze(${JSON.stringify(canonical({ ...binding, method: endpoint.method, route: endpoint.path }))});
const KIND = Object.freeze(${JSON.stringify(DECLARATIVE.KIND)});
const KEY = Object.freeze({ KIND: 'kind', FROM: 'from', PATH: 'path', OPTIONAL: 'optional', VALUE: 'value', FIELDS: 'fields', ITEM: 'item' });
const ERROR = Object.freeze({ FAILED: '${AGENT_ERROR.BACKEND_FAILED}' });
function fail() { throw new Error(ERROR.FAILED); }
function read(root, segments, optional) {
  let value = root;
  for (const segment of segments) {
    if (value === null || value === undefined || !Object.hasOwn(Object(value), segment)) { if (optional) return undefined; fail(); }
    value = value[segment];
  }
  return value;
}
function project(node, scopes) {
  switch (node[KEY.KIND]) {
    case KIND.LITERAL: return node[KEY.VALUE];
    case KIND.FIELD: return read(scopes[node[KEY.FROM]], node[KEY.PATH], node[KEY.OPTIONAL]);
    case KIND.OBJECT: return Object.fromEntries(Object.entries(node[KEY.FIELDS]).map(([name, child]) => [name, project(child, scopes)]).filter(([, value]) => value !== undefined));
    case KIND.LIST: {
      const items = read(scopes[node[KEY.FROM]], node[KEY.PATH], false);
      if (!Array.isArray(items)) fail();
      return items.map((item) => project(node[KEY.ITEM], { ...scopes, item }));
    }
    default: return fail();
  }
}
function scalar(value) {
  if (!['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) fail();
  return String(value);
}
export function createOperation(context) {
  return async function handler(input, identity, control) {
    const scopes = { input };
    const path = MAP.route.replace(/\\{([A-Za-z][A-Za-z0-9_]*)\\}/g, (_, name) => {
      const value = scalar(project(MAP.path[name], scopes));
      if (!value || value === '.' || value === '..' || /[\\/\\\\]/.test(value)) fail();
      return encodeURIComponent(value);
    });
    const request = { method: MAP.method, path };
    if (MAP.query) request.query = Object.fromEntries(Object.entries(MAP.query).map(([name, value]) => [name, project(value, scopes)])
      .filter(([, value]) => value !== undefined).map(([name, value]) => [name, scalar(value)]));
    if (MAP.body) request.body = project(MAP.body, scopes);
    const response = await context.request(request, identity, control);
    if (!MAP.successStatuses.includes(response.status)) fail();
    return project(MAP.result, { input, response });
  };
}
`;

/** Structural conversion only. Generated source remains subject to protected semantic fixtures. */
export function compileBindings(catalogInput, mappingInput, bindingInput) {
  const coverage = compileMapping(catalogInput, mappingInput);
  try {
    bound(bindingInput);
    const bindings = schema.parse(bindingInput);
    const catalog = MAPPING_CATALOG_SCHEMA.parse(catalogInput);
    const mapping = MAPPING_SCHEMA.parse(mappingInput);
    const expected = Object.values(AGENT_OPERATION).filter((operation) => mapping.operations[operation].kind === MAPPING.OPERATION_KIND.MAPPING
      && mapping.operations[operation].codec === MAPPING.CODEC.DECLARATIVE);
    if (bindings.mappingDigest !== coverage.digest || Object.keys(bindings.operations).length !== expected.length
      || expected.some((operation) => !Object.hasOwn(bindings.operations, operation))) invalid();
    const sources = new Map();
    for (const operation of expected) {
      const value = bindings.operations[operation];
      const row = mapping.operations[operation];
      const endpoint = catalog.endpoints.find((item) => item.id === value.endpointID);
      if (row.endpointIDs.length !== 1 || row.endpointIDs[0] !== value.endpointID || !endpoint
        || endpoint.method === AGENT_SERVER_METHOD.GET && value.body) invalid();
      const placeholders = [...endpoint.path.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]);
      if (Object.keys(value.path).length !== new Set(placeholders).size || placeholders.some((name) => !Object.hasOwn(value.path, name))) invalid();
      for (const projection of [...Object.values(value.path), ...Object.values(value.query ?? {}), ...(value.body ? [value.body] : [])]) inspect(projection, true);
      inspect(value.result, false);
      sources.set(operation, source(endpoint, value));
    }
    return { bindings: canonical(bindings), sources };
  } catch (error) {
    if (error instanceof DeclarativeError) throw error;
    throw new DeclarativeError();
  }
}
