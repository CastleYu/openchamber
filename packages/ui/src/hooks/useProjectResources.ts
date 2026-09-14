import { useEffect } from 'react';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useGlobalSessionStatusStore } from '@/sync/global-session-status';
import { useNotificationStore } from '@/sync/notification-store';
import { useGitStore } from '@/stores/useGitStore';
import { useChildStoreManager } from '@/sync/sync-context';
import { resolveProjectForSessionDirectory } from '@/lib/projectResolution';
import { subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { ProjectMode, projectResources } from '@/lib/performance/projectResources';
import { createResourceReporter } from '@/lib/performance/resourceReporter';
import { isVSCodeRuntime } from '@/stores/utils/vscodeRuntime';
import { getRegisteredRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';

export function useProjectResources() {
  const stores = useChildStoreManager();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reporter = isVSCodeRuntime(getRegisteredRuntimeAPIs()) ? null : createResourceReporter();
    let directories: string[] = [];
    const publish = () => reporter?.publish(directories.map(directory => ({ directory, mode: projectResources.mode(directory) })));
    const update = () => {
      clearTimeout(timer);
      const { projects, activeProjectId } = useProjectsStore.getState();
      const { availableWorktreesByProject } = useSessionUIStore.getState();
      const activity = new Map(projects.map((project) => [project.id, {
        id: project.id, directories: [project.path], running: false, unread: false,
      }]));
      const owner = (directory: string) => {
        const project = resolveProjectForSessionDirectory(projects, availableWorktreesByProject, directory);
        const entry = project ? activity.get(project.id) : undefined;
        if (entry && !entry.directories.includes(directory)) entry.directories.push(directory);
        return entry;
      };
      for (const worktrees of availableWorktreesByProject.values()) {
        for (const worktree of worktrees) owner(worktree.path);
      }
      for (const directory of stores.children.keys()) owner(directory);
      for (const directory of useGitStore.getState().directories.keys()) owner(directory);
      for (const entry of useGlobalSessionStatusStore.getState().statusById.values()) {
        const project = owner(entry.directory);
        if (project) project.running = true;
      }
      for (const entry of useNotificationStore.getState().list) {
        if (entry.viewed || !entry.directory) continue;
        const project = owner(entry.directory);
        if (project) project.unread = true;
      }
      projectResources.update([...activity.values()], activeProjectId, !document.hidden, document.hasFocus());
      directories = [...new Set([...activity.values()].flatMap(project => project.directories))];
      publish();
      for (const project of activity.values()) {
        for (const directory of project.directories) {
          if (projectResources.mode(directory) !== ProjectMode.Idle) continue;
          const git = useGitStore.getState();
          if (git.directories.get(directory)?.diffCache.size) git.clearDiffCache(directory);
          // Keep live execution, mounted consumers, and pending approvals intact.
          if (!project.running) stores.disposeDirectory(directory);
        }
      }
      const delay = projectResources.nextDelay();
      if (delay !== null) timer = setTimeout(update, delay);
    };
    const unsubscribe = [
      useProjectsStore.subscribe(update), useNotificationStore.subscribe(update),
      useGlobalSessionStatusStore.subscribe(update),
      useSessionUIStore.subscribe((state, previous) => {
        if (state.availableWorktreesByProject !== previous.availableWorktreesByProject) update();
      }),
      subscribeRuntimeEndpointChanged(() => {
        projectResources.reset();
        directories = [];
        reporter?.dispose();
        reporter = isVSCodeRuntime(getRegisteredRuntimeAPIs()) ? null : createResourceReporter();
      }),
    ];
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    update();
    const heartbeat = setInterval(publish, 30_000);
    return () => {
      clearTimeout(timer);
      clearInterval(heartbeat);
      reporter?.dispose();
      unsubscribe.forEach((stop) => stop());
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      projectResources.reset();
    };
  }, [stores]);
}
