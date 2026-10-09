import type { z } from 'zod';
import type { JsonValue } from './dispatcher.js';
export interface ExtensionLabel { key: string; en: string; zhCN: string }
export type ExtensionScalar = { kind: 'text'; maxLength: number } | { kind: 'number'; min: number; max: number }
  | { kind: 'boolean' } | { kind: 'choice'; choices: { value: string; label: ExtensionLabel }[] };
export type ExtensionValueSpec = ExtensionScalar | { kind: 'list'; item: ExtensionScalar; maxItems: number };
export interface ExtensionField { key: string; label: ExtensionLabel; required: boolean; value: ExtensionValueSpec }
export interface ExtensionColumn { key: string; label: ExtensionLabel; required: boolean; value: ExtensionScalar }
export interface ExtensionManifest {
  version: 1; actionID: string; revision: string; label: ExtensionLabel;
  context: { workspace: boolean; session: boolean }; effect: 'read' | 'mutation'; authorization: 'current-principal';
  cancellation: 'none' | 'documented'; outcome: 'observed' | 'accepted-only'; input: ExtensionField[];
  output: { kind: 'text'; maxLength: number } | { kind: 'fields'; fields: ExtensionField[] }
    | { kind: 'table'; columns: ExtensionColumn[]; maxRows: number };
  evidence: { document: string; section: string }[];
}
export type ExtensionValue = string | number | boolean | (string | number | boolean)[];
export interface ExtensionValues { [key: string]: ExtensionValue }
export type ExtensionResult = { text: string } | { fields: ExtensionValues } | { rows: ExtensionValues[] };
export const extensionManifestSchema: z.ZodType<ExtensionManifest>;
export function parseExtensionInput(manifest: ExtensionManifest, input: JsonValue): ExtensionValues;
export function parseExtensionResult(manifest: ExtensionManifest, input: JsonValue): ExtensionResult;
export function buildExtensionSchema(): ReturnType<typeof import('zod').toJSONSchema>;
