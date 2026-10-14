import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ACP_SERVER_MODE, serverSchema } from '../acp/server-transport.js';

const CONNECTION_MODE = Object.freeze({ EXTERNAL: 'external', COMMAND: 'command', PATH: 'path', BUNDLED: 'bundled', ACP: 'acp' });
const CONNECTION_STATUS = Object.freeze({ UNCONFIGURED: 'unconfigured', STARTING: 'starting', READY: 'ready', FAILED: 'failed' });
export const isAcpConnection = (config) => config?.mode === CONNECTION_MODE.ACP || config?.mode === ACP_SERVER_MODE;
const OPENCODE_CONFIG_ROUTES = Object.freeze([
  '/api/config/agents', '/api/config/commands', '/api/config/mcp',
  '/api/config/snippets', '/api/config/skills', '/api/config/plugins',
  '/api/config/websearch', '/api/config/warming', '/api/config/reload',
  '/api/config/opencode-resolution',
]);

const commandSchema = z.string().trim().min(1, 'Enter an executable command');
const originSchema = z.url().transform((value) => new URL(value)).refine((url) =>
  ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
  'Enter an HTTP or HTTPS server origin without credentials or a path',
).transform((url) => url.origin);
const connectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal(CONNECTION_MODE.EXTERNAL), url: originSchema }),
  z.object({ mode: z.literal(CONNECTION_MODE.PATH) }),
  z.object({ mode: z.literal(CONNECTION_MODE.BUNDLED) }),
  z.object({ mode: z.literal(CONNECTION_MODE.COMMAND), command: commandSchema, args: z.array(z.string()) }),
  z.object({ mode: z.literal(CONNECTION_MODE.ACP), command: commandSchema, args: z.array(z.string()), cwd: z.string().trim().refine(path.isAbsolute, 'ACP working directory must be absolute').optional() }),
  serverSchema,
]);
export const parseAgentConnection = (value) => connectionSchema.parse(value);

export const createAgentConnection = ({ filePath, startOpenCode, stopOpenCode, acpRuntime, prefill = {}, defaultCwd = process.cwd(), openCodeStatus = () => null }) => {
  let config = null;
  let status = CONNECTION_STATUS.UNCONFIGURED;
  let error = null;
  let applying = false;
  const snapshot = () => {
    if (status === CONNECTION_STATUS.READY && isAcpConnection(config) && acpRuntime.descriptor().generation !== CONNECTION_MODE.ACP) {
      status = CONNECTION_STATUS.FAILED;
      error = 'ACP agent disconnected. Apply the connection to retry.';
    }
    const failure = status === CONNECTION_STATUS.READY && !isAcpConnection(config) ? openCodeStatus() : null;
    return { config, status: failure ? CONNECTION_STATUS.FAILED : status, error: failure || error, prefill: { ...prefill, cwd: defaultCwd } };
  };
  const apply = async (next, persist = true) => {
    if (applying) throw Object.assign(new Error('An agent connection change is already running'), { statusCode: 409 });
    const parsed = parseAgentConnection(next);
    if (parsed.mode === CONNECTION_MODE.ACP) parsed.cwd ??= defaultCwd;
    applying = true;
    try {
      if (persist) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(`${filePath}.tmp`, JSON.stringify(parsed, null, 2));
        await fs.rename(`${filePath}.tmp`, filePath);
      }
      config = parsed;
      status = CONNECTION_STATUS.STARTING;
      error = null;
      await stopOpenCode();
      await acpRuntime.stop();
      if (isAcpConnection(config)) await acpRuntime.start(config);
      else await startOpenCode(config);
      status = CONNECTION_STATUS.READY;
    } catch (cause) {
      if (status === CONNECTION_STATUS.STARTING) {
        await stopOpenCode().catch(() => {});
        await acpRuntime.stop().catch(() => {});
      }
      status = CONNECTION_STATUS.FAILED;
      error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally { applying = false; }
    return snapshot();
  };
  const bootstrap = async () => {
    try {
      await stopOpenCode();
      await acpRuntime.stop();
      const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
      await apply(saved, false);
    } catch (cause) {
      if (cause.code !== 'ENOENT') {
        status = CONNECTION_STATUS.FAILED;
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }
    return snapshot();
  };
  return { snapshot, apply, bootstrap, selected: () => config };
};

export const registerAgentConnectionRoutes = (app, { express, connection }) => {
  app.get('/api/agent/connection', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(connection.snapshot());
  });
  app.post('/api/agent/connection', express.json(), async (req, res) => {
    try {
      let config;
      try { config = parseAgentConnection(req.body); }
      catch (cause) { throw Object.assign(cause, { statusCode: 400 }); }
      res.json(await connection.apply(config));
    }
    catch (error) { res.status(error.statusCode || 502).json({ ...connection.snapshot(), error: error.message }); }
  });
  app.use((req, res, next) => {
    const acpSelected = isAcpConnection(connection.selected());
    const acpRoute = req.path === '/api/acp' || req.path.startsWith('/api/acp/');
    const openCodeRoute = req.path.startsWith('/api/opencode/') && req.path !== '/api/opencode/runtime';
    const configRoute = OPENCODE_CONFIG_ROUTES.some((route) => req.path === route || req.path.startsWith(`${route}/`));
    const providerRoute = req.path === '/api/provider' || req.path.startsWith('/api/provider/');
    if (acpRoute && !acpSelected) return res.status(409).json({ error: 'Select an ACP agent connection first' });
    if (acpSelected && (openCodeRoute || configRoute || providerRoute)) return res.status(409).json({ error: 'This operation requires an OpenCode connection' });
    return next();
  });
};
