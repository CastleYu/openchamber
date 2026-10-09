import { createHash } from 'node:crypto';
import { z } from 'zod';
import ts from 'typescript';

import { AGENT_OPERATION, AGENT_SUPPORT, AGENT_PACKET } from '../../packages/web/server/lib/agent/constants.js';

export const ASSEMBLY = Object.freeze({
  LIMIT: Object.freeze({ SOURCES: Object.keys(AGENT_OPERATION).length, SOURCE_BYTES: AGENT_PACKET.MAX_FILE_BYTES, TOTAL_BYTES: AGENT_PACKET.MAX_TOTAL_BYTES }),
  ERROR: Object.freeze({ INPUT: 'invalid-assembly-input', SOURCE: 'invalid-operation-source', BUILD: 'assembly-build-failed' }),
  VIRTUAL: Object.freeze({ PREFIX: 'cagent-operation:' }),
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
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safeSource = (text) => {
  if (Buffer.byteLength(text) > ASSEMBLY.LIMIT.SOURCE_BYTES) return false;
  try {
    const scan = new Bun.Transpiler({ loader: 'js', target: 'node' }).scan(text);
    if (scan.imports.length !== 0 || scan.exports.length !== 1 || scan.exports[0] !== 'createOperation') return false;
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

const entry = (items) => {
  const imports = items.map(({ operation }, index) =>
    `import { createOperation as operation${index} } from '${ASSEMBLY.VIRTUAL.PREFIX}${operation}';`).join('\n');
  const rows = items.map(({ operation }, index) =>
    `[${JSON.stringify(operation)}, operation${index}]`).join(',\n    ');
  const all = JSON.stringify(operations);
  return `${imports}\nconst factories = new Map([${rows ? `\n    ${rows}\n  ` : ''}]);\nconst operations = ${all};\nexport async function createAdapter(context) {\n  const handlers = {};\n  for (const [id, factory] of factories) handlers[id] = await factory(context);\n  const capabilities = Object.fromEntries(operations.map((id) => [id, { state: '${AGENT_SUPPORT.UNVERIFIED}', evidence: [] }]));\n  return { handlers, capabilities };\n}\n`;
};

/** Bundles only supplied operation text into one deterministic in-memory module. */
export async function assembleAdapter(sources) {
  try {
    if (!Array.isArray(sources) || sources.length === 0 || sources.length > ASSEMBLY.LIMIT.SOURCES) {
      throw new AssemblyError(ASSEMBLY.ERROR.INPUT);
    }
    const items = sources.map((source) => {
      const parsed = sourceSchema.safeParse(source);
      if (!parsed.success || Object.getPrototypeOf(source) !== Object.prototype || !known.has(parsed.data.operation)
        || !safeSource(parsed.data.text)) {
        throw new AssemblyError(ASSEMBLY.ERROR.SOURCE);
      }
      return { operation: parsed.data.operation, text: parsed.data.text };
    }).sort((left, right) => left.operation < right.operation ? -1 : left.operation > right.operation ? 1 : 0);
    if (new Set(items.map(({ operation }) => operation)).size !== items.length
      || items.reduce((size, item) => size + Buffer.byteLength(item.text), 0) > ASSEMBLY.LIMIT.TOTAL_BYTES) {
      throw new AssemblyError(ASSEMBLY.ERROR.INPUT);
    }
    const byId = new Map(items.map(({ operation, text }) => [operation, text]));
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
          return { errors: [{ text: 'import refused' }] };
        });
        build.onLoad({ filter: /.*/, namespace: 'cagent-adapter' }, () => ({ contents: entry(items), loader: 'js' }));
        build.onLoad({ filter: /.*/, namespace: 'cagent-operation' }, ({ path: operation }) => ({ contents: byId.get(operation), loader: 'js' }));
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
