import { describe, expect, test } from 'bun:test';
import { ProjectMode, ProjectResources, ResourceBudget } from './projectResources';

describe('project resource lifecycle', () => {
  const project = (running = false, unread = false) => ({ id: 'a', directories: ['/a', '/worktree'], running, unread });
  test('visiting never boosts; sending boosts until focus loss, without rearming on return', () => {
    const resources = new ProjectResources();
    resources.update([project()], 'a', true, true, 0);
    expect(resources.mode('/a', 0)).toBe(ProjectMode.Background);
    resources.sent('/worktree');
    expect(resources.mode('/a', 90_000)).toBe(ProjectMode.Focused);
    resources.update([project()], 'a', true, false, 90_000);
    resources.update([project()], 'a', true, true, 90_001);
    expect(resources.mode('/a', 90_001)).toBe(ProjectMode.Idle);
  });
  test('foreground grace, running and unread protection; tray follows unread even with a running session', () => {
    const resources = new ProjectResources();
    resources.update([project()], 'a', true, true, 0);
    expect(resources.mode('/a', ResourceBudget.idleDelay - 1)).toBe(ProjectMode.Background);
    expect(resources.mode('/a', ResourceBudget.idleDelay)).toBe(ProjectMode.Idle);
    resources.update([project(true)], 'a', true, true);
    expect(resources.mode('/a')).toBe(ProjectMode.Background);
    resources.update([project(true)], 'a', false, false);
    expect(resources.mode('/a')).toBe(ProjectMode.Idle);
    resources.sent('/a');
    expect(resources.mode('/a')).toBe(ProjectMode.Idle);
    resources.update([project(false, true)], 'a', false, false);
    expect(resources.mode('/a')).toBe(ProjectMode.Background);
  });
  test('project changes and runtime reset revoke boost; unknown directories retain the normal frame', () => {
    const resources = new ProjectResources();
    resources.update([project()], 'a', true, true);
    resources.sent('/a');
    expect(resources.frame('/a')).toBe(ResourceBudget.focusedFrame);
    resources.update([project()], null, true, true);
    expect(resources.mode('/a')).toBe(ProjectMode.Background);
    resources.reset();
    expect(resources.frame('/a')).toBe(ResourceBudget.focusedFrame);
  });
});
