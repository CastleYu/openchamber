import { z } from 'zod'
import type { Metadata, Session } from '@/lib/opencode/model'

/** Jev opens work, may suggest completion, and only the user marks it done. */
const workSchema = z.object({
  state: z.enum(['open', 'done']),
  openedAt: z.number().optional(),
  openedBy: z.enum(['jev', 'user']).optional(),
  doneAt: z.number().optional(),
  suggestDoneAt: z.number().optional(),
})

export type SessionWork = z.infer<typeof workSchema>

const namespaceSchema = z.object({ openchamber: z.object({ work: workSchema }) })

export function getSessionWork(session: Session | null | undefined): SessionWork | null {
  return namespaceSchema.safeParse(session?.metadata).data?.openchamber.work ?? null
}

const inWorkSchema = z.object({ openchamber: z.object({ work: z.object({ state: z.literal('open') }) }) })

export function isSessionInWork(session: Session | null | undefined): boolean {
  return inWorkSchema.safeParse(session?.metadata).success
}

/** A new turn retires a stale completion hint even if its cleanup event was missed. */
export function isDoneSuggested(session: Session | null | undefined): boolean {
  const work = getSessionWork(session)
  if (work?.state !== 'open' || work.suggestDoneAt === undefined || !session) return false
  return work.suggestDoneAt >= (session.time?.idle ?? 0)
}

const openchamberSchema = z.object({ openchamber: z.record(z.string(), z.json()) })

export function withSessionWorkState(metadata: Metadata, state: SessionWork['state'], now: number): Metadata {
  const namespace = openchamberSchema.safeParse(metadata).data?.openchamber ?? {}
  const current = namespaceSchema.safeParse(metadata).data?.openchamber.work ?? null
  if (current?.state === state) return metadata
  if (state === 'open') {
    return { ...metadata, openchamber: { ...namespace, work: { state: 'open', openedAt: now, openedBy: 'user' } } }
  }
  const work: Metadata = { state: 'done', doneAt: now }
  if (current?.openedAt !== undefined) work.openedAt = current.openedAt
  if (current?.openedBy !== undefined) work.openedBy = current.openedBy
  return { ...metadata, openchamber: { ...namespace, work } }
}
