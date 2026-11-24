import {
  VikunjaClient,
  VikunjaApiError,
  parseAndValidateServerUrl,
  isTotpRequiredError,
  getJwtExpirationMs,
  extractRefreshTokenFromHeaders,
} from '../client';

function buildTestJwt(payload: Record<string, any>): string {
  const toBase64Url = (obj: Record<string, any>) =>
    Buffer.from(JSON.stringify(obj), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${toBase64Url({ alg: 'HS256', typ: 'JWT' })}.${toBase64Url(payload)}.sig_test_123`;
}

describe('VikunjaClient & URL Security', () => {
  let client: VikunjaClient;
  const mockBaseUrl = 'https://try.vikunja.io';
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new VikunjaClient({ baseUrl: mockBaseUrl });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('Base URL normalization & validation', () => {
    it('should normalize trailing slashes and ensure api/v1 prefix', () => {
      const c1 = new VikunjaClient({ baseUrl: 'https://demo.vikunja.io/' });
      expect(c1.getBaseApiUrl()).toBe('https://demo.vikunja.io/api/v1');

      const c2 = new VikunjaClient({ baseUrl: 'https://demo.vikunja.io/api/v1/' });
      expect(c2.getBaseApiUrl()).toBe('https://demo.vikunja.io/api/v1');
    });

    it('normalizes missing scheme to https:// and strips trailing /login and /api/v1 suffixes', () => {
      expect(parseAndValidateServerUrl('demo.vikunja.io')).toEqual({
        serverUrl: 'https://demo.vikunja.io',
        apiBaseUrl: 'https://demo.vikunja.io/api/v1',
        isInsecureHttp: false,
      });

      expect(parseAndValidateServerUrl('https://demo.vikunja.io/login/')).toEqual({
        serverUrl: 'https://demo.vikunja.io',
        apiBaseUrl: 'https://demo.vikunja.io/api/v1',
        isInsecureHttp: false,
      });

      expect(parseAndValidateServerUrl('https://demo.vikunja.io/api/v1/login')).toEqual({
        serverUrl: 'https://demo.vikunja.io',
        apiBaseUrl: 'https://demo.vikunja.io/api/v1',
        isInsecureHttp: false,
      });

      expect(parseAndValidateServerUrl('https://demo.vikunja.io/subpath/api/v1/')).toEqual({
        serverUrl: 'https://demo.vikunja.io/subpath',
        apiBaseUrl: 'https://demo.vikunja.io/subpath/api/v1',
        isInsecureHttp: false,
      });

      expect(parseAndValidateServerUrl('http://192.168.1.50:3456/api/v1')).toEqual({
        serverUrl: 'http://192.168.1.50:3456',
        apiBaseUrl: 'http://192.168.1.50:3456/api/v1',
        isInsecureHttp: true,
      });
    });

    it('rejects invalid schemes, bare invalid words, bad IPv4 octets, and embedded userinfo credentials', () => {
      expect(() => parseAndValidateServerUrl('')).toThrow();
      expect(() => parseAndValidateServerUrl('not-a-valid-url')).toThrow();
      expect(() => parseAndValidateServerUrl('ftp://vikunja.example.com')).toThrow();
      expect(() => parseAndValidateServerUrl('javascript:alert(1)')).toThrow();
      expect(() => parseAndValidateServerUrl('https://user:pass@vikunja.example.com')).toThrow(
        /credentials/i
      );
      expect(() => parseAndValidateServerUrl('http://999.999.999.999:3456')).toThrow(
        /IPv4|Invalid server URL/i
      );
    });
  });

  describe('Authentication, Headers & Redirect Protection', () => {
    it('should set and get auth token, include Authorization header, and omit Content-Type on bodyless GET', async () => {
      client.setToken('test-jwt-token');
      expect(client.getToken()).toBe('test-jwt-token');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, username: 'testuser' }),
      } as Response);

      await client.getCurrentUser();

      const [url, fetchOpts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://try.vikunja.io/api/v1/user');
      expect(fetchOpts.headers.Authorization).toBe('Bearer test-jwt-token');
      expect(fetchOpts.headers['Content-Type']).toBeUndefined();
      expect(fetchOpts.redirect).toBe('manual');
    });

    it('should login and return auth token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ token: 'received-jwt-token' }),
      } as Response);

      const res = await client.login('testuser', 'password123');

      expect(res.token).toBe('received-jwt-token');
      expect(client.getToken()).toBe('received-jwt-token');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/login',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            username: 'testuser',
            password: 'password123',
            long_token: true,
          }),
        })
      );
    });

    it('logs in with optional totp_passcode and preserves untrimmed password spaces', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ token: 'totp-jwt-token' }),
      } as Response);

      const res = await client.login('testuser', '  pass with spaces  ', true, '654321');
      expect(res.token).toBe('totp-jwt-token');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            username: 'testuser',
            password: '  pass with spaces  ',
            long_token: true,
            totp_passcode: '654321',
          }),
        })
      );
    });

    it('detects Vikunja TOTP 2FA errors accurately via code 1017 and status 412', () => {
      expect(
        isTotpRequiredError(new VikunjaApiError(412, 'Precondition Failed', { code: 1017 }))
      ).toBe(true);
      expect(
        isTotpRequiredError(new VikunjaApiError(400, 'Invalid totp passcode.', { code: 1017 }))
      ).toBe(true);
      expect(isTotpRequiredError(new VikunjaApiError(403, 'Invalid username or password'))).toBe(
        false
      );
    });

    it('blocks cross-origin 302 redirects, https->http downgrades, and validates Web redirect: follow response.url', async () => {
      client.setToken('secret-bearer-token');

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'location' ? 'https://attacker.evil.com/collect' : null,
        },
      } as unknown as Response);

      await expect(client.getCurrentUser()).rejects.toThrow(/cross-origin|redirect/i);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 307,
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'location' ? 'http://try.vikunja.io/api/v1/user' : null,
        },
      } as unknown as Response);

      await expect(client.getCurrentUser()).rejects.toThrow(/redirect/i);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 307,
          headers: {
            get: (k: string) =>
              k.toLowerCase() === 'location' ? 'https://try.vikunja.io/api/v1/user/' : null,
          },
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: {
            get: (k: string) => (k.toLowerCase() === 'content-type' ? 'application/json' : null),
          },
          json: async () => ({ id: 7, username: 'safeuser' }),
        } as unknown as Response);

      const user = await client.getCurrentUser();
      expect(user.username).toBe('safeuser');

      const { Platform } = require('react-native');
      const prevOS = Platform.OS;
      try {
        Platform.OS = 'web';
        global.fetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          url: 'https://try.vikunja.io/api/v1/user/',
          json: async () => ({ id: 8, username: 'webuser' }),
        } as unknown as Response);

        const webUser = await client.getCurrentUser();
        expect(webUser.username).toBe('webuser');
        expect((global.fetch as jest.Mock).mock.calls[0][1].redirect).toBe('follow');

        global.fetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          url: 'https://phishing.evil.org/api/v1/user',
          json: async () => ({ id: 9, username: 'spoof' }),
        } as unknown as Response);

        await expect(client.getCurrentUser()).rejects.toThrow(/cross-origin|redirect/i);
      } finally {
        Platform.OS = prevOS;
      }
    });

    it('does not invoke response.json() on non-JSON HTML error pages and cleans up caller AbortSignal listeners', async () => {
      const jsonSpy = jest.fn().mockRejectedValue(new SyntaxError('Unexpected token <'));
      const externalController = new AbortController();
      const removeListenerSpy = jest.spyOn(externalController.signal, 'removeEventListener');

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null,
        },
        json: jsonSpy,
      } as unknown as Response);

      await expect(
        client.getProjects({ signal: externalController.signal })
      ).rejects.toThrow('Bad Gateway');
      expect(jsonSpy).not.toHaveBeenCalled();
      expect(removeListenerSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });
  });

  describe('Projects / Lists API & Multi-Page Pagination', () => {
    beforeEach(() => {
      client.setToken('token');
    });

    it('should fetch projects', async () => {
      const mockProjects = [
        { id: 1, title: 'Inbox', hex_color: '#3498db' },
        { id: 2, title: 'Work', hex_color: '#e74c3c' },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockProjects,
      } as Response);

      const projects = await client.getProjects();
      expect(projects).toEqual(mockProjects);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects',
        expect.anything()
      );
    });

    it('paginates getProjects() automatically when multiple pages exist', async () => {
      const page1 = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, title: `List ${i + 1}` }));
      const page2 = [{ id: 51, title: 'List 51' }];

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 } as Response)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page2 } as Response);

      const projects = await client.getProjects();
      expect(projects).toHaveLength(51);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should fetch a single project by id and fetch project views', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 1, title: 'Inbox' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: 7, title: 'List', project_id: 1, view_kind: 'list' }],
        } as Response);

      const proj = await client.getProject(1);
      expect(proj.title).toBe('Inbox');
      const views = await client.getProjectViews(1);
      expect(views).toHaveLength(1);
      expect(views[0].view_kind).toBe('list');
    });

    it('should create project with PUT /projects', async () => {
      const newProj = { title: 'Personal', hex_color: '#2ecc71' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: 3, ...newProj }),
      } as Response);

      const created = await client.createProject(newProj);
      expect(created.id).toBe(3);
      expect(created.title).toBe('Personal');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(newProj),
        })
      );
    });

    it('should update project with POST /projects/{id}', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, title: 'Renamed' }),
      } as Response);

      const updated = await client.updateProject(1, { title: 'Renamed' });
      expect(updated.title).toBe('Renamed');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Renamed' }),
        })
      );
    });

    it('should fetch projects when response is envelope object with items (Regression #1)', async () => {
      const mockEnvelope = {
        items: [{ id: 1, title: 'Inbox', hex_color: '#3498db' }],
        total_pages: 1,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockEnvelope,
      } as Response);

      const projects = await client.getProjects();
      expect(projects).toEqual([{ id: 1, title: 'Inbox', hex_color: '#3498db' }]);
    });

    it('should return empty array if getProjects returns null (Regression #1)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => null,
      } as Response);

      const projects = await client.getProjects();
      expect(projects).toEqual([]);
    });

    it('should fetch tasks when response is envelope object with items (Regression #1)', async () => {
      const mockEnvelope = {
        items: [{ id: 10, title: 'Buy groceries', done: false, project_id: 1 }],
        total: 1,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockEnvelope,
      } as Response);

      const tasks = await client.getTasks(1);
      expect(tasks).toEqual([{ id: 10, title: 'Buy groceries', done: false, project_id: 1 }]);
    });

    it('should return empty array if getTasks returns null (Regression #1)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => null,
      } as Response);

      const tasks = await client.getTasks(1);
      expect(tasks).toEqual([]);
    });

    it('should delete project with DELETE /projects/{id}', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: 'Successfully deleted.' }),
      } as Response);

      await client.deleteProject(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should fetch archived projects with ?is_archived=true', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ id: 5, title: 'Archived', is_archived: true }],
      } as Response);

      const archived = await client.getProjects({ is_archived: true });
      expect(archived).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects?is_archived=true',
        expect.anything()
      );
    });

    it('should duplicate project with PUT /projects/{id}/duplicate', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 6, title: 'Personal Copy' }),
      } as Response);

      const dup = await client.duplicateProject(1);
      expect(dup.id).toBe(6);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/duplicate',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should manage project user sharing (GET, PUT by id & username, POST, DELETE)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 10, username: 'alice', permission: 1 }],
      } as Response);
      const users = await client.getProjectUsers(1);
      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('alice');

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: 'ok' }),
      } as Response);
      await client.addProjectUser(1, 10, 1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/users',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ user_id: 10, permission: 1 }),
        })
      );

      // Add by username object lookup
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: 15, username: 'diana' }],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'ok' }),
        } as Response);
      await client.addProjectUser(1, { username: 'diana', permission: 2 });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: 'ok' }),
      } as Response);
      await client.updateProjectUser(1, 10, 2);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/users/10',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ permission: 2 }),
        })
      );

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: 'ok' }),
      } as Response);
      await client.removeProjectUser(1, 10);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/users/10',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should manage project team sharing (GET /teams, GET/PUT/POST/DELETE /projects/{id}/teams)', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 20, name: 'Engineers' }],
      } as Response);
      const teams = await client.getTeams();
      expect(teams[0].name).toBe('Engineers');

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 20, name: 'Engineers', permission: 2 }],
      } as Response);
      const projectTeams = await client.getProjectTeams(1);
      expect(projectTeams[0].permission).toBe(2);

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: 'ok' }),
      } as Response);
      await client.addProjectTeam(1, 20, 1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/teams',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ team_id: 20, permission: 1 }),
        })
      );

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: 'ok' }),
      } as Response);
      await client.updateProjectTeam(1, 20, 2);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/teams/20',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ permission: 2 }),
        })
      );

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: 'ok' }),
      } as Response);
      await client.removeProjectTeam(1, 20);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/teams/20',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('paginates getTasks(projectId), getLabels(), getTeams(), and getProjectUsers() via x-pagination-total-pages header', async () => {
      const makeHeaderResponse = (items: any[], totalPages: number) =>
        ({
          ok: true,
          status: 200,
          headers: {
            get: (k: string) => {
              const lower = k.toLowerCase();
              if (lower === 'content-type') return 'application/json';
              if (lower === 'x-pagination-total-pages') return String(totalPages);
              return null;
            },
          },
          json: async () => items,
        }) as unknown as Response;

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(
          makeHeaderResponse([{ id: 1, title: 'T1', done: false, priority: 0, project_id: 1 }], 2)
        )
        .mockResolvedValueOnce(
          makeHeaderResponse([{ id: 2, title: 'T2', done: false, priority: 0, project_id: 1 }], 2)
        );
      expect((await client.getTasks(1)).map((t) => t.id)).toEqual([1, 2]);

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeHeaderResponse([{ id: 1, title: 'L1' }], 2))
        .mockResolvedValueOnce(makeHeaderResponse([{ id: 2, title: 'L2' }], 2));
      expect((await client.getLabels()).map((l) => l.id)).toEqual([1, 2]);

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(makeHeaderResponse([{ id: 10, name: 'TeamA' }], 2))
        .mockResolvedValueOnce(makeHeaderResponse([{ id: 11, name: 'TeamB' }], 2));
      expect((await client.getTeams()).map((t) => t.id)).toEqual([10, 11]);

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(
          makeHeaderResponse([{ id: 1, username: 'u1', permission: 1 }], 2)
        )
        .mockResolvedValueOnce(
          makeHeaderResponse([{ id: 2, username: 'u2', permission: 0 }], 2)
        );
      expect((await client.getProjectUsers(1)).map((u) => u.username)).toEqual(['u1', 'u2']);
    });
  });

  describe('Tasks API (TickTick style operations)', () => {
    beforeEach(() => {
      client.setToken('token');
    });

    it('should fetch tasks for a project (with optional explicit page & filter_by)', async () => {
      const mockTasks = [
        { id: 10, title: 'Buy groceries', done: false, priority: 2, project_id: 1 },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockTasks,
      } as Response);

      const tasks = await client.getTasks(1);
      expect(tasks).toEqual(mockTasks);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/tasks',
        expect.anything()
      );

      await client.getTasks(1, { page: 1, per_page: 25, filter_by: ['done'] });
      expect(global.fetch).toHaveBeenLastCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/tasks?filter_by=done&page=1&per_page=25',
        expect.anything()
      );
    });

    it('should fetch all tasks across projects using /tasks with explicit page', async () => {
      const allTasks = [
        { id: 10, title: 'Inbox item', done: false, priority: 1, project_id: 1 },
        { id: 20, title: 'Shopping item', done: false, priority: 2, project_id: 2 },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => allTasks,
      } as Response);

      const tasks = await client.getAllTasks({ page: 1 });
      expect(tasks).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/tasks'),
        expect.anything()
      );
    });

    it('should paginate through multiple pages when fetching all tasks without specific page', async () => {
      const page1 = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        title: `Task ${i + 1}`,
        done: false,
        priority: 0,
        project_id: 1,
      }));
      const page2 = Array.from({ length: 10 }, (_, i) => ({
        id: i + 51,
        title: `Task ${i + 51}`,
        done: false,
        priority: 0,
        project_id: 1,
      }));

      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 } as Response)
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page2 } as Response);

      const tasks = await client.getAllTasks();
      expect(tasks).toHaveLength(60);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('getAllTasks() falls back to /tasks/all ONLY on 404/405 and rethrows network/401/5xx errors', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ message: 'Not Found' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            { id: 10, title: 'Legacy All Task', done: false, priority: 0, project_id: 1 },
          ],
        } as Response);

      const legacyTasks = await client.getAllTasks();
      expect(legacyTasks).toHaveLength(1);

      const page1 = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        title: `Task ${i + 1}`,
        done: false,
        priority: 0,
        project_id: 1,
      }));
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => page1 } as Response)
        .mockRejectedValueOnce(new Error('Network dropped mid-sync'));

      await expect(client.getAllTasks()).rejects.toThrow('Network dropped mid-sync');

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'DB down' }),
      } as Response);

      await expect(client.getAllTasks()).rejects.toThrow('DB down');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should create task using PUT /projects/{id}/tasks and fetch single task using GET /tasks/{id}', async () => {
      const newTask = { title: 'Finish report', priority: 3, project_id: 1 };
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 11, ...newTask, done: false }),
      } as Response);

      const created = await client.createTask(1, newTask);
      expect(created.id).toBe(11);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/tasks',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(newTask),
        })
      );

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 11, ...newTask, done: false }),
      } as Response);
      const fetched = await client.getTask(11);
      expect(fetched.id).toBe(11);
    });

    it('should update task preserving all mutable fields and mapping color (including empty clear "") to hex_color', async () => {
      const fullTaskInput = {
        title: 'Important Meeting',
        description: 'Prepare quarterly slides',
        done: false,
        due_date: '2026-10-15T10:00:00Z',
        priority: 4,
        project_id: 2,
        color: '#ff0000',
        repeat_after: 86400,
        assignees: [{ id: 101, username: 'terahz' }],
      };

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 10, ...fullTaskInput, hex_color: '#ff0000' }),
      } as Response);

      const updated = await client.updateTask(10, fullTaskInput);
      expect(updated.id).toBe(10);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ...fullTaskInput,
            hex_color: '#ff0000',
          }),
        })
      );

      // Clearing color with empty string "" also maps hex_color: ""
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 10, title: 'Important Meeting', color: '', hex_color: '' }),
      } as Response);
      await client.updateTask(10, { title: 'Important Meeting', color: '' });
      expect(global.fetch).toHaveBeenLastCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10',
        expect.objectContaining({
          body: JSON.stringify({ title: 'Important Meeting', color: '', hex_color: '' }),
        })
      );
    });

    it('should toggle task completion with task snapshot to prevent field wiping', async () => {
      const snapshot = {
        title: 'Buy groceries',
        description: 'Apples and milk',
        priority: 2,
        project_id: 1,
        due_date: '2026-10-10T12:00:00Z',
        assignees: [{ id: 101, username: 'terahz' }],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 10, done: true, ...snapshot }),
      } as Response);

      const updated = await client.toggleTaskDone(10, true, snapshot);
      expect(updated.done).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ...snapshot,
            done: true,
          }),
        })
      );
    });

    it('should move task with task snapshot to prevent field wiping', async () => {
      const snapshot = {
        title: 'Buy groceries',
        description: 'Apples and milk',
        done: false,
        priority: 2,
        project_id: 1,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 10, ...snapshot, project_id: 5 }),
      } as Response);

      const moved = await client.moveTask(10, 5, snapshot);
      expect(moved.project_id).toBe(5);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ...snapshot,
            project_id: 5,
          }),
        })
      );
    });

    it('should set task position via dedicated /tasks/{id}/position endpoint', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ position: 2048, project_view_id: 7, task_id: 10 }),
      } as Response);

      await client.setTaskPosition(10, 7, 2048);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10/position',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ project_view_id: 7, position: 2048 }),
        })
      );
    });

    it('reorderTask fetches full task snapshot if falling back to updateTask so server fields are never wiped', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 10,
            title: 'Preserve My Fields',
            description: 'Critical notes',
            done: false,
            priority: 4,
            project_id: 2,
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: 10,
            title: 'Preserve My Fields',
            description: 'Critical notes',
            done: false,
            priority: 4,
            project_id: 2,
            position: 3000,
          }),
        } as Response);

      await client.reorderTask(10, 3000);

      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://try.vikunja.io/api/v1/tasks/10',
        expect.objectContaining({ method: 'GET' })
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://try.vikunja.io/api/v1/tasks/10',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            id: 10,
            title: 'Preserve My Fields',
            description: 'Critical notes',
            done: false,
            priority: 4,
            project_id: 2,
            position: 3000,
          }),
        })
      );
    });

    it('should delete task with DELETE /tasks/{id}', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: 'Successfully deleted.' }),
      } as Response);

      await client.deleteTask(10);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('Labels API (Vikunja Label Management & Task Association)', () => {
    beforeEach(() => {
      client.setToken('token');
    });

    it('should fetch all labels using GET /labels', async () => {
      const mockLabels = [
        { id: 1, title: 'Costco', hex_color: '#e74c3c' },
        { id: 2, title: "Trader Joe's", hex_color: '#2ecc71' },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockLabels,
      } as Response);

      const labels = await client.getLabels();
      expect(labels).toEqual(mockLabels);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/labels',
        expect.anything()
      );
    });

    it('should create a label using PUT /labels', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: 5, title: 'Produce', hex_color: '#3498db' }),
      } as Response);

      const created = await client.createLabel('Produce', '#3498db');
      expect(created.id).toBe(5);
      expect(created.title).toBe('Produce');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/labels',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ title: 'Produce', hex_color: '#3498db' }),
        })
      );
    });

    it('should associate label with task using PUT /tasks/{task_id}/labels', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: 'The label was successfully added to the task.' }),
      } as Response);

      await client.addLabelToTask(100, 5);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/100/labels',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ label_id: 5 }),
        })
      );
    });

    it('should remove label from task using DELETE /tasks/{task_id}/labels/{label_id}', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: 'The label was successfully removed from the task.' }),
      } as Response);

      await client.removeLabelFromTask(100, 5);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/100/labels/5',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('updateLabel should send POST request with updated label payload', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 4, title: 'Organic', hex_color: '22c55e' }),
      } as Response);

      const updated = await client.updateLabel(4, { title: 'Organic', hex_color: '22c55e' });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/labels/4',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'Organic', hex_color: '22c55e' }),
        })
      );
      expect(updated.title).toBe('Organic');
    });

    it('deleteLabel should send DELETE request to /labels/{id}', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: 'Label deleted' }),
      } as Response);

      await client.deleteLabel(4);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/labels/4',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('setTaskLabels() should resolve existing labels, create new ones, and attach them to task', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 100, title: 'Task 100', labels: [] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: 1, title: 'Costco' }],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'ok' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({ id: 2, title: 'Fresh Market' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'ok' }),
        } as Response);

      const synced = await client.setTaskLabels(100, [
        { id: 1, title: 'Costco' },
        { id: -99, title: 'Fresh Market' },
      ]);

      expect(synced).toEqual([
        expect.objectContaining({ id: 1, title: 'Costco' }),
        expect.objectContaining({ id: 2, title: 'Fresh Market' }),
      ]);
    });

    it('setTaskLabels() skips already-attached labels and removes labels not present in nextLabels', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ message: 'deleted' }),
      } as Response);

      const previousLabels = [
        { id: 1, title: 'Costco', hex_color: '#ff0000' },
        { id: 3, title: 'Pharmacy', hex_color: '#00ff00' },
      ];
      const nextLabels = [{ id: 1, title: 'Costco', hex_color: '#ff0000' }];

      const synced = await client.setTaskLabels(100, nextLabels, previousLabels);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/100/labels/3',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(synced).toEqual([{ id: 1, title: 'Costco', hex_color: '#ff0000' }]);
    });

    it('setTaskLabels() should remove all labels when empty array passed', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'deleted' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'deleted' }),
        } as Response);

      const previousLabels = [
        { id: 1, title: 'Costco' },
        { id: 2, title: 'Groceries' },
      ];

      const synced = await client.setTaskLabels(100, [], previousLabels);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/100/labels/1',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/100/labels/2',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(synced).toEqual([]);
    });

    it('setTaskLabels should rethrow unexpected errors so sync queue can retry', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 100, title: 'Task 100', labels: [] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: 5, title: 'Urgent' }],
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ message: 'Database failure' }),
        } as Response);

      await expect(client.setTaskLabels(100, [{ id: 5, title: 'Urgent' }])).rejects.toThrow(
        'Database failure'
      );
    });
  });

  describe('Assignees API', () => {
    beforeEach(() => {
      client.setToken('token');
    });

    it('searchUsers should query GET /users/search?s={query}', async () => {
      const mockUsers = [{ id: 1, username: 'terahz' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockUsers,
      } as Response);

      const users = await client.searchUsers('tera');
      expect(users).toEqual(mockUsers);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/users/search?s=tera',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('addAssigneeToTask should call PUT /tasks/{id}/assignees with user_id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: 'added' }),
      } as Response);

      await client.addAssigneeToTask(10, 5);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10/assignees',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ user_id: 5 }),
        })
      );
    });

    it('removeAssigneeFromTask should call DELETE /tasks/{id}/assignees/{userId}', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: 'removed' }),
      } as Response);

      await client.removeAssigneeFromTask(10, 5);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10/assignees/5',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('setTaskAssignees should remove unselected assignees and add new assignees', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'removed' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'added' }),
        } as Response);

      const previous = [
        { id: 1, username: 'terahz' },
        { id: 2, username: 'alex' },
      ];
      const next = [
        { id: 1, username: 'terahz' },
        { id: 3, username: 'bob' },
      ];

      const result = await client.setTaskAssignees(10, next, previous);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10/assignees/2',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10/assignees',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ user_id: 3 }),
        })
      );
      expect(result).toHaveLength(2);
    });

    it('setTaskAssignees resolves negative-ID usernames via searchUsers', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: 9, username: 'charlie' }],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'added' }),
        } as Response);

      const result = await client.setTaskAssignees(10, [{ id: -1, username: 'charlie' }], []);
      expect(result).toEqual([{ id: 9, username: 'charlie' }]);
    });

    it('setTaskAssignees should rethrow unexpected errors so sync queue can retry', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({ message: 'Upstream gateway error' }),
      } as Response);

      await expect(
        client.setTaskAssignees(100, [{ id: 9, username: 'charlie' }], [])
      ).rejects.toThrow('Upstream gateway error');
    });
  });

  describe('Auth Token Lifecycle, Refresh Deduplication & Error Handling', () => {
    it('should throw an error with response details on failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid token or credentials' }),
      } as Response);

      await expect(client.getCurrentUser()).rejects.toThrow('Invalid token or credentials');
    });

    it('login should request a long-lived token (long_token: true)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ token: 'long-lived-jwt-token' }),
      } as Response);

      const res = await client.login('testuser', 'secretpass');
      expect(res.token).toBe('long-lived-jwt-token');
      expect(client.getToken()).toBe('long-lived-jwt-token');
    });

    it('renewToken calls POST /user/token/refresh without Authorization header, sends Cookie on native, and rotates refreshToken', async () => {
      const onRefreshTokenUpdated = jest.fn();
      const rotatingClient = new VikunjaClient({
        baseUrl: mockBaseUrl,
        token: 'expired-short-jwt',
        refreshToken: 'rt_1',
        onRefreshTokenUpdated,
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'set-cookie'
              ? 'vikunja_refresh_token=rt_2; Path=/api/v1/user/token; Max-Age=2592000; HttpOnly; SameSite=Lax'
              : k.toLowerCase() === 'content-type'
              ? 'application/json'
              : null,
        },
        json: async () => ({ token: 'refreshed-jwt-token' }),
      } as unknown as Response);

      const res = await rotatingClient.renewToken();
      expect(res.token).toBe('refreshed-jwt-token');
      expect(rotatingClient.getToken()).toBe('refreshed-jwt-token');
      expect(rotatingClient.getRefreshToken()).toBe('rt_2');
      expect(onRefreshTokenUpdated).toHaveBeenCalledWith('rt_2');

      const [calledUrl, calledOpts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(calledUrl).toBe('https://try.vikunja.io/api/v1/user/token/refresh');
      expect(calledOpts.method).toBe('POST');
      expect(calledOpts.credentials).toBe('include');
      // MUST NOT send expired Authorization: Bearer header on /user/token/refresh!
      expect(calledOpts.headers.Authorization).toBeUndefined();
      expect(calledOpts.headers.Cookie).toBe('vikunja_refresh_token=rt_1');
    });

    it('falls back cleanly to pre-2.0 POST /user/token ONLY when /user/token/refresh returns 404 or 405', async () => {
      client.setToken('pre-v2-unexpired-jwt');
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ message: 'Not Found' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ token: 'pre-v2-renewed-jwt' }),
        } as Response);

      const res = await client.renewToken();
      expect(res.token).toBe('pre-v2-renewed-jwt');
      expect(client.getToken()).toBe('pre-v2-renewed-jwt');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
        'https://try.vikunja.io/api/v1/user/token/refresh'
      );
      expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBeUndefined();
      expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(
        'https://try.vikunja.io/api/v1/user/token'
      );
      expect((global.fetch as jest.Mock).mock.calls[1][1].headers.Authorization).toBe(
        'Bearer pre-v2-unexpired-jwt'
      );

      // When /user/token/refresh returns 401 (revoked/expired refresh token on Vikunja 2.0+), do NOT call /user/token!
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid refresh token' }),
      } as Response);
      await expect(client.renewToken()).rejects.toThrow('Invalid refresh token');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('parses JWT exp in pure JS even when globalThis.atob and Buffer are absent (Hermes safety) and parses folded Set-Cookie headers', () => {
      const expSec = 1_890_000_123;
      const jwtWithUtf8AndUrlChars = buildTestJwt({
        sub: '42',
        name: 'René 🦙 ???>>>',
        exp: expSec,
      });

      const origAtob = (globalThis as any).atob;
      const origBuffer = (globalThis as any).Buffer;
      try {
        delete (globalThis as any).atob;
        delete (globalThis as any).Buffer;

        expect(getJwtExpirationMs(jwtWithUtf8AndUrlChars)).toBe(expSec * 1000);
        expect(getJwtExpirationMs('tk_personal_token_123')).toBeNull();
        expect(getJwtExpirationMs('opaque-non-jwt')).toBeNull();
        expect(getJwtExpirationMs('')).toBeNull();
      } finally {
        (globalThis as any).atob = origAtob;
        (globalThis as any).Buffer = origBuffer;
      }

      // Multi-cookie folded header containing commas inside `Expires=Wed, ...` AND another cookie
      const foldedHeader =
        '__cf_bm=xyz123; Path=/; Expires=Wed, 23 Dec 2026 04:21:01 GMT; HttpOnly; Secure, ' +
        'other_vikunja_refresh_token=wrong_cookie; Path=/, ' +
        'vikunja_refresh_token=rt_folded_ok_99; Path=/api/v1/user/token; Expires=Fri, 22 Jan 2027 00:00:00 GMT; HttpOnly; SameSite=Lax';
      expect(
        extractRefreshTokenFromHeaders({
          get: (k: string) => (k.toLowerCase() === 'set-cookie' ? foldedHeader : null),
        })
      ).toBe('rt_folded_ok_99');

      // Node/Undici getSetCookie() array with clearing cookie followed by new cookie
      expect(
        extractRefreshTokenFromHeaders({
          getSetCookie: () => [
            'vikunja_refresh_token=; Path=/; Max-Age=0; HttpOnly',
            'vikunja_refresh_token=rt_from_array_77; Path=/api/v1/user/token; HttpOnly',
          ],
          get: () => null,
        })
      ).toBe('rt_from_array_77');
    });

    it('proactively refreshes near-expiry or expired 10-minute JWT via singleflight refreshPromise across parallel requests and rotates refresh tokens', async () => {
      const nowMs = Date.now();
      const nearExpiryJwt = buildTestJwt({ sub: '1', exp: Math.floor((nowMs + 45_000) / 1000) });
      const freshJwt1 = buildTestJwt({ sub: '1', exp: Math.floor((nowMs + 600_000) / 1000) });
      const freshJwt2 = buildTestJwt({ sub: '1', exp: Math.floor((nowMs + 1_200_000) / 1000) });

      const persistedRefreshTokens: (string | null)[] = [];
      const v2Client = new VikunjaClient({
        baseUrl: mockBaseUrl,
        token: nearExpiryJwt,
        refreshToken: 'rt_1',
        onRefreshTokenUpdated: async (rt) => {
          persistedRefreshTokens.push(rt);
        },
      });
      v2Client.onTokenRefresh = async () => {
        const res = await v2Client.renewToken();
        return res.token;
      };

      let refreshCalls = 0;
      const seenCookiesOnRefresh: (string | undefined)[] = [];
      const seenBearerOnApi: (string | undefined)[] = [];

      global.fetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
        if (url.endsWith('/user/token/refresh')) {
          refreshCalls++;
          seenCookiesOnRefresh.push(opts?.headers?.Cookie);
          expect(opts?.headers?.Authorization).toBeUndefined();
          await new Promise((r) => setTimeout(r, 15));
          const nextRt = refreshCalls === 1 ? 'rt_2' : 'rt_3';
          const nextJwt = refreshCalls === 1 ? freshJwt1 : freshJwt2;
          return {
            ok: true,
            status: 200,
            headers: {
              get: (k: string) =>
                k.toLowerCase() === 'set-cookie'
                  ? `vikunja_refresh_token=${nextRt}; Path=/api/v1/user/token; HttpOnly`
                  : 'application/json',
            },
            json: async () => ({ token: nextJwt }),
          } as unknown as Response;
        }
        seenBearerOnApi.push(opts?.headers?.Authorization);
        return {
          ok: true,
          status: 200,
          json: async () => [],
        } as Response;
      });

      // Fire 4 concurrent API requests while within 90s pre-expiry window:
      // MUST issue exactly ONE /user/token/refresh request and ZERO 401s!
      await Promise.all([
        v2Client.getProjects(),
        v2Client.getLabels(),
        v2Client.getAllTasks(),
        v2Client.getTeams(),
      ]);

      expect(refreshCalls).toBe(1);
      expect(seenCookiesOnRefresh).toEqual(['vikunja_refresh_token=rt_1']);
      expect(persistedRefreshTokens).toEqual(['rt_2']);
      expect(v2Client.getRefreshToken()).toBe('rt_2');
      expect(seenBearerOnApi.every((h) => h === `Bearer ${freshJwt1}`)).toBe(true);

      // Simulate 10 minutes passing so freshJwt1 is now expired: next refresh MUST send rotated `rt_2`, never `rt_1`!
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs + 610_000);
      try {
        await v2Client.getProjects();
        expect(refreshCalls).toBe(2);
        expect(seenCookiesOnRefresh).toEqual([
          'vikunja_refresh_token=rt_1',
          'vikunja_refresh_token=rt_2',
        ]);
        expect(v2Client.getRefreshToken()).toBe('rt_3');
        expect(v2Client.getToken()).toBe(freshJwt2);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('never sets forbidden Cookie header on Web while sending credentials: include on auth endpoints and logoutServer()', async () => {
      const { Platform } = require('react-native');
      const prevOS = Platform.OS;
      try {
        Platform.OS = 'web';
        const webClient = new VikunjaClient({
          baseUrl: mockBaseUrl,
          token: 'web-jwt',
          refreshToken: 'rt_should_be_ignored_on_web',
        });

        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          url: 'https://try.vikunja.io/api/v1/user/token/refresh',
          json: async () => ({ token: 'web-renewed-jwt' }),
        } as unknown as Response);

        await webClient.renewToken();
        const [, refreshOpts] = (global.fetch as jest.Mock).mock.calls[0];
        expect(refreshOpts.credentials).toBe('include');
        expect(refreshOpts.headers.Cookie).toBeUndefined();
        expect(refreshOpts.headers.Authorization).toBeUndefined();

        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          url: 'https://try.vikunja.io/api/v1/user/logout',
          json: async () => ({ message: 'logged out' }),
        } as unknown as Response);
        await webClient.logoutServer();
        const [logoutUrl, logoutOpts] = (global.fetch as jest.Mock).mock.calls[0];
        expect(logoutUrl).toBe('https://try.vikunja.io/api/v1/user/logout');
        expect(logoutOpts.credentials).toBe('include');
        expect(logoutOpts.headers.Cookie).toBeUndefined();
      } finally {
        Platform.OS = prevOS;
      }
    });

    it('normalizes iOS comma-folded Cookie headers in withIosRefreshCookieMerge Expo plugin so latest SecureStore refresh token wins', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const withIosRefreshCookieMerge = require('../../../plugins/withIosRefreshCookieMerge');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const appJson = require('../../../app.json');

      expect(appJson.expo.plugins).toContain('./plugins/withIosRefreshCookieMerge');
      expect(withIosRefreshCookieMerge.OBJC_INTERCEPTOR_SOURCE).toContain(
        '#import <React/RCTHTTPRequestHandler.h>'
      );
      expect(withIosRefreshCookieMerge.OBJC_INTERCEPTOR_SOURCE).toContain(
        'RCTSetCustomHTTPRequestInterceptor'
      );

      // Comma-folded iOS RCTNetworking header: NSHTTPCookieStorage `rt_old` + JS header `rt_new`
      expect(
        withIosRefreshCookieMerge.normalizeIosCookieHeader(
          'vikunja_refresh_token=rt_old,vikunja_refresh_token=rt_new'
        )
      ).toBe('vikunja_refresh_token=rt_new');

      // Preserves reverse-proxy cookies (`CF_Authorization`, `authelia_session`) with `; ` delimiter
      expect(
        withIosRefreshCookieMerge.normalizeIosCookieHeader(
          'CF_Authorization=cf_jwt_123; vikunja_refresh_token=rt_stale, vikunja_refresh_token=rt_authoritative'
        )
      ).toBe('CF_Authorization=cf_jwt_123; vikunja_refresh_token=rt_authoritative');

      // Leaves unrelated Cookie headers without vikunja_refresh_token untouched (returns null)
      expect(
        withIosRefreshCookieMerge.normalizeIosCookieHeader('CF_Authorization=cf_jwt_123')
      ).toBeNull();
    });

    it('should invoke onUnauthorized callback when API responds with 401 and no refresh handler', async () => {
      client.setToken('expired-token');
      const onUnauthorized = jest.fn();
      client.onUnauthorized = onUnauthorized;

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Token is expired' }),
      } as Response);

      await expect(client.getProjects()).rejects.toThrow('Token is expired');
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('should automatically refresh token and retry request on 401 when onTokenRefresh is provided', async () => {
      client.setToken('expired-token');
      const onUnauthorized = jest.fn();
      client.onUnauthorized = onUnauthorized;
      const onTokenRefresh = jest.fn().mockResolvedValue('fresh-new-token');
      client.onTokenRefresh = onTokenRefresh;

      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            json: async () => ({ message: 'Token is expired' }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: 1, title: 'Refreshed Project' }],
        } as Response);
      });

      const projects = await client.getProjects();
      expect(projects).toEqual([{ id: 1, title: 'Refreshed Project' }]);
      expect(onTokenRefresh).toHaveBeenCalledTimes(1);
      expect(client.getToken()).toBe('fresh-new-token');
      expect(onUnauthorized).not.toHaveBeenCalled();
    });

    it('should call onUnauthorized when onTokenRefresh fails or returns null', async () => {
      client.setToken('expired-token');
      const onUnauthorized = jest.fn();
      client.onUnauthorized = onUnauthorized;
      client.onTokenRefresh = jest.fn().mockResolvedValue(null);

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Token is expired' }),
      } as Response);

      await expect(client.getProjects()).rejects.toThrow('Token is expired');
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('deduplicates concurrent 401 refresh & onUnauthorized calls and never calls renewToken for tk_ API tokens', async () => {
      client.setToken('tk_personal_token_123');
      const onRefresh = jest.fn();
      const onUnauthorized = jest.fn();
      client.onTokenRefresh = onRefresh;
      client.onUnauthorized = onUnauthorized;

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid token' }),
      } as Response);

      await Promise.allSettled([
        client.getProjects(),
        client.getLabels(),
        client.getCurrentUser(),
      ]);

      expect(onRefresh).not.toHaveBeenCalled();
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('retries immediately if a sibling request already refreshed the JWT before 401 arrived', async () => {
      client.setToken('jwt-old');
      const onTokenRefresh = jest.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 15));
        return 'jwt-fresh';
      });
      client.onTokenRefresh = onTokenRefresh;

      global.fetch = jest.fn().mockImplementation(async (_url: string, opts: any) => {
        const auth = opts?.headers?.Authorization;
        if (auth === 'Bearer jwt-old') {
          await new Promise((r) => setTimeout(r, 5));
          return {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            json: async () => ({ message: 'Expired' }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 1, title: 'OK' }],
        } as Response;
      });

      const [p1, p2] = await Promise.all([client.getProjects(), client.getLabels()]);
      expect(p1).toHaveLength(1);
      expect(p2).toHaveLength(1);
      expect(onTokenRefresh).toHaveBeenCalledTimes(1);
    });

    it('never deadlocks if renewToken (/user/token) itself returns 401', async () => {
      client.setToken('jwt-expired');
      client.onTokenRefresh = async () => {
        const res = await client.renewToken();
        return res.token;
      };
      const onUnauthorized = jest.fn();
      client.onUnauthorized = onUnauthorized;

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Token expired beyond renewal window' }),
      } as Response);

      await expect(client.getProjects()).rejects.toThrow('Token expired beyond renewal window');
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('should abort request and throw when timeout is exceeded', async () => {
      const fastTimeoutClient = new VikunjaClient({
        baseUrl: 'https://try.vikunja.io',
        timeoutMs: 50,
      });

      global.fetch = jest.fn().mockImplementation((_url, options) => {
        return new Promise((_resolve, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      await expect(fastTimeoutClient.getProjects()).rejects.toThrow(/timed out|timeout|aborted/i);
    });
  });

  describe('Client Identification, Task Relations (Subtasks), and Saved Filters', () => {
    beforeEach(() => {
      client.setToken('token-123');
    });

    it('sends Guanaco User-Agent header on native platforms and omits it on web for CORS safety', async () => {
      const { Platform } = require('react-native');
      const originalOS = Platform.OS;

      try {
        Platform.OS = 'android';
        global.fetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);

        await client.getProjects();
        const androidHeaders = (global.fetch as jest.Mock).mock.calls[0][1].headers;
        expect(androidHeaders['User-Agent']).toMatch(/^Guanaco\/\d+\.\d+\.\d+ \(Android\)$/);

        Platform.OS = 'web';
        global.fetch = jest.fn().mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        } as Response);

        await client.getProjects();
        const webHeaders = (global.fetch as jest.Mock).mock.calls[0][1].headers;
        expect(webHeaders['User-Agent']).toBeUndefined();
      } finally {
        Platform.OS = originalOS;
      }
    });

    it('creates and deletes subtask relations via /tasks/{id}/relations endpoints', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            task_id: 10,
            other_task_id: 25,
            relation_kind: 'subtask',
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'deleted' }),
        } as Response);

      const created = await client.createTaskRelation(10, 25, 'subtask');
      expect(created).toEqual({
        task_id: 10,
        other_task_id: 25,
        relation_kind: 'subtask',
      });
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://try.vikunja.io/api/v1/tasks/10/relations',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            task_id: 10,
            other_task_id: 25,
            relation_kind: 'subtask',
          }),
        })
      );

      await client.deleteTaskRelation(10, 'subtask', 25);
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://try.vikunja.io/api/v1/tasks/10/relations/subtask/25',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('fetches saved filter tasks via list view endpoint with fallback to /projects/{id}/tasks', async () => {
      const makePageHeaders = () =>
        ({
          get: (k: string) => {
            const lower = k.toLowerCase();
            if (lower === 'content-type') return 'application/json';
            if (lower === 'x-pagination-total-pages') return '1';
            return null;
          },
        }) as any;

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: makePageHeaders(),
        json: async () => [{ id: 77, title: 'Urgent Cross-Project Task', done: false, priority: 4, project_id: 3 }],
      } as Response);

      const tasksFromView = await client.getSavedFilterTasks({
        id: -2,
        title: 'High Priority',
        views: [{ id: 19, title: 'List', project_id: -2, view_kind: 'list' }],
      });
      expect(tasksFromView).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/-2/views/19/tasks',
        expect.objectContaining({ method: 'GET' })
      );

      // Fallback to /projects/{serverId}/tasks when view endpoint returns 404
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ message: 'No view route' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: makePageHeaders(),
          json: async () => [{ id: 88, title: 'Fallback Filter Task', done: false, priority: 3, project_id: 2 }],
        } as Response);

      const fallbackTasks = await client.getSavedFilterTasks({
        id: -1000001,
        server_project_id: -1,
        is_saved_filter: true,
        title: 'First Saved Filter',
        views: [{ id: 12, title: 'List', project_id: -1, view_kind: 'list' }],
      });
      expect(fallbackTasks).toHaveLength(1);
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://try.vikunja.io/api/v1/projects/-1/tasks',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });
});
