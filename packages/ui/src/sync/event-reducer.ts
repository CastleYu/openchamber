import type { Event, PermissionRequest, Project, QuestionRequest, Todo } from "@opencode-ai/sdk/v2/client"
import type { Message, Part, SessionStatus } from "@/lib/opencode/model"
import { projectLegacyMessage, projectLegacyPart, projectLegacySession } from "@/lib/opencode/v1/projection"
import type { DomainEvent } from "@/lib/opencode/events"
import { Binary } from "./binary"
import type { FileDiff, GlobalState, State } from "./types"
import { dropSessionCaches } from "./session-cache"
import { stripSessionDiffSnapshots } from "./sanitize"
import { syncDebug } from "./debug"
import { shouldSkipStaleSessionEvent } from "./session-event-freshness"
import {
  compareMessagesChronologically,
  findMessageIndex,
  insertMessageChronologically,
} from "./message-ordering"

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const DELTA_OVERLAP_FIELDS = ["text", "output"] as const
const FINAL_TOOL_STATUSES = new Set(["completed", "error", "aborted", "failed", "timeout", "cancelled"])

type DedupeMetadata = {
  __dedupeNextDeltaFields?: string[]
}

function appendNonOverlappingDelta(existingValue: string | undefined, delta: string) {
  if (!existingValue || delta.length === 0) return (existingValue ?? "") + delta
  if (existingValue.endsWith(delta)) return existingValue

  const maxOverlap = Math.min(existingValue.length, delta.length)
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (existingValue.endsWith(delta.slice(0, overlap))) {
      return existingValue + delta.slice(overlap)
    }
  }

  return existingValue + delta
}

function getUpdatedDeltaFields(previous: Part, next: Part) {
  const dedupeFields: string[] = []
  for (const field of DELTA_OVERLAP_FIELDS) {
    const previousValue = (previous as Record<string, unknown>)[field]
    const nextValue = (next as Record<string, unknown>)[field]
    if (typeof previousValue !== "string" || typeof nextValue !== "string") continue
    if (previousValue.length === 0 || nextValue.length === 0) continue
    if (nextValue === previousValue || nextValue.startsWith(previousValue) || previousValue.startsWith(nextValue)) {
      dedupeFields.push(field)
    }
  }
  return dedupeFields
}

function getPartEndTime(part: Part): number | undefined {
  const stateEnd = (part as { state?: { time?: { end?: unknown } } }).state?.time?.end
  if (typeof stateEnd === "number") {
    return stateEnd
  }

  const timeEnd = (part as { time?: { end?: unknown } }).time?.end
  return typeof timeEnd === "number" ? timeEnd : undefined
}

function getToolStatus(part: Part): string | undefined {
  if (part.type !== "tool") {
    return undefined
  }

  const status = (part as { state?: { status?: unknown } }).state?.status
  return typeof status === "string" ? status : undefined
}

function shouldPreserveExistingPart(previous: Part, next: Part): boolean {
  if (previous.type !== "tool" || next.type !== "tool") {
    return false
  }

  const previousStatus = getToolStatus(previous)
  const nextStatus = getToolStatus(next)
  if (previousStatus && FINAL_TOOL_STATUSES.has(previousStatus) && (!nextStatus || !FINAL_TOOL_STATUSES.has(nextStatus))) {
    return true
  }

  const previousEnd = getPartEndTime(previous)
  const nextEnd = getPartEndTime(next)
  if (typeof previousEnd === "number" && typeof nextEnd !== "number") {
    return true
  }

  return false
}

function areSessionStatusesEqual(left: SessionStatus | undefined, right: SessionStatus): boolean {
  if (left === right) return true
  if (!left || left.type !== right.type) return false
  if (left.type === "retry") {
    return right.type === "retry"
      && left.attempt === right.attempt
      && left.message === right.message
      && left.next === right.next
  }
  return true
}

function areJsonEquivalent(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined) return left === right
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function areMessageUpdateFieldsEqual(existing: Message, next: Message): boolean {
  if (existing.role !== next.role) return false
  if ((existing as { finish?: unknown }).finish !== (next as { finish?: unknown }).finish) return false
  if ((existing.time as { completed?: number })?.completed !== (next.time as { completed?: number })?.completed) return false

  const fields: Array<keyof Message | "structured" | "summary" | "tokens" | "error" | "cost" | "model" | "tools" | "format" | "variant" | "agent" | "system"> = [
    "summary",
    "error",
    "cost",
    "tokens",
    "structured",
    "model",
    "tools",
    "format",
    "variant",
    "agent",
    "system",
  ]

  for (const field of fields) {
    if (!areJsonEquivalent((existing as Record<string, unknown>)[field], (next as Record<string, unknown>)[field])) {
      return false
    }
  }

  return true
}

