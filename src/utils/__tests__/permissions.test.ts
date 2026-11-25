import {
  isProjectReadOnly,
  canWriteProject,
  canAdminProject,
  canWriteTask,
} from '../permissions';
import { Project, Task } from '../../types/vikunja';

describe('Project & Task Permission Helpers', () => {
  const ownedProject: Project = { id: 1, title: 'Owned' };
  const readOnlyProject: Project = { id: 2, title: 'Shared Read', max_permission: 0 };
  const writeProject: Project = { id: 3, title: 'Shared Write', max_permission: 1 };
  const adminProject: Project = { id: 4, title: 'Shared Admin', max_permission: 2 };
  const savedFilter: Project = {
    id: -2,
    title: 'Saved Filter',
    is_saved_filter: true,
    max_permission: 0,
  };

  it('evaluates project read/write/admin permissions accurately', () => {
    expect(isProjectReadOnly(ownedProject)).toBe(false);
    expect(canWriteProject(ownedProject)).toBe(true);
    expect(canAdminProject(ownedProject)).toBe(true);

    expect(isProjectReadOnly(readOnlyProject)).toBe(true);
    expect(canWriteProject(readOnlyProject)).toBe(false);
    expect(canAdminProject(readOnlyProject)).toBe(false);

    expect(isProjectReadOnly(writeProject)).toBe(false);
    expect(canWriteProject(writeProject)).toBe(true);
    expect(canAdminProject(writeProject)).toBe(false);

    expect(isProjectReadOnly(adminProject)).toBe(false);
    expect(canWriteProject(adminProject)).toBe(true);
    expect(canAdminProject(adminProject)).toBe(true);

    expect(isProjectReadOnly(savedFilter)).toBe(false);
    expect(canWriteProject(savedFilter)).toBe(false);
    expect(canAdminProject(savedFilter)).toBe(false);
  });

  it('evaluates per-task write eligibility across mixed project lists', () => {
    const projects = [ownedProject, readOnlyProject, writeProject];
    const readOnlyTask: Task = {
      id: 10,
      title: 'RO Task',
      done: false,
      priority: 0,
      project_id: 2,
    };
    const writableTask: Task = {
      id: 11,
      title: 'RW Task',
      done: false,
      priority: 0,
      project_id: 3,
    };
    const unknownProjTask: Task = {
      id: 12,
      title: 'Unmapped Task',
      done: false,
      priority: 0,
      project_id: 99,
    };

    expect(canWriteTask(readOnlyTask, projects)).toBe(false);
    expect(canWriteTask(writableTask, projects)).toBe(true);
    expect(canWriteTask(unknownProjTask, projects)).toBe(true);
    expect(canWriteTask(null, projects)).toBe(false);
  });
});
