import { z } from 'zod';

const choice = z.object({ value: z.string(), label: z.string() });
const base = { key: z.string(), title: z.string().optional(), description: z.string().optional(), required: z.boolean() };
const acpFieldSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('string'), minLength: z.number().optional(), maxLength: z.number().optional(), format: z.enum(['email', 'uri', 'date', 'date-time']).optional(), choices: z.array(choice).optional(), default: z.string().optional() }),
  z.object({ ...base, type: z.enum(['number', 'integer']), minimum: z.number().optional(), maximum: z.number().optional(), default: z.number().optional() }),
  z.object({ ...base, type: z.literal('boolean'), default: z.boolean().optional() }),
  z.object({ ...base, type: z.literal('array'), choices: z.array(choice), minItems: z.number().optional(), maxItems: z.number().optional(), default: z.array(z.string()).optional() }),
]);
const interaction = { id: z.string(), agent: z.string(), message: z.string(), state: z.enum(['pending', 'waiting']) };
const form = { mode: z.literal('form'), fields: z.array(acpFieldSchema) };
const url = { mode: z.literal('url'), url: z.url().refine((value) => { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password; }), elicitationId: z.string() };
const session = { ...interaction, scope: z.literal('session'), sessionID: z.string(), toolCallID: z.string().optional() };
const request = { ...interaction, scope: z.literal('request'), requestID: z.union([z.string(), z.number()]) };
const acpSessionInputSchema = z.discriminatedUnion('mode', [z.object({ ...session, ...form }), z.object({ ...session, ...url })]);
export const acpConnectionInputSchema = z.discriminatedUnion('mode', [z.object({ ...request, ...form }), z.object({ ...request, ...url })]);
export const acpTaggedInputSchema = z.object({ generation: z.literal('acp'), kind: z.literal('elicitation'), value: acpSessionInputSchema });
export type AcpSessionInput = z.infer<typeof acpSessionInputSchema>;
export type AcpConnectionInput = z.infer<typeof acpConnectionInputSchema>;
export type AcpInteraction = AcpSessionInput | AcpConnectionInput;
export type AcpField = z.infer<typeof acpFieldSchema>;
export type AcpValues = { [key: string]: string | number | boolean | string[] };
export type AcpAnswer = { action: 'accept' | 'decline' | 'cancel'; content?: AcpValues };
export const acpInfoSchema = z.object({ epoch: z.number(), agentInfo: z.object({ name: z.string(), title: z.string().optional(), version: z.string() }).optional(), authMethods: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional(), type: z.string().optional() })).default([]), error: z.string().nullable() });
export type AcpInfo = z.infer<typeof acpInfoSchema>;
