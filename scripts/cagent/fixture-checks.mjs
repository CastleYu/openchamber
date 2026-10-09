import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AGENT_ERROR, AGENT_OPERATION, AGENT_PACKET } from '../../packages/web/server/lib/agent/constants.js';
import { AGENT_INPUT_SCHEMAS, AGENT_OUTPUT_SCHEMAS, agentIdentitySchema, agentServerRequestSchema, agentServerResponseSchema } from '../../packages/web/server/lib/agent/schemas.js';

export const FIXTURE = Object.freeze({ VERSION: 1, INVALID: 'invalid-fixtures', REQUEST: 'fixture-request-mismatch', FACTORY: 'fixture-factory-unavailable' });
const exchange = z.object({ request: agentServerRequestSchema, outcome: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('response'), response: agentServerResponseSchema }).strict(),
  z.object({ kind: z.literal('failure'), error: z.enum(Object.values(AGENT_ERROR)) }).strict(),
]) }).strict();
const expected = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('result'), result: z.json() }).strict(),
  z.object({ kind: z.literal('failure'), error: z.enum(Object.values(AGENT_ERROR)) }).strict(),
]);
export const fixtureSchema = z.object({
  version: z.literal(FIXTURE.VERSION), operation: z.enum(Object.values(AGENT_OPERATION)),
  cases: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/), input: z.json(),
    identity: agentIdentitySchema, exchanges: z.array(exchange).max(64), expected,
  }).strict()).min(1).max(AGENT_PACKET.MAX_CHECKS).refine((cases) => new Set(cases.map((item) => item.id)).size === cases.length),
}).strict();

export class FixtureError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Host-owned fixtures and factory loading port; candidate code is not a sandbox. */
export function createFixtureChecks(input, loadFactory) {
  const parsed = fixtureSchema.safeParse(input);
  const port = z.function().safeParse(loadFactory);
  if (!parsed.success || !port.success) throw new FixtureError(FIXTURE.INVALID);
  const definition = parsed.data;
  const inputSchema = AGENT_INPUT_SCHEMAS[definition.operation];
  const outputSchema = AGENT_OUTPUT_SCHEMAS[definition.operation];
  for (const item of definition.cases) {
    if (!inputSchema.safeParse(item.input).success
      || (item.expected.kind === 'result' && !outputSchema.safeParse(item.expected.result).success)) {
      throw new FixtureError(FIXTURE.INVALID);
    }
  }
  return definition.cases.map((item) => Object.freeze({ id: item.id, run: async (sources) => {
    let count = 0;
    let mismatched = false;
    const controller = new AbortController();
    const context = Object.freeze({ request: async (request, identity, control = {}) => {
      const current = item.exchanges[count++];
      if (!current || !isDeepStrictEqual(request, current.request) || !isDeepStrictEqual(identity, item.identity)
        || control.signal !== controller.signal || Object.keys(control).some((key) => key !== 'signal')) {
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
      const result = await handler.data(structuredClone(item.input), structuredClone(item.identity), { signal: controller.signal });
      const output = outputSchema.safeParse(result);
      passed = item.expected.kind === 'result' && output.success && isDeepStrictEqual(output.data, item.expected.result);
    } catch (error) {
      passed = item.expected.kind === 'failure' && error instanceof Error
        && (error.code === item.expected.error || error.message === item.expected.error);
    } finally { controller.abort(); }
    return passed && !mismatched && count === item.exchanges.length;
  } }));
}
