import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { appendManagedPlugin } from '../opencode/managed-plugin-config.js';
import { createIdleMcpReclaimer } from './idle-reclaim.js';
import { prepareMcpLaunch, configureMcpLaunch } from './launch.js';
import { resourceKey, resourceModes } from './resource-modes.js';

/**
 * OpenCode marks an MCP server `failed` when it does not come up at startup or
 * when a live connection drops, and never tries again. This plugin runs inside
 * the managed OpenCode process and reconnects those servers with a per-server
 * exponential backoff, so a server that was merely slow to start, or a local
 * one that crashed, comes back without an OpenCode restart.
 *
 * Only `failed` is retried. `needs_auth`, `needs_client_registration`, and
 * `disabled` are user decisions or need user action, and retrying them would
 * either loop on a login prompt or re-enable a server the user turned off.
 *
 * The plugin talks to OpenCode through the SDK client OpenCode hands it, which
 * is scoped to one project directory, so each open directory reconnects its
 * own servers. Idle lifecycle decisions use bounded, privacy-safe runtime logs.
 */
const createPluginSource = (launch, modeFile) => `import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { watch } from 'node:fs';
import { execFile } from 'node:child_process';
import { access, readFile, appendFile, stat, rename } from 'node:fs/promises';
const launch = ${JSON.stringify(launch)};
const modeFile = ${JSON.stringify(modeFile)};
const resourceKey = (${resourceKey.toString()});
const configureMcpLaunch = (${configureMcpLaunch.toString()});
const createIdleMcpReclaimer = (${createIdleMcpReclaimer.toString()});\n` + String.raw`
const INITIAL_RETRY_MS = 1000
const MAX_RETRY_MS = 30000
const IDLE_CHECK_MS = 30000
const listeners = new Set()
let watcher
let modes = null
const readModes = async () => {
  try { modes = JSON.parse(await readFile(modeFile, 'utf8')); if (!Array.isArray(modes)) modes = null }
  catch { modes = null }
}
let logPending = Promise.resolve()
const logFile = join(dirname(modeFile), 'mcp-idle.log')
const writeLog = (entry) => {
  logPending = logPending.then(async () => {
    if ((await stat(logFile).catch(() => null))?.size > 1024 * 1024) await rename(logFile, logFile + '.old')
    await appendFile(logFile, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 })
  }).catch(() => {})
}

export const OpenChamberMcpReconnectPlugin = async ({ client, directory }) => {
  const directoryKey = createHash('sha256').update(resourceKey(directory || '/')).digest('hex')
  const reports = new Map()
  const report = (event, reason, name = '') => {
    const key = event + ':' + reason + ':' + name
    if (Date.now() - (reports.get(key) ?? 0) < 60000) return
    reports.set(key, Date.now())
    writeLog({ event, reason, directory: directoryKey.slice(0, 12), server: name ? createHash('sha256').update(name).digest('hex').slice(0, 12) : null })
  }
  let background = new Map()
  let activated = false
  const hasConnection = async () => {
    for (const entry of background.values()) {
      try { await access(entry.state) } catch { continue }
      const alive = await new Promise((resolve) => execFile(launch.guard, ['--alive', entry.state], { windowsHide: true, timeout: 3000 }, (error, stdout) => resolve(!error && stdout.trim() === 'alive')))
      if (alive) return true
    }
    return false
  }
  const emptyBackground = (port) => new Promise((resolve) => {
    const socket = new WebSocket('ws://localhost:' + port)
    const finish = (empty) => { clearTimeout(timer); socket.close(); resolve(empty) }
    const timer = setTimeout(() => finish(null), 2000)
    socket.addEventListener('error', () => finish(null))
    socket.addEventListener('message', ({ data }) => {
      if (data.length > 65536) return finish(false)
      try {
        const state = JSON.parse(data)
        if (state.action !== 'server.full_state' || !Array.isArray(state.processes)) return finish(null)
        finish(state.processes.length === 0)
      } catch { finish(false) }
    })
  })
  const canRelease = async (name) => {
    const entry = background.get(name)
    if (!entry?.background) return true
    if (!entry.inspect) return false
    const ports = await new Promise((resolve) => execFile(launch.guard, ['--ports', entry.state], { windowsHide: true, timeout: 3000 }, (error, stdout) => {
      try { resolve(error ? [] : JSON.parse(stdout)) } catch { resolve([]) }
    }))
    // One directory may retain multiple owned BGPM connections. Probe owned ports;
    // only an authoritative full state can permit release. Preserve task history.
    if (!Array.isArray(ports) || !ports.length || ports.some(port => !Number.isInteger(port) || port <= 0 || port > 65535)) return false
    const states = await Promise.all(ports.map(emptyBackground))
    return states.includes(true) && !states.includes(false)
  }
  const release = async (name) => {
    const entry = background.get(name)
    if (!entry) return
    await new Promise((resolve, reject) => execFile(launch.guard, ['--release', entry.state], { windowsHide: true, timeout: 5000 }, error => error ? reject(error) : resolve()))
  }
  const idle = createIdleMcpReclaimer(client, canRelease, report, release)
  let disposed = false
  let running = false
  let wakeRequested = false
  let timer
  // Consecutive failed attempts per server, cleared once it is seen healthy.
  const attempts = new Map()
  const dueAt = new Map()

  const schedule = (delayMs) => {
    if (disposed) return
    clearTimeout(timer)
    timer = setTimeout(tick, delayMs)
  }

  const tick = async () => {
    if (running) {
      wakeRequested = true
      return
    }
    running = true
    let delay = IDLE_CHECK_MS
    try {
      // Guard state observes an already-created connection without asking
      // OpenCode to initialize MCP. A runtime-specific scope excludes peers.
      if (!activated) activated = await hasConnection()
      if (!activated) return
      const entry = modes?.find(entry => entry.key === directoryKey)
      const mode = modes === null || entry?.activeUntil > Date.now() ? 'active' : entry?.idleUntil > Date.now() ? 'idle' : null
      if (modes === null) report('kept', 'mode-unavailable')
      const statuses = (await client.mcp.status())?.data ?? {}
      if (disposed) return
      const now = Date.now()
      const due = []
      for (const [name, entry] of Object.entries(statuses)) {
        if (idle.has(name)) continue
        if (entry?.status !== "failed") {
          attempts.delete(name)
          dueAt.delete(name)
          continue
        }
        const at = dueAt.get(name) ?? now
        if (at > now) {
          delay = Math.min(delay, at - now)
          continue
        }
        due.push(name)
      }
      for (const name of attempts.keys()) {
        if (!Object.hasOwn(statuses, name)) {
          attempts.delete(name)
          dueAt.delete(name)
        }
      }

      await Promise.allSettled(due.map((name) => client.mcp.connect({ path: { name } })))

      // The result is read on the next tick: a server that came back clears
      // its counter there, one still failed waits out its backoff.
      const after = Date.now()
      for (const name of due) {
        const count = (attempts.get(name) ?? 0) + 1
        const wait = Math.min(INITIAL_RETRY_MS * 2 ** (count - 1), MAX_RETRY_MS)
        attempts.set(name, count)
        dueAt.set(name, after + wait)
        delay = Math.min(delay, wait)
      }
      await idle.check(mode)
    } catch {
      report('failed', 'status-or-mode-query')
      // Status is unavailable while OpenCode is shutting down or restarting;
      // the idle check picks up again when it is back.
    } finally {
      running = false
      const wake = wakeRequested
      wakeRequested = false
      schedule(wake ? INITIAL_RETRY_MS : delay)
    }
  }

  // Metadata-only directory initialization must not initialize MCP state.
  // Prompts and MCP connection events arm monitoring after actual demand.
  const activate = async () => {
    activated = true
    await idle.restore()
    schedule(INITIAL_RETRY_MS)
  }
  schedule(INITIAL_RETRY_MS)
  const wake = () => schedule(0)
  listeners.add(wake)
  if (!watcher) {
    await readModes()
    watcher = watch(dirname(modeFile), async (_event, filename) => {
      if (filename !== 'resource-modes.json') return
      await readModes()
      for (const listener of listeners) listener()
    })
    watcher.unref()
  }

  return {
    config: async (config) => {
      background = configureMcpLaunch(config, directory, launch, (value) => createHash('sha256').update(value).digest('hex'), join)
    },
    // OpenCode awaits this before resolving the next prompt's MCP tools.
    "chat.message": activate,
    "command.execute.before": activate,
    // A dropped connection publishes this event; checking right away beats
    // waiting out the idle interval.
    event: async ({ event }) => {
      if (event?.type === "mcp.tools.changed") { activated = true; schedule(INITIAL_RETRY_MS) }
      if (event?.type === "session.status" || event?.type === "session.idle" ||
          event?.type === "permission.asked" || event?.type === "question.asked") idle.touch()
    },
    dispose: async () => {
      disposed = true
      idle.dispose()
      clearTimeout(timer)
      listeners.delete(wake)
      if (!listeners.size) { watcher?.close(); watcher = undefined }
    },
  }
}
`;

export const createMcpReconnectRuntime = ({ fsPromises, path, dataDir, prepareLaunch = prepareMcpLaunch }) => {
  const pluginDirectory = path.join(dataDir, 'mcp-reconnect');
  const pluginPath = path.join(pluginDirectory, 'openchamber-mcp-reconnect-plugin.js');

  const prepareManagedOpenCodeEnv = async (rawConfig) => {
    await fsPromises.mkdir(pluginDirectory, { recursive: true });
    const launch = await prepareLaunch(dataDir);
    if (launch) launch.states = path.join(launch.states, randomUUID());
    const scope = path.join(pluginDirectory, randomUUID());
    await fsPromises.mkdir(scope, { recursive: true });
    const modeFile = path.join(scope, 'resource-modes.json');
    await resourceModes.start(modeFile);
    await fsPromises.writeFile(pluginPath, createPluginSource(launch, modeFile), { mode: 0o600 });
    return {
      OPENCODE_CONFIG_CONTENT: appendManagedPlugin(rawConfig, pathToFileURL(pluginPath).href, 'MCP reconnect plugin'),
    };
  };

  return { prepareManagedOpenCodeEnv };
};
