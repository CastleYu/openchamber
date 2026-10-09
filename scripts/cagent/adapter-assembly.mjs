import { createHash } from 'node:crypto';
import { z } from 'zod';
import ts from 'typescript';

import { AGENT_EXTENSION, AGENT_OPERATION, AGENT_SUPPORT, AGENT_PACKET } from '../../packages/web/server/lib/agent/constants.js';
import { extensionManifestSchema } from '../../packages/web/server/lib/agent/extensions.js';

export const ASSEMBLY = Object.freeze({
  LIMIT: Object.freeze({ SOURCES: Object.keys(AGENT_OPERATION).length, SOURCE_BYTES: AGENT_PACKET.MAX_FILE_BYTES, TOTAL_BYTES: AGENT_PACKET.MAX_TOTAL_BYTES }),
  ERROR: Object.freeze({ INPUT: 'invalid-assembly-input', SOURCE: 'invalid-operation-source', BUILD: 'assembly-build-failed' }),
  VIRTUAL: Object.freeze({ PREFIX: 'cagent-operation:', EXTENSION: 'cagent-extension:' }),
  FORBIDDEN: Object.freeze(['require', 'eval']),
});

export class AssemblyError extends Error {
  constructor(code) {
    super(`Adapter assembly refused: ${code}`);
    this.name = 'AssemblyError';
    this.code = code;
  }
}

