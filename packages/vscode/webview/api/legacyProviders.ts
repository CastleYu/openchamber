import { z } from 'zod';
import { LEGACY_PROVIDER_BRIDGE } from '../../legacyProviderBridge';
import { sendBridgeMessage, sendBridgeMessageWithOptions } from './bridge';
import { extractJsonBody } from '../requestBodyTransport';

const responseSchema = z.object({ status: z.number().int().min(100).max(599), body: z.json() }).strict();

export async function legacyProviderFetch(path: string, input: RequestInfo | URL, init: RequestInit | undefined, method: string): Promise<Response> {
  const signal = init?.signal !== undefined ? init.signal : input instanceof Request ? input.signal : undefined;
  const body = method === 'POST' ? await extractJsonBody(input, init, method) : undefined;
  const raw = await sendBridgeMessageWithOptions<z.infer<ReturnType<typeof z.json>>>(LEGACY_PROVIDER_BRIDGE.REQUEST, { method, path, body }, {
    timeoutMs: 0,
    signal: signal ?? undefined,
    onAbort: requestID => { void sendBridgeMessage(LEGACY_PROVIDER_BRIDGE.ABORT, { requestID }).catch(() => {}); },
  });
  const result = responseSchema.parse(raw);
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
