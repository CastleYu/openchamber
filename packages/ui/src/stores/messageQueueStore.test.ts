import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

// The local queue is the VS Code behavior; every other runtime hands the
// queue to the server (see messageQueueStore.server.test.ts).
const desktop = await import("@/lib/desktop")
mock.module("@/lib/desktop", () => ({ ...desktop, isVSCodeRuntime: () => true }))

const {
  createMessageQueueTarget,
  getMessageQueueKey,
  migrateMessageQueueState,
  parseMessageQueueKey,
  useMessageQueueStore,
} = await import("./messageQueueStore")

const originalFetch = globalThis.fetch
let activeTarget = 'a'.repeat(64)
beforeEach(() => {
  activeTarget = 'a'.repeat(64)
  globalThis.fetch = async () => Response.json({ target: activeTarget })
  useMessageQueueStore.setState({ queuedMessages: {}, quarantinedLegacyMessages: {}, sendingIds: {} })
})

afterEach(() => { globalThis.fetch = originalFetch })

describe("message queue runtime ownership", () => {
  test("isolates colliding session IDs by runtime and directory", async () => {
    const a = createMessageQueueTarget("session-1", "/repo", "runtime-a")!
    const b = createMessageQueueTarget("session-1", "/repo", "runtime-b")!
    await useMessageQueueStore.getState().addToQueue(a, { content: "from A" })
    await useMessageQueueStore.getState().addToQueue(b, { content: "from B" })

    expect(useMessageQueueStore.getState().getQueueForTarget(a)[0]?.content).toBe("from A")
    expect(useMessageQueueStore.getState().getQueueForTarget(b)[0]?.content).toBe("from B")
  })

  test("round trips a composite queue key", async () => {
    const target = createMessageQueueTarget("session-1", "/repo", "runtime-a")!
    expect(parseMessageQueueKey(getMessageQueueKey(target))).toEqual(target)
  })

  test("quarantines legacy session-only queues instead of activating them", async () => {
    const migrated = migrateMessageQueueState({
      queuedMessages: {
        "session-1": [{ id: "queued-1", content: "legacy", createdAt: 1 }],
      },
    }, 1)

    expect(migrated.queuedMessages).toEqual({})
    expect(migrated.quarantinedLegacyMessages?.["session-1"]?.[0]?.content).toBe("legacy")
  })

  test("keeps what was captured at queue time on the local message", async () => {
    const target = createMessageQueueTarget("session-1", "/repo", "runtime-a")!
    const context = [{ kind: "synthetic" as const, text: "conflict payload" }]
    await useMessageQueueStore.getState().addToQueue(target, {
      content: "@Builder do it",
      text: "do it",
      agentMention: "Builder",
      context,
    })
    await useMessageQueueStore.getState().addToQueue(target, { content: "plain" })

    const [captured, plain] = useMessageQueueStore.getState().getQueueForTarget(target)
    expect(captured?.content).toBe("@Builder do it")
    expect(captured?.text).toBe("do it")
    expect(captured?.agentMention).toBe("Builder")
    expect(captured?.context).toEqual(context)
    expect(plain?.text).toBe("plain")
    expect(plain?.agentMention).toBe(undefined)
    expect(plain?.context).toBe(undefined)
  })

  test("messages persisted before delivery text existed deliver their content", async () => {
    const migrated = migrateMessageQueueState({
      queuedMessages: {
        "runtime-a\n/repo\nsession-1": [{ id: "queued-1", content: "@Builder old", createdAt: 1 }],
      },
    }, 2)

    expect(migrated.queuedMessages?.["runtime-a\n/repo\nsession-1"]?.[0]?.text).toBe("@Builder old")
  })

  test("bounds each local queue without evicting captured intent", async () => {
    const target = createMessageQueueTarget("session-1", "/repo", "runtime-a")!
    for (let index = 0; index < 20; index += 1) {
      await useMessageQueueStore.getState().addToQueue(target, { content: `message-${index}` })
    }

    const queue = useMessageQueueStore.getState().getQueueForTarget(target)
    expect(queue).toHaveLength(20)
    expect(queue[0]?.content).toBe("message-0")
    await expect(useMessageQueueStore.getState().addToQueue(target, { content: "overflow" })).rejects.toThrow("full")
    expect(useMessageQueueStore.getState().getQueueForTarget(target)).toEqual(queue)
  })
})

