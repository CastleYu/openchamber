import { runtimeFetch } from '@/lib/runtime-fetch';

const READ_TIMEOUT_MS = 30_000;

type TimeoutLease = { signal: AbortSignal; cleanup: () => void };

export const createTimeoutSignal = (milliseconds: number): TimeoutLease => {
  const native = AbortSignal.timeout?.(milliseconds);
  if (native) return { signal: native, cleanup: () => undefined };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
};

/** Both SDK generations use this one runtime-aware fetch implementation. */
export const createOpenCodeFetch = (options: { requestTimeoutMs?: number; assertProtocol?: () => void } = {}): typeof fetch => {
  const requestTimeoutMs = options.requestTimeoutMs ?? READ_TIMEOUT_MS;
  return async (input: string | URL | Request, init?: RequestInit) => {
    options.assertProtocol?.();
    const url = input instanceof Request ? input.url : String(input);
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.includes('/event') || method === 'POST') return runtimeFetch(input, init);

    const timeout = createTimeoutSignal(requestTimeoutMs);
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const anySignal = AbortSignal.any?.bind(AbortSignal);
    let signal: AbortSignal;
    let detach: (() => void) | null = null;
    if (callerSignal && anySignal) {
      signal = anySignal([callerSignal, timeout.signal]);
    } else if (callerSignal) {
      const controller = new AbortController();
      const fromCaller = () => controller.abort(callerSignal.reason);
      const fromTimeout = () => controller.abort(timeout.signal.reason);
      if (callerSignal.aborted) fromCaller();
      else if (timeout.signal.aborted) fromTimeout();
      else {
        callerSignal.addEventListener('abort', fromCaller, { once: true });
        timeout.signal.addEventListener('abort', fromTimeout, { once: true });
        detach = () => {
          callerSignal.removeEventListener('abort', fromCaller);
          timeout.signal.removeEventListener('abort', fromTimeout);
        };
      }
      signal = controller.signal;
    } else {
      signal = timeout.signal;
    }
    const cleanup = () => { detach?.(); timeout.cleanup(); };
    let responseHasBody = false;
    try {
      const response = await runtimeFetch(input, { ...init, signal });
      responseHasBody = response.body !== null;
      return response;
    } catch (error) {
      if (timeout.signal.aborted && !callerSignal?.aborted) {
        throw new Error(`OpenCode request timed out after ${requestTimeoutMs}ms`);
      }
      throw error;
    } finally {
      if (!responseHasBody || signal.aborted) cleanup();
      else signal.addEventListener('abort', cleanup, { once: true });
    }
  };
};
