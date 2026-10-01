import { describe, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import { ChildStoreManager } from '@/sync/child-store';
import { sessionEvents, type SessionDeleteRequest } from '@/lib/sessionEvents';
import { I18nProvider } from '@/lib/i18n';
import { useSessionFoldersStore } from '@/stores/useSessionFoldersStore';
import { useUIStore } from '@/stores/useUIStore';
import type { SessionFolder } from '@/stores/useSessionFoldersStore';
import type { Session } from '@/lib/opencode/model';
import type { SessionGroupSectionProps } from './SessionGroupSection';
import { installHookTestDom } from '../test-utils/testDom';

type FolderCallbacks = {
  onRename: (name: string) => void;
  onDelete: () => void;
};

type RowPropsCapture = Pick<SessionGroupSectionProps,
  | 'allowReselect'
  | 'onSessionSelected'
  | 'resetSessionSearch'
  | 'deleteSessionConfirm'
  | 'copiedSessionId'
  | 'setCopiedSessionId'
>;

let folderCallbacks: FolderCallbacks | null = null;
let rowPropsCapture: RowPropsCapture | null = null;
const childStores = new ChildStoreManager();

mock.module('../../SessionFolderItem', () => ({
  SessionFolderItem: (props: FolderCallbacks) => {
    folderCallbacks = props;
    return null;
  },
}));

mock.module('../folders/sessionFolderDnd', () => ({
  DroppableFolderWrapper: ({ children }: { children: (ref: () => void, isOver: boolean) => React.ReactNode }) => <>{children(() => undefined, false)}</>,
  SessionFolderDndScope: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

mock.module('@/sync/sync-context', () => ({
  setActiveSession: () => undefined,
  useChildStoreManager: () => childStores,
  useDirectoryStore: () => null,
  useGlobalSessionStatus: () => null,
  useSessionPermissions: () => null,
  useSessionQuestionCount: () => 0,
  useSyncSDK: () => null,
  useSyncDirectory: () => null,
  buildSessionMessageRecordsSnapshot: () => [],
}));

mock.module('../sessions/collapsedActivityIndicator', () => ({
  CollapsedSessionActivityIndicator: () => null,
}));

mock.module('../sessions/collapsedActivityState', () => ({
  useCollapsedSessionActivityState: () => null,
}));

mock.module('../sessions/SessionTreeItem', () => ({
  SessionTreeItem: (props: RowPropsCapture) => {
    rowPropsCapture = props;
    return null;
  },
}));

const { SessionGroupSection } = await import('./SessionGroupSection');

const folder: SessionFolder = {
  id: 'folder-a',
  name: 'Initial folder',
  parentId: null,
  sessionIds: [],
  createdAt: 1,
};

const group: SessionGroupSectionProps['group'] = {
  id: 'main',
  label: 'Main',
  branch: null,
  description: null,
  isMain: true,
  worktree: null,
  directory: '/workspace',
  folderScopeKey: '/workspace',
  sessions: [],
};

const groupWithSession: SessionGroupSectionProps['group'] = {
  ...group,
  // SAFETY: SessionGroupSection only reads the fixture session's id in this test.
  sessions: [{ session: { id: 'session-a' } as Session, children: [], worktree: null }],
};

const createProps = (): SessionGroupSectionProps => ({
  group,
  groupKey: 'project:main',
  projectId: 'project',
  hideGroupLabel: true,
  hasSessionSearchQuery: false,
  normalizedSessionSearchQuery: '',
  groupSearchDataByGroup: new WeakMap(),
  collapsedGroups: new Set(),
  hideDirectoryControls: false,
  showMoreGroupSessions: () => undefined,
  resetGroupSessionLimit: () => undefined,
  mobileVariant: false,
  alwaysShowActions: false,
  activeProjectId: null,
  setActiveProjectIdOnly: () => undefined,
  setSessionSwitcherOpen: () => undefined,
  openNewSessionDraft: () => undefined,
  pinnedSessionIds: new Set(),
  sessionOrderIndex: new Map(),
  notifyOnSubtasks: false,
  expandedParents: new Set(),
  editingId: null,
  editingRowKey: null,
  editTitle: '',
  copiedSessionId: null,
  openSidebarMenuKey: null,
  setEditingId: () => undefined,
  setEditingRowKey: () => undefined,
  setEditTitle: () => undefined,
  toggleParent: () => undefined,
  setOpenSidebarMenuKey: () => undefined,
  startFolderRename: () => undefined,
  allowReselect: false,
  resetSessionSearch: () => undefined,
  deleteSessionConfirm: null,
  setDeleteSessionConfirm: () => undefined,
  setCopiedSessionId: () => undefined,
  startSessionWorktreeMenuLoad: () => ({
    cachedTargets: [],
    refreshTargets: Promise.resolve([]),
  }),
  onToggleCollapsedGroup: () => undefined,
  folderRename: null,
  setFolderRenameDraft: () => undefined,
  clearFolderRename: () => undefined,
});

describe('SessionGroupSection public behavior', () => {
  test('Shift+click requests a safe worktree check while ordinary click keeps the dialog', async () => {
    const dom = new Window({ url: 'http://localhost' });
    const originals = new Map<string, PropertyDescriptor | undefined>();
    for (const [name, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator,
      Element: dom.Element, HTMLElement: dom.HTMLElement, MouseEvent: dom.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const requests: SessionDeleteRequest[] = [];
    const unsubscribe = sessionEvents.onDeleteRequest((request) => requests.push(request));
    const worktreeGroup: SessionGroupSectionProps['group'] = {
      ...groupWithSession,
      id: 'worktree',
      label: 'Feature',
      isMain: false,
      worktree: { path: '/workspace/feature', projectDirectory: '/workspace', branch: 'feature', label: 'Feature' },
    };
    try {
      await act(async () => root.render(<I18nProvider><SessionGroupSection {...createProps()} group={worktreeGroup} groupKey="project:feature" hideGroupLabel={false} renderBody={false} /></I18nProvider>));
      const button = [...container.querySelectorAll('button')].find((entry) => entry.getAttribute('aria-label')?.includes('Delete Feature'));
      if (!button) throw new Error('Worktree delete action did not mount');
      await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
      expect(requests.map((request) => request.skipDialogIfSafe)).toEqual([false, true]);
      expect(requests.every((request) => request.mode === 'worktree' && request.worktree?.path === '/workspace/feature')).toBe(true);
    } finally {
      unsubscribe();
      await act(async () => root.unmount());
      container.remove();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      await dom.happyDOM.abort();
    }
  });

  test('an empty successful list does not spin for initialization and keeps initialization failure retryable', async () => {
    let rejectInitialization!: (error: Error) => void;
    const initialization = new Promise<void>((_resolve, reject) => { rejectInitialization = reject; });
    childStores.configure({ onBootstrap: (context) => { context.trackInitialization(initialization); } });
    childStores.requestBootstrap({ directory: '/workspace', priority: 'selected', reason: 'selected-session' });
    await Promise.resolve();
    await Promise.resolve();
    try {
      const waiting = renderToStaticMarkup(<I18nProvider><SessionGroupSection {...createProps()} /></I18nProvider>);
      expect(waiting).toContain('No sessions in this workspace yet.');
      expect(waiting).not.toContain('Loading sessions');
      rejectInitialization(new Error('initialization failed'));
      await Promise.resolve();
      await Promise.resolve();
      const failed = renderToStaticMarkup(<I18nProvider><SessionGroupSection {...createProps()} /></I18nProvider>);
      expect(failed).toContain('Could not initialize workspace.');
      expect(failed).toContain('Try again');
      expect(failed).not.toContain('Could not refresh sessions.');
    } finally {
      rejectInitialization(new Error('test finished'));
      childStores.disposeAll();
    }
  });

  test('routes rendered folder rename and delete actions to the owning folder store', async () => {
    const dom = installHookTestDom();
    const root = createRoot(dom.container);
    const originalFolders = useSessionFoldersStore.getState();
    const originalUi = useUIStore.getState();
    useSessionFoldersStore.setState({ foldersMap: { '/workspace': [folder] } });
    useUIStore.setState({ showDeletionDialog: false });

    try {
      await act(async () => root.render(<I18nProvider><SessionGroupSection {...createProps()} /></I18nProvider>));
      expect(folderCallbacks).not.toBeNull();

      await act(async () => folderCallbacks?.onRename('Renamed folder'));
      expect(useSessionFoldersStore.getState().foldersMap['/workspace']?.[0]?.name).toBe('Renamed folder');

      await act(async () => folderCallbacks?.onDelete());
      expect(useSessionFoldersStore.getState().foldersMap['/workspace']).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      useSessionFoldersStore.setState(originalFolders, true);
      useUIStore.setState(originalUi, true);
      folderCallbacks = null;
      dom.restore();
    }
  });

  test('propagates confirmation, search/navigation, and copy ownership changes to rendered rows', async () => {
    const dom = installHookTestDom();
    const root = createRoot(dom.container);
    const firstSelected = () => undefined;
    const nextSelected = () => undefined;
    const firstResetSearch = () => undefined;
    const nextResetSearch = () => undefined;
    const firstCopied = () => undefined;
    const nextCopied = () => undefined;
    const initialProps = createProps();

    try {
      await act(async () => root.render(<I18nProvider><SessionGroupSection {...initialProps} group={groupWithSession} onSessionSelected={firstSelected} resetSessionSearch={firstResetSearch} setCopiedSessionId={firstCopied} /></I18nProvider>));
      expect(rowPropsCapture?.onSessionSelected).toBe(firstSelected);
      expect(rowPropsCapture?.resetSessionSearch).toBe(firstResetSearch);
      expect(rowPropsCapture?.deleteSessionConfirm).toBeNull();
      expect(rowPropsCapture?.copiedSessionId).toBeNull();
      expect(rowPropsCapture?.setCopiedSessionId).toBe(firstCopied);

      // SAFETY: the confirmation is only forwarded by identity to the row mock.
      const confirmation = { session: { id: 'session-a' } as Session, descendantCount: 0, descendantIds: [], archivedBucket: false };
      await act(async () => root.render(<I18nProvider><SessionGroupSection {...initialProps} group={groupWithSession} allowReselect onSessionSelected={nextSelected} resetSessionSearch={nextResetSearch} deleteSessionConfirm={confirmation} copiedSessionId="session-a" setCopiedSessionId={nextCopied} /></I18nProvider>));
      expect(rowPropsCapture?.allowReselect).toBe(true);
      expect(rowPropsCapture?.onSessionSelected).toBe(nextSelected);
      expect(rowPropsCapture?.resetSessionSearch).toBe(nextResetSearch);
      expect(rowPropsCapture?.deleteSessionConfirm).toBe(confirmation);
      expect(rowPropsCapture?.copiedSessionId).toBe('session-a');
      expect(rowPropsCapture?.setCopiedSessionId).toBe(nextCopied);
    } finally {
      await act(async () => root.unmount());
      rowPropsCapture = null;
      dom.restore();
    }
  });
});