describe("in-flight queued sends", () => {
  test("hides a dispatched message from the sendable queue but keeps it visible", async () => {
    const target = createMessageQueueTarget("session-1", "/repo", "runtime-a")!
    const store = useMessageQueueStore.getState()
    await store.addToQueue(target, { content: "first" })
    await store.addToQueue(target, { content: "second" })
    const [first] = useMessageQueueStore.getState().getQueueForTarget(target)

    useMessageQueueStore.getState().markSending(target, first.id)

    expect(useMessageQueueStore.getState().getQueueForTarget(target)).toHaveLength(2)
    const sendable = useMessageQueueStore.getState().getSendableQueue(target)
    expect(sendable).toHaveLength(1)
    expect(sendable[0]?.content).toBe("second")

    useMessageQueueStore.getState().clearSending(target, first.id)
    expect(useMessageQueueStore.getState().getSendableQueue(target)).toHaveLength(2)
    expect(useMessageQueueStore.getState().sendingIds).toEqual({})
  })

  test("clearQueue retains a message whose send is still awaiting the server", async () => {
    const target = createMessageQueueTarget("session-1", "/repo", "runtime-a")!
    const store = useMessageQueueStore.getState()
    await store.addToQueue(target, { content: "in flight" })
    await store.addToQueue(target, { content: "merged by composer" })
    const [inFlight] = useMessageQueueStore.getState().getQueueForTarget(target)
    useMessageQueueStore.getState().markSending(target, inFlight.id)

    useMessageQueueStore.getState().clearQueue(target)

    const remaining = useMessageQueueStore.getState().getQueueForTarget(target)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(inFlight.id)
  })

  test("clearQueue drops everything once no send is in flight", async () => {
    const target = createMessageQueueTarget("session-1", "/repo", "runtime-a")!
    await useMessageQueueStore.getState().addToQueue(target, { content: "queued" })

    useMessageQueueStore.getState().clearQueue(target)

    expect(useMessageQueueStore.getState().getQueueForTarget(target)).toHaveLength(0)
  })
})

describe("local queue configured target", () => {
  test("changed target holds old intent and editing returns the full payload", async () => {
    const target = createMessageQueueTarget("same-id", "/repo", "runtime-a")!
    const store = useMessageQueueStore.getState()
    const context = [{ kind: "synthetic" as const, text: "captured context" }]
    await store.addToQueue(target, { content: "original", context })
    const [original] = store.getQueueForTarget(target)
    expect(original.queueTarget).toBe('a'.repeat(64))
    activeTarget = 'b'.repeat(64)
    expect(await store.takeForSend(target)).toEqual([])
    expect(store.getSendableQueue(target)).toEqual([])
    expect(store.getQueueForTarget(target)[0].delivery).toBe("target-changed")
    expect(await store.popToInput(target, original.id)).toEqual({ ...original, delivery: "target-changed" })
    expect(store.getQueueForTarget(target)).toEqual([])
  })
  test("unknown persisted intent stays held, but can be removed or edited", async () => {
    const target = createMessageQueueTarget("same-id", "/repo", "runtime-a")!
    const legacy = { id: "legacy", content: "keep me", text: "keep me", createdAt: 1 }
    useMessageQueueStore.setState({ queuedMessages: { [getMessageQueueKey(target)]: [legacy] } })
    const store = useMessageQueueStore.getState()
    expect(await store.takeForSend(target)).toEqual([])
    expect(store.getQueueForTarget(target)[0].delivery).toBe("target-unknown")
    expect((await store.popToInput(target, legacy.id))?.content).toBe("keep me")
  })
  test("failed dispatch restores the captured target without reassigning it", async () => {
    const target = createMessageQueueTarget("same-id", "/repo", "runtime-a")!
    const store = useMessageQueueStore.getState()
    await store.addToQueue(target, { content: "retry original" })
    const taken = await store.takeForSend(target)
    activeTarget = 'b'.repeat(64)
    store.restoreTaken(target, taken)
    await store.takeForSend(target)
    expect(store.getQueueForTarget(target)).toEqual(taken.map(item => ({ ...item, delivery: "target-changed" })))
    store.restoreTaken(target, taken)
    expect(store.getQueueForTarget(target)).toHaveLength(1)
  })
  test("target lookup failure preserves old messages and rejects a new enqueue", async () => {
    const target = createMessageQueueTarget("same-id", "/repo", "runtime-a")!
    const store = useMessageQueueStore.getState()
    await store.addToQueue(target, { content: "keep" })
    globalThis.fetch = async () => new Response('', { status: 503 })
    await expect(store.addToQueue(target, { content: "reject" })).rejects.toThrow()
    expect(store.getQueueForTarget(target)).toHaveLength(1)
    expect(store.getQueueForTarget(target)[0].delivery).toBe("target-unknown")
  })
})
