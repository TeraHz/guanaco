import { Project, Task } from '../types/vikunja';

/**
 * Vikunja permission levels (`Project.max_permission`):
 * - `0` = Read-only (`RightRead`)
 * - `1` = Read & Write (`RightWrite`)
 * - `2` = Admin (`RightAdmin`)
 * - `undefined` / `null` = Owned / local / legacy project with full Admin rights
 */
export function isProjectReadOnly(project?: Project | null): boolean {
  if (!project || project.id <= 0 || project.is_saved_filter) return false;
  return project.max_permission === 0;
}

export function canWriteProject(project?: Project | null): boolean {
  if (!project || project.id <= 0 || project.is_saved_filter) return false;
  return (
    project.max_permission === undefined ||
    project.max_permission === null ||
    project.max_permission >= 1
  );
}

export function canAdminProject(project?: Project | null): boolean {
  if (!project || project.id <= 0 || project.is_saved_filter) return false;
  return (
    project.max_permission === undefined ||
    project.max_permission === null ||
    project.max_permission >= 2
  );
}

export function canWriteTask(
  task: Task | null | undefined,
  projects: Project[] | null | undefined
): boolean {
  if (!task) return false;
  if (!Array.isArray(projects) || projects.length === 0) return true;
  const proj = projects.find((p) => p && p.id === task.project_id);
  return proj ? canWriteProject(proj) : true;
}