const operations = Object.freeze(Object.values(AGENT_OPERATION));
const known = new Set(operations);
const sourceSchema = z.object({ operation: z.enum(operations), text: z.string().min(1).max(ASSEMBLY.LIMIT.SOURCE_BYTES) }).strict();
const extensionSourceSchema = z.object({ manifest: extensionManifestSchema, text: z.string().min(1).max(ASSEMBLY.LIMIT.SOURCE_BYTES) }).strict();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safeSource = (text, factory) => {
  if (Buffer.byteLength(text) > ASSEMBLY.LIMIT.SOURCE_BYTES) return false;
  try {
    const scan = new Bun.Transpiler({ loader: 'js', target: 'node' }).scan(text);
    if (scan.imports.length !== 0 || scan.exports.length !== 1 || scan.exports[0] !== factory) return false;
    const tree = ts.createSourceFile('handler.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let forbidden = false;
    const visit = (node) => {
      if (ts.isIdentifier(node) && ASSEMBLY.FORBIDDEN.includes(node.text)) forbidden = true;
      ts.forEachChild(node, visit);
    };
    visit(tree);
    return !forbidden;
  } catch { return false; }
};

const entry = (items, extensions) => {
  const imports = items.map(({ operation }, index) =>
    `import { createOperation as operation${index} } from '${ASSEMBLY.VIRTUAL.PREFIX}${operation}';`).join('\n');
  const rows = items.map(({ operation }, index) =>
    `[${JSON.stringify(operation)}, operation${index}]`).join(',\n    ');
  const extensionImports = extensions.map((_, index) =>
    `import { createExtension as extension${index} } from '${ASSEMBLY.VIRTUAL.EXTENSION}${index}';`).join('\n');
  const extensionRows = extensions.map(({ manifest }, index) =>
    `[${JSON.stringify(manifest)}, extension${index}]`).join(',\n    ');
  const all = JSON.stringify(operations);
  return `${imports}\n${extensionImports}\nconst factories = new Map([${rows ? `\n    ${rows}\n  ` : ''}]);\nconst extensions = [${extensionRows ? `\n    ${extensionRows}\n  ` : ''}];\nconst operations = ${all};\nexport async function createAdapter(context) {\n  const handlers = {};\n  for (const [id, factory] of factories) handlers[id] = await factory(context);\n  const capabilities = Object.fromEntries(operations.map((id) => [id, { state: '${AGENT_SUPPORT.UNVERIFIED}', evidence: [] }]));\n  const adapter = { handlers, capabilities };\n  if (extensions.length) adapter.extensions = await Promise.all(extensions.map(async ([manifest, factory]) => ({ manifest, capability: { state: '${AGENT_SUPPORT.UNVERIFIED}', evidence: [] }, handler: await factory(context) })));\n  return adapter;\n}\n`;
};

/** Bundles supplied operation and finite extension text without evaluating it. */
export async function assembleAdapter(sources, extensions = []) {
  try {
    if (!Array.isArray(sources) || !Array.isArray(extensions) || sources.length > ASSEMBLY.LIMIT.SOURCES
      || extensions.length > AGENT_EXTENSION.MAX_ACTIONS || (sources.length === 0 && extensions.length === 0)) {
      throw new AssemblyError(ASSEMBLY.ERROR.INPUT);
    }
    const items = sources.map((source) => {
      const parsed = sourceSchema.safeParse(source);
      if (!parsed.success || Object.getPrototypeOf(source) !== Object.prototype || !known.has(parsed.data.operation)
        || !safeSource(parsed.data.text, 'createOperation')) {
        throw new AssemblyError(ASSEMBLY.ERROR.SOURCE);
      }
      return { operation: parsed.data.operation, text: parsed.data.text };
    }).sort((left, right) => left.operation < right.operation ? -1 : left.operation > right.operation ? 1 : 0);
    const extensionItems = extensions.map((extension) => {
      const parsed = extensionSourceSchema.safeParse(extension);
      if (!parsed.success || Object.getPrototypeOf(extension) !== Object.prototype
        || !safeSource(parsed.data.text, 'createExtension')) {
        throw new AssemblyError(ASSEMBLY.ERROR.SOURCE);
      }
      return parsed.data;
    }).sort((left, right) => left.manifest.actionID < right.manifest.actionID ? -1 : left.manifest.actionID > right.manifest.actionID ? 1 : 0);
    if (new Set(items.map(({ operation }) => operation)).size !== items.length
      || new Set(extensionItems.map(({ manifest }) => manifest.actionID)).size !== extensionItems.length
      || items.reduce((size, item) => size + Buffer.byteLength(item.text), 0)
        + extensionItems.reduce((size, item) => size + Buffer.byteLength(item.text), 0) > ASSEMBLY.LIMIT.TOTAL_BYTES) {
      throw new AssemblyError(ASSEMBLY.ERROR.INPUT);
    }
    const byId = new Map(items.map(({ operation, text }) => [operation, text]));
    const extensionById = new Map(extensionItems.map((item, index) => [String(index), item.text]));
    const result = await Bun.build({
      entrypoints: ['virtual:adapter-entry'], target: 'node', format: 'esm', sourcemap: 'none',
      minify: false, write: false,
      plugins: [{ name: 'cagent-adapter-virtual-input', setup(build) {
        build.onResolve({ filter: /.*/ }, ({ path: specifier }) => {
          if (specifier === 'virtual:adapter-entry') return { path: specifier, namespace: 'cagent-adapter' };
          if (specifier.startsWith(ASSEMBLY.VIRTUAL.PREFIX)) {
            const operation = specifier.slice(ASSEMBLY.VIRTUAL.PREFIX.length);
            if (known.has(operation) && byId.has(operation)) return { path: operation, namespace: 'cagent-operation' };
          }
          if (specifier.startsWith(ASSEMBLY.VIRTUAL.EXTENSION)) {
            const id = specifier.slice(ASSEMBLY.VIRTUAL.EXTENSION.length);
            if (/^\d+$/.test(id) && extensionById.has(id)) return { path: id, namespace: 'cagent-extension' };
          }
          return { errors: [{ text: 'import refused' }] };
        });
        build.onLoad({ filter: /.*/, namespace: 'cagent-adapter' }, () => ({ contents: entry(items, extensionItems), loader: 'js' }));
        build.onLoad({ filter: /.*/, namespace: 'cagent-operation' }, ({ path: operation }) => ({ contents: byId.get(operation), loader: 'js' }));
        build.onLoad({ filter: /.*/, namespace: 'cagent-extension' }, ({ path: id }) => ({ contents: extensionById.get(id), loader: 'js' }));
      } }],
    });
    if (!result.success || result.outputs.length !== 1) throw new AssemblyError(ASSEMBLY.ERROR.BUILD);
    const bytes = Buffer.from(await result.outputs[0].arrayBuffer());
    return Object.freeze({ source: bytes.toString('utf8'), digest: hash(bytes), bytes: bytes.length });
  } catch (error) {
    if (error instanceof AssemblyError) throw error;
    throw new AssemblyError(ASSEMBLY.ERROR.BUILD);
  }
}
