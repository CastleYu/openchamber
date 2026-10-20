import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createLegacyProviderRequest, LEGACY_PROVIDER_ROUTE as ROUTE } from './legacy-provider-request.js';

const CALLER = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), token: z.string().min(1) }),
  z.object({ type: z.literal('client'), clientId: z.string().min(1) }),
]);
const PREFIX = 'legacy-provider-';
const PATHS = [ROUTE.METHODS, ROUTE.SOURCES, ROUTE.SAVE, ROUTE.DISCONNECT, ROUTE.BEGIN, ROUTE.AUTHORIZE, ROUTE.CALLBACK, ROUTE.CANCEL];
function createLegacyProviderCaller({ getUiAuth }) {
  return async (req, res) => {
    try {
      const auth = getUiAuth();
      if (!auth) return null;
      let admitted = false;
      await auth.requireAuth(req, res, () => { admitted = true; });
      if (!admitted) return null;
      let context = await auth.resolveVerifiedAuthContext(req);
      if (!context && auth.enabled === false) context = await auth.resolveAuthContext(req, res, { allowClientAuth: true, allowUrlToken: false });
      const parsed = CALLER.safeParse(context);
      if (!parsed.success) return null;
      const key = parsed.data.type === 'session' ? parsed.data.token : parsed.data.clientId;
      return `${PREFIX}${createHash('sha256').update(JSON.stringify([parsed.data.type, key])).digest('hex')}`;
    } catch { return null; }
  };
}
function requestSignal(req, res) {
  const controller = new AbortController();
  const aborted = () => controller.abort();
  const closed = () => { if (!res.writableEnded) controller.abort(); };
  req.once('aborted', aborted);
  res.once('close', closed);
  if (req.aborted || res.destroyed) controller.abort();
  return { signal: controller.signal, detach: () => { req.removeListener('aborted', aborted); res.removeListener('close', closed); } };
}
function createLegacyProviderHttp({ api, getRuntime, resolveCaller }) {
  const dispatch = createLegacyProviderRequest({ api, getRuntime });
  const register = app => {
    const handle = async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const transport = requestSignal(req, res);
      if (transport.signal.aborted) { transport.detach(); return undefined; }
      try {
        let caller;
        try { caller = await resolveCaller(req, res); }
        catch { if (res.headersSent) return undefined; caller = null; }
        if (res.headersSent || transport.signal.aborted) return undefined;
        const result = await dispatch({ method: req.method, path: req.originalUrl.split('?')[0], body: req.body, caller, signal: transport.signal });
        if (transport.signal.aborted || res.destroyed || res.writableEnded) return undefined;
        return res.status(result.status).json(result.body);
      } finally { transport.detach(); }
    };
    for (const path of PATHS) app.all(`${ROUTE.BASE}${path}`, handle);
    app.use(ROUTE.BASE, (req, res, next) => {
      const path = req.originalUrl.split('?')[0];
      if (!path.startsWith(ROUTE.BASE + '/')) return next();
      res.set('Cache-Control', 'no-store');
      return res.status(req.method === 'POST' ? 404 : 405).json({ error: 'Provider request failed' });
    });
    return app;
  };
  return { register };
}
export { createLegacyProviderCaller, createLegacyProviderHttp };

