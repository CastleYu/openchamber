import type { OpencodeClient, Project } from "@opencode-ai/sdk/v2/client"
import type { SyncSource } from "./source"
import type { BootstrapPath } from "@/lib/opencode/operations"
import { z } from "zod"
import { retry } from "./retry"
import type { GlobalState, State } from "./types"
import { runtimeFetch } from "../lib/runtime-fetch"
import { emitSyncConfigChanged, emitTaggedSyncConfigChanged } from "./sync-refs"
import { warmChatsRootDirectory } from "../lib/chatDirectories"
import { runBackgroundNetworkTask } from "../lib/background-network"
import { sessionStatusSnapshotSchema } from "../lib/opencode/session-status"
import {
  readDirectoryStatusSnapshot,
  readDirectoryQuestionSnapshot,
  readDirectoryPermissionSnapshot,
  readDomainStatusSnapshot,
  readDomainInputSnapshot,
  readDomainPermissionSnapshot,
  type DirectoryRecoverySource,
} from "./directory-recovery-snapshots"

const sdkErrorMessage = z.object({ message: z.string() })

function hasLegacyPath(path: BootstrapPath): path is Required<Pick<BootstrapPath, "directory" | "state" | "config" | "worktree" | "home">> {
  return typeof path.state === "string" && typeof path.config === "string"
    && typeof path.worktree === "string" && typeof path.home === "string"
}

/**
 * SDK returns `{ data, error, response }` without throwing on non-2xx.
 * The silent `x.data!` / `x.data ?? []` pattern lets HTTP 5xx warmup
 * errors become empty state. Wrap into a real Error so retry() fires.
 */
function unwrap<T>(
  result: { data?: T; error?: unknown; response?: { status?: number } },
  name: string,
): T {
  if (result.error) {
    const status = result.response?.status
    const parsed = sdkErrorMessage.safeParse(result.error)
    const message = parsed.success ? parsed.data.message : String(result.error)
    throw Object.assign(new Error(`${name} failed${status ? ` (${status})` : ""}: ${message}`), { status })
  }
  if (result.data === undefined || result.data === null) {
    // No error + no data: ambiguous, treat as transient so retry fires.
    throw Object.assign(new Error(`${name} returned no data`), { status: 503 })
  }
  return result.data
}

function projectID(directory: string, projects: Project[]) {
  return projects.find(
    (project) => project.worktree === directory || project.sandboxes?.includes(directory),
  )?.id
}

// ---------------------------------------------------------------------------
// Bootstrap global state
// ---------------------------------------------------------------------------

/**
 * Deliberately does not call `project.list()`: it enumerates every project the
 * OpenCode server knows about while the visible directory is still
 * bootstrapping. `bootstrapDirectory` resolves its own project and
 * `project.updated` events keep `projects` current.
 */
export async function bootstrapGlobal(
  sdk: OpencodeClient | SyncSource,
  set: (patch: Partial<GlobalState>) => void,
) {
  const source = "generation" in sdk ? sdk : null
  const legacyClient = (): OpencodeClient => {
    if ("generation" in sdk) throw new Error("OC1 SDK used by OC2 bootstrap")
    return sdk
  }
  const results = await Promise.allSettled([
    // Sync chat classification needs the chats root before session lists load;
    // it resolves alongside the other bootstrap calls, not ahead of them.
    warmChatsRootDirectory(),
    retry(async () => {
      if (source) {
        const pathInfo = await source.bootstrap.getBootstrapPath(null)
        set({ pathInfo, ...(source.generation === "oc1" && hasLegacyPath(pathInfo) ? { path: pathInfo } : {}) })
      }
      else set({ path: unwrap(await legacyClient().path.get(), "path.get") })
    }),
    retry(async () => {
      if (source) {
        const configTagged = await source.bootstrap.getTaggedConfig(null)
        set({ configTagged, ...(configTagged.generation === "oc1" ? { config: configTagged.value } : {}) })
      }
      else set({ config: unwrap(await legacyClient().global.config.get(), "global.config.get") })
    }),
  ])

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason)
  if (errors.length) {
    console.error("[bootstrap] global bootstrap failed", errors[0])
  }

  // If ALL requests failed, OpenCode is likely down — fetch the OpenChamber
  // health endpoint (outside the readiness gate) to get the actual error reason.
  if (errors.length === results.length) {
    let message = errors[0] instanceof Error ? errors[0].message : String(errors[0])
    try {
      const healthRes = await runtimeFetch('/health', { signal: AbortSignal.timeout(4000) })
      if (healthRes.ok) {
        const health = await healthRes.json()
        if (health.lastOpenCodeError) {
          message = health.lastOpenCodeError
        } else if (!health.openCodeRunning) {
          message = "OpenCode process is not running"
        }
      }
    } catch {
      // health endpoint itself unreachable — use the original error
    }
    set({ ready: true, error: { type: "init", message } })
  } else {
    set({ ready: true, error: undefined })
  }
}

