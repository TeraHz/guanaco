import {
  AuthTokens,
  CreateProjectInput,
  CreateTaskInput,
  Label,
  Project,
  Task,
  UpdateProjectInput,
  UpdateTaskInput,
  User,
} from '../types/vikunja';

export interface VikunjaClientConfig {
  baseUrl: string;
  token?: string;
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

  constructor(config: VikunjaClientConfig) {
    this.baseApiUrl = this.normalizeUrl(config.baseUrl);
    if (config.token) {
      this.token = config.token;
    }
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

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseApiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

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
      const errorMsg = data?.message || response.statusText || 'API request failed';
      throw new VikunjaApiError(response.status, errorMsg, data);
    }

    return data as T;
  }

  // --- Auth Endpoints ---
  public async login(username: string, password: string): Promise<AuthTokens> {
    const res = await this.request<AuthTokens>('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
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
  public async getProjects(): Promise<Project[]> {
    const res = await this.request<any>('/projects', { method: 'GET' });
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
    return this.request<Task>(`/tasks/${taskId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async toggleTaskDone(taskId: number, done: boolean): Promise<Task> {
    return this.updateTask(taskId, { done });
  }

  public async moveTask(taskId: number, targetProjectId: number): Promise<Task> {
    return this.updateTask(taskId, { project_id: targetProjectId });
  }

  public async reorderTask(taskId: number, position: number): Promise<Task> {
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
        } catch (_) {}
      }
    }

    if (nextLabels.length === 0) {
      return [];
    }

    // 4. Fetch existing labels from server to reuse IDs and preserve hex_color
    let existingLabels: Label[] = [];
    try {
      existingLabels = await this.getLabels();
    } catch (_) {
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
        } catch (_) {
          finalLabel = l;
        }
      }

      if (finalLabel && finalLabel.id > 0) {
        try {
          await this.addLabelToTask(taskId, finalLabel.id);
        } catch (_) {}
      }

      resolvedLabels.push(finalLabel);
    }

    return resolvedLabels;
  }
}
