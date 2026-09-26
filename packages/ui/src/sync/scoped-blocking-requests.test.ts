import { describe, expect, test } from "bun:test"
import type { Session } from "@/lib/opencode/model"

import {
  areRequestArraysReferentiallyEqual,
  collectScopedBlockingRequests,
  collectScopedRequests,
} from "./scoped-blocking-requests"

const session = (id: string, parentID?: string): Session => ({
  id, parentID, projectID: "project", directory: "/repo", title: id, time: { created: 1, updated: 1 },
})

describe("scoped blocking requests", () => {
  test("collects requests for the current session subtree", () => {
    const rootRequest = { id: "perm_root" }
    const childRequest = { id: "perm_child" }
    const grandchildRequest = { id: "perm_grandchild" }
    const siblingRequest = { id: "perm_sibling" }
    const empty: Array<typeof rootRequest> = []

    const result = collectScopedBlockingRequests(
      [
        session("ses_root"),
        session("ses_child", "ses_root"),
        session("ses_grandchild", "ses_child"),
        session("ses_sibling"),
      ],
      {
        ses_root: [rootRequest],
        ses_child: [childRequest],
        ses_grandchild: [grandchildRequest],
        ses_sibling: [siblingRequest],
      },
      "ses_root",
      empty,
    )

    expect(result).toEqual([rootRequest, childRequest, grandchildRequest])
  })

  test("returns the provided empty array when no scoped requests exist", () => {
    const empty: Array<{ id: string }> = []

    expect(collectScopedBlockingRequests([session("ses_root")], {}, "ses_root", empty)).toBe(empty)
    expect(collectScopedBlockingRequests([session("ses_root")], {}, null, empty)).toBe(empty)
  })

  test("compares request arrays by item identity", () => {
    const first = { id: "perm_1" }
    const second = { id: "perm_2" }

    expect(areRequestArraysReferentiallyEqual([first, second], [first, second])).toBe(true)
    expect(areRequestArraysReferentiallyEqual([first, second], [second, first])).toBe(false)
    expect(areRequestArraysReferentiallyEqual([first], [{ id: "perm_1" }])).toBe(false)
  })

  test("keeps tagged form requests intact across a session subtree", () => {
    const form = { generation: "oc2" as const, kind: "form" as const, value: { id: "form_1", sessionID: "ses_child" } }
    const sibling = { generation: "oc2" as const, kind: "form" as const, value: { id: "form_2", sessionID: "ses_sibling" } }
    const result = collectScopedRequests(
      [session("ses_root"), session("ses_child", "ses_root"), session("ses_sibling")],
      { ses_child: [form, form], ses_sibling: [sibling] }, "ses_root", [],
      (request) => request.value.id,
    )
    expect(result).toEqual([form])
    expect(result[0]).toBe(form)
  })
})
