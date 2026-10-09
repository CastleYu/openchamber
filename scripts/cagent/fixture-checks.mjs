import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AGENT_ATTEMPT, AGENT_ERROR, AGENT_EXTENSION, AGENT_OPERATION, AGENT_PACKET } from '../../packages/web/server/lib/agent/constants.js';
import { AGENT_INPUT_SCHEMAS, AGENT_OUTPUT_SCHEMAS, agentExtensionInputSchema, agentExtensionResponseSchema, agentIdentitySchema, agentServerRequestSchema, agentServerResponseSchema } from '../../packages/web/server/lib/agent/schemas.js';
import { extensionActionIDSchema, extensionManifestSchema, parseExtensionInput, parseExtensionResult } from '../../packages/web/server/lib/agent/extensions.js';

export const FIXTURE = Object.freeze({ VERSION: 1, INVALID: 'invalid-fixtures', REQUEST: 'fixture-request-mismatch', FACTORY: 'fixture-factory-unavailable' });
const exchange = z.object({ request: agentServerRequestSchema, outcome: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('response'), response: agentServerResponseSchema }).strict(),
  z.object({ kind: z.literal('failure'), error: z.enum(Object.values(AGENT_ERROR)) }).strict(),
]) }).strict();
const expected = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('result'), result: z.json() }).strict(),
  z.object({ kind: z.literal('failure'), error: z.enum(Object.values(AGENT_ERROR)) }).strict(),
]);
const caseSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/), input: z.json(),
  identity: agentIdentitySchema, exchanges: z.array(exchange).max(64), expected,
}).strict();
const cases = z.array(caseSchema).min(1).max(AGENT_PACKET.MAX_CHECKS)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length);
const coreFixtureSchema = z.object({
  version: z.literal(FIXTURE.VERSION), operation: z.enum(Object.values(AGENT_OPERATION)),
  cases,
}).strict();
const extensionFixtureSchema = z.object({ version: z.literal(FIXTURE.VERSION), actionID: extensionActionIDSchema,
  manifest: extensionManifestSchema, cases,
}).strict().refine((definition) => definition.manifest.actionID === definition.actionID);
export const fixtureSchema = z.union([coreFixtureSchema, extensionFixtureSchema]);

const extensionResponse = (manifest, input, result) => {
  const response = agentExtensionResponseSchema.parse(result);
  parseExtensionResult(manifest, response.result);
  const receipt = response.receipt;
  if (manifest.effect === AGENT_EXTENSION.EFFECT.READ ? receipt !== undefined
    : !receipt || receipt.requestID !== input.requestID || receipt.state === AGENT_ATTEMPT.UNKNOWN
      || (manifest.outcome === AGENT_EXTENSION.OUTCOME.OBSERVED && receipt.state !== AGENT_ATTEMPT.COMPLETE)) {
    throw new FixtureError(FIXTURE.INVALID);
  }
  return response;
};

export class FixtureError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Host-owned fixtures and factory loading port; candidate code is not a sandbox. */
export function createFixtureChecks(input, loadFactory) {
  const parsed = fixtureSchema.safeParse(input);
  const port = z.function().safeParse(loadFactory);
  if (!parsed.success || !port.success) throw new FixtureError(FIXTURE.INVALID);
  const definition = parsed.data;
  if ('operation' in definition) {
    const inputSchema = AGENT_INPUT_SCHEMAS[definition.operation];
    const outputSchema = AGENT_OUTPUT_SCHEMAS[definition.operation];
    for (const item of definition.cases) {
      if (!inputSchema.safeParse(item.input).success
        || (item.expected.kind === 'result' && !outputSchema.safeParse(item.expected.result).success)) throw new FixtureError(FIXTURE.INVALID);
    }
  } else {
    for (const item of definition.cases) {
      const input = agentExtensionInputSchema.safeParse(item.input);
      if (!input.success || !agentIdentitySchema.safeParse(item.identity).success
        || Boolean(input.data.workspaceID) !== definition.manifest.context.workspace
        || Boolean(input.data.sessionID) !== definition.manifest.context.session
        || Boolean(input.data.requestID) !== (definition.manifest.effect === AGENT_EXTENSION.EFFECT.MUTATION)) throw new FixtureError(FIXTURE.INVALID);
      try {
        parseExtensionInput(definition.manifest, input.data.values);
        if (item.expected.kind === 'result') extensionResponse(definition.manifest, input.data, item.expected.result);
      } catch { throw new FixtureError(FIXTURE.INVALID); }
    }
  }
  return definition.cases.map((item) => Object.freeze({ id: item.id, run: async (sources) => {
    let count = 0;
    let mismatched = false;
    const controller = new AbortController();
    const context = Object.freeze({ request: async (request, identity, control = {}) => {
      const current = item.exchanges[count++];
      if (!current || !isDeepStrictEqual(request, current.request) || !isDeepStrictEqual(identity, item.identity)
        || (('operation' in definition) ? control.signal !== controller.signal || Object.keys(control).some((key) => key !== 'signal')
          : !z.object({}).strict().safeParse(control).success)) {
        mismatched = true;
        throw new FixtureError(FIXTURE.REQUEST);
      }
      if (current.outcome.kind === 'failure') throw new FixtureError(current.outcome.error);
      return structuredClone(current.outcome.response);
    } });
    const factory = z.function().safeParse(await port.data(sources));
    if (!factory.success) throw new FixtureError(FIXTURE.FACTORY);
    const handler = z.function().safeParse(await factory.data(context));
    if (!handler.success) throw new FixtureError(FIXTURE.FACTORY);
    let passed;
    try {
      const result = 'operation' in definition
        ? await handler.data(structuredClone(item.input), structuredClone(item.identity), { signal: controller.signal })
        : await handler.data(structuredClone(item.input), structuredClone(item.identity));
      if ('operation' in definition) {
        const output = AGENT_OUTPUT_SCHEMAS[definition.operation].safeParse(result);
        passed = item.expected.kind === 'result' && output.success && isDeepStrictEqual(output.data, item.expected.result);
      } else {
        const request = agentExtensionInputSchema.parse(item.input);
        const output = extensionResponse(definition.manifest, request, result);
        passed = item.expected.kind === 'result' && isDeepStrictEqual(output, item.expected.result);
      }
    } catch (error) {
      passed = item.expected.kind === 'failure' && error instanceof Error
        && (error.code === item.expected.error || error.message === item.expected.error);
    } finally { controller.abort(); }
    return passed && !mismatched && count === item.exchanges.length;
  } }));
}
