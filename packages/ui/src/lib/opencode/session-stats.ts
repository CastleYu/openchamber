/**
 * OpenCode's experimental usage route (`session.stats`,
 * `GET /api/experimental/session/stats`), translated into the shape the usage
 * page reads.
 *
 * Route semantics (OpenCode 2.0.15, `packages/core/src/session/stats.ts`):
 * - `from`/`to` are epoch milliseconds, `from` inclusive, `to` exclusive.
 *   `to` defaults to now; without `from` the range starts at the oldest
 *   message. `from >= to` is a 400.
 * - `project` is an OpenCode project id, not a directory; without it every
 *   project on the server is counted.
 * - `timezone` is an IANA zone used to bucket `activity` into `YYYY-MM-DD`
 *   days (defaults to UTC, so we always send the viewer's zone).
 * - `tools` selects the tool breakdown; the page shows none, so we send
 *   `"none"` and OpenCode skips that work.
 *
 * A failed read throws; it is never a zeroed report.
 */

import type { SessionStatsInfo } from "@opencode/client"
import { opencodeClient } from "./client"
import { OpenCodeRuntimeChangedError, OpenCodeRuntimeError, type OpenCodeRuntime } from './runtime'
import { createV2RuntimeClient } from './v2/client'

interface UsageTokens {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface UsageModel {
  providerID: string
  modelID: string
  variant: string | null
  steps: number
  tokens: UsageTokens
  cost: number
}

interface UsageToolTotals {
  calls: number
  succeeded: number
  failed: number
  unfinished: number
}

interface UsageToolUsage {
  name: string
  calls: number
  succeeded: number
  failed: number
  unfinished: number
  durationP50: number | null
}

export type UsageTools =
  | { mode: 'none' }
  | { mode: 'summary'; totals: UsageToolTotals }
  | { mode: 'detail'; totals: UsageToolTotals; usage: UsageToolUsage[] }

export interface UsageStats {
  range: { from: number; to: number }
  sessions: number
  subagents: number
  prompts: number
  steps: number
  tokens: UsageTokens
  cost: number
  tools: UsageTools
  activeDays: number
  /** Longest run of consecutive active days inside the range. */
  streak: number
  /** Active days only, ascending; days with no model steps are absent. */
  activity: Array<{ date: string; steps: number }>
  /** Sorted by total tokens, largest first. */
  models: UsageModel[]
}

interface UsageStatsQuery {
  from?: number
  to?: number
  /** OpenCode project id; omit for every project. */
  projectID?: string
  timezone: string
}

const toTokens = (tokens: SessionStatsInfo["tokens"]): UsageTokens => ({
  input: tokens.input,
  output: tokens.output,
  reasoning: tokens.reasoning,
  cacheRead: tokens.cache.read,
  cacheWrite: tokens.cache.write,
  total: tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write,
})

const toTools = (tools: SessionStatsInfo['tools']): UsageTools => {
  if (tools.mode === 'none') return { mode: 'none' }
  const totals = {
    calls: tools.totals.calls,
    succeeded: tools.totals.succeeded,
    failed: tools.totals.failed,
    unfinished: tools.totals.unfinished,
  }
  if (tools.mode === 'summary') return { mode: 'summary', totals }
  return {
    mode: 'detail',
    totals,
    usage: tools.usage.map((tool) => ({
      name: tool.name,
      calls: tool.calls,
      succeeded: tool.succeeded,
      failed: tool.failed,
      unfinished: tool.unfinished,
      durationP50: tool.durationP50 ?? null,
    })),
  }
}

const toUsageStats = (info: SessionStatsInfo): UsageStats => ({
  range: { from: info.range.from, to: info.range.to },
  sessions: info.sessions,
  subagents: info.subagents,
  prompts: info.prompts,
  steps: info.steps,
  tokens: toTokens(info.tokens),
  cost: info.cost,
  tools: toTools(info.tools),
  activeDays: info.activeDays,
  streak: info.streak,
  activity: info.activity.map((day) => ({ date: day.date, steps: day.steps })),
  models: info.models.map((entry) => ({
    providerID: entry.model.providerID,
    modelID: entry.model.id,
    variant: entry.model.variant ?? null,
    steps: entry.steps,
    tokens: toTokens(entry.tokens),
    cost: entry.cost,
  })),
})

export function assertUsageStatsRuntime(): OpenCodeRuntime {
  const runtime = opencodeClient.getBoundRuntime()
  if (runtime?.generation !== 'oc2') throw new OpenCodeRuntimeError(runtime?.generation ?? 'unknown', 'session.stats')
  return runtime
}

function assertSameRuntime(runtime: OpenCodeRuntime): void {
  if (opencodeClient.getBoundRuntime() !== runtime) throw new OpenCodeRuntimeChangedError()
}

export async function fetchUsageStats(query: UsageStatsQuery, signal?: AbortSignal, runtime = assertUsageStatsRuntime()): Promise<UsageStats> {
  assertSameRuntime(runtime)
  const client = createV2RuntimeClient({
    baseUrl: opencodeClient.getBaseUrl(),
    assertProtocol: () => assertSameRuntime(runtime),
  })
  const info = await client.session.stats(
    { from: query.from, to: query.to, project: query.projectID, timezone: query.timezone, tools: 'none' },
    { signal },
  )
  assertSameRuntime(runtime)
  return toUsageStats(info)
}

/** Detailed tool-call counts are requested separately so ordinary reports do not scan every call. */
export async function fetchUsageTools(query: UsageStatsQuery, signal?: AbortSignal, runtime = assertUsageStatsRuntime()): Promise<UsageTools> {
  assertSameRuntime(runtime)
  const client = createV2RuntimeClient({
    baseUrl: opencodeClient.getBaseUrl(),
    assertProtocol: () => assertSameRuntime(runtime),
  })
  const info = await client.session.stats(
    { from: query.from, to: query.to, project: query.projectID, timezone: query.timezone, tools: 'detail' },
    { signal },
  )
  assertSameRuntime(runtime)
  return toTools(info.tools)
}

/** The OpenCode project id a directory belongs to, for the `project` filter. */
export async function resolveUsageProjectID(directory: string, signal?: AbortSignal, runtime = assertUsageStatsRuntime()): Promise<string> {
  assertSameRuntime(runtime)
  const project = await opencodeClient.getCurrentProject(directory, signal)
  assertSameRuntime(runtime)
  return project.id
}
