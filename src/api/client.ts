import { Platform } from 'react-native';
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
import { isPersonalApiToken } from '../utils/biometrics';

export interface VikunjaClientConfig {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  sessionSignal?: AbortSignal;
  onUnauthorized?: () => void;
  onTokenRefresh?: () => Promise<string | null>;
}

export class VikunjaApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
    this.name = 'VikunjaApiError';
  }
}

export interface ParsedServerUrl {
  serverUrl: string;
  apiBaseUrl: string;
  isInsecureHttp: boolean;
}

/**
 * Validates and normalizes a user-supplied Vikunja server URL:
 * - Defaults missing scheme to `https://`
 * - Rejects non-HTTP(S) schemes, embedded credentials (`user:pass@`), malformed hosts, and invalid IPv4 octets
 * - Strips hash fragments (`/#/login`), query strings, and trailing `/login` or `/api/v1` suffixes
 * - Flags cleartext `http://` URLs via `isInsecureHttp`
 */
export function parseAndValidateServerUrl(rawUrl: string): ParsedServerUrl {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('Server URL is required');
  }

  // Reject scheme-relative (`://...` or `//...`) and dangerous non-http(s) schemes
  if (trimmed.startsWith('//') || trimmed.startsWith('://')) {
    throw new Error('Invalid server URL');
  }

  const explicitSchemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (explicitSchemeMatch) {
    const proto = explicitSchemeMatch[1].toLowerCase();
    if (proto !== 'http' && proto !== 'https') {
      throw new Error(`Unsupported URL scheme "${proto}://". Use https:// or http://.`);
    }
  } else if (/^(javascript|data|vbscript|file|mailto|about|blob):/i.test(trimmed)) {
    throw new Error('Invalid server URL scheme');
  }

  const candidate = explicitSchemeMatch ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch (_) {
    throw new Error('Invalid server URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Unsupported URL protocol');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Embedded credentials in server URL are not allowed');
  }

  const hostname = parsed.hostname.trim();
  if (!hostname || hostname.includes('..') || hostname.startsWith('.') || hostname.endsWith('.')) {
    throw new Error('Invalid server hostname');
  }

  // Validate IPv4 octets if hostname is numeric IPv4
  if (/^\d+(\.\d+)*$/.test(hostname)) {
    const octets = hostname.split('.');
    if (
      octets.length !== 4 ||
      octets.some((o) => {
        const n = Number(o);
        return !Number.isInteger(n) || n < 0 || n > 255;
      })
    ) {
      throw new Error('Invalid IPv4 address in server URL');
    }
  } else if (!hostname.startsWith('[')) {
    // Standard DNS hostname validation
    const labels = hostname.split('.');
    const validLabels = labels.every(
      (lbl) =>
        lbl.length > 0 &&
        lbl.length <= 63 &&
        /^[a-zA-Z0-9-]+$/.test(lbl) &&
        !lbl.startsWith('-') &&
        !lbl.endsWith('-')
    );
    if (!validLabels) {
      throw new Error('Invalid server hostname');
    }
    // Require a dot, `localhost`, or explicit port so bare words like "invalid-url" are rejected
    if (labels.length < 2 && hostname.toLowerCase() !== 'localhost' && !parsed.port) {
      throw new Error('Please enter a valid domain or host (e.g. https://vikunja.example.com)');
    }
  }

  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error('Invalid server port');
    }
  }

  // Strip Vue hash router paths (e.g. `/#/login`), query strings, trailing slashes, and `/login` or `/api/v1`
  let pathname = (parsed.pathname || '').replace(/\/+$/, '');
  while (/\/(api\/v1\/login|api\/v1|login)$/i.test(pathname)) {
    pathname = pathname.replace(/\/(api\/v1\/login|api\/v1|login)$/i, '').replace(/\/+$/, '');
  }

  const serverUrl = `${parsed.protocol}//${parsed.host}${pathname}`;
  const apiBaseUrl = `${serverUrl}/api/v1`;

  return {
    serverUrl,
    apiBaseUrl,
    isInsecureHttp: parsed.protocol === 'http:',
  };
}

/**
 * Detects whether an API error indicates Vikunja requires or rejected a TOTP 2FA passcode.
 * Vikunja returns code `1017` ("Invalid totp passcode.") or HTTP 412 when 2FA is enabled.
 */
