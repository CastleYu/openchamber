import type { Session } from "@/lib/opencode/model"
import { opencodeClient } from "@/lib/opencode/client"
import { usePermissionStore } from "@/stores/permissionStore"
import { getAllSyncSessionMap, getDirectoryState } from "./sync-refs"
import * as sessionActions from "./session-actions"

const RETRY_DELAYS_MS = [0, 250, 1000]
type PermissionRef = { id: string; sessionID: string }

type Dependencies = {
  getScope: () => string
  getPolicy: () => Record<string, boolean>
  getSessions: () => ReadonlyMap<string, Session>
  getSession: (sessionId: string, directory?: string) => Promise<Session>
  getKnownPendingPermissions?: (directory?: string) => PermissionRef[]
  listPendingPermissions: (directory?: string) => Promise<PermissionRef[]>
  getPermissionState: (sessionId: string, requestId: string, directory?: string) => Promise<"ok" | "resolved" | "unknown">
  reply: (sessionId: string, requestId: string, directory?: string) => Promise<void>
  wait: (delayMs: number) => Promise<void>
}

export function createVSCodePermissionAutoAcceptRuntime(dependencies: Dependencies) {
  const inFlight = new Map<string, Promise<boolean>>()
  const reconcileInFlight = new Map<string, Promise<void>>()
  const recentOutcomes = new Map<string, boolean>()

  const isEnabled = async (sessionId: string, directory?: string) => {
    const policy = dependencies.getPolicy()
    const syncedSessions = dependencies.getSessions()
    const fetchedSessions = new Map<string, Session>()
    const seen = new Set<string>()
    let current: string | undefined = sessionId
    let currentDirectory = directory

    while (current && !seen.has(current)) {
      if (Object.prototype.hasOwnProperty.call(policy, current)) return policy[current] === true
      seen.add(current)

      let session: Session | undefined = syncedSessions.get(current) ?? fetchedSessions.get(current)
      if (!session) {
        try {
          session = await dependencies.getSession(current, currentDirectory)
          fetchedSessions.set(session.id, session)
        } catch {
          return false
        }
      }
      current = session.parentID
      currentDirectory = session.directory || currentDirectory
    }
    return false
  }

  const processPermission = (
    permission: PermissionRef,
    directory?: string,
    options?: { verifyPending?: boolean },
  ) => {
    const scope = dependencies.getScope()
    const key = JSON.stringify([scope, directory, permission.sessionID, permission.id])
    const current = () => dependencies.getScope() === scope
    const recent = recentOutcomes.get(key)
    if (recent !== undefined) return Promise.resolve(recent)
    const existing = inFlight.get(key)
    if (existing) return existing

    const task = (async () => {
      if (!(await isEnabled(permission.sessionID, directory))) return false
      if (!current()) return false

      if (options?.verifyPending !== false) {
        const permissionState = await dependencies.getPermissionState(permission.sessionID, permission.id, directory)
        if (!current()) return false
        if (permissionState === "resolved") return true
      }

      for (const delay of RETRY_DELAYS_MS) {
        if (delay > 0) await dependencies.wait(delay)
        if (!current()) return false
        try {
          await dependencies.reply(permission.sessionID, permission.id, directory)
          return current()
        } catch {
          // A failed reply stays visible after the bounded retries.
        }
      }
      return false
    })().then((accepted) => {
      if (accepted) {
        recentOutcomes.set(key, true)
        setTimeout(() => recentOutcomes.delete(key), 5000)
      }
      return accepted
    }).finally(() => inFlight.delete(key))

    inFlight.set(key, task)
    return task
  }

  const reconcilePending = (directory?: string) => {
    const scope = dependencies.getScope()
    const key = JSON.stringify([scope, directory?.trim() || "all"])
    const existing = reconcileInFlight.get(key)
    if (existing) return existing

    const task = (async () => {
      const processed = new Set<string>()
      const processAll = async (permissions: PermissionRef[], verifyPending: boolean) => {
        if (dependencies.getScope() !== scope) return
        const pending = permissions.filter((permission) => {
          if (!permission?.id || processed.has(permission.id)) return false
          processed.add(permission.id)
          return true
        })
        await Promise.all(pending.map((permission) => processPermission(permission, directory, { verifyPending })))
      }

      // A permission.asked event is already authoritative local state. Process
      // those visible cards before the network reconciliation so enabling the
      // toggle works even when permission.list is unavailable or stale.
      await processAll(dependencies.getKnownPendingPermissions?.(directory) ?? [], false)
      // The list arm must not pre-check against getPermissionState:
      // On OC1, permission.list and session.permission.get use different
      // pending maps even though both belong to OpenCode 1. Those
      // authorities are separate. A request in the first map can answer 404
      // from the second. The selected generation's pending list is sufficient
      // authority for replying; no second preflight is needed.
      await processAll(await dependencies.listPendingPermissions(directory), false)
    })()
      .finally(() => reconcileInFlight.delete(key))

    reconcileInFlight.set(key, task)
    return task
  }

  return { processPermission, reconcilePending }
}

const runtime = createVSCodePermissionAutoAcceptRuntime({
  getScope: () => JSON.stringify(opencodeClient.getBoundRuntime()),
  getPolicy: () => usePermissionStore.getState().autoAccept,
  getSessions: getAllSyncSessionMap,
  getSession: (sessionId, directory) => opencodeClient.getSession(sessionId, directory),
  getKnownPendingPermissions: (directory) => {
    const state = getDirectoryState(directory)
    return [...Object.values(state?.permission ?? {}).flat(),
      ...Object.values(state?.pendingPermission ?? {}).flat().map((request) => request.value)]
  },
  listPendingPermissions: async (directory) => (await opencodeClient.listTaggedPermissions({ directories: [directory] })).map((request) => request.value),
  getPermissionState: async (sessionId, requestId, directory) => {
    if (opencodeClient.getBoundRuntime()?.generation !== 'oc2') return (await opencodeClient.fetchPermission(sessionId, requestId, directory)).state
    const pending = await opencodeClient.listTaggedPermissions({ directories: [directory] })
    return pending.some((request) => request.value.id === requestId && request.value.sessionID === sessionId) ? 'ok' : 'resolved'
  },
  reply: (sessionId, requestId, directory) => sessionActions.respondToPermission(sessionId, requestId, "once", directory),
  wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
})

export const processVSCodePermissionAutoAccept = (
  permission: PermissionRef,
  directory?: string,
) => runtime.processPermission(permission, directory, { verifyPending: false })
// Both selected-generation lists are authoritative. In particular, OC1's
// legacy and newer permission APIs have separate pending maps. See #3259.
export const processVSCodeReconciledPermissionAutoAccept = (
  permission: PermissionRef,
  directory?: string,
) => runtime.processPermission(permission, directory, { verifyPending: false })
export const reconcileVSCodePendingPermissions = runtime.reconcilePending
