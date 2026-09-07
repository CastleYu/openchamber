import express from 'express';
import path from 'path';

const isObjectRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const DIAGNOSTIC_REPEAT_SUPPRESS_MS = 30_000;

const isValidSource = (source) => source === 'status' || source === 'connect' || source === 'auth' || source === 'test';

const validateDiagnosticPayload = (body) => {
  if (!isObjectRecord(body)) return null;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) return null;
  const error = typeof body.error === 'string' ? body.error.trim() : '';
  if (!error || error.length > 4000) return null;
  const directory = typeof body.directory === 'string' && body.directory.trim() ? body.directory.trim() : null;
  if (directory && directory.length > 1024) return null;
  if (!isValidSource(body.source)) return null;
  const at = typeof body.at === 'number' && Number.isFinite(body.at) && body.at > 0 ? body.at : Date.now();
  return { name, error, directory, source: body.source, at };
};

export const registerLogsRoutes = (app, dependencies) => {
  const {
    runtimeLog,
  } = dependencies;

  // Reports a UI-observed MCP failure into the runtime log. The same failure
  // repeatedly observed by status polling is suppressed for a window so the
  // file records transitions, not every poll.
  const lastReportedDiagnostics = new Map();

  app.post('/api/logs/mcp-diagnostics', express.json({ limit: '64kb' }), async (req, res) => {
    const payload = validateDiagnosticPayload(req.body);
    if (!payload) {
      return res.status(400).json({ error: 'Invalid MCP diagnostic payload' });
    }
    const dedupeKey = `${payload.directory ?? ''}::${payload.name}::${payload.source}::${payload.error}`;
    const lastAt = lastReportedDiagnostics.get(dedupeKey) ?? 0;
    if (payload.at - lastAt < DIAGNOSTIC_REPEAT_SUPPRESS_MS) {
      return res.json({ recorded: false });
    }
    lastReportedDiagnostics.set(dedupeKey, payload.at);
    if (lastReportedDiagnostics.size > 500) {
      for (const [key, at] of lastReportedDiagnostics) {
        if (payload.at - at >= DIAGNOSTIC_REPEAT_SUPPRESS_MS) {
          lastReportedDiagnostics.delete(key);
        }
      }
    }
    try {
      // The response says "recorded", so the entry is flushed before answering.
      await runtimeLog.appendEntry({
        scope: 'mcp',
        event: 'diagnostic',
        level: 'error',
        server: payload.name,
        directory: payload.directory,
        source: payload.source,
        failedAt: payload.at,
        error: payload.error,
      });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to write diagnostic' });
    }
    return res.json({ recorded: true });
  });

  app.get('/api/logs/info', async (_req, res) => {
    try {
      const info = await runtimeLog.getInfo();
      return res.json(info);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read log info' });
    }
  });

  app.get('/api/logs/download', async (req, res) => {
    try {
      const requestedName = typeof req.query.file === 'string' ? req.query.file : null;
      let fileName = requestedName;
      if (!fileName) {
        const info = await runtimeLog.getInfo();
        const latest = [...info.files].sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
        fileName = latest?.name ?? info.current ?? null;
      }
      if (!fileName) {
        return res.status(404).json({ error: 'No log files available' });
      }
      const content = await runtimeLog.readLogFileName(fileName);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fileName)}"`);
      return res.send(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read log file';
      const status = message === 'Invalid log file name' ? 400 : 500;
      return res.status(status).json({ error: message });
    }
  });
};
