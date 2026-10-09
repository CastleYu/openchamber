import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AGENT_SERVER_METHOD } from '../../packages/web/server/lib/agent/constants.js';
import { MAPPING, MAPPING_CATALOG_SCHEMA } from './mapping-intake.mjs';
import { DOCUMENT, compileDocuments } from './document-excerpts.mjs';

export const OPENAPI = Object.freeze({ VERSION: 1, ERROR: 'invalid-openapi-catalog',
  METHODS: Object.freeze(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']),
  LIMIT: 256 });
const id = z.string().min(1).max(96).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sourceSchema = z.object({ version: z.literal(OPENAPI.VERSION), id, revision: id,
  text: z.string().min(1).max(DOCUMENT.MAX_SOURCE_BYTES) }).strict();
const row = z.object({ effect: z.enum(Object.values(MAPPING.EFFECT)), requestRef: id, responseRef: id }).strict();
const reviewSchema = z.object({ version: z.literal(OPENAPI.VERSION), revision: id,
  endpoints: z.record(id, row), sections: z.array(z.object({ id, pointer: z.string().min(1).max(512).startsWith('/') }).strict()).max(128) }).strict();
const apiSchema = z.object({ openapi: z.string().regex(/^3\.(?:0|1)\.\d+$/), paths: z.record(z.string(), z.json()) }).passthrough();
export function buildOpenAPISchemas() { return { source: z.toJSONSchema(sourceSchema), review: z.toJSONSchema(reviewSchema) }; }
export class OpenAPIError extends Error {
  constructor() { super(OPENAPI.ERROR); this.code = OPENAPI.ERROR; }
}
const invalid = () => { throw new OpenAPIError(); };
const escape = (value) => value.replace(/~/g, '~0').replace(/\//g, '~1');
const itemSchema = z.object({ operationId: id }).passthrough();
const pathSchema = z.record(z.string(), z.json());

/** Imports structural routes only; owner review supplies semantics and complete dispositions. */
export function compileOpenAPI(sourceInput, reviewInput) {
  try {
    const source = sourceSchema.parse(sourceInput);
    const review = reviewSchema.parse(reviewInput);
    if (Buffer.byteLength(source.text) > DOCUMENT.MAX_SOURCE_BYTES) invalid();
    const api = apiSchema.parse(JSON.parse(source.text));
    if (Object.hasOwn(api, 'webhooks')) invalid();
    const endpoints = [];
    const sections = [...review.sections];
    const seen = new Set();
    for (const route of Object.keys(api.paths).sort()) {
      const path = pathSchema.parse(api.paths[route]);
      if (Object.hasOwn(path, '$ref')) invalid();
      for (const method of OPENAPI.METHODS) {
        if (!Object.hasOwn(path, method)) continue;
        const operation = itemSchema.parse(path[method]);
        const owner = review.endpoints[operation.operationId];
        if (!owner || seen.has(operation.operationId) || Object.hasOwn(operation, '$ref') || Object.hasOwn(operation, 'callbacks')) invalid();
        const verb = method.toUpperCase();
        if (!Object.values(AGENT_SERVER_METHOD).includes(verb) || endpoints.length >= OPENAPI.LIMIT) invalid();
        seen.add(operation.operationId);
        sections.push({ id: operation.operationId, pointer: `/paths/${escape(route)}/${method}` });
        endpoints.push({ id: operation.operationId, method: verb, path: route, ...owner,
          citations: [{ document: source.id, section: operation.operationId }] });
      }
    }
    if (!endpoints.length || seen.size !== Object.keys(review.endpoints).length
      || sections.length > 128 || new Set(sections.map((section) => section.id)).size !== sections.length) invalid();
    const catalog = MAPPING_CATALOG_SCHEMA.parse({ version: MAPPING.VERSION, revision: review.revision,
      documents: [{ id: source.id, revision: source.revision, digest: createHash('sha256').update(source.text).digest('hex'),
        sections: sections.map((section) => section.id) }], endpoints });
    const documents = { version: DOCUMENT.VERSION, documents: [{ id: source.id, revision: source.revision,
      format: DOCUMENT.FORMAT.OPENAPI, text: source.text, sections }] };
    compileDocuments(catalog, documents);
    return { catalog, documents };
  } catch (error) {
    if (error instanceof OpenAPIError) throw error;
    throw new OpenAPIError();
  }
}
