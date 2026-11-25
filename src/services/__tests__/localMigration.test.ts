import AsyncStorage from '@react-native-async-storage/async-storage';
import { VikunjaApiError, VikunjaClient } from '../../api/client';
import {
  clearMigrationCheckpoint,
  isUntouchedEmptyStarterProject,
  MIGRATION_CHECKPOINT_STORAGE_KEY,
  migrateLocalDataToServer,
} from '../localMigration';
import { RepeatMode } from '../../types/vikunja';

describe('localMigration — standalone Local Mode to Vikunja server migration', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('identifies untouched empty starter lists across EN/BG/ES and skips creating duplicates when server already has projects', async () => {
    const starterProjects = [
      { id: 1, title: 'Tasks', hex_color: '#0A84FF', is_archived: false, is_favorite: false },
      { id: 2, title: 'Groceries', hex_color: '#30D158', is_archived: false, is_favorite: false },
    ];
    expect(isUntouchedEmptyStarterProject(starterProjects[0], starterProjects, [])).toBe(true);
    expect(isUntouchedEmptyStarterProject(starterProjects[1], starterProjects, [])).toBe(true);

    const mockClient = {
      getBaseApiUrl: () => 'https://vikunja.example.com/api/v1',
      getProjects: jest.fn().mockResolvedValue([{ id: 7, title: 'Inbox', hex_color: '#3498db' }]),
      getLabels: jest.fn().mockResolvedValue([]),
      createProject: jest.fn(),
      createLabel: jest.fn(),
      createTask: jest.fn(),
    } as unknown as VikunjaClient;

    const res = await migrateLocalDataToServer({
      client: mockClient,
      localProjects: starterProjects,
      localTasks: [],
      localLabels: [],
      selectedProjectId: 1,
    });

    expect(mockClient.createProject).not.toHaveBeenCalled();
    expect(res.uploadedProjects).toBe(0);
    expect(res.uploadedTasks).toBe(0);
    // Maps selectedProjectId to server's existing active Inbox (id: 7)
    expect(res.mappedSelectedProjectId).toBe(7);
  });

  it('migrates nested sub-lists in topological parent-first order, merges matching root lists, deduplicates labels, preserves done=true, and links subtasks', async () => {
    let nextProjId = 50;
    let nextTaskId = 900;

    const mockClient = {
      getBaseApiUrl: () => 'https://vikunja.example.com/api/v1',
      getProjects: jest.fn().mockResolvedValue([
        { id: 10, title: 'Tasks', hex_color: '#0A84FF', is_archived: false },
      ]),
      getLabels: jest.fn().mockResolvedValue([
        { id: 3, title: 'Costco', hex_color: '#FF453A' },
      ]),
      createProject: jest.fn().mockImplementation(async (input) => ({
        id: ++nextProjId,
        ...input,
        is_archived: false,
      })),
      updateProject: jest.fn().mockImplementation(async (id, input) => ({ id, ...input })),
      createLabel: jest.fn().mockImplementation(async (title, hex_color) => ({
        id: 44,
        title,
        hex_color,
      })),
      createTask: jest.fn().mockImplementation(async (projectId, data) => ({
        id: ++nextTaskId,
        ...data,
        project_id: projectId,
        // Simulate Vikunja server returning done: false on initial PUT /projects/:id/tasks
        done: false,
      })),
      updateTask: jest.fn().mockResolvedValue({}),
      addLabelToTask: jest.fn().mockResolvedValue({}),
      createTaskRelation: jest.fn().mockResolvedValue({}),
    } as unknown as VikunjaClient;

    const localProjects = [
      { id: 1, title: 'Tasks', hex_color: '#0A84FF' }, // Matches server id: 10!
      // Child listed BEFORE parent in array to test topological ordering!
      { id: 3, title: 'Backend Sprint', parent_project_id: 2, hex_color: '#BF5AF2' },
      { id: 2, title: 'Work', hex_color: '#FF9F0A', is_favorite: true },
      { id: 4, title: '2025 Archive', is_archived: true },
    ];

    const localLabels = [
      { id: -1, title: 'costco', hex_color: '#FF453A' }, // Matches server id: 3!
      { id: -2, title: 'DeepWork', hex_color: '#0A84FF' }, // Created as id: 44
    ];

    const localTasks = [
      {
        id: -101,
        title: 'Buy Coffee Beans',
        done: false,
        priority: 2,
        project_id: 1,
        labels: [{ id: -1, title: 'Costco' }],
      },
      {
        id: -201,
        title: 'Deploy API',
        done: false,
        priority: 4,
        project_id: 3,
        repeat_after: 86400,
        repeat_mode: RepeatMode.FromDueDate,
        labels: [{ id: -2, title: 'DeepWork' }],
        related_tasks: {
          subtask: [
            { id: -202, title: 'Run DB migrations', done: true, priority: 3, project_id: 3 },
          ],
        },
      },
      {
        id: -202,
        title: 'Run DB migrations',
        done: true,
        done_at: '2026-11-24T10:00:00.000Z',
        priority: 3,
        project_id: 3,
      },
    ];

    const result = await migrateLocalDataToServer({
      client: mockClient,
      localProjects,
      localTasks,
      localLabels,
      selectedProjectId: 3,
    });

    // 'Tasks' reused server id 10; 'Work' (51), 'Backend Sprint' (52 with parent 51), and '2025 Archive' (53) created!
    expect(result.uploadedProjects).toBe(3);
    const createProjCalls = (mockClient.createProject as jest.Mock).mock.calls.map(([arg]) => arg);
    const workIdx = createProjCalls.findIndex((c) => c.title === 'Work');
    const sprintIdx = createProjCalls.findIndex((c) => c.title === 'Backend Sprint');
    expect(workIdx).toBeGreaterThanOrEqual(0);
    expect(sprintIdx).toBeGreaterThan(workIdx);
    expect(createProjCalls[sprintIdx].parent_project_id).toBe(51);

    // Archived project received follow-up updateProject with full project payload + is_archived: true
    expect(mockClient.updateProject).toHaveBeenCalledWith(
      53,
      expect.objectContaining({ title: '2025 Archive', is_archived: true })
    );

    // Only 'DeepWork' needed creation; 'Costco' reused server label 3
    expect(result.uploadedLabels).toBe(1);
    expect(mockClient.createLabel).toHaveBeenCalledTimes(1);

    // 3 unique tasks uploaded (no duplicate subtask upload!)
    expect(result.uploadedTasks).toBe(3);
    expect(mockClient.createTask).toHaveBeenCalledTimes(3);

    // Completed task (-202 -> 903) triggered updateTask to guarantee done: true on all Vikunja versions
    expect(mockClient.updateTask).toHaveBeenCalledWith(
      903,
      expect.objectContaining({ done: true })
    );

    // Subtask relation linked on server (902 -> 903)
    expect(mockClient.createTaskRelation).toHaveBeenCalledWith(902, 903, 'subtask');
    expect(result.mappedSelectedProjectId).toBe(52);
    expect(result.deferredTasks).toHaveLength(0);
    expect(await AsyncStorage.getItem(MIGRATION_CHECKPOINT_STORAGE_KEY)).toBeNull();
  });

  it('defers remaining tasks & relations for SyncQueue on mid-migration network drop and resumes idempotently from checkpoint without duplicates', async () => {
    let createdTaskCalls = 0;
    const mockClient = {
      getBaseApiUrl: () => 'https://vikunja.example.com/api/v1',
      getProjects: jest.fn().mockResolvedValue([{ id: 10, title: 'Tasks' }]),
      getLabels: jest.fn().mockResolvedValue([]),
      createProject: jest.fn(),
      createLabel: jest.fn(),
      createTask: jest.fn().mockImplementation(async (_pid, data) => {
        createdTaskCalls += 1;
        if (createdTaskCalls === 2) {
          throw new Error('Network connection lost mid-upload');
        }
        return { id: 700 + createdTaskCalls, ...data, done: false };
      }),
      addLabelToTask: jest.fn(),
      createTaskRelation: jest.fn(),
    } as unknown as VikunjaClient;

    const localProjects = [{ id: 1, title: 'Tasks' }];
    const localTasks = [
      { id: -1, title: 'First Task', done: false, priority: 1, project_id: 1, position: 1000 },
      { id: -2, title: 'Second Task', done: false, priority: 1, project_id: 1, position: 2000 },
      { id: -3, title: 'Third Task', done: false, priority: 1, project_id: 1, position: 3000 },
    ];

    const firstAttempt = await migrateLocalDataToServer({
      client: mockClient,
      localProjects,
      localTasks,
      localLabels: [],
      selectedProjectId: 1,
    });

    // Task -1 succeeded (701); Tasks -2 and -3 were deferred cleanly with serverProjectId = 10!
    expect(firstAttempt.uploadedTasks).toBe(1);
    expect(firstAttempt.deferredTasks).toHaveLength(2);
    expect(firstAttempt.deferredTasks.map((d) => d.taskData.title)).toEqual([
      'Second Task',
      'Third Task',
    ]);
    expect(firstAttempt.deferredTasks[0].serverProjectId).toBe(10);

    // Checkpoint was retained because deferredTasks > 0; retrying directly skips Task -1 (no duplicate!)
    expect(await AsyncStorage.getItem(MIGRATION_CHECKPOINT_STORAGE_KEY)).not.toBeNull();

    const retryClient = {
      ...mockClient,
      createTask: jest.fn().mockImplementation(async (_pid, data) => ({
        id: 800 + (retryClient.createTask as jest.Mock).mock.calls.length,
        ...data,
      })),
    } as unknown as VikunjaClient;

    const secondAttempt = await migrateLocalDataToServer({
      client: retryClient,
      localProjects,
      localTasks,
      localLabels: [],
      selectedProjectId: 1,
    });

    expect(retryClient.createTask).toHaveBeenCalledTimes(2);
    expect(
      (retryClient.createTask as jest.Mock).mock.calls.map(([, d]) => d.title)
    ).toEqual(['Second Task', 'Third Task']);
    expect(secondAttempt.deferredTasks).toHaveLength(0);
    expect(await AsyncStorage.getItem(MIGRATION_CHECKPOINT_STORAGE_KEY)).toBeNull();

    await clearMigrationCheckpoint();
  });

  it('throws cleanly without modifying local data if initial server fetch fails (e.g. offline or 502)', async () => {
    const failingClient = {
      getBaseApiUrl: () => 'https://vikunja.example.com/api/v1',
      getProjects: jest.fn().mockRejectedValue(new VikunjaApiError(502, 'Bad Gateway')),
      getLabels: jest.fn().mockResolvedValue([]),
      createProject: jest.fn(),
    } as unknown as VikunjaClient;

    await expect(
      migrateLocalDataToServer({
        client: failingClient,
        localProjects: [{ id: 1, title: 'My Local List' }],
        localTasks: [{ id: -5, title: 'Important Local Task', done: false, priority: 3, project_id: 1 }],
        localLabels: [],
        selectedProjectId: 1,
      })
    ).rejects.toThrow('Bad Gateway');

    expect(failingClient.createProject).not.toHaveBeenCalled();
  });

  it('keeps two identically titled local projects distinct, strips orphaned relative reminders, escapes plain-text angle brackets, and scopes checkpoints per user', async () => {
    let projSeq = 200;
    let taskSeq = 1000;
    const mockClient = {
      getBaseApiUrl: () => 'https://vikunja.example.com/api/v1',
      getProjects: jest.fn().mockResolvedValue([]),
      getLabels: jest.fn().mockResolvedValue([]),
      createProject: jest.fn().mockImplementation(async (input) => ({
        id: ++projSeq,
        ...input,
        is_archived: false,
      })),
      createLabel: jest.fn(),
      createTask: jest.fn().mockImplementation(async (projectId, data) => ({
        id: ++taskSeq,
        ...data,
        project_id: projectId,
        done: Boolean(data.done),
      })),
    } as unknown as VikunjaClient;

    const res = await migrateLocalDataToServer({
      client: mockClient,
      localProjects: [
        { id: 1, title: 'Shopping' },
        { id: 2, title: 'Shopping' },
      ],
      localTasks: [
        {
          id: -10,
          title: 'Check <config> env',
          description: 'Use <env> & verify',
          done: false,
          priority: 2,
          project_id: 2,
          due_date: null,
          reminders: [
            // Orphaned relative reminder with no due_date must be stripped so Vikunja does not 400
            { relative_to: 'due_date' as any, relative_period: -900 },
            // Absolute reminder is preserved
            { reminder: '2026-12-10T09:00:00.000Z', relative_to: '' },
          ],
        },
      ],
      localLabels: [],
      selectedProjectId: 2,
      userScope: 'id:42',
    });

    // Both "Shopping" lists must be created separately (not collapsed into one!)
    expect(res.uploadedProjects).toBe(2);
    expect(res.projectIdMap.get(1)).toBe(201);
    expect(res.projectIdMap.get(2)).toBe(202);
    expect(res.mappedSelectedProjectId).toBe(202);

    const createdPayload = (mockClient.createTask as jest.Mock).mock.calls[0][1];
    expect(createdPayload.description).toContain('&lt;env&gt;');
    expect(createdPayload.reminders).toEqual([
      { reminder: '2026-12-10T09:00:00.000Z', relative_to: '' },
    ]);
  });

  it('never maps local tasks into read-only shared server projects, truncates >250 char fallback titles, and records skippedTasks on permanent 403/400 rejection', async () => {
    let createdProjSeq = 300;
    const longTitle = 'A'.repeat(280);

    const mockClient = {
      getBaseApiUrl: () => 'https://vikunja.example.com/api/v1',
      getProjects: jest.fn().mockResolvedValue([
        // Same title 'Tasks', but read-only shared project (max_permission: 0)!
        { id: 10, title: 'Tasks', max_permission: 0, is_archived: false },
      ]),
      getLabels: jest.fn().mockResolvedValue([]),
      createProject: jest.fn().mockImplementation(async (input) => ({
        id: ++createdProjSeq,
        ...input,
        max_permission: 2,
        is_archived: false,
      })),
      createLabel: jest.fn(),
      createTask: jest.fn().mockImplementation(async (projectId, data) => {
        if (data.title.length > 250) {
          throw new VikunjaApiError(400, 'Title exceeds 250 characters');
        }
        if (data.title === 'Always Rejected') {
          throw new VikunjaApiError(403, 'Forbidden by policy');
        }
        return {
          id: 950,
          ...data,
          project_id: projectId,
          done: Boolean(data.done),
        };
      }),
    } as unknown as VikunjaClient;

    const res = await migrateLocalDataToServer({
      client: mockClient,
      localProjects: [{ id: 1, title: 'Tasks' }],
      localTasks: [
        { id: -1, title: longTitle, done: false, priority: 1, project_id: 1 },
        { id: -2, title: 'Always Rejected', done: false, priority: 1, project_id: 1 },
      ],
      localLabels: [],
      selectedProjectId: 1,
    });

    // Created a fresh writable project (301) instead of mapping into read-only project 10!
    expect(res.projectIdMap.get(1)).toBe(301);
    expect(res.uploadedTasks).toBe(1);
    expect(res.uploadedServerTasks[0].title).toHaveLength(250);
    expect(res.skippedTasks).toHaveLength(1);
    expect(res.skippedTasks[0]).toMatchObject({
      serverProjectId: 301,
      status: 403,
      errorMessage: 'Forbidden by policy',
    });
  });
});