// ---------------------------------------------------------------------------
// Global events
// ---------------------------------------------------------------------------

export type GlobalEventResult = {
  type: "refresh"
} | {
  type: "project"
  project: Project
} | null

export type SessionMaterializationReason =
  | "missing-owning-message"
  | "orphan-delta"
  | "missing-delta-part"
  | "empty-assistant-message"
  | "child-session-idle"
  | "child-session-discovered"
  | "ensure-session-messages"
  | "stream-reconnect"
  | "transport-switch"
  | "stale-status-resync"
  | "settled-running-tool"

export type DirectoryEventResult = boolean | {
  changed: boolean
  materialization: {
    type: "incomplete-session-snapshot"
    reason: SessionMaterializationReason
    sessionID?: string
    messageID: string
    partID?: string
  }
}

function hasMessage(draft: State, sessionID: string | undefined, messageID: string): boolean {
  if (!sessionID) return false
  const messages = draft.message[sessionID]
  if (!messages) return false
  return messages.some((message) => message.id === messageID)
}

export function reduceGlobalEvent(event: Event): GlobalEventResult {
  if (event.type === "global.disposed" || event.type === "server.connected") {
    return { type: "refresh" }
  }
  if (event.type === "project.updated") {
    return { type: "project", project: event.properties as Project }
  }
  return null
}

export function applyGlobalProject(state: GlobalState, project: Project): GlobalState {
  const projects = [...state.projects]
  const result = Binary.search(projects, project.id, (s) => s.id)
  if (result.found) {
    projects[result.index] = { ...projects[result.index], ...project }
  } else {
    projects.splice(result.index, 0, project)
  }
  return { ...state, projects }
}

// ---------------------------------------------------------------------------
// Directory events — mutates draft in place for batching efficiency.
// Caller MUST pass a mutable copy of State (e.g. structuredClone or spread).
// ---------------------------------------------------------------------------

