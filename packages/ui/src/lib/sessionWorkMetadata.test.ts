import { expect, test } from 'bun:test'
import type { Metadata, Session } from '@/lib/opencode/model'
import { getSessionWork, isDoneSuggested, isSessionInWork, withSessionWorkState } from './sessionWorkMetadata'

const session = (metadata: Metadata, idle = 100): Session => ({
  id: 'ses_1', projectID: 'prj', directory: '/repo', title: 'work',
  time: { created: 1, updated: 200, idle }, metadata,
})

test('work membership follows the stored open state', () => {
  expect(isSessionInWork(session({ openchamber: { work: { state: 'open' } } }))).toBe(true)
  expect(isSessionInWork(session({ openchamber: { work: { state: 'done' } } }))).toBe(false)
  expect(isSessionInWork(session({}))).toBe(false)
})

test('completion hint expires when a newer turn settles', () => {
  const hinted = { openchamber: { work: { state: 'open', suggestDoneAt: 150 } } }
  expect(isDoneSuggested(session(hinted, 100))).toBe(true)
  expect(isDoneSuggested(session(hinted, 300))).toBe(false)
})

test('closing work preserves its origin and removes the hint', () => {
  const open: Metadata = { openchamber: { goal: { id: 'g' }, work: {
    state: 'open', openedAt: 5, openedBy: 'jev', suggestDoneAt: 8,
  } } }
  const done = withSessionWorkState(open, 'done', 20)
  expect(getSessionWork(session(done))).toEqual({ state: 'done', doneAt: 20, openedAt: 5, openedBy: 'jev' })
  expect(done.openchamber).toMatchObject({ goal: { id: 'g' } })
  expect(withSessionWorkState(done, 'done', 30)).toBe(done)
})