export function isTotpRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as any;
  if (anyErr.data?.code === 1017) return true;
  if (anyErr.status === 412) return true;
  const msg = typeof anyErr.message === 'string' ? anyErr.message : '';
  return /\btotp\b|\b2fa\b|two[- ]factor|passcode|authenticator/i.test(msg);
}

const DEFAULT_PER_PAGE = 50;
const MAX_PAGINATION_PAGES = 100;
const MAX_REDIRECT_HOPS = 3;

interface InternalRequestOptions extends RequestInit {
  _isRetry?: boolean;
  _skipAuthRefresh?: boolean;
}

interface ResponseWithMeta<T> {
  data: T;
  totalPages: number | null;
}

export class VikunjaClient {
  private baseApiUrl: string;
  private baseOriginUrl: URL;
  private token: string | null = null;
  private timeoutMs: number;
  private sessionSignal?: AbortSignal;
  public onUnauthorized?: () => void;
  public onTokenRefresh?: () => Promise<string | null>;
  private refreshPromise: Promise<string | null> | null = null;
  private hasNotifiedUnauthorized = false;

  constructor(config: VikunjaClientConfig) {
    this.baseApiUrl = this.normalizeUrl(config.baseUrl);
    this.baseOriginUrl = new URL(this.baseApiUrl);
    if (config.token) {
      this.token = config.token;
    }
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.sessionSignal = config.sessionSignal;
    this.onUnauthorized = config.onUnauthorized;
    this.onTokenRefresh = config.onTokenRefresh;
  }

  private normalizeUrl(url: string): string {
    return parseAndValidateServerUrl(url).apiBaseUrl;
  }

  public getBaseApiUrl(): string {
    return this.baseApiUrl;
  }

  public setToken(token: string | null): void {
    this.token = token;
    this.hasNotifiedUnauthorized = false;
  }

  public getToken(): string | null {
    return this.token;
  }

  private isSafeSameOriginTarget(targetUrlStr: string): boolean {
    try {
      const target = new URL(targetUrlStr);
      if (target.host.toLowerCase() !== this.baseOriginUrl.host.toLowerCase()) {
        return false;
      }
      // Never allow protocol downgrade from https: to http:
      if (this.baseOriginUrl.protocol === 'https:' && target.protocol !== 'https:') {
        return false;
      }
      return target.protocol === 'https:' || target.protocol === 'http:';
    } catch (_) {
      return false;
    }
  }

