import { describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createStore } from "zustand/vanilla"
import { bootstrapDirectory, bootstrapGlobal } from "./bootstrap"
import { INITIAL_STATE, type GlobalState, type State } from "./types"
import { getBackgroundNetworkState, runBackgroundNetworkTask } from "../lib/background-network"
import type { SyncSource } from "./source"

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

const createSdk = (respond?: (url: URL) => Response | Promise<Response> | undefined) => createOpencodeClient({
  baseUrl: "https://bootstrap.test",
  directory: "/sdk-default",
  fetch: async (request) => {
    const url = new URL(request instanceof Request ? request.url : request.toString())
    const override = respond?.(url)
    if (override) return override
    const directory = url.searchParams.get("directory")
    const body = url.pathname === "/project/current" ? { id: "project-a" }
      : url.pathname === "/path" ? { directory, worktree: directory, state: "", config: "", home: "/home" }
      : url.pathname === "/config" ? { instructions: [directory] }
      : url.pathname === "/session/status" ? {}
      : url.pathname === "/vcs" ? { branch: "main" }
      : []
    return Response.json(body)
  },
})

const inputFor = (sdk: OpencodeClient | SyncSource = createSdk(), state: Partial<State> = {}) => {
  const store = createStore<State>(() => ({ ...INITIAL_STATE, ...state }))
  return {
    directory: "/repo", sdk, store,
    set: (patch: Partial<State>) => { store.setState(patch) },
    global: { config: {}, projects: [] },
    loadSessions: async () => undefined,
  }
}

describe("bootstrapGlobal", () => {
  test("never enumerates projects while the visible directory is still loading", async () => {
    const calls: string[] = []
    const patches: Array<Partial<GlobalState>> = []

    await bootstrapGlobal(
      createSdk((url) => { calls.push(url.pathname); return undefined }),
      (patch) => patches.push(patch),
    )

    expect(calls.sort()).toEqual(["/global/config", "/path"])
    expect(patches.at(-1)).toEqual({ ready: true, error: undefined })
  })
})

