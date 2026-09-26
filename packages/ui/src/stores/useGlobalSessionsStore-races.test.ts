import { ensureChatsRootDirectory } from '@/lib/chatDirectories';
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { Session } from "@/lib/opencode/model"

import { opencodeClient } from "@/lib/opencode/client"
import { useGlobalSessionsStore } from "./useGlobalSessionsStore"

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let listRequest: Deferred<Session[]>

// The store issues one inclusive (`archived: true`) paginated request per
// load/refresh scope and splits active/archived client-side, so restored
// sessions (`time.archived` falsy-but-present) stay visible in the active
// list. The mock serves that single request.
const originalListSessionsPage = opencodeClient.listSessionsPage

const session = (id: string, title = id, archived?: number): Session => {
  const value: Session = {
    id,
    projectID: "project",
    directory: "/repo",
    title,
    time: { created: 1, updated: 1 },
  };
  if (archived !== undefined) value.time.archived = archived;
  return value;
}

describe("global session mutation reconciliation", () => {
  beforeEach(() => {
    listRequest = deferred<Session[]>()
    opencodeClient.listSessionsPage = async () => ({ sessions: await listRequest.promise, cursor: {} })
    useGlobalSessionsStore.getState().resetForRuntimeSwitch()
  })

  afterEach(() => {
    opencodeClient.listSessionsPage = originalListSessionsPage
  })

  test("keeps a session created after a full load starts", async () => {
    const loading = useGlobalSessionsStore.getState().loadSessions()
    useGlobalSessionsStore.getState().upsertSession(session("created"))

    listRequest.resolve([])
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(["created"])
  })

  test("does not resurrect a session deleted after a full load starts", async () => {
    const stale = session("deleted")
    useGlobalSessionsStore.getState().applySnapshot([stale], [])
    const loading = useGlobalSessionsStore.getState().loadSessions()
    useGlobalSessionsStore.getState().removeSessions([stale.id])

    listRequest.resolve([stale])
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions).toEqual([])
    expect(useGlobalSessionsStore.getState().archivedSessions).toEqual([])
  })

  test("keeps an archive mutation newer than both list requests", async () => {
    const stale = session("archived")
    useGlobalSessionsStore.getState().applySnapshot([stale], [])
    const loading = useGlobalSessionsStore.getState().loadSessions()
    useGlobalSessionsStore.getState().archiveSessions([stale.id], 10)

    listRequest.resolve([stale])
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions).toEqual([])
    expect(useGlobalSessionsStore.getState().archivedSessions[0]?.time.archived).toBe(10)
  })

  test("keeps a newer title when an older response finishes last", async () => {
    const stale = session("updated", "Old")
    useGlobalSessionsStore.getState().applySnapshot([stale], [])
    const loading = useGlobalSessionsStore.getState().loadSessions()
    useGlobalSessionsStore.getState().upsertSession(session("updated", "New"))

    listRequest.resolve([stale])
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions[0]?.title).toBe("New")
  })

  test("uses commit-time state when the load fails", async () => {
    const created = session("created")
    const loading = useGlobalSessionsStore.getState().loadSessions()
    useGlobalSessionsStore.getState().upsertSession(created)

    listRequest.reject(new Error("unavailable"))
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions).toEqual([created])
    expect(useGlobalSessionsStore.getState().status).toBe("error")
  })

  test("splits a restored session into the active list", async () => {
    const loading = useGlobalSessionsStore.getState().loadSessions()

    listRequest.resolve([session("active"), session("archived", "archived", 5), session("restored", "restored", 0)])
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(["active", "restored"])
    expect(useGlobalSessionsStore.getState().archivedSessions.map((item) => item.id)).toEqual(["archived"])
    expect(useGlobalSessionsStore.getState().status).toBe("ready")
  })

  test("does not undo a move while refreshing the source directory", async () => {
    const source = { ...session("moved"), directory: "/source" }
    const destination = { ...source, directory: "/destination" }
    useGlobalSessionsStore.getState().applySnapshot([source], [])
    const refreshing = useGlobalSessionsStore.getState().refreshSessionsForDirectories(["/source"])
    useGlobalSessionsStore.getState().upsertSession(destination)

    listRequest.resolve([source])
    await refreshing

    expect(useGlobalSessionsStore.getState().sessionsByDirectory.get("/source")).toBe(undefined)
    expect(useGlobalSessionsStore.getState().sessionsByDirectory.get("/destination")?.[0]?.id).toBe("moved")
  })

  test("keeps a restore mutation newer than the directory refresh", async () => {
    const archived = { ...session("restored", "restored", 5), directory: "/source" }
    useGlobalSessionsStore.getState().applySnapshot([], [archived])
    const refreshing = useGlobalSessionsStore.getState().refreshSessionsForDirectories(["/source"])
    useGlobalSessionsStore.getState().upsertSession({ ...archived, time: { ...archived.time, archived: 0 } })

    // The server still reports the pre-restore row for this directory.
    listRequest.resolve([archived])
    await refreshing

    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(["restored"])
    expect(useGlobalSessionsStore.getState().archivedSessions).toEqual([])
  })
})