export function applyDirectoryEvent(
  draft: State,
  event: Event,
  callbacks?: {
    onRefresh?: (directory: string) => void
    onLoadLsp?: () => void
    onSetSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
  },
): DirectoryEventResult {
  const markSessionEvent = (sessionID: string, deleted: boolean) => {
    const revision = (draft.sessionRevision ?? 0) + 1
    draft.sessionRevision = revision
    draft.sessionListSource = "live"
    draft.sessionEventRevision = draft.sessionEventRevision ?? {}
    draft.sessionDeletedRevision = draft.sessionDeletedRevision ?? {}
    if (deleted) {
      draft.sessionDeletedRevision[sessionID] = revision
      delete draft.sessionEventRevision[sessionID]
    } else {
      draft.sessionEventRevision[sessionID] = revision
      delete draft.sessionDeletedRevision[sessionID]
    }
  }

  switch (event.type) {
    case "server.instance.disposed": {
      callbacks?.onRefresh?.("")
      return false
    }

    case "session.created": {
      const info = stripSessionDiffSnapshots(projectLegacySession(event.properties.info))
      const sessions = draft.session
      const result = Binary.search(sessions, info.id, (s) => s.id)
      if (result.found && shouldSkipStaleSessionEvent(sessions[result.index], info)) {
        return false
      }
      if (result.found) {
        sessions[result.index] = info
      } else {
        sessions.splice(result.index, 0, info)
        trimSessions(draft)
        if (!info.parentID) draft.sessionTotal += 1
      }
      markSessionEvent(info.id, false)
      return true
    }

    case "session.updated": {
      const info = stripSessionDiffSnapshots(projectLegacySession(event.properties.info))
      const sessions = draft.session
      const result = Binary.search(sessions, info.id, (s) => s.id)
      // Keep the freshness check ahead of the archive branch: direct archive
      // responses handle the store update on their own (optimistic removal +
      // SDK response), so stale SSE echoes should not win just because they
      // mark the session archived.
      if (result.found && shouldSkipStaleSessionEvent(sessions[result.index], info)) {
        return false
      }

      if (info.time.archived) {
        if (result.found) sessions.splice(result.index, 1)
        cleanupSessionCaches(draft, info.id, callbacks?.onSetSessionTodo)
        if (!info.parentID) draft.sessionTotal = Math.max(0, draft.sessionTotal - 1)
        markSessionEvent(info.id, true)
        return true
      }

      if (result.found) {
        sessions[result.index] = info
      } else {
        sessions.splice(result.index, 0, info)
        trimSessions(draft)
      }
      markSessionEvent(info.id, false)
      return true
    }

    case "session.deleted": {
      const sessions = draft.session
      const props = event.properties
      const sessionID = props.info?.id ?? props.sessionID
      if (!sessionID) return false
      const result = Binary.search(sessions, sessionID, (s) => s.id)
      const info = props.info ? projectLegacySession(props.info) : (result.found ? sessions[result.index] : undefined)
      if (result.found) sessions.splice(result.index, 1)
      cleanupSessionCaches(draft, sessionID, callbacks?.onSetSessionTodo)
      if (!info?.parentID) draft.sessionTotal = Math.max(0, draft.sessionTotal - 1)
      markSessionEvent(sessionID, true)
      return true
    }

    case "session.diff": {
      const props = event.properties as { sessionID: string; diff: FileDiff[] }
      draft.session_diff[props.sessionID] = props.diff
      return true
    }

    case "todo.updated": {
      const props = event.properties as { sessionID: string; todos: Todo[] }
      if (areJsonEquivalent(draft.todo[props.sessionID], props.todos)) {
        return false
      }
      draft.todo[props.sessionID] = props.todos
      callbacks?.onSetSessionTodo?.(props.sessionID, props.todos)
      return true
    }

    case "session.status": {
      const props = event.properties as { sessionID: string; status: SessionStatus }
      if (areSessionStatusesEqual(draft.session_status[props.sessionID], props.status)) {
        return false
      }
      draft.session_status[props.sessionID] = props.status
      return true
    }

    case "session.idle": {
      const props = event.properties as { sessionID: string }
      const status = { type: "idle" } as const
      if (areSessionStatusesEqual(draft.session_status[props.sessionID], status)) {
        return false
      }
      draft.session_status[props.sessionID] = status
      return true
    }

    case "session.error": {
      const props = event.properties as { sessionID: string }
      const status = { type: "idle" } as const
      if (areSessionStatusesEqual(draft.session_status[props.sessionID], status)) {
        return false
      }
      draft.session_status[props.sessionID] = status
      return true
    }

    case "message.updated": {
      const info = projectLegacyMessage(event.properties.info)
      const messages = draft.message[info.sessionID]
      if (!messages) {
        draft.message[info.sessionID] = [info]
        return true
      }
      const messageIndex = findMessageIndex(messages, info.id)
      if (messageIndex >= 0) {
        // Skip message replacement if unchanged — preserves reference, avoids re-render
        const existing = messages[messageIndex]
        const unchanged = areMessageUpdateFieldsEqual(existing, info)
        if (unchanged) {
          syncDebug.reducer.messageUpdatedUnchanged(info.sessionID, info.id, info.role, (info as { finish?: unknown }).finish, (info.time as { completed?: number })?.completed)
          return false
        }
        const next = [...messages]
        if (compareMessagesChronologically(existing, info) === 0) {
          next[messageIndex] = info
        } else {
          next.splice(messageIndex, 1)
          insertMessageChronologically(next, info)
        }
        draft.message[info.sessionID] = next
      } else {
        const next = [...messages]
        insertMessageChronologically(next, info)
        draft.message[info.sessionID] = next
      }
      return true
    }

    case "message.removed": {
      const props = event.properties as { sessionID: string; messageID: string }
      const messages = draft.message[props.sessionID]
      if (messages) {
        const next = [...messages]
        const messageIndex = findMessageIndex(next, props.messageID)
        if (messageIndex >= 0) {
          next.splice(messageIndex, 1)
          draft.message[props.sessionID] = next
        }
      }
      delete draft.part[props.messageID]
      return true
    }

    case "message.part.updated": {
      const props = event.properties
      const part = projectLegacyPart(props.part)
      if (SKIP_PARTS.has(part.type)) {
        syncDebug.reducer.partSkipped((part as { messageID: string }).messageID, part.id, part.type)
        return false
      }
      const messageID = (part as { messageID?: string }).messageID
      const sessionID = props.sessionID ?? (part as { sessionID?: string }).sessionID
      if (!messageID) return false
      const missingOwningMessage = !hasMessage(draft, sessionID, messageID)
      const parts = draft.part[messageID]
      if (!parts) {
        syncDebug.reducer.partUpdatedNoExistingParts(messageID, part.id, part.type)
        draft.part[messageID] = [part]
        return missingOwningMessage
          ? {
            changed: true,
            materialization: { type: "incomplete-session-snapshot", reason: "missing-owning-message", sessionID, messageID, partID: part.id },
          }
          : true
      }
      const next = [...parts]
      const partIndex = next.findIndex((candidate) => candidate.id === part.id)
      if (partIndex >= 0) {
        const previous = next[partIndex]
        if (shouldPreserveExistingPart(previous, part)) {
          return false
        }
        const dedupeFields = getUpdatedDeltaFields(previous, part)
        next[partIndex] = dedupeFields.length > 0
          ? { ...part, __dedupeNextDeltaFields: dedupeFields } as unknown as Part
          : part
      } else {
        // Replace optimistic part (no sessionID) with server part of same type.
        // Every optimistic part is a candidate, not only the first one: the
        // server echoes a just-sent message part by part, and after the text
        // echo replaced the first slot the file echo still has to find the
        // optimistic file behind it, or the attachment shows twice until the
        // next page fetch. The scan runs only when a part with a NEW id
        // arrives, which during assistant streaming is once per part.
        const optimisticIndex = part.type === "text" || part.type === "file"
          ? next.findIndex((p) => p.type === part.type && !(p as { sessionID?: string }).sessionID)
          : -1
        if (optimisticIndex >= 0) {
          // Replace in place: pushing to the end reorders text/file parts of a
          // just-sent message and remounts its rendered subtree.
          next[optimisticIndex] = part
        } else {
          next.push(part)
        }
      }
      draft.part[messageID] = next
      return missingOwningMessage
        ? {
          changed: true,
          materialization: { type: "incomplete-session-snapshot", reason: "missing-owning-message", sessionID, messageID, partID: part.id },
        }
        : true
    }

    case "message.part.removed": {
      const props = event.properties as { messageID: string; partID: string }
      const parts = draft.part[props.messageID]
      if (!parts) return false
      const partIndex = parts.findIndex((part) => part.id === props.partID)
      if (partIndex >= 0) {
        const next = [...parts]
        next.splice(partIndex, 1)
        if (next.length === 0) {
          delete draft.part[props.messageID]
        } else {
          draft.part[props.messageID] = next
        }
        return true
      }
      return false
    }

    case "message.part.delta": {
      const props = event.properties as {
        sessionID?: string
        messageID: string
        partID: string
        field: string
        delta: string
      }
      const parts = draft.part[props.messageID]
      if (!parts) {
        syncDebug.reducer.partDeltaNoParts(props.messageID, props.partID)
        return {
          changed: false,
          materialization: { type: "incomplete-session-snapshot", reason: "orphan-delta", sessionID: props.sessionID, messageID: props.messageID, partID: props.partID },
        }
      }
      const partIndex = parts.findIndex((part) => part.id === props.partID)
      if (partIndex < 0) {
        syncDebug.reducer.partDeltaNotFound(props.messageID, props.partID)
        return {
          changed: false,
          materialization: { type: "incomplete-session-snapshot", reason: "missing-delta-part", sessionID: props.sessionID, messageID: props.messageID, partID: props.partID },
        }
      }
      const existing = parts[partIndex] as Record<string, unknown>
      const existingValue = existing[props.field] as string | undefined
      const dedupeFields = (existing as DedupeMetadata).__dedupeNextDeltaFields ?? []
      const shouldDedupe = dedupeFields.includes(props.field)
      // Create new Part object + new array so React detects the change
      const next = [...parts]
      next[partIndex] = {
        ...existing,
        [props.field]: shouldDedupe ? appendNonOverlappingDelta(existingValue, props.delta) : (existingValue ?? "") + props.delta,
        __dedupeNextDeltaFields: dedupeFields.filter((field) => field !== props.field),
      } as unknown as Part
      draft.part[props.messageID] = next
      return true
    }

    case "vcs.branch.updated": {
      const props = event.properties as { branch: string }
      if (draft.vcs?.branch === props.branch) return false
      draft.vcs = { branch: props.branch }
      return true
    }

    case "permission.asked": {
      const permission = event.properties as PermissionRequest
      const permissions = draft.permission[permission.sessionID] ?? []
      const next = [...permissions]
      const result = Binary.search(next, permission.id, (p) => p.id)
      if (result.found) {
        next[result.index] = permission
      } else {
        next.splice(result.index, 0, permission)
      }
      draft.permission[permission.sessionID] = next
      return true
    }

    case "permission.replied": {
      const props = event.properties as { sessionID: string; requestID: string }
      const permissions = draft.permission[props.sessionID]
      if (!permissions) return false
      const result = Binary.search(permissions, props.requestID, (p) => p.id)
      if (result.found) {
        const next = [...permissions]
        next.splice(result.index, 1)
        draft.permission[props.sessionID] = next
        return true
      }
      return false
    }

    case "question.asked": {
      const question = event.properties as QuestionRequest
      const questions = draft.question[question.sessionID] ?? []
      const next = [...questions]
      const result = Binary.search(next, question.id, (q) => q.id)
      if (result.found) {
        next[result.index] = question
      } else {
        next.splice(result.index, 0, question)
      }
      draft.question[question.sessionID] = next
      return true
    }

    case "question.replied":
    case "question.rejected": {
      const props = event.properties as { sessionID: string; requestID: string }
      const questions = draft.question[props.sessionID]
      if (!questions) return false
      const result = Binary.search(questions, props.requestID, (q) => q.id)
      if (result.found) {
        const next = [...questions]
        next.splice(result.index, 1)
        draft.question[props.sessionID] = next
        return true
      }
      return false
    }

    case "lsp.updated": {
      callbacks?.onLoadLsp?.()
      return false
    }

    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimSessions(draft: State) {
  if (draft.session.length <= draft.limit) return
  // Keep sessions that have pending permissions (they need to stay visible)
  const hasPermission = new Set(
    Object.entries(draft.permission ?? {})
      .filter(([, perms]) => perms && perms.length > 0)
      .map(([sessionID]) => sessionID),
  )
  while (draft.session.length > draft.limit) {
    // Remove from the beginning (oldest by sorted ID)
    const candidate = draft.session[0]
    if (hasPermission.has(candidate.id)) break
    draft.session.shift()
  }
}

function cleanupSessionCaches(
  draft: State,
  sessionID: string,
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void,
) {
  if (!sessionID) return
  setSessionTodo?.(sessionID, undefined)
  dropSessionCaches(draft, [sessionID])
}

export type DomainEventResult = {
  changed: boolean
  refresh?: { type: "global" | "directory" | "session" | "message" | "transcript"; sessionID?: string; messageID?: string }
}

/** OC2 reducer. Partial stream facts request an authoritative HTTP record instead of inventing one. */
export function applyDomainEvent(draft: State, event: DomainEvent): DomainEventResult {
  const sessionID = "sessionID" in event ? event.sessionID
    : "session" in event ? event.session.id
    : "message" in event ? event.message.sessionID
    : "part" in event ? event.part.sessionID
    : "request" in event ? event.request.value.sessionID
    : undefined
  if (sessionID && "sequence" in event && event.sequence !== undefined) {
    const previous = draft.eventSequence?.[sessionID] ?? 0
    if (event.sequence <= previous) return { changed: false }
    draft.eventSequence = { ...draft.eventSequence, [sessionID]: event.sequence }
  }

  switch (event.type) {
    case "session-upsert": {
      const info = stripSessionDiffSnapshots(event.session)
      const result = Binary.search(draft.session, info.id, (item) => item.id)
      if (result.found && shouldSkipStaleSessionEvent(draft.session[result.index], info)) return { changed: false }
      const next = [...draft.session]
      if (result.found) next[result.index] = info
      else next.splice(result.index, 0, info)
      draft.session = next
      draft.sessionListSource = "live"
      draft.sessionRevision = (draft.sessionRevision ?? 0) + 1
      draft.sessionEventRevision = { ...draft.sessionEventRevision, [info.id]: draft.sessionRevision }
      return { changed: true }
    }
    case "session-delete": {
      const result = Binary.search(draft.session, event.sessionID, (item) => item.id)
      const next = [...draft.session]
      if (result.found) next.splice(result.index, 1)
      draft.session = next
      cleanupSessionCaches(draft, event.sessionID)
      delete draft.pendingPermission[event.sessionID]
      delete draft.pendingInput[event.sessionID]
      draft.sessionListSource = "live"
      draft.sessionRevision = (draft.sessionRevision ?? 0) + 1
      draft.sessionDeletedRevision = { ...draft.sessionDeletedRevision, [event.sessionID]: draft.sessionRevision }
      return { changed: true }
    }
    case "message-upsert": {
      const info = event.message
      const previous = draft.message[info.sessionID] ?? []
      const index = findMessageIndex(previous, info.id)
      if (index >= 0 && areMessageUpdateFieldsEqual(previous[index], info)) return { changed: false }
      const next = [...previous]
      if (index >= 0) next.splice(index, 1)
      insertMessageChronologically(next, info)
      draft.message[info.sessionID] = next
      return { changed: true }
    }
    case "part-upsert": {
      if (SKIP_PARTS.has(event.part.type)) return { changed: false }
      const parts = draft.part[event.part.messageID] ?? []
      const index = parts.findIndex((item) => item.id === event.part.id)
      if (index >= 0 && areJsonEquivalent(parts[index], event.part)) return { changed: false }
      const next = [...parts]
      if (index >= 0) {
        if (shouldPreserveExistingPart(next[index], event.part)) return { changed: false }
        next[index] = event.part
      } else next.push(event.part)
      draft.part[event.part.messageID] = next
      return { changed: true }
    }
    case "part-remove": {
      const parts = draft.part[event.messageID]
      if (!parts) return { changed: false }
      const next = parts.filter((part) => part.id !== event.partID)
      if (next.length === parts.length) return { changed: false }
      if (next.length) draft.part[event.messageID] = next
      else delete draft.part[event.messageID]
      return { changed: true }
    }
    case "part-delta": {
      const parts = draft.part[event.messageID]
      const index = parts?.findIndex((part) => part.id === event.partID) ?? -1
      if (!parts || index < 0) return { changed: false, refresh: { type: "message", sessionID: event.sessionID, messageID: event.messageID } }
      const part = parts[index]
      if (part.type !== "text" && part.type !== "reasoning") return { changed: false }
      const next = [...parts]
      next[index] = { ...part, text: part.text + event.delta }
      if (next[index].text === part.text) return { changed: false }
      draft.part[event.messageID] = next
      return { changed: true }
    }
    case "status": {
      if (areSessionStatusesEqual(draft.session_status[event.sessionID], event.status)) return { changed: false }
      draft.session_status[event.sessionID] = event.status
      return { changed: true }
    }
    case "permission-asked": {
      const request = event.request
      const previous = draft.pendingPermission[request.value.sessionID] ?? []
      const index = previous.findIndex((item) => item.value.id === request.value.id)
      const next = [...previous]
      if (index >= 0) next[index] = request
      else next.push(request)
      draft.pendingPermission[request.value.sessionID] = next
      return { changed: true }
    }
    case "permission-replied": {
      const previous = draft.pendingPermission[event.sessionID]
      if (!previous) return { changed: false }
      const next = previous.filter((item) => item.value.id !== event.requestID)
      if (next.length === previous.length) return { changed: false }
      draft.pendingPermission[event.sessionID] = next
      return { changed: true }
    }
    case "input-created": {
      const request = event.request
      const previous = draft.pendingInput[request.value.sessionID] ?? []
      const index = previous.findIndex((item) => item.value.id === request.value.id)
      const next = [...previous]
      if (index >= 0) next[index] = request
      else next.push(request)
      draft.pendingInput[request.value.sessionID] = next
      return { changed: true }
    }
    case "form-closed": {
      const previous = draft.pendingInput[event.sessionID]
      if (!previous) return { changed: false }
      const next = previous.filter((item) => item.value.id !== event.requestID)
      if (next.length === previous.length) return { changed: false }
      draft.pendingInput[event.sessionID] = next
      return { changed: true }
    }
    case "vcs-branch": {
      if (draft.vcs?.branch === event.branch) return { changed: false }
      draft.vcs = { ...draft.vcs, branch: event.branch }
      return { changed: true }
    }
    case "session-refresh": return { changed: false, refresh: { type: "session", sessionID: event.sessionID } }
    case "message-refresh": return { changed: false, refresh: { type: "message", sessionID: event.sessionID, messageID: event.messageID } }
    case "transcript-refresh": return { changed: false, refresh: { type: "transcript", sessionID: event.sessionID } }
    case "refresh": return { changed: false, refresh: { type: event.scope } }
  }
}
