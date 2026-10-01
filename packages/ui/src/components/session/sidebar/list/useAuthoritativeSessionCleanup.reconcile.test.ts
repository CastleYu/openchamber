import { afterEach, beforeEach, expect, test } from 'bun:test'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Session } from '@/lib/opencode/model'
import type { SyncSource } from '@/sync/source'
import { installHookTestDom } from '../test-utils/testDom'
import { ChildStoreManager } from '@/sync/child-store'
import { setActionRefs } from '@/sync/session-actions'
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore'
import { useSessionUIStore } from '@/sync/session-ui-store'
import { useSpacesStore } from '@/lib/spaces/spaces-store'
import { useAuthoritativeSessionCleanup } from './useAuthoritativeSessionCleanup'

const session = (id: string, directory = '/repo'): Session => ({
  id, directory, projectID: 'project', title: id, time: { created: 1, updated: 1 },
})

const Probe = ({ sessions }: { sessions: Session[] }) => {
  useAuthoritativeSessionCleanup({ hasAuthoritativeGlobalSessions: true, sessions })
  return null
}

let dom: ReturnType<typeof installHookTestDom>
let root: Root
let stores: ChildStoreManager

beforeEach(() => {
  dom = installHookTestDom()
  root = createRoot(dom.container)
  stores = new ChildStoreManager()
  // SAFETY: cleanup only reads the configured child stores, not source operations.
  setActionRefs({} as SyncSource, stores, () => '/repo')
  stores.ensureChild('/repo', { bootstrap: false }).setState({ session: [session('deleted'), session('retained')] })
  useGlobalSessionsStore.getState().applySnapshot([session('deleted'), session('retained')], [], 'ready')
  useSessionUIStore.getState().setCurrentSession('deleted', '/repo')
  useSpacesStore.getState().resetForRuntimeSwitch()
})

afterEach(() => {
  act(() => root.unmount())
  dom.restore()
  stores.disposeAll()
  useGlobalSessionsStore.getState().resetForRuntimeSwitch()
  useSessionUIStore.getState().setCurrentSession(null)
})

test('complete snapshot omission removes the live record and selected chat', () => {
  act(() => root.render(React.createElement(Probe, { sessions: [session('deleted'), session('retained')] })))
  act(() => root.render(React.createElement(Probe, { sessions: [session('retained')] })))
  expect(stores.getChild('/repo')?.getState().session.map((item) => item.id)).toEqual(['retained'])
  expect(useGlobalSessionsStore.getState().entityById.has('deleted')).toBe(false)
  expect(useSessionUIStore.getState().currentSessionId).toBe(null)
})

test('a stale Space list cannot prove its omitted session was deleted', () => {
  const directory = '/spaces/abcdef123456/repo'
  const spaceSession = session('space-chat', directory)
  stores.ensureChild(directory, { bootstrap: false }).setState({ session: [spaceSession] })
  useSpacesStore.getState().applyMarks([{ id: 'abcdef123456', name: 'Space', state: 'stale',
    projectDirectory: '/repo', directory }])
  act(() => root.render(React.createElement(Probe, { sessions: [spaceSession] })))
  act(() => root.render(React.createElement(Probe, { sessions: [] })))
  expect(stores.getChild(directory)?.getState().session.map((item) => item.id)).toEqual(['space-chat'])
})
