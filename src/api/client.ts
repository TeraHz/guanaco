import {
  AuthTokens,
  CreateProjectInput,
  CreateTaskInput,
  Label,
  Permission,
  Project,
  ProjectTeamShare,
  ProjectUserShare,
  ProjectView,
  Task,
  Team,
  UpdateProjectInput,
  UpdateTaskInput,
  User,
} from '../types/vikunja';

export interface VikunjaClientConfig {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  onUnauthorized?: () => void;
  onTokenRefresh?: () => Promise<string | null>;
}

export class VikunjaApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
    this.name = 'VikunjaApiError';
  }
}

export class VikunjaClient {
  private baseApiUrl: string;
  private token: string | null = null;
  private timeoutMs: number;
  public onUnauthorized?: () => void;
  public onTokenRefresh?: () => Promise<string | null>;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(config: VikunjaClientConfig) {
    this.baseApiUrl = this.normalizeUrl(config.baseUrl);
    if (config.token) {
      this.token = config.token;
    }
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.onUnauthorized = config.onUnauthorized;
    this.onTokenRefresh = config.onTokenRefresh;
  }

  private normalizeUrl(url: string): string {
    let clean = url.trim().replace(/\/+$/, '');
    if (!clean.endsWith('/api/v1')) {
      clean = `${clean}/api/v1`;
    }
    return clean;
  }

  public getBaseApiUrl(): string {
    return this.baseApiUrl;
  }

  public setToken(token: string | null): void {
    this.token = token;
  }

