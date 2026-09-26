import type { Event, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@/lib/opencode/model"
import type { State } from "./types"
import type { DomainEvent } from "@/lib/opencode/events"
import type { PendingInput, PendingPermission } from "@/lib/opencode/operations"

export type DirectoryRecoverySource = { getState: () => State }

type RecoveryObserver = (event: Event) => void
const observers = new WeakMap<DirectoryRecoverySource, Set<RecoveryObserver>>()
const domainObservers = new WeakMap<DirectoryRecoverySource, Set<(event: DomainEvent) => void>>()

export function recordDomainRecoveryEvent(source: DirectoryRecoverySource, event: DomainEvent): void {
  const listeners = domainObservers.get(source)
  if (listeners) for (const listener of listeners) listener(event)
}

async function withDomainObserver<T>(source: DirectoryRecoverySource, observer: (event: DomainEvent) => void, read: () => Promise<T>): Promise<T> {
  let listeners = domainObservers.get(source)
  if (!listeners) {
    listeners = new Set()
    domainObservers.set(source, listeners)
  }
  listeners.add(observer)
  try { return await read() }
  finally {
    listeners.delete(observer)
    if (listeners.size === 0) domainObservers.delete(source)
  }
}

export function readDomainStatusSnapshot(source: DirectoryRecoverySource, read: () => Promise<State["session_status"]>): Promise<State["session_status"]> {
  const before = source.getState().session_status
  const changes = new Map<string, SessionStatus | null>()
  return withDomainObserver(source, (event) => {
    if (event.type === "status") changes.set(event.sessionID, event.status)
    if (event.type === "session-delete") changes.set(event.sessionID, null)
  }, async () => {
    const snapshot = { ...await read() }
    const current = source.getState().session_status
    for (const id of new Set([...Object.keys(before), ...Object.keys(current)])) {
      if (before[id] === current[id]) continue
      if (current[id]) snapshot[id] = current[id]
      else delete snapshot[id]
    }
    for (const [id, status] of changes) {
      if (status) snapshot[id] = status
      else delete snapshot[id]
    }
    return snapshot
  })
}

function readDomainBlockingSnapshot<T extends PendingPermission | PendingInput>(
  source: DirectoryRecoverySource,
  currentGroups: () => Record<string, T[]>,
  read: () => Promise<T[]>,
  mutation: (event: DomainEvent) => { id: string; request: T | null } | undefined,
): Promise<Record<string, T[]>> {
  const before = new Map(Object.values(currentGroups()).flat().map((item) => [item.value.id, item] as const))
  const changes = new Map<string, T | null>()
  const removedSessions = new Set<string>()
  return withDomainObserver(source, (event) => {
    const change = mutation(event)
    if (change) changes.set(change.id, change.request)
    if (event.type === "session-delete") removedSessions.add(event.sessionID)
  }, async () => {
    const fetched = await read()
    const snapshot = new Map(fetched.map((item) => [item.value.id, item] as const))
    const current = new Map(Object.values(currentGroups()).flat().map((item) => [item.value.id, item] as const))
    for (const id of before.keys()) if (!current.has(id)) snapshot.delete(id)
    for (const [id, item] of current) if (before.get(id) !== item) snapshot.set(id, item)
    for (const [id, item] of changes) {
      if (item) snapshot.set(id, item)
      else snapshot.delete(id)
    }
    const groups: Record<string, T[]> = {}
    for (const item of snapshot.values()) {
      const sessionID = item.value.sessionID
      if (removedSessions.has(sessionID)) continue
      ;(groups[sessionID] ??= []).push(item)
    }
    for (const group of Object.values(groups)) group.sort((a, b) => a.value.id < b.value.id ? -1 : a.value.id > b.value.id ? 1 : 0)
    return groups
  })
}

export const readDomainPermissionSnapshot = (source: DirectoryRecoverySource, read: () => Promise<PendingPermission[]>) =>
  readDomainBlockingSnapshot(source, () => source.getState().pendingPermission, read, (event) => {
    if (event.type === "permission-asked") return { id: event.request.value.id, request: event.request }
    if (event.type === "permission-replied") return { id: event.requestID, request: null }
  })

export const readDomainInputSnapshot = (source: DirectoryRecoverySource, read: () => Promise<PendingInput[]>) =>
  readDomainBlockingSnapshot(source, () => source.getState().pendingInput, read, (event) => {
    if (event.type === "input-created") return { id: event.request.value.id, request: event.request }
    if (event.type === "form-closed") return { id: event.requestID, request: null }
  })

// Only in-flight reads retain events. Even a repeated busy event that produces
// no store publication must supersede an older HTTP snapshot.
export function recordDirectoryRecoveryEvent(source: DirectoryRecoverySource, event: Event): void {
  const listeners = observers.get(source)
  if (listeners) for (const listener of listeners) listener(event)
}

async function withRecoveryObserver<T>(
  source: DirectoryRecoverySource,
  observer: RecoveryObserver,
  read: () => Promise<T>,
): Promise<T> {
  let listeners = observers.get(source)
  if (!listeners) {
    listeners = new Set()
    observers.set(source, listeners)
  }
  listeners.add(observer)
  try {
    return await read()
  } finally {
    listeners.delete(observer)
    if (listeners.size === 0) observers.delete(source)
  }
}

function removedSessionID(event: Event): string | undefined {
  if (event.type === "session.deleted") return event.properties.info?.id ?? event.properties.sessionID
  if (event.type === "session.updated" && event.properties.info.time.archived) return event.properties.info.id
}

export function readDirectoryStatusSnapshot(
  source: DirectoryRecoverySource,
  read: () => Promise<State["session_status"]>,
): Promise<State["session_status"]> {
  const before = source.getState().session_status
  const changes = new Map<string, SessionStatus | null>()
  return withRecoveryObserver(source, (event) => {
    if (event.type === "session.status") changes.set(event.properties.sessionID, event.properties.status)
    else if (event.type === "session.idle" || event.type === "session.error") {
      if (event.properties.sessionID) changes.set(event.properties.sessionID, { type: "idle" })
    }
    const removed = removedSessionID(event)
    if (removed) changes.set(removed, null)
  }, async () => {
    const snapshot = { ...await read() }
    const current = source.getState().session_status
    for (const id of new Set([...Object.keys(before), ...Object.keys(current)])) {
      if (before[id] === current[id]) continue
      if (current[id]) snapshot[id] = current[id]
      else delete snapshot[id]
    }
    for (const [id, status] of changes) {
      if (status) snapshot[id] = status
      else delete snapshot[id]
    }
    return snapshot
  })
}

type BlockingRequest = { id: string; sessionID: string }
type BlockingMutation<T> = { id: string; request: T | null }

const indexRequests = <T extends BlockingRequest>(groups: Record<string, T[]>) => (
  new Map(Object.values(groups).flatMap((requests) => requests.map((request) => [request.id, request] as const)))
)

function readBlockingSnapshot<T extends BlockingRequest>(
  source: DirectoryRecoverySource,
  currentGroups: () => Record<string, T[]>,
  read: () => Promise<T[]>,
  mutation: (event: Event) => BlockingMutation<T> | undefined,
): Promise<Record<string, T[]>> {
  const before = indexRequests(currentGroups())
  const changes = new Map<string, T | null>()
  const removedSessions = new Set<string>()
  return withRecoveryObserver(source, (event) => {
    const change = mutation(event)
    if (change) changes.set(change.id, change.request)
    const removed = removedSessionID(event)
    if (removed) removedSessions.add(removed)
  }, async () => {
    const fetched = await read()
    const snapshot = new Map(fetched.filter((request) => request.id && request.sessionID).map((request) => [request.id, request]))
    const current = indexRequests(currentGroups())
    for (const id of before.keys()) if (!current.has(id)) snapshot.delete(id)
    for (const [id, request] of current) if (before.get(id) !== request) snapshot.set(id, request)
    for (const [id, request] of changes) {
      if (request) snapshot.set(id, request)
      else snapshot.delete(id)
    }
    const groups: Record<string, T[]> = {}
    for (const request of snapshot.values()) {
      if (removedSessions.has(request.sessionID)) continue
      const group = groups[request.sessionID] ?? (groups[request.sessionID] = [])
      group.push(request)
    }
    for (const group of Object.values(groups)) group.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    return groups
  })
}

export const readDirectoryPermissionSnapshot = (source: DirectoryRecoverySource, read: () => Promise<PermissionRequest[]>) => (
  readBlockingSnapshot(source, () => source.getState().permission, read, (event) => {
    if (event.type === "permission.asked") return { id: event.properties.id, request: event.properties }
    if (event.type === "permission.replied") return { id: event.properties.requestID, request: null }
  })
)

export const readDirectoryQuestionSnapshot = (source: DirectoryRecoverySource, read: () => Promise<QuestionRequest[]>) => (
  readBlockingSnapshot(source, () => source.getState().question, read, (event) => {
    if (event.type === "question.asked") return { id: event.properties.id, request: event.properties }
    if (event.type === "question.replied" || event.type === "question.rejected") {
      return { id: event.properties.requestID, request: null }
    }
  })
)
