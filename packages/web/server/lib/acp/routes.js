import { z } from 'zod';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const ROUTE = '/api/acp';
const createSchema = z.object({ directory: z.string().min(1), title: z.string().optional() });
const promptSchema = z.object({ sessionID: z.string(), messageID: z.string(), text: z.string(), files: z.array(z.object({ url: z.string(), filename: z.string().optional() })).optional() });

/** ACP has its own domain routes; none of them imitate an OpenCode endpoint. */
export const registerAcpRoutes = (app, { express, runtime }) => {
  const handle = (operation) => async (req, res) => {
    try { res.json(await operation(req)); }
    catch (error) { res.status(error instanceof z.ZodError ? 400 : 409).json({ error: error.message }); }
  };
  const directory = (req) => z.object({ directory: z.string().optional() }).parse(req.query).directory;
  app.get(`${ROUTE}/info`, handle(() => runtime.info()));
  app.get(`${ROUTE}/path`, handle((req) => ({ directory: directory(req) ?? runtime.directory() ?? homedir(), home: homedir() })));
  app.get(`${ROUTE}/sessions`, handle((req) => runtime.discover(directory(req))));
  app.post(`${ROUTE}/sessions`, express.json(), handle((req) => runtime.createSession(createSchema.parse(req.body))));
  app.get(`${ROUTE}/sessions/:id`, handle((req) => runtime.session(req.params.id)));
  app.get(`${ROUTE}/sessions/:id/messages`, handle((req) => runtime.open(req.params.id)));
  app.post(`${ROUTE}/sessions/:id/update`, express.json(), handle((req) => runtime.updateSession(req.params.id, req.body)));
  app.post(`${ROUTE}/sessions/:id/delete`, express.json(), handle((req) => runtime.deleteSession(req.params.id)));
  app.get(`${ROUTE}/sessions/:id/controls`, handle((req) => runtime.controls(req.params.id)));
  app.post(`${ROUTE}/sessions/:id/config`, express.json(), handle((req) => { const value = z.object({ configId: z.string(), value: z.string() }).parse(req.body); return runtime.setConfig(req.params.id, value.configId, value.value); }));
  app.get(`${ROUTE}/commands`, handle((req) => runtime.commands(directory(req))));
  app.get(`${ROUTE}/status`, handle((req) => runtime.statuses(directory(req))));
  app.get(`${ROUTE}/permissions`, handle((req) => runtime.permissions(directory(req))));
  app.get(`${ROUTE}/inputs`, handle((req) => runtime.inputs(directory(req))));
  app.get(`${ROUTE}/connection-inputs`, handle(() => runtime.connectionInputs()));
  app.post(`${ROUTE}/inputs/:id`, express.json(), handle((req) => runtime.replyInput(req.params.id, req.body)));
  app.post(`${ROUTE}/prompt`, express.json(), handle((req) => runtime.prompt(promptSchema.parse(req.body))));
  app.post(`${ROUTE}/sessions/:id/cancel`, handle((req) => runtime.cancel(req.params.id)));
  app.post(`${ROUTE}/permissions/:id`, express.json(), handle((req) => runtime.reply(req.params.id, z.object({ optionID: z.string() }).parse(req.body).optionID)));
  app.post(`${ROUTE}/authenticate`, express.json(), handle((req) => { const value = z.object({ methodId: z.string(), epoch: z.number().optional() }).parse(req.body); return runtime.authenticate(value.methodId, value.epoch); }));
  app.post(`${ROUTE}/sessions/:id/mode`, express.json(), handle((req) => runtime.setMode(req.params.id, z.object({ modeId: z.string() }).parse(req.body).modeId)));
  app.get(`${ROUTE}/events`, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    // Reconnect replaces live state from this complete snapshot, then consumes
    // ordered facts from the same in-process owner.
    const unsubscribe = runtime.subscribe((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const snapshot = randomUUID();
    let sequence = 0;
    const fact = (value) => res.write(`data: ${JSON.stringify({ ...value, eventID: `acp:snapshot:${snapshot}:${++sequence}` })}\n\n`);
    for (const session of runtime.sessions()) {
      const directory = session.directory;
      fact({ type: 'session-upsert', session, directory });
      for (const item of runtime.messages(session.id)) {
        fact({ type: 'message-upsert', message: item.info, directory });
        for (const part of item.parts) fact({ type: 'part-upsert', part, directory });
      }
      fact({ type: 'status', sessionID: session.id, status: runtime.statuses(directory)[session.id], directory });
    }
    for (const request of runtime.permissions()) fact({ type: 'permission-asked', request, directory: runtime.session(request.value.sessionID).directory });
    for (const request of runtime.inputs()) fact({ type: 'input-created', request, directory: runtime.session(request.value.sessionID).directory });
    fact({ type: 'connection-inputs', inputs: runtime.connectionInputs(), error: runtime.info().error ?? undefined });
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });
};
