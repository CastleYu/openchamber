import { z } from 'zod';
import { AGENT_EXTENSION } from './constants.js';

const kind = AGENT_EXTENSION.KIND;
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
  .refine((value) => !['__proto__', 'prototype', 'constructor'].includes(value));
const id = z.string().min(1).max(96).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const label = z.object({ key: z.string().max(96).regex(/^cagent\.[A-Za-z0-9][A-Za-z0-9._-]*$/),
  en: z.string().trim().min(1).max(128), zhCN: z.string().trim().min(1).max(128) }).strict();
const text = z.object({ kind: z.literal(kind.TEXT), maxLength: z.number().int().min(1).max(AGENT_EXTENSION.MAX_TEXT) }).strict();
const number = z.object({ kind: z.literal(kind.NUMBER), min: z.number().finite(), max: z.number().finite() }).strict()
  .refine((value) => value.min <= value.max);
const boolean = z.object({ kind: z.literal(kind.BOOLEAN) }).strict();
const choice = z.object({ kind: z.literal(kind.CHOICE), choices: z.array(z.object({ value: key, label }).strict())
  .min(1).max(AGENT_EXTENSION.MAX_ITEMS).refine((values) => new Set(values.map((value) => value.value)).size === values.length) }).strict();
const scalar = z.union([text, number, boolean, choice]);
const value = z.union([scalar, z.object({ kind: z.literal(kind.LIST), item: scalar,
  maxItems: z.number().int().min(1).max(AGENT_EXTENSION.MAX_ITEMS) }).strict()]);
const field = z.object({ key, label, required: z.boolean(), value }).strict();
const column = z.object({ key, label, required: z.boolean(), value: scalar }).strict();
const fields = (schema) => z.array(schema).max(AGENT_EXTENSION.MAX_FIELDS)
  .refine((items) => new Set(items.map((item) => item.key)).size === items.length
    && new Set(items.map((item) => item.label.key)).size === items.length);
export const extensionActionIDSchema = z.string().max(87).regex(/^cagent\.[A-Za-z0-9][A-Za-z0-9._-]{0,78}$/);
export const extensionManifestSchema = z.object({ version: z.literal(AGENT_EXTENSION.VERSION),
  actionID: extensionActionIDSchema, revision: id, label,
  context: z.object({ workspace: z.boolean(), session: z.boolean() }).strict()
    .refine((scope) => !scope.session || scope.workspace),
  effect: z.enum(Object.values(AGENT_EXTENSION.EFFECT)), authorization: z.literal('current-principal'),
  cancellation: z.enum(Object.values(AGENT_EXTENSION.CANCELLATION)), outcome: z.enum(Object.values(AGENT_EXTENSION.OUTCOME)),
  input: fields(field),
  output: z.union([text, z.object({ kind: z.literal(kind.FIELDS), fields: fields(field).min(1) }).strict(),
    z.object({ kind: z.literal(kind.TABLE), columns: fields(column).min(1), maxRows: z.number().int().min(1).max(AGENT_EXTENSION.MAX_ROWS) }).strict()]),
  evidence: z.array(z.object({ document: id, section: id }).strict()).min(1).max(32),
}).strict();

const parser = (definition) => {
  switch (definition.kind) {
    case kind.TEXT: return z.string().max(definition.maxLength);
    case kind.NUMBER: return z.number().finite().min(definition.min).max(definition.max);
    case kind.BOOLEAN: return z.boolean();
    case kind.CHOICE: return z.string().refine((value) => definition.choices.some((choice) => choice.value === value));
    case kind.LIST: return z.array(parser(definition.item)).max(definition.maxItems);
    default: throw new Error('invalid-extension-kind');
  }
};
const object = (fields) => z.object(Object.fromEntries(fields.map((field) => {
  const schema = parser(field.value);
  return [field.key, field.required ? schema : schema.optional()];
}))).strict();

/** Parses a detached finite form value. No transport, code or permission is evaluated. */
export function parseExtensionInput(manifestInput, input) {
  const manifest = extensionManifestSchema.parse(manifestInput);
  return object(manifest.input).parse(input);
}
export function parseExtensionResult(manifestInput, input) {
  const manifest = extensionManifestSchema.parse(manifestInput);
  switch (manifest.output.kind) {
    case kind.TEXT: return z.object({ text: parser(manifest.output) }).strict().parse(input);
    case kind.FIELDS: return z.object({ fields: object(manifest.output.fields) }).strict().parse(input);
    case kind.TABLE: return z.object({ rows: z.array(object(manifest.output.columns)).max(manifest.output.maxRows) }).strict().parse(input);
    default: throw new Error('invalid-extension-kind');
  }
}
export function buildExtensionSchema() { return z.toJSONSchema(extensionManifestSchema); }
