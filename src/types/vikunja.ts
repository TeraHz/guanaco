export interface User {
  id: number;
  username: string;
  email?: string;
  name?: string;
  created?: string;
  updated?: string;
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
  is_archived?: boolean;
  is_favorite?: boolean;
  position?: number;
}

export interface AuthTokens {
  token: string;
}
