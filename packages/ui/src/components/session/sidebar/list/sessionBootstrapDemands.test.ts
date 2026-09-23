import { describe, expect, test } from "bun:test"
import { buildSessionBootstrapDemands, filterBackgroundEligibleSections } from "./sessionBootstrapDemands"

describe("buildSessionBootstrapDemands", () => {
  test("demands only the current directory and the selected session directory", () => {
    const demands = buildSessionBootstrapDemands({
      currentDirectory: "/repo",
      currentSessionDirectory: "/repo/wt-b",
    })

    expect(demands).toEqual([
      { directory: "/repo", priority: "selected", reason: "current-directory" },
      { directory: "/repo/wt-b", priority: "selected", reason: "selected-session" },
    ])
  })

  test("deduplicates one directory selected through both paths", () => {
    const demands = buildSessionBootstrapDemands({
      currentDirectory: "/repo/",
      currentSessionDirectory: "/repo",
    })

    expect(demands.map(({ directory, reason }) => [directory, reason])).toEqual([["/repo", "current-directory"]])
  })

  test("publishes nothing without a working directory", () => {
    expect(buildSessionBootstrapDemands({ currentDirectory: null, currentSessionDirectory: null })).toEqual([])
  })
})

describe("filterBackgroundEligibleSections", () => {
  const sections = [
    { project: { id: "project-a", normalizedPath: "/repo" }, groups: [] },
  ]

  test("keeps eligible sections even when they are collapsed", () => {
    const filtered = filterBackgroundEligibleSections(sections, new Set(["project-a"]), new Set(["project-a"]))

    expect(filtered.map((section) => section.project.id)).toEqual(["project-a"])
  })

  test("drops collapsed inactive projects but keeps explicitly expanded projects", () => {
    const inactive = { project: { id: "project-b", normalizedPath: "/other" }, groups: [] }
    const expanded = { project: { id: "project-c", normalizedPath: "/expanded" }, groups: [] }

    const filtered = filterBackgroundEligibleSections(
      [...sections, inactive, expanded],
      new Set(["project-c"]),
      new Set(["project-b"]),
    )

    expect(filtered.map((section) => section.project.id)).toEqual(["project-a", "project-c"])
  })

  test("keeps collapsed projects that own an active session", () => {
    const inactive = { project: { id: "project-b", normalizedPath: "/other" }, groups: [] }

    const filtered = filterBackgroundEligibleSections(
      [...sections, inactive],
      new Set(["project-b"]),
      new Set(["project-b"]),
    )

    expect(filtered.map((section) => section.project.id)).toEqual(["project-a", "project-b"])
  })
})
