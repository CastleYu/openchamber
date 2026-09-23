import type { DirectoryBootstrapDemand } from "@/sync/child-store"
import { normalizePath } from "../utils"

type BootstrapProjectSection = {
  project: { id: string; normalizedPath: string }
  groups: Array<{
    id: string
    directory: string | null
    isArchivedBucket?: boolean
    isMain: boolean
  }>
}

export const filterBackgroundEligibleSections = <TSection extends BootstrapProjectSection>(
  sections: TSection[],
  backgroundEligibleProjectIds: ReadonlySet<string>,
  collapsedProjects: ReadonlySet<string>,
): TSection[] => {
  return sections.filter((section) => (
    backgroundEligibleProjectIds.has(section.project.id) || !collapsedProjects.has(section.project.id)
  ));
};

export function buildSessionBootstrapDemands(input: {
  currentDirectory: string | null
  currentSessionDirectory: string | null
}): DirectoryBootstrapDemand[] {
  const demands: DirectoryBootstrapDemand[] = []
  const add = (directory: string | null, reason: DirectoryBootstrapDemand["reason"]) => {
    const normalizedDirectory = normalizePath(directory)
    if (!normalizedDirectory || demands.some((demand) => demand.directory === normalizedDirectory)) return
    demands.push({ directory: normalizedDirectory, priority: "selected", reason })
  }
  add(input.currentDirectory, "current-directory")
  add(input.currentSessionDirectory, "selected-session")
  return demands
}