describe("paginated global session load", () => {
  const PAGE_SIZE = 500
  let secondPage: Deferred<Session[]>
  let listCalls: number

  const firstPage = Array.from({ length: PAGE_SIZE }, (_, index) => ({
    ...session(`page1-${index}`),
    time: { created: 1, updated: 1000 - index },
  }))
  const originalPagedListSessionsPage = opencodeClient.listSessionsPage

  const until = async (predicate: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error("condition never became true")
  }

  beforeEach(() => {
    secondPage = deferred<Session[]>()
    listCalls = 0
    opencodeClient.listSessionsPage = async (options) => {
      listCalls += 1
      return {
        sessions: options?.cursor === undefined ? firstPage : await secondPage.promise,
        cursor: options?.cursor === undefined ? { next: 'page-2' } : {},
      }
    }
    useGlobalSessionsStore.getState().resetForRuntimeSwitch()
  })

  afterEach(() => {
    opencodeClient.listSessionsPage = originalPagedListSessionsPage
  })

  test("shows the first page before pagination finishes", async () => {
    const loading = useGlobalSessionsStore.getState().loadSessions()
    await until(() => useGlobalSessionsStore.getState().activeSessions.length > 0)

    const partial = useGlobalSessionsStore.getState()
    expect(partial.activeSessions).toHaveLength(PAGE_SIZE)
    expect(partial.status).toBe("loading")
    expect(partial.hasLoaded).toBe(false)
    expect(listCalls).toBe(2)

    secondPage.resolve([{ ...session("page2-0"), time: { created: 1, updated: 400 } }])
    await loading

    const complete = useGlobalSessionsStore.getState()
    expect(complete.activeSessions).toHaveLength(PAGE_SIZE + 1)
    expect(complete.activeSessions.some((item) => item.id === "page2-0")).toBe(true)
    expect(complete.status).toBe("ready")
    expect(complete.hasLoaded).toBe(true)
  })

  test("keeps the persisted seed visible while pagination continues", async () => {
    const seeded = session("seeded")
    useGlobalSessionsStore.getState().upsertSession(seeded)

    const loading = useGlobalSessionsStore.getState().loadSessions()
    await until(() => useGlobalSessionsStore.getState().activeSessions.length > 1)

    expect(useGlobalSessionsStore.getState().activeSessions.some((item) => item.id === "seeded")).toBe(true)

    secondPage.resolve([])
    await loading
  })

  test("keeps an archive made between the first page and completion", async () => {
    const loading = useGlobalSessionsStore.getState().loadSessions()
    await until(() => useGlobalSessionsStore.getState().activeSessions.length > 0)

    useGlobalSessionsStore.getState().archiveSessions(["page1-0"], 42)

    secondPage.resolve([])
    await loading

    const state = useGlobalSessionsStore.getState()
    expect(state.activeSessions.some((item) => item.id === "page1-0")).toBe(false)
    expect(state.archivedSessions.map((item) => item.id)).toEqual(["page1-0"])
    expect(state.status).toBe("ready")
  })

  test("keeps the first page when a later page fails", async () => {
    const loading = useGlobalSessionsStore.getState().loadSessions()
    await until(() => useGlobalSessionsStore.getState().activeSessions.length > 0)

    secondPage.reject(new Error("unavailable"))
    await loading

    const state = useGlobalSessionsStore.getState()
    expect(state.activeSessions).toHaveLength(PAGE_SIZE)
    expect(state.status).toBe("error")
  })

  test("drops the pages when the runtime switches mid-load", async () => {
    const loading = useGlobalSessionsStore.getState().loadSessions()
    await until(() => useGlobalSessionsStore.getState().activeSessions.length > 0)

    useGlobalSessionsStore.getState().resetForRuntimeSwitch()
    secondPage.resolve([{ ...session("page2-0"), time: { created: 1, updated: 400 } }])
    await loading

    const state = useGlobalSessionsStore.getState()
    expect(state.activeSessions).toEqual([])
    expect(state.archivedSessions).toEqual([])
    expect(state.hasLoaded).toBe(false)
    expect(state.status).toBe("idle")
  })
})

const originalHomeInfo = opencodeClient.getFilesystemHomeInfo;
opencodeClient.getFilesystemHomeInfo = async () => ({ home: '/home/user' });
await ensureChatsRootDirectory();
opencodeClient.getFilesystemHomeInfo = originalHomeInfo;

describe("global snapshot authority", () => {
  beforeEach(() => {
    listRequest = deferred<Session[]>()
    opencodeClient.listSessionsPage = async () => ({ sessions: await listRequest.promise, cursor: {} })
    useGlobalSessionsStore.getState().resetForRuntimeSwitch()
  })

  afterEach(() => {
    opencodeClient.listSessionsPage = originalListSessionsPage
  })

  test("a scoped directory refresh never claims global authority", async () => {
    const scoped = { ...session("scoped"), directory: "/source" }
    const refreshing = useGlobalSessionsStore.getState().refreshSessionsForDirectories(["/source"])

    listRequest.resolve([scoped])
    await refreshing

    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(["scoped"])
    expect(useGlobalSessionsStore.getState().status).toBe("idle")
    expect(useGlobalSessionsStore.getState().hasLoaded).toBe(false)
  })

  test("only a successful complete snapshot arms ready authority", async () => {
    expect(useGlobalSessionsStore.getState().status).toBe("idle")

    const loading = useGlobalSessionsStore.getState().loadSessions()
    listRequest.resolve([session("everything")])
    await loading

    expect(useGlobalSessionsStore.getState().status).toBe("ready")
  })

  test("a failed complete snapshot preserves prior sessions and withholds authority", async () => {
    const known = session("known")
    useGlobalSessionsStore.getState().applySnapshot([known], [])

    const loading = useGlobalSessionsStore.getState().loadSessions()
    listRequest.reject(new Error("opencode unreachable"))
    await loading

    expect(useGlobalSessionsStore.getState().activeSessions.map((item) => item.id)).toEqual(["known"])
    expect(useGlobalSessionsStore.getState().status).toBe("error")
  })
})
