import { createHash } from 'node:crypto';
import { z } from 'zod';

const contextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('client'), clientId: z.string().min(1) }),
  z.object({ type: z.literal('session'), token: z.string().min(1) }),
]);

/** Authentication owns verification. Only an opaque scope leaves this boundary. */
export const createAgentPrincipalResolver = ({ getUiAuth }) => async (req) => {
  const auth = getUiAuth();
  if (!auth?.resolveVerifiedAuthContext) return null;
  const parsed = contextSchema.safeParse(await auth.resolveVerifiedAuthContext(req));
  if (!parsed.success) return null;
  const context = parsed.data;
  const key = context.type === 'client' ? context.clientId : context.token;
  return `principal-${createHash('sha256').update(JSON.stringify([context.type, key])).digest('hex')}`;
};