describe("bootstrapDirectory", () => {
  test("OC2 cold bootstrap publishes its VCS branch to the tray state", async () => {
    const unused = (): never => { throw new Error("Unexpected sync operation") }
    const source: SyncSource = {
      generation: "oc2",
      identity: {},
      bootstrap: {
        getVcs: async () => ({ branch: "feature", defaultBranch: "main" }),
        getCurrentProject: async () => ({ id: "project-a", worktree: "/repo", time: { created: 1, updated: 1 }, sandboxes: [] }),
        getTaggedConfig: async () => ({ generation: "oc2", value: {} }),
        getBootstrapPath: async () => ({ directory: "/repo", worktree: "/repo", home: "/home" }),
        getLspStatus: async () => [],
        listSyncSessions: unused, getProviderCatalog: unused, listTaggedAgents: unused,
      },
      status: async () => ({}), permissions: async () => [], inputs: async () => [],
      listSessions: unused, getSession: unused, messagePage: unused, getMessage: unused,
      events: unused,
    }
    const input = inputFor(source)
    const bootstrap = bootstrapDirectory(input)
    expect(await bootstrap.environment).toBe("complete")
    expect(input.store.getState().vcs).toEqual({ branch: "feature", default_branch: "main" })
  })
  test("metadata discovery does not activate MCP status or command prompts", async () => {
    const calls: string[] = []
    const input = inputFor(createSdk((url) => { calls.push(url.pathname); return undefined }))
    const bootstrap = bootstrapDirectory(input)
    expect(await bootstrap.sessions).toBe("complete")
    expect(await bootstrap.environment).toBe("complete")
    expect(calls).not.toContain("/mcp/status")
    expect(calls).not.toContain("/command")
  })

  test("session loading finishes before deferred environment fields", async () => {
    const blocked = deferred<Response>()
    let sessionsStarted = false
    const input = inputFor(createSdk((url) => url.pathname === "/config" ? blocked.promise : undefined))
    const bootstrap = bootstrapDirectory({ ...input, loadSessions: async () => { sessionsStarted = true } })
    expect(await bootstrap.sessions).toBe("complete")
    expect(sessionsStarted).toBe(true)
    expect(input.store.getState().status).toBe("partial")
    blocked.resolve(Response.json({}))
    expect(await bootstrap.environment).toBe("complete")
  })

  test("stale bootstrap work does not commit", async () => {
    const input = inputFor()
    const bootstrap = bootstrapDirectory({ ...input, isStale: () => true })
    expect(await bootstrap.sessions).toBe("stale")
    expect(await bootstrap.environment).toBe("stale")
    expect(input.store.getState()).toMatchObject(INITIAL_STATE)
  })

  test("finishes session loading while /config is unresolved", async () => {
    const blocked = deferred<Response>()
    const input = inputFor(createSdk((url) => url.pathname === "/config" ? blocked.promise : undefined))
    let initialized = false
    const bootstrap = bootstrapDirectory(input)
    void bootstrap.environment.then(() => { initialized = true })
    try {
      expect(await bootstrap.sessions).toBe("complete")
      expect(initialized).toBe(false)
      expect(input.store.getState().status).toBe("partial")
    } finally {
      blocked.resolve(Response.json({}))
      expect(await bootstrap.environment).toBe("complete")
      expect(input.store.getState().status).toBe("complete")
    }
  })

  test("keeps session-list failure separate from successful environment initialization", async () => {
    const cached = [{
      id: "cached", slug: "cached", projectID: "project-a", directory: "/repo",
      title: "Cached", version: "1", time: { created: 1, updated: 1 },
    }]
    const input = inputFor(createSdk(), { session: cached })
    const bootstrap = bootstrapDirectory({ ...input, loadSessions: async () => { throw new Error("unavailable") } })
    expect(await bootstrap.sessions).toBe("failed")
    expect(await bootstrap.environment).toBe("complete")
    expect(input.store.getState().session).toBe(cached)
  })

  test("a config failure cannot suppress status or pending-question recovery", async () => {
    const question = { id: "question", sessionID: "session", questions: [] }
    const input = inputFor(createSdk((url) => {
      if (url.pathname === "/config") return Response.json({ message: "invalid config" }, { status: 400 })
      if (url.pathname === "/question") return Response.json([question])
    }))
    const bootstrap = bootstrapDirectory(input)
    expect(await bootstrap.sessions).toBe("complete")
    expect(await bootstrap.environment).toBe("failed")
    expect(input.store.getState().question.session).toEqual([question])
    expect(input.store.getState().sessionStatusReady).toBe(true)
  })

  test("a failed status request does not grant idle authority", async () => {
    const input = inputFor(createSdk((url) => url.pathname === "/session/status"
      ? Response.json({ message: "status unavailable" }, { status: 400 }) : undefined))
    const bootstrap = bootstrapDirectory(input)
    expect(await bootstrap.sessions).toBe("complete")
    expect(await bootstrap.environment).toBe("failed")
    expect(input.store.getState().sessionStatusReady).toBeUndefined()
  })

  test("malformed status success does not clear live state or grant idle authority", async () => {
    const statuses: State["session_status"] = { session: { type: "busy" } }
    const input = inputFor(createSdk((url) => url.pathname === "/session/status" ? Response.json([]) : undefined), {
      session_status: statuses,
    })
    const bootstrap = bootstrapDirectory(input)
    expect(await bootstrap.sessions).toBe("complete")
    expect(await bootstrap.environment).toBe("failed")
    expect(input.store.getState().sessionStatusReady).toBeUndefined()
    expect(input.store.getState().session_status).toBe(statuses)
  })

  test("never reads MCP-initializing endpoints during directory initialization", async () => {
    // Reading MCP status initializes the directory's entire stdio server
    // fleet, and listing commands enumerates MCP prompts, which touches the
    // same state. The sidebar declares bootstrap demand for every known
    // project directory, so either read spawned a fleet per project at
    // startup. MCP and command surfaces fetch on demand instead.
    const requests: URL[] = []
    const input = inputFor(createSdk((url) => { requests.push(url); return undefined }))
    const bootstrap = bootstrapDirectory(input)
    expect(await bootstrap.sessions).toBe("complete")
    expect(await bootstrap.environment).toBe("complete")
    expect(requests.some((url) => url.pathname === "/mcp")).toBe(false)
    expect(requests.some((url) => url.pathname === "/command")).toBe(false)
  })

  test("rejects stale work before starting either phase", async () => {
    let calls = 0
    const input = inputFor(createSdk(() => { calls += 1; return undefined }))
    const state = input.store.getState()
    const bootstrap = bootstrapDirectory({ ...input, isStale: () => true, loadSessions: async () => { calls += 1 } })
    expect(await bootstrap.sessions).toBe("stale")
    expect(await bootstrap.environment).toBe("stale")
    expect(calls).toBe(0)
    expect(input.store.getState()).toBe(state)
  })

  test("drops queued initialization reads after the directory generation changes", async () => {
    const blocked = Array.from({ length: getBackgroundNetworkState().limit }, () => deferred<void>())
    const occupied = blocked.map((task) => runBackgroundNetworkTask(() => task.promise))
    let calls = 0
    let stale = false
    const input = inputFor(createSdk(() => { calls += 1; return undefined }))
    const bootstrap = bootstrapDirectory({ ...input, isStale: () => stale })
    expect(await bootstrap.sessions).toBe("complete")
    stale = true
    const state = input.store.getState()
    for (const task of blocked) task.resolve()
    await Promise.all(occupied)
    expect(await bootstrap.environment).toBe("stale")
    expect(calls).toBe(0)
    expect(input.store.getState()).toBe(state)
  })

  test("an in-flight response cannot commit after its initialization is superseded", async () => {
    const response = deferred<Response>()
    const started = deferred<void>()
    let stale = false
    const input = inputFor(createSdk((url) => {
      if (url.pathname !== "/config") return undefined
      started.resolve()
      return response.promise
    }))
    const bootstrap = bootstrapDirectory({ ...input, isStale: () => stale })
    await bootstrap.sessions
    await started.promise
    stale = true
    const state = input.store.getState()
    response.resolve(Response.json({ instructions: ["old configuration"] }))
    expect(await bootstrap.environment).toBe("stale")
    expect(input.store.getState()).toBe(state)
  })

  test("addresses every environment read to its directory rather than the SDK default", async () => {
    const requests: URL[] = []
    const sdk = createSdk((url) => { requests.push(url); return undefined })
    for (const directory of ["/workspace/Alpha", "C:/Users/Developer/Tree", "//Server/Share/Project", "C:/Users/Ірина/Project with spaces/100%", "C:/"]) {
      requests.length = 0
      const input = { ...inputFor(sdk), directory }
      const bootstrap = bootstrapDirectory(input)
      expect(await bootstrap.sessions).toBe("complete")
      expect(await bootstrap.environment).toBe("complete")
      expect(requests).toHaveLength(8)
      expect(new Set(requests.map((url) => url.searchParams.get("directory")))).toEqual(new Set([directory]))
      expect(input.store.getState().path.directory).toBe(directory)
      expect(input.store.getState().config.instructions).toEqual([directory])
    }
  })

  test("an authoritative empty question list clears old records", async () => {
    const input = inputFor(createSdk(), { question: { session: [{ id: "old", sessionID: "session", questions: [] }] } })
    const bootstrap = bootstrapDirectory(input)
    await bootstrap.sessions
    expect(await bootstrap.environment).toBe("complete")
    expect(input.store.getState().question).toEqual({})
  })

  test("failed question recovery preserves previous questions", async () => {
    const questions = { session: [{ id: "old", sessionID: "session", questions: [] }] }
    const input = inputFor(createSdk((url) => url.pathname === "/question"
      ? Response.json({ message: "unavailable" }, { status: 400 }) : undefined), { question: questions })
    const bootstrap = bootstrapDirectory(input)
    await bootstrap.sessions
    expect(await bootstrap.environment).toBe("failed")
    expect(input.store.getState().question).toBe(questions)
  })

  test("retries transient question failures without replaying the session list", async () => {
    let attempts = 0
    let lists = 0
    const question = { id: "pending", sessionID: "session", questions: [] }
    const input = inputFor(createSdk((url) => {
      if (url.pathname !== "/question") return undefined
      attempts += 1
      return attempts === 1 ? Response.json({ message: "warming up" }, { status: 503 }) : Response.json([question])
    }))
    const bootstrap = bootstrapDirectory({ ...input, loadSessions: async () => { lists += 1 } })
    expect(await bootstrap.sessions).toBe("complete")
    expect(await bootstrap.environment).toBe("complete")
    expect(attempts).toBe(2)
    expect(lists).toBe(1)
    expect(input.store.getState().question.session).toEqual([question])
  })
})
