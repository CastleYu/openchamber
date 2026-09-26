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
      const config = await client.config.get({ throwOnError: true });
      if (!config.data) throw new Error('MCP configuration unavailable');
      const failures = [];
      for (const name of sleeping) {
        if (disposed) return;
        const entry = config.data.mcp?.[name];
        if (!entry || entry.enabled === false) {
          sleeping.delete(name);
          continue;
        }
        try {
          await client.mcp.connect({ path: { name }, throwOnError: true });
          const result = await client.mcp.status({ throwOnError: true });
          if (result.data?.[name]?.status !== STATUS.CONNECTED) {
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
    const sessions = await client.session.status({ throwOnError: true });
    if (!sessions.data) { report('kept', 'session-status-unavailable'); return; }
    if (disposed || started !== revision) return;
    if (Object.values(sessions.data).some((entry) => entry.type !== STATUS.IDLE)) {
      touch();
      report('kept', 'running-session');
      return;
    }
    const result = await client.mcp.status({ throwOnError: true });
    if (!result.data) { report('kept', 'mcp-status-unavailable'); return; }
    for (const [name, entry] of Object.entries(result.data)) {
      if (disposed || started !== revision) return;
      if (entry.status !== STATUS.CONNECTED) continue;
      if (!await canRelease(name)) { report('kept', 'background-state', name); continue; }
      if (disposed || started !== revision) return;
      // Reserve the name before the request: a lost response must still be
      // recoverable before the next prompt resolves its tools.
      sleeping.add(name);
      try {
        await client.mcp.disconnect({ path: { name }, throwOnError: true });
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
