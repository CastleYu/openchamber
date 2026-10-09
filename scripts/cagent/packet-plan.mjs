import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AGENT_ARTIFACT, AGENT_ERROR, AGENT_EXTENSION, AGENT_OPERATION, AGENT_PACKET, AGENT_SUPPORT } from '../../packages/web/server/lib/agent/constants.js';
import { extensionActionIDSchema, extensionManifestSchema } from '../../packages/web/server/lib/agent/extensions.js';
import { compileExtensions } from './extension-mapping.mjs';
import { agentArtifactDigest } from '../../packages/web/server/lib/agent/artifacts.js';
import { MAPPING_CATALOG_SCHEMA, MAPPING_SCHEMA, compileMapping, MAPPING, MappingError } from './mapping-intake.mjs';
import { buildContractPages, CONTRACT_REFERENCE } from './contract-pages.mjs';
import { OPERATION_REFERENCE } from './operation-reference.mjs';
import { z } from 'zod';
import { createFixtureChecks, FIXTURE, FixtureError } from './fixture-checks.mjs';
import { compileBindings, DeclarativeError, DECLARATIVE } from './declarative-codec.mjs';
import { compileDocuments, packetDocuments, DocumentError, DOCUMENT } from './document-excerpts.mjs';

export const PACKET_PLAN = Object.freeze({
  VERSION: 1,
  ERROR: Object.freeze({ INVALID: 'invalid-packet-plan', NO_READY: 'no-ready-operations' }),
  DIRECTORY: Object.freeze({ PROTECTED: 'protected', CANDIDATE: 'candidate', CONTROL: 'control' }),
  FILE: Object.freeze({ REGISTRATION: 'registration.json', MANIFEST: 'manifest.json', COVERAGE: 'coverage.json', PACKET: 'packet.json', MAPPING: 'mapping.json', SCHEMA: 'schema.json', REFERENCE_EN: 'reference.en.md', REFERENCE_ZH: 'reference.zh-CN.md', HANDLER: 'handler.mjs', FIXTURES: 'fixtures.json' }),
  CHECK: Object.freeze({ SCOPE: 'syntax-only', SEMANTIC: 'semantic-fixtures', STATUS: 'awaiting-implementation', GENERATED: 'awaiting-validation' }),
});

