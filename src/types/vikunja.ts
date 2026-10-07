export interface User {
  id: number;
  username: string;
  email?: string;
  name?: string;
  created?: string;
  updated?: string;
}

/** Vikunja permission levels: 0 = Read only, 1 = Read & Write, 2 = Admin */
export type Permission = 0 | 1 | 2;

/** Vikunja repeat modes: 0 = every repeat_after seconds, 1 = monthly, 2 = from completion date */
export const RepeatMode = {
  FromDueDate: 0,
  Monthly: 1,
  FromCompletion: 2,
} as const;
export type RepeatMode = (typeof RepeatMode)[keyof typeof RepeatMode];

export const ReminderRelativeTo = {
  DueDate: 'due_date',
  StartDate: 'start_date',
  EndDate: 'end_date',
} as const;
export type ReminderRelativeTo = (typeof ReminderRelativeTo)[keyof typeof ReminderRelativeTo];

export interface TaskReminder {
  /** Absolute reminder time (ISO). Computed by the server for relative reminders. */
  reminder?: string | null;
  /** Date field the relative period refers to. Empty / undefined means absolute. */
  relative_to?: ReminderRelativeTo | '';
  /** Seconds relative to `relative_to`. Negative = before. */
  relative_period?: number;
}

export interface Team {
  id: number;
  name: string;
  description?: string;
}

export interface ProjectUserShare extends Partial<User> {
  id: number;
  username: string;
  /** Permission granted to this user on the project */
  permission: Permission;
  user?: User;
}

export interface ProjectTeamShare extends Partial<Team> {
  id: number;
  name: string;
  permission: Permission;
  team?: Team;
}

export interface ProjectView {
  id: number;
  title: string;
  project_id: number;
  view_kind: 'list' | 'kanban' | 'gantt' | 'table';
  default_bucket_id?: number;
  done_bucket_id?: number;
  position?: number;
}

export interface Project {
  id: number;
  title: string;
  description?: string;
  identifier?: string;
  hex_color?: string;
  parent_project_id?: number;
  is_archived?: boolean;
  is_favorite?: boolean;
  position?: number;
  views?: ProjectView[];
  /** Highest permission the current user has on this project */
  max_permission?: Permission;
  owner?: User;
  created?: string;
  updated?: string;
}

export interface Label {
  id: number;
  title: string;
  hex_color?: string;
  color?: string;
  description?: string;
}

export interface Task {
  id: number;
  title: string;
  description?: string;
  done: boolean;
  done_at?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  repeat_after?: number;
  repeat_mode?: RepeatMode;
  reminders?: TaskReminder[] | null;
  priority: number; // 0 = None, 1 = Low, 2 = Medium, 3 = High, 4 = Urgent, 5 = Critical
  project_id: number;
  position?: number;
  percent_done?: number;
  color?: string;
  labels?: Label[];
  assignees?: User[];
  created?: string;
  updated?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  priority?: number;
  project_id: number;
  labels?: Label[];
  assignees?: User[];
  percent_done?: number;
  color?: string;
  hex_color?: string;
  repeat_after?: number;
  repeat_mode?: RepeatMode;
  reminders?: TaskReminder[] | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  done?: boolean;
  done_at?: string | null;
  due_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  priority?: number;
  project_id?: number;
  position?: number;
  percent_done?: number;
  color?: string;
  hex_color?: string;
  repeat_after?: number;
  repeat_mode?: RepeatMode;
  reminders?: TaskReminder[] | null;
  labels?: Label[];
  assignees?: User[];
}

export interface CreateProjectInput {
  title: string;
  description?: string;
  hex_color?: string;
  parent_project_id?: number;
  is_favorite?: boolean;
}

export interface UpdateProjectInput {
  title?: string;
  description?: string;
  hex_color?: string;
  parent_project_id?: number;
  is_archived?: boolean;
  is_favorite?: boolean;
  position?: number;
}

export interface AuthTokens {
  token: string;
}
