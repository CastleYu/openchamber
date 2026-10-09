import { createHash } from 'node:crypto';
import { AGENT_ARTIFACT, AGENT_ERROR, AGENT_OPERATION, AGENT_PACKET, AGENT_SUPPORT } from '../../packages/web/server/lib/agent/constants.js';
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
const operationFiles = (operation, contractFiles) => {
  const schema = contractFiles.get(`${CONTRACT_REFERENCE.EN}/schemas/${operation}.json`);
  const en = contractFiles.get(`${CONTRACT_REFERENCE.EN}/${operation}.md`);
  const zh = contractFiles.get(`${CONTRACT_REFERENCE.ZH}/${operation}.md`);
  if (schema === undefined || en === undefined || zh === undefined) throw new PacketPlanError(PACKET_PLAN.ERROR.INVALID);
  return { schema, en, zh };
};

/** Builds review packets and an immutable protected snapshot description; it never writes or executes candidates. */
export function buildPacketPlan(catalogInput, mappingInput, fixtureInput, bindingInput, documentInput) {
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
    if (!ready.length) throw new PacketPlanError(PACKET_PLAN.ERROR.NO_READY);
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
    files.set(`${PACKET_PLAN.DIRECTORY.PROTECTED}/${PACKET_PLAN.FILE.REGISTRATION}`, json({ operations: packets.map(({ operation, candidateDirectory: directory }) => ({ operation, directory, entry: PACKET_PLAN.FILE.HANDLER, factory: 'createOperation' })), capabilities }));
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