export class PacketPlanError extends Error {
  constructor(code) {
    super('Packet plan rejected');
    this.name = 'PacketPlanError';
    this.code = code;
  }
}

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const json = (value) => `${JSON.stringify(canonical(value), null, 2)}\n`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const freeze = (value) => {
  if (value !== null && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const handler = (operation) => `const OPERATION = Object.freeze({ ID: '${operation}', REFUSAL: '${AGENT_ERROR.UNVERIFIED}' });\n\nexport function createOperation(context) {\n  return async function handler(input, identity, control = {}) {\n    void context;\n    void input;\n    void identity;\n    void control;\n    throw new Error(OPERATION.REFUSAL);\n  };\n}\n`;
const extensionInputSchema = z.object({ manifests: z.array(extensionManifestSchema).max(AGENT_EXTENSION.MAX_ACTIONS)
  .refine((items) => new Set(items.map((item) => item.actionID)).size === items.length),
  fixtures: z.record(extensionActionIDSchema, z.json()),
}).strict();
const extensionHandler = () => `const REFUSAL = '${AGENT_ERROR.UNVERIFIED}';\nexport function createExtension(context) {\n  return async function handler(input, identity) {\n    void context; void input; void identity;\n    throw new Error(REFUSAL);\n  };\n}\n`;
const operationFiles = (operation, contractFiles) => {
  const schema = contractFiles.get(`${CONTRACT_REFERENCE.EN}/schemas/${operation}.json`);
  const en = contractFiles.get(`${CONTRACT_REFERENCE.EN}/${operation}.md`);
  const zh = contractFiles.get(`${CONTRACT_REFERENCE.ZH}/${operation}.md`);
  if (schema === undefined || en === undefined || zh === undefined) throw new PacketPlanError(PACKET_PLAN.ERROR.INVALID);
  return { schema, en, zh };
};

/** Builds review packets and an immutable protected snapshot description; it never writes or executes candidates. */
export function buildPacketPlan(catalogInput, mappingInput, fixtureInput, bindingInput, documentInput, extensionInput) {
  try {
    const coverage = compileMapping(catalogInput, mappingInput);
    const catalog = MAPPING_CATALOG_SCHEMA.parse(catalogInput);
    const mapping = MAPPING_SCHEMA.parse(mappingInput);
    if (bindingInput !== undefined && fixtureInput === undefined) throw new PacketPlanError(FIXTURE.INVALID);
    const generated = bindingInput === undefined ? null : compileBindings(catalogInput, mappingInput, bindingInput);
    const excerpts = documentInput === undefined ? null : compileDocuments(catalogInput, documentInput);
    const contract = buildContractPages();
    const ready = Object.values(AGENT_OPERATION).filter((operation) =>
      mapping.operations[operation].kind === MAPPING.OPERATION_KIND.MAPPING && coverage.operations[operation] === MAPPING.STATE.READY);
    const extra = extensionInput === undefined ? null : extensionInputSchema.parse(extensionInput);
    const inventory = extra ? compileExtensions(catalogInput, mappingInput, extra.manifests) : null;
    if (!ready.length && !extra?.manifests.length) throw new PacketPlanError(PACKET_PLAN.ERROR.NO_READY);
    if (extra && (Object.keys(extra.fixtures).length !== extra.manifests.length
      || extra.manifests.some((manifest) => !Object.hasOwn(extra.fixtures, manifest.actionID)))) throw new PacketPlanError(FIXTURE.INVALID);
    const fixtures = fixtureInput === undefined ? null : z.partialRecord(z.enum(Object.values(AGENT_OPERATION)), z.json()).safeParse(fixtureInput);
    if (fixtures && (!fixtures.success || Object.keys(fixtures.data).length !== ready.length
      || ready.some((operation) => !Object.hasOwn(fixtures.data, operation)))) throw new PacketPlanError(FIXTURE.INVALID);

    const files = new Map();
    const candidateDirectory = (operation) => `${PACKET_PLAN.DIRECTORY.CANDIDATE}/${operation}`;
    const packets = ready.map((operation) => {
      const row = mapping.operations[operation];
      const endpoints = row.endpointIDs.map((id) => catalog.endpoints.find((endpoint) => endpoint.id === id));
      if (endpoints.some((endpoint) => !endpoint)) throw new PacketPlanError(PACKET_PLAN.ERROR.INVALID);
      const citations = [...row.endpointIDs.flatMap((id) => catalog.endpoints.find((endpoint) => endpoint.id === id).citations), ...Object.values(row.evidence).flat()];
      const docs = [...new Set(citations.map((item) => item.document))].sort();
      const documents = docs.map((id) => {
        const source = catalog.documents.find((document) => document.id === id);
        const sections = [...new Set(citations.filter((item) => item.document === id).map((item) => item.section))].sort();
        return source ? { id: source.id, revision: source.revision, digest: source.digest, sections } : undefined;
      });
      if (documents.some((document) => !document)) throw new PacketPlanError(PACKET_PLAN.ERROR.INVALID);
      const candidate = candidateDirectory(operation);
      const definition = fixtures?.data[operation];
      if (fixtures && (definition?.operation !== operation || !createFixtureChecks(definition, async () => null).length)) throw new PacketPlanError(FIXTURE.INVALID);
      const packet = freeze({
        operation, goal: OPERATION_REFERENCE[operation].en.goal, citations, candidateDirectory: candidate,
        files: [PACKET_PLAN.FILE.HANDLER], dependsOn: [],
        checkCommand: definition
          ? ['bun', 'scripts/cagent/check-packet.mjs', '--workspace', '<workspace>', '--operation', operation, '--node', '<node>', '--kit-digest', '<protected-digest>', '--json']
          : ['node', '--check', `${candidate}/${PACKET_PLAN.FILE.HANDLER}`],
        checkScope: definition ? PACKET_PLAN.CHECK.SEMANTIC : PACKET_PLAN.CHECK.SCOPE,
        status: generated?.sources.has(operation) ? PACKET_PLAN.CHECK.GENERATED : PACKET_PLAN.CHECK.STATUS,
        maxCorrections: AGENT_PACKET.MAX_CORRECTIONS,
        mappingDigest: coverage.digest, referenceDigest: contract.digest,
      });
      const local = operationFiles(operation, contract.files);
      const base = `${PACKET_PLAN.DIRECTORY.PROTECTED}/${operation}`;
      if (excerpts) files.set(`${base}/${DOCUMENT.FILE}`, packetDocuments(excerpts, documents));
      files.set(`${candidate}/${PACKET_PLAN.FILE.HANDLER}`, generated?.sources.get(operation) ?? handler(operation));
      if (generated?.sources.has(operation)) files.set(`${base}/${DECLARATIVE.FILE}`, json(generated.bindings.operations[operation]));
      files.set(`${base}/${PACKET_PLAN.FILE.PACKET}`, json(packet));
      files.set(`${base}/${PACKET_PLAN.FILE.MAPPING}`, json({ operation, row, endpoints, documents }));
      files.set(`${base}/${PACKET_PLAN.FILE.SCHEMA}`, local.schema);
      if (definition) files.set(`${base}/${PACKET_PLAN.FILE.FIXTURES}`, json(definition));
      files.set(`${base}/${PACKET_PLAN.FILE.REFERENCE_EN}`, local.en);
      files.set(`${base}/${PACKET_PLAN.FILE.REFERENCE_ZH}`, local.zh);
      return packet;
    });

    const capabilities = Object.fromEntries(Object.values(AGENT_OPERATION).map((operation) => [operation, { state: AGENT_SUPPORT.UNVERIFIED, evidence: [] }]));
    const registration = { operations: packets.map(({ operation, candidateDirectory: directory }) => ({ operation, directory, entry: PACKET_PLAN.FILE.HANDLER, factory: 'createOperation' })), capabilities };
    if (extra) {
      registration.extensions = [];
      for (const manifest of [...extra.manifests].sort((a, b) => a.actionID < b.actionID ? -1 : a.actionID > b.actionID ? 1 : 0)) {
        const operation = manifest.actionID;
        const definition = extra.fixtures[operation];
        if (definition?.actionID !== operation || !isDeepStrictEqual(extensionManifestSchema.parse(definition.manifest), manifest)
          || !createFixtureChecks(definition, async () => null).length) throw new PacketPlanError(FIXTURE.INVALID);
        const row = inventory.actions.find((action) => action.actionID === operation);
        const endpoints = row.endpointIDs.map((id) => catalog.endpoints.find((endpoint) => endpoint.id === id));
        const citations = [...manifest.evidence, ...endpoints.flatMap((endpoint) => endpoint.citations)];
        const documents = [...new Set(citations.map((ref) => ref.document))].sort().map((id) => {
          const source = catalog.documents.find((document) => document.id === id);
          return { id, revision: source.revision, digest: source.digest,
            sections: [...new Set(citations.filter((ref) => ref.document === id).map((ref) => ref.section))].sort() };
        });
        const candidate = candidateDirectory(operation);
        const packet = freeze({ operation, goal: manifest.label.en, citations, candidateDirectory: candidate,
          files: [PACKET_PLAN.FILE.HANDLER], dependsOn: [], checkScope: PACKET_PLAN.CHECK.SEMANTIC,
          checkCommand: ['bun', 'scripts/cagent/check-packet.mjs', '--workspace', '<workspace>', '--operation', operation, '--node', '<node>', '--kit-digest', '<protected-digest>', '--json'],
          status: PACKET_PLAN.CHECK.STATUS, maxCorrections: AGENT_PACKET.MAX_CORRECTIONS, mappingDigest: coverage.digest });
        const base = `${PACKET_PLAN.DIRECTORY.PROTECTED}/${operation}`;
        files.set(`${candidate}/${PACKET_PLAN.FILE.HANDLER}`, extensionHandler());
        files.set(`${base}/${PACKET_PLAN.FILE.PACKET}`, json(packet));
        files.set(`${base}/${PACKET_PLAN.FILE.MAPPING}`, json({ actionID: operation, row, endpoints, documents }));
        files.set(`${base}/${PACKET_PLAN.FILE.MANIFEST}`, json(manifest));
        files.set(`${base}/${PACKET_PLAN.FILE.FIXTURES}`, json(definition));
        if (excerpts) files.set(`${base}/${DOCUMENT.FILE}`, packetDocuments(excerpts, documents));
        files.set(`${base}/${PACKET_PLAN.FILE.REFERENCE_EN}`, `# ${operation}\n\nImplement only createExtension(context) in the assigned handler.mjs. Use the protected manifest, mapping, documented excerpts and fixtures. The handler receives { values, declared workspaceID/sessionID, requestID for mutations } and current identity. Return { result, receipt? }; mutation receipts must match requestID and documented completion. Never invent routes, grant approval or edit protected files. Run the supplied check command; stop after the correction limit. Passing fixtures do not enable this action.\n`);
        files.set(`${base}/${PACKET_PLAN.FILE.REFERENCE_ZH}`, `# ${operation}\n\n仅在指定 handler.mjs 实现 createExtension(context)。使用受保护清单、映射、文档摘录和夹具。处理器接收 { values, 已声明的 workspaceID/sessionID, 变更的 requestID } 及当前身份。返回 { result, receipt? }；变更回执必须匹配 requestID 及文档完成语义。不得编造路由、授予批准或修改受保护文件。执行提供的检查命令，到达修正上限即停止。夹具通过不启用动作。\n`);
        registration.extensions.push({ actionID: operation, directory: candidate, entry: PACKET_PLAN.FILE.HANDLER, factory: 'createExtension', manifest });
        packets.push(packet);
      }
      files.set(`${PACKET_PLAN.DIRECTORY.PROTECTED}/extension-coverage.json`, json(inventory));
    }
    files.set(`${PACKET_PLAN.DIRECTORY.PROTECTED}/${PACKET_PLAN.FILE.REGISTRATION}`, json(registration));
    files.set(`${PACKET_PLAN.DIRECTORY.PROTECTED}/${PACKET_PLAN.FILE.COVERAGE}`, json(coverage));
    const protectedFiles = [...files].filter(([path]) => path.startsWith(`${PACKET_PLAN.DIRECTORY.PROTECTED}/`))
      .map(([path, contents]) => ({ path: path.slice(`${PACKET_PLAN.DIRECTORY.PROTECTED}/`.length), bytes: Buffer.byteLength(contents), digest: hash(contents) }))
      .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const artifactDigest = agentArtifactDigest(protectedFiles);
    files.set(`${PACKET_PLAN.DIRECTORY.CONTROL}/${PACKET_PLAN.FILE.MANIFEST}`, json({ version: AGENT_ARTIFACT.VERSION, files: protectedFiles, artifactDigest }));
    return freeze({ version: PACKET_PLAN.VERSION, digest: artifactDigest, coverage, packets, files });
  } catch (error) {
    if (error instanceof FixtureError) throw new PacketPlanError(FIXTURE.INVALID);
    if (error instanceof PacketPlanError || error instanceof MappingError || error instanceof DeclarativeError || error instanceof DocumentError) throw error;
    throw new PacketPlanError(PACKET_PLAN.ERROR.INVALID);
  }
}
