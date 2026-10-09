import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MAPPING_CATALOG_SCHEMA } from './mapping-intake.mjs';

export const DOCUMENT = Object.freeze({ VERSION: 1, FILE: 'api-excerpts.json',
  FORMAT: Object.freeze({ TEXT: 'text', OPENAPI: 'openapi-json' }),
  MAX_SOURCE_BYTES: 1048576, MAX_PACKET_BYTES: 16384, ERROR: 'invalid-document-excerpts' });
const id = z.string().min(1).max(96).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const line = z.object({ id, fromLine: z.number().int().min(1).max(100000), toLine: z.number().int().min(1).max(100000) }).strict();
const pointer = z.object({ id, pointer: z.string().min(1).max(512).startsWith('/') }).strict();
const common = { id, revision: id, text: z.string().min(1).max(DOCUMENT.MAX_SOURCE_BYTES) };
const source = z.discriminatedUnion('format', [
  z.object({ ...common, format: z.literal(DOCUMENT.FORMAT.TEXT), sections: z.array(line).min(1).max(128) }).strict(),
  z.object({ ...common, format: z.literal(DOCUMENT.FORMAT.OPENAPI), sections: z.array(pointer).min(1).max(128) }).strict(),
]);
const schema = z.object({ version: z.literal(DOCUMENT.VERSION), documents: z.array(source).min(1).max(128) }).strict();
export function buildDocumentSchema() { return z.toJSONSchema(schema); }
export class DocumentError extends Error {
  constructor() { super(DOCUMENT.ERROR); this.code = DOCUMENT.ERROR; }
}
const invalid = () => { throw new DocumentError(); };
const at = (root, name) => {
  const segments = name.slice(1).split('/');
  if (segments.length > 16) invalid();
  let value = root;
  for (const segment of segments) {
    if (/~(?![01])/.test(segment)) invalid();
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (['__proto__', 'prototype', 'constructor'].includes(key) || value === null || value === undefined
      || !Object.hasOwn(Object(value), key)) invalid();
    value = value[key];
  }
  return JSON.stringify(value, null, 2);
};

/** Extracts owner-selected source sections. It neither invents endpoints nor approves mappings. */
export function compileDocuments(catalogInput, input) {
  try {
    const catalog = MAPPING_CATALOG_SCHEMA.parse(catalogInput);
    const sources = schema.parse(input).documents;
    if (sources.length !== catalog.documents.length || new Set(sources.map((item) => item.id)).size !== sources.length) invalid();
    const result = new Map();
    let bytes = 0;
    for (const item of sources) {
      bytes += Buffer.byteLength(item.text);
      const doc = catalog.documents.find((entry) => entry.id === item.id);
      if (bytes > DOCUMENT.MAX_SOURCE_BYTES || !doc || doc.revision !== item.revision
        || doc.digest !== createHash('sha256').update(item.text).digest('hex')
        || item.sections.length !== doc.sections.length || new Set(item.sections.map((entry) => entry.id)).size !== item.sections.length
        || item.sections.some((entry) => !doc.sections.includes(entry.id))) invalid();
      const lines = item.text.split(/\r?\n/);
      let api;
      if (item.format === DOCUMENT.FORMAT.OPENAPI) {
        api = JSON.parse(item.text);
        if (!z.object({ openapi: z.string().regex(/^3\.(?:0|1)\.\d+$/) }).passthrough().safeParse(api).success) invalid();
      }
      const sections = new Map();
      for (const section of item.sections) {
        let text;
        let locator;
        if (item.format === DOCUMENT.FORMAT.TEXT) {
          if (section.fromLine > section.toLine || section.toLine > lines.length) invalid();
          text = lines.slice(section.fromLine - 1, section.toLine).join('\n');
          locator = { fromLine: section.fromLine, toLine: section.toLine };
        } else {
          text = at(api, section.pointer);
          locator = { pointer: section.pointer };
        }
        if (!text.trim()) invalid();
        sections.set(section.id, Object.freeze({ id: section.id, locator: Object.freeze(locator), text }));
      }
      result.set(item.id, { id: doc.id, revision: doc.revision, digest: doc.digest, format: item.format, sections });
    }
    return result;
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError();
  }
}

/** Includes only cited excerpts, with a byte ceiling independent of model token counting. */
export function packetDocuments(documents, references) {
  const selected = references.map((reference) => {
    const doc = documents.get(reference.id);
    if (!doc) invalid();
    const sections = reference.sections.map((name) => {
      const section = doc.sections.get(name);
      if (!section) invalid();
      return section;
    });
    return { id: doc.id, revision: doc.revision, digest: doc.digest, format: doc.format, sections };
  });
  const text = `${JSON.stringify({ version: DOCUMENT.VERSION, documents: selected }, null, 2)}\n`;
  if (Buffer.byteLength(text) > DOCUMENT.MAX_PACKET_BYTES) invalid();
  return text;
}
