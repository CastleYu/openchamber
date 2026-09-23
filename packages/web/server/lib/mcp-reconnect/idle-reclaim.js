/** Serialized into the managed plugin; keep dependencies inside this function. */
export function createIdleMcpReclaimer(client, canRelease = async () => true, report = () => {}, release = async () => {}) {
  const IDLE_MS = 5 * 60 * 1000;
  const STATUS = { IDLE: 'idle', CONNECTED: 'connected' };
  let idleSince = Date.now();
  let revision = 0;
  let disposed = false;
  let operation = Promise.resolve();
  const sleeping = new Set();

  const touch = () => {
    revision += 1;
    idleSince = Date.now();
  };

  const serialize = (work) => {
    const next = operation.then(work);
    operation = next.catch(() => undefined);
    return next;
  };

  const restore = () => {
    touch();
    return serialize(async () => {
      if (disposed || sleeping.size === 0) return;
      const config = await client.config.get();
      if (!Array.isArray(config)) throw new Error('MCP configuration unavailable');
      const configured = new Map();
      for (const entry of config) {
        for (const [name, server] of Object.entries(entry.info?.mcp?.servers ?? {})) {
          configured.set(name, server);
        }
      }
      const failures = [];
      for (const name of sleeping) {
        if (disposed) return;
        const entry = configured.get(name);
        if (!entry || entry.disabled === true || entry.enabled === false) {
          sleeping.delete(name);
          continue;
        }
        try {
          await client.mcp.connect({ server: name });
          const result = await client.mcp.list();
          const server = (result?.data ?? []).find((item) => item.name === name);
          if (server?.status?.status !== STATUS.CONNECTED && server?.status !== STATUS.CONNECTED) {
            throw new Error('MCP did not reconnect: ' + name);
          }
          sleeping.delete(name);
          report('restored', 'prompt', name);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, 'Unable to restore idle MCP servers');
    });
  };

  const check = (mode = null) => serialize(async () => {
    if (disposed) return;
    if (mode === 'active') { report('kept', 'active-client'); return; }
    if (mode !== 'idle' && Date.now() - idleSince < IDLE_MS) return;
    const started = revision;
    // This is the OpenCode directory's authoritative live status, not a UI
    // subset. Busy includes tools waiting for permission and user input.
    const sessions = await client.session.active();
    if (!sessions) { report('kept', 'session-status-unavailable'); return; }
    if (disposed || started !== revision) return;
    if (Object.values(sessions).some((entry) => entry.type !== STATUS.IDLE)) {
      touch();
      report('kept', 'running-session');
      return;
    }
    const result = await client.mcp.list();
    if (!Array.isArray(result?.data)) { report('kept', 'mcp-status-unavailable'); return; }
    for (const entry of result.data) {
      const name = entry.name;
      if (disposed || started !== revision) return;
      if (entry.status?.status !== STATUS.CONNECTED && entry.status !== STATUS.CONNECTED) continue;
      if (!await canRelease(name)) { report('kept', 'background-state', name); continue; }
      if (disposed || started !== revision) return;
      // Reserve the name before the request: a lost response must still be
      // recoverable before the next prompt resolves its tools.
      sleeping.add(name);
      try {
        await client.mcp.disconnect({ server: name });
        await release(name);
        report('released', 'idle', name);
      } catch {
        report('failed', 'disconnect', name);
        // Preserve ownership for restore, and let unrelated servers finish.
      }
    }
  });

  return {
    check,
    restore,
    touch,
    has: (name) => sleeping.has(name),
    dispose: () => { disposed = true; touch(); },
  };
}
