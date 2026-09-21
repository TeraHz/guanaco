import { VikunjaClient } from '../client';

describe('VikunjaClient', () => {
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

  describe('Base URL normalization', () => {
    it('should normalize trailing slashes and ensure api/v1 prefix', () => {
      const c1 = new VikunjaClient({ baseUrl: 'https://demo.vikunja.io/' });
      expect(c1.getBaseApiUrl()).toBe('https://demo.vikunja.io/api/v1');

      const c2 = new VikunjaClient({ baseUrl: 'https://demo.vikunja.io/api/v1/' });
      expect(c2.getBaseApiUrl()).toBe('https://demo.vikunja.io/api/v1');
    });
  });

  describe('Authentication', () => {
    it('should set and get auth token and include it in requests', async () => {
      client.setToken('test-jwt-token');
      expect(client.getToken()).toBe('test-jwt-token');

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, username: 'testuser' }),
      } as Response);

      await client.getCurrentUser();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/user',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-jwt-token',
            'Content-Type': 'application/json',
          }),
        })
      );
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
          body: JSON.stringify({ username: 'testuser', password: 'password123' }),
        })
      );
    });
  });

  describe('Projects / Lists API', () => {
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
  });

  describe('Tasks API (TickTick style operations)', () => {
    beforeEach(() => {
      client.setToken('token');
    });

    it('should fetch tasks for a project', async () => {
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
    });

    it('should fetch all tasks across projects using /tasks', async () => {
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
      // 50 items on page 1, 10 items on page 2
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
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => page1,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => page2,
        } as Response);

      const tasks = await client.getAllTasks();
      expect(tasks).toHaveLength(60);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should create task using PUT /projects/{id}/tasks', async () => {
      const newTask = { title: 'Finish report', priority: 3, project_id: 1 };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ id: 11, ...newTask, done: false }),
      } as Response);

      const created = await client.createTask(1, newTask);
      expect(created.id).toBe(11);
      expect(created.title).toBe('Finish report');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/projects/1/tasks',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(newTask),
        })
      );
    });

    it('should toggle task completion (done: true/false)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 10, done: true, title: 'Buy groceries' }),
      } as Response);

      const updated = await client.toggleTaskDone(10, true);
      expect(updated.done).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ done: true }),
        })
      );
    });

    it('should move task to another project (list)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 10, project_id: 5, title: 'Buy groceries' }),
      } as Response);

      const moved = await client.moveTask(10, 5);
      expect(moved.project_id).toBe(5);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ project_id: 5 }),
        })
      );
    });

    it('should reorder task by updating position', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 10, position: 2048, title: 'Buy groceries' }),
      } as Response);

      const reordered = await client.reorderTask(10, 2048);
      expect(reordered.position).toBe(2048);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ position: 2048 }),
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
        { id: 2, title: 'Trader Joe\'s', hex_color: '#2ecc71' },
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

    it('setTaskLabels() should resolve existing labels, create new ones, and attach them to task', async () => {
      // 1: GET /tasks/100 returns current task with no labels
      // 2: GET /labels returns existing label 'Costco' (id 1)
      // 3: PUT /tasks/100/labels for 'Costco' (id 1)
      // 4: PUT /labels to create 'Fresh Market' returns id 2
      // 5: PUT /tasks/100/labels for 'Fresh Market' (id 2)
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

      const labelsToSet = [
        { id: 1, title: 'Costco' },
        { id: -99, title: 'Fresh Market' }, // new label without server id
      ];

      const synced = await client.setTaskLabels(100, labelsToSet);
      expect(synced).toEqual([
        expect.objectContaining({ id: 1, title: 'Costco' }),
        expect.objectContaining({ id: 2, title: 'Fresh Market' }),
      ]);
    });

    it('setTaskLabels() should remove labels not present in nextLabels', async () => {
      // previousLabels has Costco (id 1) and Pharmacy (id 3)
      // nextLabels only has Costco (id 1) -> Pharmacy (id 3) must be deleted
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'deleted' }),
        } as Response) // DELETE /tasks/100/labels/3
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: 1, title: 'Costco' }],
        } as Response) // GET /labels
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'ok' }),
        } as Response); // PUT /tasks/100/labels (Costco)

      const previousLabels = [
        { id: 1, title: 'Costco' },
        { id: 3, title: 'Pharmacy' },
      ];
      const nextLabels = [{ id: 1, title: 'Costco' }];

      const synced = await client.setTaskLabels(100, nextLabels, previousLabels);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/100/labels/3',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(synced).toHaveLength(1);
      expect(synced[0].title).toBe('Costco');
    });

    it('setTaskLabels() should remove all labels when empty array passed', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'deleted' }),
        } as Response) // DELETE /tasks/100/labels/1
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'deleted' }),
        } as Response); // DELETE /tasks/100/labels/2

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
  });

  describe('Error handling', () => {
    it('should throw an error with response details on failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid token or credentials' }),
      } as Response);

      await expect(client.getCurrentUser()).rejects.toThrow('Invalid token or credentials');
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
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'removed' }),
        } as Response) // DELETE /tasks/10/assignees/2
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ message: 'added' }),
        } as Response); // PUT /tasks/10/assignees with user_id: 3

      const previous = [
        { id: 1, username: 'terahz' },
        { id: 2, username: 'alex' },
      ];
      const next = [
        { id: 1, username: 'terahz' },
        { id: 3, username: 'bob' },
      ];

      const result = await client.setTaskAssignees(10, next, previous);

      // Removed alex (id: 2)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10/assignees/2',
        expect.objectContaining({ method: 'DELETE' })
      );
      // Added bob (id: 3)
      expect(global.fetch).toHaveBeenCalledWith(
        'https://try.vikunja.io/api/v1/tasks/10/assignees',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ user_id: 3 }),
        })
      );
      expect(result).toHaveLength(2);
    });
  });
});