// ---------------------------------------------------------------------------
// Bootstrap per-directory state
// ---------------------------------------------------------------------------

type DirectoryBootstrapInput = {
  directory: string
  sdk: OpencodeClient | SyncSource
  store: DirectoryRecoverySource
  set: (patch: Partial<State>) => void
  isStale?: () => boolean
  global: {
    config: State["config"]
    projects: Project[]
  }
  loadSessions: (directory: string) => Promise<void> | void
}

type BootstrapResult = "complete" | "failed" | "stale"

export function bootstrapDirectory(input: DirectoryBootstrapInput) {
  const sessions = (async (): Promise<BootstrapResult> => {
    if (input.isStale?.()) return "stale"
    try {
      await input.loadSessions(input.directory)
      return input.isStale?.() ? "stale" : "complete"
    } catch (error) {
      if (input.isStale?.()) return "stale"
      console.error(`[bootstrap] session load failed for ${input.directory}`, error)
      return "failed"
    }
  })()
  // Initialization has its own completion and network capacity. A slow config
  // or directory cannot hold the session-list scheduler's slot.
  const environment = initializeDirectory(input)
  return { sessions, environment }
}

async function initializeDirectory(input: DirectoryBootstrapInput): Promise<BootstrapResult> {
  const { directory, sdk, store, set, global: g } = input
  const source = "generation" in sdk ? sdk : null
  const legacyClient = (): OpencodeClient => {
    if ("generation" in sdk) throw new Error("OC1 SDK used by OC2 bootstrap")
    return sdk
  }
  const read = <T>(request: () => Promise<T>) => retry(() => runBackgroundNetworkTask(() => {
    if (input.isStale?.()) throw new Error("Directory initialization superseded")
    return request()
  }))
  const commit = (patch: Partial<State>): boolean => {
    if (input.isStale?.()) return false
    set(patch)
    return true
  }
  const state = store.getState()

  // Seed from global state while we fetch directory-specific data
  const seededProject = projectID(directory, g.projects)
  if (seededProject) commit({ project: seededProject })
  if (Object.keys(state.config ?? {}).length === 0 && Object.keys(g.config ?? {}).length > 0) {
    const seededConfig = g.config
    if (commit({ config: seededConfig })) emitSyncConfigChanged(directory, seededConfig)
  }
  commit({ status: "partial" })
  if (input.isStale?.()) return "stale"

  // Queue live recovery first. Each read commits independently and failures in
  // config/MCP cannot suppress pending questions or permission recovery.
  const critical = Promise.allSettled([
    read(async () => {
      const session_status = source
        ? await readDomainStatusSnapshot(store, () => source.status(directory))
        : await readDirectoryStatusSnapshot(store, async () => (
          sessionStatusSnapshotSchema.parse(unwrap(await legacyClient().session.status({ directory }), "session.status"))
        ))
      commit({ session_status, sessionStatusReady: true })
    }),
    read(async () => {
      if (source) {
        const pendingInput = await readDomainInputSnapshot(store, () => source.inputs(directory))
        commit({ pendingInput })
      } else {
        const question = await readDirectoryQuestionSnapshot(store, async () => (
          unwrap(await legacyClient().question.list({ directory }), "question.list")
        ))
        commit({ question })
      }
    }),
    read(async () => {
      if (source) {
        const pendingPermission = await readDomainPermissionSnapshot(store, () => source.permissions(directory))
        commit({ pendingPermission })
      } else {
        const permission = await readDirectoryPermissionSnapshot(store, async () => (
          unwrap(await legacyClient().permission.list({ directory }), "permission.list")
        ))
        commit({ permission })
      }
    }),
    seededProject
      ? Promise.resolve()
      : read(async () => {
        const project = source ? await source.bootstrap.getCurrentProject(directory) : unwrap(await legacyClient().project.current({ directory }), "project.current")
        commit({ project: project.id })
      }),
    read(async () => {
      if (source) {
        const configTagged = await source.bootstrap.getTaggedConfig(directory)
        if (commit({ configTagged })) emitTaggedSyncConfigChanged(directory, configTagged)
        if (configTagged.generation === "oc1") {
          if (commit({ config: configTagged.value })) emitSyncConfigChanged(directory, configTagged.value)
        }
      } else {
        const config = unwrap(await legacyClient().config.get({ directory }), "config.get")
        if (commit({ config })) emitSyncConfigChanged(directory, config)
      }
    }),
    read(async () => {
      if (source) {
        const data = await source.bootstrap.getBootstrapPath(directory)
        commit({ pathInfo: data, ...(source.generation === "oc1" && hasLegacyPath(data) ? { path: data } : {}) })
        const next = projectID(data.directory, g.projects)
        if (next) commit({ project: next })
      } else {
        const data = unwrap(await legacyClient().path.get({ directory }), "path.get")
        commit({ path: data })
        const next = projectID(data.directory, g.projects)
        if (next) commit({ project: next })
      }
    }),
  ])
  const enrichment = Promise.allSettled([
    // MCP status and the command list are deliberately not read here. Reading
    // MCP state initializes the directory's whole stdio server fleet as an
    // OpenCode side effect, and listing commands enumerates MCP prompts,
    // which touches that same state. The sidebar declares bootstrap demand
    // for every known project directory, so either read launched one full
    // fleet per project at startup. Both surfaces fetch on demand through
    // their own stores (useMcpStore, useCommandsStore) instead.
    source?.generation === "oc2"
      ? Promise.resolve(commit({ lspAvailability: "unsupported" }))
      : read(async () => {
        const lsp = source ? await source.bootstrap.getLspStatus(directory) : unwrap(await legacyClient().lsp.status({ directory }), "lsp.status")
        commit({ lsp, lspAvailability: "supported" })
      }),
    read(async () => {
      if (source) {
        const vcs = await source.bootstrap.getVcs(directory)
        commit({ vcs: { branch: vcs.branch, default_branch: vcs.defaultBranch } })
      }
      else {
        const result = await legacyClient().vcs.get({ directory })
        if (result.error) throw new Error(`vcs.get failed: ${String(result.error)}`)
        if (result.data) commit({ vcs: result.data })
      }
    }),
  ])
  const [results, enrichmentResults] = await Promise.all([critical, enrichment])
  if (input.isStale?.()) return "stale"
  const enrichmentErrors = enrichmentResults.filter((result): result is PromiseRejectedResult => result.status === "rejected")
  if (enrichmentErrors.length) console.warn(`[bootstrap] optional enrichment failed for ${directory}`, enrichmentErrors[0].reason)
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected")
  if (errors.length) {
    console.error(`[bootstrap] environment initialization failed for ${directory}`, errors[0].reason)
    return "failed"
  }
  commit({ status: "complete" })
  return "complete"
}
