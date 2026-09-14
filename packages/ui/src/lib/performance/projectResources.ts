import { normalizePath } from '@/lib/pathNormalization';

export const ProjectMode = { Idle: 'idle', Background: 'background', Focused: 'focused' } as const;
export type ProjectMode = typeof ProjectMode[keyof typeof ProjectMode];
export const ResourceBudget = { idleDelay: 60_000, focusedFrame: 16, backgroundFrame: 64, idleFrame: 250 } as const;
type ProjectActivity = { id: string; directories: string[]; running: boolean; unread: boolean };

export class ProjectResources {
  private projects = new Map<string, ProjectActivity>();
  private quietSince = new Map<string, number>();
  private owners = new Map<string, string>();
  private focused: string | null = null;
  private active: string | null = null;
  private visible = true;
  private foreground = true;

  update(projects: ProjectActivity[], active: string | null, visible: boolean, foreground: boolean, now = Date.now()) {
    if (active !== this.active || !visible || !foreground) this.focused = null;
    this.active = active;
    this.visible = visible;
    this.foreground = foreground;
    this.projects = new Map(projects.map((project) => [project.id, project]));
    this.owners.clear();
    for (const project of projects) {
      for (const directory of project.directories) {
        const key = normalizePath(directory);
        if (key) this.owners.set(key, project.id);
      }
      if (project.running || project.unread) this.quietSince.delete(project.id);
      else if (!this.quietSince.has(project.id)) this.quietSince.set(project.id, now);
    }
    for (const id of this.quietSince.keys()) if (!this.projects.has(id)) this.quietSince.delete(id);
    if (this.focused && !this.projects.has(this.focused)) this.focused = null;
  }

  sent(directory: string) {
    const owner = this.owner(directory);
    if (this.visible && this.foreground && owner && owner === this.active) this.focused = owner;
  }

  owner(directory: string) {
    const key = normalizePath(directory);
    if (!key) return undefined;
    return this.owners.get(key);
  }

  mode(directory: string, now = Date.now()): ProjectMode {
    const owner = this.owner(directory);
    const project = owner ? this.projects.get(owner) : undefined;
    // Unowned directories keep their existing behavior.
    if (!owner || !project) return ProjectMode.Background;
    if (!this.visible) return project.unread ? ProjectMode.Background : ProjectMode.Idle;
    if (owner === this.focused) return ProjectMode.Focused;
    if (project.running || project.unread) return ProjectMode.Background;
    return now - (this.quietSince.get(owner) ?? now) >= ResourceBudget.idleDelay
      ? ProjectMode.Idle : ProjectMode.Background;
  }

  frame(directory: string) {
    if (!this.owner(directory)) return ResourceBudget.focusedFrame;
    switch (this.mode(directory)) {
      case ProjectMode.Focused: return ResourceBudget.focusedFrame;
      case ProjectMode.Background: return ResourceBudget.backgroundFrame;
      case ProjectMode.Idle: return ResourceBudget.idleFrame;
    }
  }

  nextDelay(now = Date.now()): number | null {
    if (!this.visible) return null;
    let delay = Number.POSITIVE_INFINITY;
    for (const [id, since] of this.quietSince) {
      if (id === this.focused) continue;
      const remaining = since + ResourceBudget.idleDelay - now;
      if (remaining > 0) delay = Math.min(delay, remaining);
    }
    return Number.isFinite(delay) ? delay : null;
  }

  reset() {
    this.projects.clear();
    this.owners.clear();
    this.quietSince.clear();
    this.focused = null;
    this.active = null;
  }
}

export const projectResources = new ProjectResources();