  public getToken(): string | null {
    return this.token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit & { _isRetry?: boolean } = {}
  ): Promise<T> {
    const url = `${this.baseApiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    let isTimedOut = false;
    const timer = setTimeout(() => {
      isTimedOut = true;
      controller.abort();
    }, this.timeoutMs);

    // If caller provided their own signal, forward abort
    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (!response) {
        throw new Error('No response received');
      }

      let data: any = null;
      const contentType = response.headers?.get?.('content-type') || '';
      if (contentType.includes('application/json') || response.json) {
        try {
          data = await response.json();
        } catch (e) {
          data = null;
        }
      }

      if (!response.ok) {
        // Attempt transparent token refresh on 401 (excluding login and already retried requests)
        if (
          response.status === 401 &&
          !options._isRetry &&
          this.onTokenRefresh &&
          !endpoint.startsWith('/login')
        ) {
          try {
            if (!this.refreshPromise) {
              this.refreshPromise = this.onTokenRefresh().finally(() => {
                this.refreshPromise = null;
              });
            }
            const newToken = await this.refreshPromise;
            if (newToken) {
              this.setToken(newToken);
              return await this.request<T>(endpoint, {
                ...options,
                _isRetry: true,
              });
            }
          } catch (_) {
            // Token refresh failed, continue to onUnauthorized below
          }
        }

        if (response.status === 401 && this.onUnauthorized) {
          this.onUnauthorized();
        }
        const errorMsg = data?.message || response.statusText || 'API request failed';
        throw new VikunjaApiError(response.status, errorMsg, data);
      }

      return data as T;
    } catch (err: any) {
      if (isTimedOut || err?.name === 'AbortError') {
        const timeoutErr = new Error(`Request timed out after ${this.timeoutMs}ms`);
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Auth Endpoints ---
  public async login(username: string, password: string, longToken = true): Promise<AuthTokens> {
    const res = await this.request<AuthTokens>('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, long_token: longToken }),
    });
    if (res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  public async renewToken(): Promise<AuthTokens> {
    const res = await this.request<AuthTokens>('/user/token', {
      method: 'POST',
    });
    if (res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  public async getCurrentUser(): Promise<User> {
    return this.request<User>('/user', { method: 'GET' });
  }

  private normalizeListResponse<T>(res: any): T[] {
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.items)) return res.items;
    if (Array.isArray(res?.data)) return res.data;
    return [];
  }

  // --- Projects Endpoints ---
  public async getProjects(params?: { is_archived?: boolean }): Promise<Project[]> {
    let endpoint = '/projects';
    if (params?.is_archived) {
      endpoint += '?is_archived=true';
    }
    const res = await this.request<any>(endpoint, { method: 'GET' });
    return this.normalizeListResponse<Project>(res);
  }

  public async getProject(projectId: number): Promise<Project> {
    return this.request<Project>(`/projects/${projectId}`, { method: 'GET' });
  }

  public async createProject(data: CreateProjectInput): Promise<Project> {
    return this.request<Project>('/projects', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async updateProject(projectId: number, data: UpdateProjectInput): Promise<Project> {
    return this.request<Project>(`/projects/${projectId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async deleteProject(projectId: number): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/projects/${projectId}`, {
      method: 'DELETE',
    });
  }

  public async duplicateProject(projectId: number): Promise<Project> {
    return this.request<Project>(`/projects/${projectId}/duplicate`, {
      method: 'PUT',
    });
  }

  public async getProjectViews(projectId: number): Promise<ProjectView[]> {
    const res = await this.request<any>(`/projects/${projectId}/views`, { method: 'GET' });
    return this.normalizeListResponse<ProjectView>(res);
  }

  // --- Project Sharing (Users) ---
  public async getProjectUsers(projectId: number): Promise<ProjectUserShare[]> {
    const res = await this.request<any>(`/projects/${projectId}/users`, { method: 'GET' });
    return this.normalizeListResponse<ProjectUserShare>(res);
  }

  public async addProjectUser(
    projectId: number,
    userIdOrInput: number | { user_id?: number; username?: string; permission?: Permission },
    permission?: Permission
  ): Promise<any> {
    if (typeof userIdOrInput === 'object') {
      let resolvedUserId = userIdOrInput.user_id;
      if (!resolvedUserId && userIdOrInput.username) {
        try {
          const users = await this.searchUsers(userIdOrInput.username);
          const found = users.find(
            (u) => u.username.toLowerCase() === userIdOrInput.username?.toLowerCase()
          );
          if (found) resolvedUserId = found.id;
        } catch (_) {}
      }
      const perm = userIdOrInput.permission ?? permission ?? 1;
      return this.request<any>(`/projects/${projectId}/users`, {
        method: 'PUT',
        body: JSON.stringify({
          user_id: resolvedUserId,
          username: userIdOrInput.username,
          permission: perm,
        }),
      });
    }

    return this.request<any>(`/projects/${projectId}/users`, {
      method: 'PUT',
      body: JSON.stringify({ user_id: userIdOrInput, permission: permission ?? 1 }),
    });
  }

  public async updateProjectUser(
    projectId: number,
    userId: number,
    permission: Permission
  ): Promise<any> {
    return this.request<any>(`/projects/${projectId}/users/${userId}`, {
      method: 'POST',
      body: JSON.stringify({ permission }),
    });
  }

  public async removeProjectUser(projectId: number, userId: number): Promise<any> {
    return this.request<any>(`/projects/${projectId}/users/${userId}`, {
      method: 'DELETE',
    });
  }

  // --- Project Sharing (Teams) ---
  public async getTeams(): Promise<Team[]> {
    const res = await this.request<any>('/teams', { method: 'GET' });
    return this.normalizeListResponse<Team>(res);
  }

  public async getProjectTeams(projectId: number): Promise<ProjectTeamShare[]> {
    const res = await this.request<any>(`/projects/${projectId}/teams`, { method: 'GET' });
    return this.normalizeListResponse<ProjectTeamShare>(res);
  }

  public async addProjectTeam(
    projectId: number,
    teamIdOrInput: number | { team_id: number; permission?: Permission },
    permission?: Permission
  ): Promise<any> {
    const teamId = typeof teamIdOrInput === 'object' ? teamIdOrInput.team_id : teamIdOrInput;
    const perm = typeof teamIdOrInput === 'object' ? teamIdOrInput.permission ?? 0 : permission ?? 0;
    return this.request<any>(`/projects/${projectId}/teams`, {
      method: 'PUT',
      body: JSON.stringify({ team_id: teamId, permission: perm }),
    });
  }

  public async updateProjectTeam(
    projectId: number,
    teamId: number,
    permission: Permission
  ): Promise<any> {
    return this.request<any>(`/projects/${projectId}/teams/${teamId}`, {
      method: 'POST',
      body: JSON.stringify({ permission }),
    });
  }

  public async removeProjectTeam(projectId: number, teamId: number): Promise<any> {
    return this.request<any>(`/projects/${projectId}/teams/${teamId}`, {
      method: 'DELETE',
    });
  }

  // --- Tasks Endpoints ---
  public async getTasks(
    projectId: number,
    params?: { page?: number; per_page?: number; filter_by?: string[] }
  ): Promise<Task[]> {
    let query = '';
    if (params) {
      const qParams = new URLSearchParams();
      if (params.page) qParams.set('page', params.page.toString());
      if (params.per_page) qParams.set('per_page', params.per_page.toString());
      if (params.filter_by?.length) {
        params.filter_by.forEach((f) => qParams.append('filter_by', f));
      }
      const qs = qParams.toString();
      if (qs) query = `?${qs}`;
    }
    const res = await this.request<any>(`/projects/${projectId}/tasks${query}`, { method: 'GET' });
    return this.normalizeListResponse<Task>(res);
  }

  public async getAllTasks(params?: { page?: number; per_page?: number }): Promise<Task[]> {
    if (params?.page) {
      const qParams = new URLSearchParams();
      qParams.set('page', params.page.toString());
      if (params.per_page) qParams.set('per_page', params.per_page.toString());
      const query = `?${qParams.toString()}`;
      try {
        const res = await this.request<any>(`/tasks${query}`, { method: 'GET' });
        return this.normalizeListResponse<Task>(res);
      } catch (_) {
        const res = await this.request<any>(`/tasks/all${query}`, { method: 'GET' });
        return this.normalizeListResponse<Task>(res);
      }
    }

    const perPage = params?.per_page || 50;
    let page = 1;
    const allTasks: Task[] = [];
    let hasMore = true;

    while (hasMore && page <= 20) {
      const query = `?page=${page}&per_page=${perPage}`;
      let res: any;
      try {
        res = await this.request<any>(`/tasks${query}`, { method: 'GET' });
      } catch (_) {
        try {
          res = await this.request<any>(`/tasks/all${query}`, { method: 'GET' });
        } catch (_) {
          break;
        }
      }

      const items = this.normalizeListResponse<Task>(res);
      if (!items || items.length === 0) {
        hasMore = false;
      } else {
        allTasks.push(...items);
        if (items.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    return allTasks;
  }

  public async createTask(projectId: number, data: CreateTaskInput): Promise<Task> {
    return this.request<Task>(`/projects/${projectId}/tasks`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public async getTask(taskId: number): Promise<Task> {
    return this.request<Task>(`/tasks/${taskId}`, { method: 'GET' });
  }

  public async updateTask(taskId: number, data: UpdateTaskInput): Promise<Task> {
    const payload: any = { ...data };
    if (payload.color && !payload.hex_color) {
      payload.hex_color = payload.color;
    }
    return this.request<Task>(`/tasks/${taskId}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async toggleTaskDone(
    taskId: number,
    done: boolean,
    taskSnapshot?: Partial<Task>
  ): Promise<Task> {
    const base = taskSnapshot ? { ...taskSnapshot } : {};
    return this.updateTask(taskId, { ...base, done });
  }

  public async moveTask(
    taskId: number,
    targetProjectId: number,
    taskSnapshot?: Partial<Task>
  ): Promise<Task> {
    const base = taskSnapshot ? { ...taskSnapshot } : {};
    return this.updateTask(taskId, { ...base, project_id: targetProjectId });
  }

  public async setTaskPosition(
    taskId: number,
    projectViewId: number,
    position: number
  ): Promise<any> {
    return this.request<any>(`/tasks/${taskId}/position`, {
      method: 'POST',
      body: JSON.stringify({
        project_view_id: projectViewId,
        position,
      }),
    });
  }

  public async reorderTask(taskId: number, position: number, projectViewId?: number): Promise<any> {
    if (projectViewId && projectViewId > 0) {
      try {
        return await this.setTaskPosition(taskId, projectViewId, position);
      } catch (_) {
        // Fallback to updating task if dedicated position endpoint fails
      }
    }
    return this.updateTask(taskId, { position });
  }

  public async deleteTask(taskId: number): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  // --- Labels Endpoints ---
  public async getLabels(): Promise<Label[]> {
    const res = await this.request<any>('/labels', { method: 'GET' });
    return this.normalizeListResponse<Label>(res);
  }

  public async createLabel(title: string, hex_color?: string): Promise<Label> {
    return this.request<Label>('/labels', {
      method: 'PUT',
      body: JSON.stringify({ title, hex_color }),
    });
  }

  public async addLabelToTask(taskId: number, labelId: number): Promise<any> {
    return this.request<any>(`/tasks/${taskId}/labels`, {
      method: 'PUT',
      body: JSON.stringify({ label_id: labelId }),
    });
  }

  public async removeLabelFromTask(taskId: number, labelId: number): Promise<any> {
    return this.request<any>(`/tasks/${taskId}/labels/${labelId}`, {
      method: 'DELETE',
    });
  }

  public async updateLabel(
    id: number,
    input: { title?: string; hex_color?: string; description?: string }
  ): Promise<Label> {
    return this.request<Label>(`/labels/${id}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async deleteLabel(id: number): Promise<any> {
    return this.request<any>(`/labels/${id}`, {
      method: 'DELETE',
    });
  }

  public async setTaskLabels(
    taskId: number,
    labels: Label[],
    previousLabels?: Label[]
  ): Promise<Label[]> {
    const nextLabels = Array.isArray(labels) ? labels : [];

    // 1. Determine currently attached labels to identify which ones need removal
    let currentTaskLabels: Label[] = previousLabels || [];
    if (!previousLabels) {
      try {
        const currentTask = await this.getTask(taskId);
        if (currentTask && Array.isArray(currentTask.labels)) {
          currentTaskLabels = currentTask.labels;
        }
      } catch (_) {
        currentTaskLabels = [];
      }
    }

    // 2. Identify labels to remove
    const labelsToRemove = currentTaskLabels.filter((oldLabel) => {
      return !nextLabels.some((newLabel) => {
        if (newLabel.id > 0 && oldLabel.id > 0 && newLabel.id === oldLabel.id) {
          return true;
        }
        return newLabel.title.trim().toLowerCase() === oldLabel.title.trim().toLowerCase();
      });
    });

    // 3. Detach removed labels
    for (const rem of labelsToRemove) {
      if (rem.id > 0) {
        try {
          await this.removeLabelFromTask(taskId, rem.id);
        } catch (err: any) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[VikunjaClient] removeLabelFromTask error:', err);
          }
          if (err instanceof VikunjaApiError && err.status === 404) {
            // Label already detached or doesn't exist
          } else {
            throw err;
          }
        }
      }
    }

    if (nextLabels.length === 0) {
      return [];
    }

    // 4. Fetch existing labels from server to reuse IDs and preserve hex_color
    let existingLabels: Label[] = [];
    try {
      existingLabels = await this.getLabels();
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[VikunjaClient] getLabels error:', err);
      }
      existingLabels = [];
    }

    const resolvedLabels: Label[] = [];

    for (const l of nextLabels) {
      let finalLabel: Label | undefined;

      // Check if it already has a valid remote ID
      if (l.id > 0) {
        finalLabel = existingLabels.find((el) => el.id === l.id) || l;
      } else {
        // Find existing label by title (case-insensitive)
        finalLabel = existingLabels.find(
          (el) => el.title.toLowerCase() === l.title.trim().toLowerCase()
        );
      }

      // If label doesn't exist on server, create it
      if (!finalLabel) {
        try {
          finalLabel = await this.createLabel(l.title.trim(), l.hex_color);
          existingLabels.push(finalLabel);
        } catch (err) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[VikunjaClient] createLabel error:', err);
          }
          finalLabel = l;
        }
      }

      if (finalLabel && finalLabel.id > 0) {
        try {
          await this.addLabelToTask(taskId, finalLabel.id);
        } catch (err: any) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[VikunjaClient] addLabelToTask error:', err);
          }
          if (err instanceof VikunjaApiError && (err.status === 409 || err.status === 400)) {
            // Already attached
          } else {
            throw err;
          }
        }
      }

      resolvedLabels.push(finalLabel);
    }

    return resolvedLabels;
  }

  // --- Assignees Endpoints ---
  public async searchUsers(query: string): Promise<User[]> {
    const res = await this.request<any>(`/users/search?s=${encodeURIComponent(query)}`, {
      method: 'GET',
    });
    return this.normalizeListResponse<User>(res);
  }

  public async addAssigneeToTask(taskId: number, userId: number): Promise<any> {
    return this.request<any>(`/tasks/${taskId}/assignees`, {
      method: 'PUT',
      body: JSON.stringify({ user_id: userId }),
    });
  }

  public async removeAssigneeFromTask(taskId: number, userId: number): Promise<any> {
    return this.request<any>(`/tasks/${taskId}/assignees/${userId}`, {
      method: 'DELETE',
    });
  }

  public async setTaskAssignees(
    taskId: number,
    nextAssignees: User[],
    previousAssignees?: User[]
  ): Promise<User[]> {
    let currentAssignees = previousAssignees;
    if (!currentAssignees) {
      try {
        const task = await this.getTask(taskId);
        currentAssignees = task.assignees || [];
      } catch (_) {
        currentAssignees = [];
      }
    }

    const prevIds = new Set(
      currentAssignees.filter((u) => u.id > 0).map((u) => u.id)
    );
    const prevUsernames = new Set(
      currentAssignees.map((u) => u.username.toLowerCase())
    );
    const nextIds = new Set(
      nextAssignees.filter((u) => u.id > 0).map((u) => u.id)
    );
    const nextUsernames = new Set(
      nextAssignees.map((u) => u.username.toLowerCase())
    );

    // 1. Remove assignees present in previous but not in next
    for (const prev of currentAssignees) {
      const kept =
        (prev.id > 0 && nextIds.has(prev.id)) ||
        nextUsernames.has(prev.username.toLowerCase());
      if (!kept && prev.id > 0) {
        try {
          await this.removeAssigneeFromTask(taskId, prev.id);
        } catch (err: any) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[VikunjaClient] removeAssigneeFromTask error:', err);
          }
          if (err instanceof VikunjaApiError && err.status === 404) {
            // Already removed or doesn't exist
          } else {
            throw err;
          }
        }
      }
    }

    // 2. Add new assignees (skipping ones already assigned)
    const resolvedAssignees: User[] = [];
    for (const u of nextAssignees) {
      const alreadyAssigned =
        (u.id > 0 && prevIds.has(u.id)) ||
        prevUsernames.has(u.username.toLowerCase());

      if (alreadyAssigned) {
        resolvedAssignees.push(u);
        continue;
      }
      let finalUser = u;
      if (finalUser.id <= 0) {
        // Try to search user by username
        try {
          const found = await this.searchUsers(u.username);
          const matched = found.find(
            (f) => f.username.toLowerCase() === u.username.toLowerCase()
          );
          if (matched) {
            finalUser = matched;
          }
        } catch (err) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[VikunjaClient] searchUsers error:', err);
          }
        }
      }

      if (finalUser.id > 0) {
        try {
          await this.addAssigneeToTask(taskId, finalUser.id);
        } catch (err: any) {
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[VikunjaClient] addAssigneeToTask error:', err);
          }
          if (err instanceof VikunjaApiError && (err.status === 409 || err.status === 400)) {
            // Already assigned
          } else {
            throw err;
          }
        }
      }
      resolvedAssignees.push(finalUser);
    }

    return resolvedAssignees;
  }
}