  private async requestWithMeta<T>(
    endpoint: string,
    options: InternalRequestOptions = {}
  ): Promise<ResponseWithMeta<T>> {
    const initialUrl = `${this.baseApiUrl}${endpoint}`;
    const hasBody = options.body !== undefined && options.body !== null;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    const requestToken = this.token;
    if (requestToken) {
      headers['Authorization'] = `Bearer ${requestToken}`;
    }

    const controller = new AbortController();
    let isTimedOut = false;
    let isCallerAborted = false;

    const callerSignals: AbortSignal[] = [];
    if (options.signal) callerSignals.push(options.signal);
    if (this.sessionSignal && this.sessionSignal !== options.signal) {
      callerSignals.push(this.sessionSignal);
    }

    const onCallerAbort = () => {
      isCallerAborted = true;
      controller.abort();
    };

    for (const sig of callerSignals) {
      if (sig.aborted) {
        isCallerAborted = true;
        controller.abort();
        break;
      }
      sig.addEventListener('abort', onCallerAbort);
    }

    const timer = setTimeout(() => {
      isTimedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      if (isCallerAborted) {
        const abortErr = new Error('Request aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const { _isRetry, _skipAuthRefresh, signal: _ignoredSignal, ...fetchInit } = options;

      let currentUrl = initialUrl;
      let currentMethod = fetchInit.method || 'GET';
      let currentBody = fetchInit.body;
      let response: Response | undefined;

      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        const hopHeaders = { ...headers };
        if (currentBody === undefined || currentBody === null) {
          delete hopHeaders['Content-Type'];
        }

        response = await fetch(currentUrl, {
          ...fetchInit,
          method: currentMethod,
          body: currentBody,
          headers: hopHeaders,
          redirect: Platform.OS === 'web' ? 'follow' : 'manual',
          signal: controller.signal,
        });

        if (!response) {
          throw new Error('No response received');
        }

        if ((response as any).type === 'opaqueredirect') {
          throw new VikunjaApiError(
            0,
            'Blocked opaque redirect from server to protect authentication credentials'
          );
        }

        // Verify final response URL if populated by underlying XHR/fetch runtime
        if (response.url && !this.isSafeSameOriginTarget(response.url)) {
          throw new VikunjaApiError(
            0,
            'Blocked cross-origin or insecure redirect to protect authentication credentials'
          );
        }

        // Handle 3xx redirects manually so Authorization never leaks cross-origin or over downgraded HTTP
        if (
          response.status === 301 ||
          response.status === 302 ||
          response.status === 303 ||
          response.status === 307 ||
          response.status === 308
        ) {
          const location = response.headers?.get?.('location');
          if (!location) {
            break;
          }
          const resolvedRedirect = new URL(location, currentUrl).toString();
          if (!this.isSafeSameOriginTarget(resolvedRedirect)) {
            throw new VikunjaApiError(
              response.status,
              'Blocked cross-origin or protocol-downgrade redirect to protect authentication credentials'
            );
          }
          if (hop === MAX_REDIRECT_HOPS) {
            throw new VikunjaApiError(response.status, 'Too many redirects');
          }
          currentUrl = resolvedRedirect;
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && currentMethod === 'POST')
          ) {
            currentMethod = 'GET';
            currentBody = undefined;
          }
          continue;
        }

        break;
      }

      if (!response) {
        throw new Error('No response received');
      }

      let data: any = null;
      const hasHeadersApi = Boolean(response.headers && typeof response.headers.get === 'function');
      const contentType = hasHeadersApi
        ? (response.headers.get('content-type') || '').toLowerCase()
        : '';

      let totalPages: number | null = null;
      if (hasHeadersApi) {
        const rawTotalPages = response.headers.get('x-pagination-total-pages');
        if (rawTotalPages) {
          const parsedPages = parseInt(rawTotalPages, 10);
          if (!isNaN(parsedPages) && parsedPages >= 0) {
            totalPages = parsedPages;
          }
        }
      }

      if (response.status !== 204 && response.status !== 205) {
        const shouldParseJson = hasHeadersApi
          ? contentType.includes('application/json') ||
            contentType.includes('+json') ||
            contentType === ''
          : typeof response.json === 'function';

        if (shouldParseJson && typeof response.json === 'function') {
          try {
            data = await response.json();
          } catch (_) {
            data = null;
          }
        }
      }

      if (!response.ok) {
        const isAuthEndpoint =
          endpoint.startsWith('/login') || endpoint.startsWith('/user/token');

        if (
          response.status === 401 &&
          !options._isRetry &&
          !options._skipAuthRefresh &&
          !isAuthEndpoint
        ) {
          // 1. If a sibling request already refreshed the token while we were in-flight, retry with the updated token
          if (requestToken && this.token && this.token !== requestToken) {
            return await this.requestWithMeta<T>(endpoint, {
              ...options,
              _isRetry: true,
            });
          }

          // 2. Attempt JWT renewal (never call /user/token for Personal API Tokens `tk_...`)
          if (this.onTokenRefresh && !isPersonalApiToken(this.token)) {
            try {
              if (!this.refreshPromise) {
                this.refreshPromise = this.onTokenRefresh().finally(() => {
                  this.refreshPromise = null;
                });
              }
              const newToken = await this.refreshPromise;
              if (newToken) {
                this.setToken(newToken);
                return await this.requestWithMeta<T>(endpoint, {
                  ...options,
                  _isRetry: true,
                });
              }
            } catch (_) {
              // Refresh failed — fall through to deduplicated onUnauthorized
            }
          }
        }

        if (
          response.status === 401 &&
          !options._skipAuthRefresh &&
          !isAuthEndpoint &&
          this.onUnauthorized &&
          !this.hasNotifiedUnauthorized
        ) {
          this.hasNotifiedUnauthorized = true;
          this.onUnauthorized();
        }

        const errorMsg = data?.message || response.statusText || 'API request failed';
        throw new VikunjaApiError(response.status, errorMsg, data);
      }

      return { data: data as T, totalPages };
    } catch (err: any) {
      if (isCallerAborted && !isTimedOut) {
        const abortErr = new Error('Request aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      if (isTimedOut || err?.name === 'AbortError') {
        const timeoutErr = new Error(`Request timed out after ${this.timeoutMs}ms`);
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      for (const sig of callerSignals) {
        sig.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  private async request<T>(
    endpoint: string,
    options: InternalRequestOptions = {}
  ): Promise<T> {
    const { data } = await this.requestWithMeta<T>(endpoint, options);
    return data;
  }

  // --- Auth Endpoints ---
  public async login(
    username: string,
    password: string,
    longTokenOrOptions: boolean | { longToken?: boolean; totpPasscode?: string } = true,
    totpPasscode?: string
  ): Promise<AuthTokens> {
    const longToken =
      typeof longTokenOrOptions === 'object'
        ? longTokenOrOptions.longToken ?? true
        : longTokenOrOptions;
    const resolvedTotp =
      typeof longTokenOrOptions === 'object'
        ? longTokenOrOptions.totpPasscode ?? totpPasscode
        : totpPasscode;

    const payload: Record<string, any> = {
      username,
      password,
      long_token: longToken,
    };
    if (resolvedTotp && resolvedTotp.trim()) {
      payload.totp_passcode = resolvedTotp.trim();
    }

    const res = await this.request<AuthTokens>('/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      _skipAuthRefresh: true,
    });
    if (res?.token) {
      this.setToken(res.token);
    }
    return res;
  }

  public async renewToken(): Promise<AuthTokens> {
    if (isPersonalApiToken(this.token)) {
      throw new VikunjaApiError(400, 'Personal API tokens do not support JWT renewal');
    }
    const res = await this.request<AuthTokens>('/user/token', {
      method: 'POST',
      _skipAuthRefresh: true,
    });
    if (res?.token) {
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

  private extractEnvelopeTotalPages(res: any): number | null {
    if (res && typeof res === 'object' && !Array.isArray(res)) {
      const tp = Number(res.total_pages ?? res.totalPages);
      if (Number.isInteger(tp) && tp >= 0) {
        return tp;
      }
    }
    return null;
  }

  /**
   * Fetches either a single explicit page or automatically paginates through all pages.
   * Rethrows any network, timeout, auth, or server error on ANY page so partial results
   * never overwrite cached local state.
   */
  private async fetchPaginatedList<T>(
    baseEndpoint: string,
    params?: {
      page?: number;
      per_page?: number;
      extraParams?: Record<string, string | string[] | undefined>;
      signal?: AbortSignal;
    }
  ): Promise<T[]> {
    const buildQuery = (page?: number, perPage?: number): string => {
      const qParams = new URLSearchParams();
      if (params?.extraParams) {
        for (const [k, v] of Object.entries(params.extraParams)) {
          if (Array.isArray(v)) {
            v.forEach((entry) => qParams.append(k, entry));
          } else if (v !== undefined) {
            qParams.set(k, v);
          }
        }
      }
      if (page !== undefined) qParams.set('page', page.toString());
      if (perPage !== undefined) qParams.set('per_page', perPage.toString());
      const qs = qParams.toString();
      return qs ? `?${qs}` : '';
    };

    if (params?.page !== undefined) {
      const res = await this.request<any>(
        `${baseEndpoint}${buildQuery(params.page, params.per_page)}`,
        { method: 'GET', signal: params.signal }
      );
      return this.normalizeListResponse<T>(res);
    }

    const perPage = params?.per_page ?? DEFAULT_PER_PAGE;
    const allItems: T[] = [];
    let page = 1;

    while (page <= MAX_PAGINATION_PAGES) {
      // On page 1 without explicit per_page, preserve clean URL unless paginating further,
      // while reading x-pagination-total-pages or perPage threshold for subsequent pages.
      const query =
        page === 1 && params?.per_page === undefined
          ? buildQuery(undefined, undefined)
          : buildQuery(page, perPage);

      const { data: res, totalPages: headerTotalPages } = await this.requestWithMeta<any>(
        `${baseEndpoint}${query}`,
        { method: 'GET', signal: params?.signal }
      );

      const items = this.normalizeListResponse<T>(res);
      if (items.length === 0) {
        break;
      }

      allItems.push(...items);

      const knownTotalPages = headerTotalPages ?? this.extractEnvelopeTotalPages(res);
      if (knownTotalPages !== null) {
        if (page >= knownTotalPages) {
          break;
        }
        page += 1;
      } else if (items.length < perPage) {
        break;
      } else {
        page += 1;
      }
    }

    return allItems;
  }

  // --- Projects Endpoints ---
  public async getProjects(params?: {
    is_archived?: boolean;
    page?: number;
    per_page?: number;
    signal?: AbortSignal;
  }): Promise<Project[]> {
    return this.fetchPaginatedList<Project>('/projects', {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
      extraParams: params?.is_archived ? { is_archived: 'true' } : undefined,
    });
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
  public async getProjectUsers(
    projectId: number,
    params?: { page?: number; per_page?: number; signal?: AbortSignal }
  ): Promise<ProjectUserShare[]> {
    return this.fetchPaginatedList<ProjectUserShare>(`/projects/${projectId}/users`, {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
    });
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
  public async getTeams(params?: {
    page?: number;
    per_page?: number;
    signal?: AbortSignal;
  }): Promise<Team[]> {
    return this.fetchPaginatedList<Team>('/teams', {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
    });
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
    const perm =
      typeof teamIdOrInput === 'object' ? teamIdOrInput.permission ?? 0 : permission ?? 0;
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
    params?: { page?: number; per_page?: number; filter_by?: string[]; signal?: AbortSignal }
  ): Promise<Task[]> {
    return this.fetchPaginatedList<Task>(`/projects/${projectId}/tasks`, {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
      extraParams: params?.filter_by?.length ? { filter_by: params.filter_by } : undefined,
    });
  }

  public async getAllTasks(params?: {
    page?: number;
    per_page?: number;
    signal?: AbortSignal;
  }): Promise<Task[]> {
    const fetchTasksEndpoint = async (
      query: string,
      preferredEndpoint: '/tasks' | '/tasks/all'
    ): Promise<{ res: ResponseWithMeta<any>; resolvedEndpoint: '/tasks' | '/tasks/all' }> => {
      if (preferredEndpoint === '/tasks/all') {
        const res = await this.requestWithMeta<any>(`/tasks/all${query}`, {
          method: 'GET',
          signal: params?.signal,
        });
        return { res, resolvedEndpoint: '/tasks/all' };
      }

      try {
        const res = await this.requestWithMeta<any>(`/tasks${query}`, {
          method: 'GET',
          signal: params?.signal,
        });
        return { res, resolvedEndpoint: '/tasks' };
      } catch (err: any) {
        // ONLY fall back to legacy `/tasks/all` on 404 or 405; rethrow network/timeout/401/5xx!
        if (err instanceof VikunjaApiError && (err.status === 404 || err.status === 405)) {
          const res = await this.requestWithMeta<any>(`/tasks/all${query}`, {
            method: 'GET',
            signal: params?.signal,
          });
          return { res, resolvedEndpoint: '/tasks/all' };
        }
        throw err;
      }
    };

    if (params?.page !== undefined) {
      const qParams = new URLSearchParams();
      qParams.set('page', params.page.toString());
      if (params.per_page !== undefined) qParams.set('per_page', params.per_page.toString());
      const query = `?${qParams.toString()}`;
      const { res } = await fetchTasksEndpoint(query, '/tasks');
      return this.normalizeListResponse<Task>(res.data);
    }

    const perPage = params?.per_page ?? DEFAULT_PER_PAGE;
    let page = 1;
    let endpointToUse: '/tasks' | '/tasks/all' = '/tasks';
    const allTasks: Task[] = [];

    while (page <= MAX_PAGINATION_PAGES) {
      const query = `?page=${page}&per_page=${perPage}`;
      const { res, resolvedEndpoint } = await fetchTasksEndpoint(query, endpointToUse);
      endpointToUse = resolvedEndpoint;

      const items = this.normalizeListResponse<Task>(res.data);
      if (items.length === 0) {
        break;
      }

      allTasks.push(...items);

      const knownTotalPages = res.totalPages ?? this.extractEnvelopeTotalPages(res.data);
      if (knownTotalPages !== null) {
        if (page >= knownTotalPages) {
          break;
        }
        page += 1;
      } else if (items.length < perPage) {
        break;
      } else {
        page += 1;
      }
    }

    return allTasks;
  }

  public async createTask(projectId: number, data: CreateTaskInput): Promise<Task> {
    const payload: any = { ...data };
    if (payload.color !== undefined && payload.hex_color === undefined) {
      payload.hex_color = payload.color;
    }
    if (Array.isArray(payload.labels)) {
      payload.labels = payload.labels.filter((l: Label) => l && l.id > 0);
      if (payload.labels.length === 0) delete payload.labels;
    }
    if (Array.isArray(payload.assignees)) {
      payload.assignees = payload.assignees.filter((u: User) => u && u.id > 0);
      if (payload.assignees.length === 0) delete payload.assignees;
    }
    return this.request<Task>(`/projects/${projectId}/tasks`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  public async getTask(taskId: number): Promise<Task> {
    return this.request<Task>(`/tasks/${taskId}`, { method: 'GET' });
  }

  public async updateTask(taskId: number, data: UpdateTaskInput): Promise<Task> {
    const payload: any = { ...data };
    if (typeof payload.id === 'number' && payload.id < 0) {
      delete payload.id;
    }
    if (payload.color !== undefined && payload.hex_color === undefined) {
      payload.hex_color = payload.color;
    }
    if (Array.isArray(payload.labels)) {
      payload.labels = payload.labels.filter((l: Label) => l && l.id > 0);
    }
    if (Array.isArray(payload.assignees)) {
      payload.assignees = payload.assignees.filter((u: User) => u && u.id > 0);
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
    let base = taskSnapshot ? { ...taskSnapshot } : undefined;
    if (!base || !base.title) {
      try {
        base = await this.getTask(taskId);
      } catch (_) {
        base = base || {};
      }
    }
    return this.updateTask(taskId, { ...base, done });
  }

  public async moveTask(
    taskId: number,
    targetProjectId: number,
    taskSnapshot?: Partial<Task>
  ): Promise<Task> {
    let base = taskSnapshot ? { ...taskSnapshot } : undefined;
    if (!base || !base.title) {
      try {
        base = await this.getTask(taskId);
      } catch (_) {
        base = base || {};
      }
    }
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

  public async reorderTask(
    taskId: number,
    position: number,
    projectViewId?: number,
    taskSnapshot?: Partial<Task>
  ): Promise<any> {
    let resolvedViewId = projectViewId && projectViewId > 0 ? projectViewId : undefined;

    if (!resolvedViewId && taskSnapshot?.project_id && taskSnapshot.project_id > 0) {
      try {
        const views = await this.getProjectViews(taskSnapshot.project_id);
        const listView = views.find((v) => v.view_kind === 'list') || views[0];
        if (listView?.id && listView.id > 0) {
          resolvedViewId = listView.id;
        }
      } catch (_) {
        // Proceed to snapshot-backed fallback if views cannot be resolved
      }
    }

    if (resolvedViewId && resolvedViewId > 0) {
      try {
        return await this.setTaskPosition(taskId, resolvedViewId, position);
      } catch (err: any) {
        // Only fall back to updateTask when the dedicated position endpoint is unsupported (404/405)
        if (!(err instanceof VikunjaApiError && (err.status === 404 || err.status === 405))) {
          throw err;
        }
      }
    }

    // Never send a bare `{ position }` without a full task snapshot to `updateTask`
    let snapshot: Partial<Task> | undefined =
      taskSnapshot && taskSnapshot.title ? { ...taskSnapshot } : undefined;
    if (!snapshot) {
      snapshot = await this.getTask(taskId);
    }
    return this.updateTask(taskId, { ...snapshot, position });
  }

  public async deleteTask(taskId: number): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  // --- Labels Endpoints ---
  public async getLabels(params?: {
    page?: number;
    per_page?: number;
    signal?: AbortSignal;
  }): Promise<Label[]> {
    return this.fetchPaginatedList<Label>('/labels', {
      page: params?.page,
      per_page: params?.per_page,
      signal: params?.signal,
    });
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

    // 1. Determine currently attached labels to identify removals and skip already-attached labels
    let currentTaskLabels: Label[] = previousLabels || [];
    if (!previousLabels) {
      const currentTask = await this.getTask(taskId);
      currentTaskLabels = Array.isArray(currentTask?.labels) ? currentTask.labels : [];
    }

    const alreadyAttachedIds = new Set(
      currentTaskLabels.filter((l) => l.id > 0).map((l) => l.id)
    );
    const alreadyAttachedTitles = new Set(
      currentTaskLabels.map((l) => l.title.trim().toLowerCase())
    );

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
          if (err instanceof VikunjaApiError && err.status === 404) {
            // Label already detached or deleted on server
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
    const needsServerLookup = nextLabels.some(
      (l) => l.id <= 0 || !l.hex_color || !alreadyAttachedIds.has(l.id)
    );
    if (needsServerLookup) {
      try {
        existingLabels = await this.getLabels();
      } catch (err) {
        // Rethrow if any label lacks a positive server ID so SyncQueue retries instead of dropping it
        if (nextLabels.some((l) => l.id <= 0)) {
          throw err;
        }
        existingLabels = [];
      }
    }

    const resolvedLabels: Label[] = [];

    for (const l of nextLabels) {
      let finalLabel: Label | undefined;

      if (l.id > 0) {
        finalLabel =
          existingLabels.find((el) => el.id === l.id) ||
          currentTaskLabels.find((cl) => cl.id === l.id) ||
          l;
      } else {
        finalLabel = existingLabels.find(
          (el) => el.title.trim().toLowerCase() === l.title.trim().toLowerCase()
        );
      }

      // If label doesn't exist on server yet, create it
      if (!finalLabel) {
        try {
          finalLabel = await this.createLabel(l.title.trim(), l.hex_color);
          existingLabels.push(finalLabel);
        } catch (err: any) {
          if (err instanceof VikunjaApiError && (err.status === 400 || err.status === 409)) {
            const refreshed = await this.getLabels();
            existingLabels = refreshed;
            finalLabel = refreshed.find(
              (el) => el.title.trim().toLowerCase() === l.title.trim().toLowerCase()
            );
          }
          if (!finalLabel) {
            throw err;
          }
        }
      }

      const wasAlreadyAttached =
        (finalLabel.id > 0 && alreadyAttachedIds.has(finalLabel.id)) ||
        (finalLabel.id > 0 && alreadyAttachedTitles.has(finalLabel.title.trim().toLowerCase()));

      if (finalLabel.id > 0 && !wasAlreadyAttached) {
        try {
          await this.addLabelToTask(taskId, finalLabel.id);
          alreadyAttachedIds.add(finalLabel.id);
          alreadyAttachedTitles.add(finalLabel.title.trim().toLowerCase());
        } catch (err: any) {
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
      const task = await this.getTask(taskId);
      currentAssignees = task?.assignees || [];
    }

    const prevIds = new Set(currentAssignees.filter((u) => u.id > 0).map((u) => u.id));
    const prevByUsername = new Map(
      currentAssignees.map((u) => [u.username.toLowerCase(), u])
    );
    const nextIds = new Set(nextAssignees.filter((u) => u.id > 0).map((u) => u.id));
    const nextUsernames = new Set(nextAssignees.map((u) => u.username.toLowerCase()));

    // 1. Remove assignees present in previous but not in next
    for (const prev of currentAssignees) {
      const kept =
        (prev.id > 0 && nextIds.has(prev.id)) ||
        nextUsernames.has(prev.username.toLowerCase());
      if (!kept && prev.id > 0) {
        try {
          await this.removeAssigneeFromTask(taskId, prev.id);
        } catch (err: any) {
          if (err instanceof VikunjaApiError && err.status === 404) {
            // Already removed
          } else {
            throw err;
          }
        }
      }
    }

    // 2. Add new assignees (skipping ones already assigned)
    const resolvedAssignees: User[] = [];
    for (const u of nextAssignees) {
      const prevMatch = prevByUsername.get(u.username.toLowerCase());
      const alreadyAssigned =
        (u.id > 0 && prevIds.has(u.id)) || Boolean(prevMatch && prevMatch.id > 0);

      if (alreadyAssigned) {
        resolvedAssignees.push(u.id > 0 ? u : prevMatch || u);
        continue;
      }

      let finalUser = u;
      if (finalUser.id <= 0) {
        const found = await this.searchUsers(u.username);
        const matched = found.find(
          (f) => f.username.toLowerCase() === u.username.toLowerCase()
        );
        if (matched) {
          finalUser = matched;
        }
      }

      if (finalUser.id > 0) {
        try {
          await this.addAssigneeToTask(taskId, finalUser.id);
          prevIds.add(finalUser.id);
        } catch (err: any) {
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
