import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { CACHE_KEY_LOCAL_MODE, useTaskStore } from '../taskStore';
import { VikunjaClient } from '../../api/client';
import { RepeatMode } from '../../types/vikunja';
import { setActiveLanguagePreference } from '../../i18n';

describe('useTaskStore — Standalone Local Mode, Recurring Rollover & Backup/Restore', () => {
  beforeEach(async () => {
    setActiveLanguagePreference('en');
    await useTaskStore.getState().clearSession();
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    setActiveLanguagePreference('system');
  });

  it('seeds localized starter lists (Tasks & Groceries) on first launch and respects user-cleared lists on subsequent launches', async () => {
    await useTaskStore.getState().initializeLocalMode({ seedDefaultsIfEmpty: true });

    const state = useTaskStore.getState();
    expect(state.isLocalMode).toBe(true);
    expect(state.client).toBeNull();
    expect(state.syncQueue).toBeNull();
    expect(state.projects.map((p) => p.title)).toEqual(['Tasks', 'Groceries']);
    expect(state.selectedProjectId).toBe(1);
    expect(await AsyncStorage.getItem(CACHE_KEY_LOCAL_MODE)).toBe('true');

    // Delete both starter lists explicitly -> CACHE_KEY_PROJECTS becomes "[]"
    await useTaskStore.getState().deleteProject(1);
    await useTaskStore.getState().deleteProject(2);
    expect(useTaskStore.getState().projects).toHaveLength(0);

    // Cold reload in local mode must NOT re-seed deleted starter lists when CACHE_KEY_PROJECTS is "[]"
    await useTaskStore.getState().initializeLocalMode({ seedDefaultsIfEmpty: true });
    expect(useTaskStore.getState().projects).toHaveLength(0);
  });

  it('supports full local CRUD on lists including sub-list hierarchy, cycle prevention, archive, favorite, duplicate (with subtasks), and delete', async () => {
    await useTaskStore.getState().initializeLocalMode({ seedDefaultsIfEmpty: false });

    const parent = await useTaskStore.getState().createProject({
      title: 'Home Renovation',
      hex_color: '#FF9F0A',
      is_favorite: true,
    });
    const child = await useTaskStore.getState().createProject({
      title: 'Kitchen',
      parent_project_id: parent.id,
      hex_color: '#30D158',
    });

    expect(parent.id).toBe(1);
    expect(child.id).toBe(2);
    expect(child.parent_project_id).toBe(1);

    // Attempting to set parent's parent_project_id to its own child is ignored (cycle prevention)
    const afterCycleAttempt = await useTaskStore
      .getState()
      .updateProject(parent.id, { parent_project_id: child.id });
    expect(afterCycleAttempt.parent_project_id).toBeUndefined();

    // Add task + subtask to Kitchen, then duplicate Kitchen
    const mainTask = useTaskStore.getState().addTask({
      title: 'Install Cabinets',
      project_id: child.id,
      priority: 3,
    });
    const sub = useTaskStore.getState().addSubtask(mainTask.id, 'Level wall cleat');
    expect(sub).not.toBeNull();

    const duplicatedProj = await useTaskStore.getState().duplicateProject(child.id);
    expect(duplicatedProj.title).toBe('Kitchen (Copy)');
    const dupTasks = useTaskStore
      .getState()
      .tasks.filter((t) => t.project_id === duplicatedProj.id);
    expect(dupTasks).toHaveLength(2);
    const dupMain = dupTasks.find((t) => t.title === 'Install Cabinets')!;
    const dupSub = dupTasks.find((t) => t.title === 'Level wall cleat')!;
    expect(dupMain.related_tasks?.subtask?.[0]?.id).toBe(dupSub.id);

    // Favorite & Archive toggles work locally
    const favToggled = await useTaskStore.getState().toggleProjectFavorite(duplicatedProj.id);
    expect(favToggled.is_favorite).toBe(true);

    useTaskStore.getState().setSelectedProjectId(duplicatedProj.id);
    const archived = await useTaskStore.getState().archiveProject(duplicatedProj.id, true);
    expect(archived.is_archived).toBe(true);
    expect(useTaskStore.getState().selectedProjectId).toBeNull();

    // Deleting parent project promotes orphaned child ('Kitchen') to root (parent_project_id cleared)
    await useTaskStore.getState().deleteProject(parent.id);
    const remainingChild = useTaskStore.getState().projects.find((p) => p.id === child.id)!;
    expect(remainingChild.parent_project_id).toBeUndefined();
  });

  it('rolls recurring tasks forward in toggleTask and updateTaskDetails ONLY when in standalone Local Mode', async () => {
    await useTaskStore.getState().initializeLocalMode({ seedDefaultsIfEmpty: true });

    const tomorrowIso = new Date(Date.now() + 86400 * 1000).toISOString();
    const recurring = useTaskStore.getState().addTask({
      title: 'Pay Rent',
      project_id: 1,
      due_date: tomorrowIso,
      repeat_after: 2592000,
      repeat_mode: RepeatMode.Monthly,
      percent_done: 0.5,
    });

    // 1. Toggle in Local Mode -> stays open (done: false), percent_done reset to 0, due_date advances 1 month!
    useTaskStore.getState().toggleTask(recurring.id);
    const afterToggle = useTaskStore.getState().tasks.find((t) => t.id === recurring.id)!;
    expect(afterToggle.done).toBe(false);
    expect(afterToggle.percent_done).toBe(0);
    expect(new Date(afterToggle.due_date!).getTime()).toBeGreaterThan(
      new Date(tomorrowIso).getTime() + 20 * 86400 * 1000
    );

    // 2. Marking done via updateTaskDetails in Local Mode also rolls forward!
    const prevDueMs = new Date(afterToggle.due_date!).getTime();
    useTaskStore.getState().updateTaskDetails(recurring.id, { done: true });
    const afterDetailSave = useTaskStore.getState().tasks.find((t) => t.id === recurring.id)!;
    expect(afterDetailSave.done).toBe(false);
    expect(new Date(afterDetailSave.due_date!).getTime()).toBeGreaterThan(prevDueMs);
  });

  it('exports and imports JSON backups in both replace and merge modes while rescheduling local notifications', async () => {
    await useTaskStore.getState().initializeLocalMode({ seedDefaultsIfEmpty: true });
    await useTaskStore.getState().createGlobalLabel('Fresh', '#30D158');
    const futureDue = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    useTaskStore.getState().addTask({
      title: 'Avocados',
      project_id: 2,
      due_date: futureDue,
      reminders: [{ relative_to: 'due_date', relative_period: -900 }],
    });

    const exportedJson = useTaskStore.getState().exportBackupJson();

    // Wipe and import in 'replace' mode
    await useTaskStore.getState().clearSession();
    await useTaskStore.getState().initializeLocalMode({ seedDefaultsIfEmpty: false });
    expect(useTaskStore.getState().tasks).toHaveLength(0);

    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    const replaceStats = await useTaskStore
      .getState()
      .importLocalBackup(exportedJson, 'replace');
    expect(replaceStats).toEqual({
      importedProjects: 2,
      importedTasks: 1,
      importedLabels: 1,
    });
    expect(useTaskStore.getState().tasks[0].title).toBe('Avocados');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);

    // Import again in 'merge' mode -> matches existing lists, keeps both tasks with unique IDs!
    const mergeStats = await useTaskStore.getState().importLocalBackup(exportedJson, 'merge');
    expect(mergeStats.importedTasks).toBe(1);
    expect(useTaskStore.getState().projects).toHaveLength(2);
    expect(useTaskStore.getState().tasks).toHaveLength(2);
    expect(new Set(useTaskStore.getState().tasks.map((t) => t.id)).size).toBe(2);
  });

  it('auto-registers ad-hoc #labels into global store.labels, resets completed checklist subtasks on recurring rollover, localizes untouched starter lists, and clones nested sub-lists', async () => {
    await useTaskStore.getState().initializeLocalMode({ seedDefaultsIfEmpty: true });
    expect(useTaskStore.getState().projects.map((p) => p.title)).toEqual(['Tasks', 'Groceries']);

    // Switching language dynamically renames untouched starter lists!
    await useTaskStore.getState().setLanguagePreference('bg');
    expect(useTaskStore.getState().projects.map((p) => p.title)).toEqual([
      'Задачи',
      'Списък за пазар',
    ]);
    await useTaskStore.getState().setLanguagePreference('en');
    expect(useTaskStore.getState().projects.map((p) => p.title)).toEqual(['Tasks', 'Groceries']);

    // Ad-hoc label added via addTask is registered in store.labels and cleaned up by deleteGlobalLabel
    const taskWithAdHocLbl = useTaskStore.getState().addTask({
      title: 'Weekly Prep',
      project_id: 1,
      due_date: new Date(Date.now() + 86400 * 1000).toISOString(),
      repeat_after: 604800,
      repeat_mode: RepeatMode.FromDueDate,
      labels: [{ id: -999999, title: 'MealPrep' }],
    });
    const registeredLbl = useTaskStore
      .getState()
      .labels.find((l) => l.title.toLowerCase() === 'mealprep');
    expect(registeredLbl).toBeDefined();

    // Add checklist subtask, mark subtask done, then complete recurring parent -> subtask resets to open!
    const sub = useTaskStore.getState().addSubtask(taskWithAdHocLbl.id, 'Chop veggies')!;
    useTaskStore.getState().toggleTask(sub.id);
    expect(useTaskStore.getState().tasks.find((t) => t.id === sub.id)?.done).toBe(true);

    useTaskStore.getState().toggleTask(taskWithAdHocLbl.id);
    expect(useTaskStore.getState().tasks.find((t) => t.id === taskWithAdHocLbl.id)?.done).toBe(
      false
    );
    expect(useTaskStore.getState().tasks.find((t) => t.id === sub.id)?.done).toBe(false);

    // Deleting global label strips it from tasks cleanly
    await useTaskStore.getState().deleteGlobalLabel(registeredLbl!.id);
    expect(
      useTaskStore.getState().tasks.find((t) => t.id === taskWithAdHocLbl.id)?.labels
    ).toEqual([]);

    // Duplicating a parent list with nested sub-lists clones the entire sub-list hierarchy + tasks
    const rootList = await useTaskStore.getState().createProject({ title: 'Q1 Roadmap' });
    const subList = await useTaskStore
      .getState()
      .createProject({ title: 'Mobile App', parent_project_id: rootList.id });
    useTaskStore.getState().addTask({ title: 'Ship Offline Mode', project_id: subList.id });

    const clonedRoot = await useTaskStore.getState().duplicateProject(rootList.id);
    expect(clonedRoot.title).toBe('Q1 Roadmap (Copy)');
    const clonedSubList = useTaskStore
      .getState()
      .projects.find(
        (p) => p.parent_project_id === clonedRoot.id && p.title === 'Mobile App'
      );
    expect(clonedSubList).toBeDefined();
    expect(
      useTaskStore
        .getState()
        .tasks.some(
          (t) => t.project_id === clonedSubList!.id && t.title === 'Ship Offline Mode'
        )
    ).toBe(true);
  });

  it('preserves labels, assignees, subtasks, and reminders in Server Mode when POST /tasks/:id returns JSON null slices on recurring rollover', async () => {
    await useTaskStore.getState().initialize('https://vikunja.example.com', 'jwt_tok', null);

    const rolledDue = '2026-12-08T09:00:00.000Z';
    const updateTaskSpy = jest
      .spyOn(VikunjaClient.prototype, 'updateTask')
      .mockResolvedValue({
        id: 50,
        title: 'Weekly Sync',
        done: false,
        done_at: null,
        due_date: rolledDue,
        project_id: 1,
        priority: 2,
        // Real Vikunja Go struct serialization on POST /tasks/:id returns null for non-loaded slices
        labels: null as any,
        assignees: null as any,
        related_tasks: null as any,
        reminders: null as any,
      });

    useTaskStore.setState({
      projects: [{ id: 1, title: 'Work' }],
      labels: [{ id: 7, title: 'Ops', hex_color: '#0A84FF' }],
      tasks: [
        {
          id: 50,
          title: 'Weekly Sync',
          done: false,
          priority: 2,
          project_id: 1,
          due_date: '2026-12-01T09:00:00.000Z',
          repeat_after: 604800,
          repeat_mode: RepeatMode.FromDueDate,
          labels: [{ id: 7, title: 'Ops', hex_color: '#0A84FF' }],
          assignees: [{ id: 3, username: 'alice' }],
          reminders: [{ relative_to: 'due_date', relative_period: -900 }],
          related_tasks: {
            subtask: [{ id: 51, title: 'Prepare agenda', done: false, priority: 1, project_id: 1 }],
          },
        },
        {
          id: 51,
          title: 'Prepare agenda',
          done: false,
          priority: 1,
          project_id: 1,
        },
      ],
    });

    useTaskStore.getState().toggleTask(50);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(updateTaskSpy).toHaveBeenCalledTimes(1);
    const updated = useTaskStore.getState().tasks.find((t) => t.id === 50)!;
    // Server rolled recurring task forward to done: false & new due_date
    expect(updated.done).toBe(false);
    expect(updated.due_date).toBe(rolledDue);
    // Labels, assignees, reminders, and subtask relations were NOT wiped by JSON null!
    expect(updated.labels).toHaveLength(1);
    expect(updated.labels?.[0]?.title).toBe('Ops');
    expect(updated.assignees).toHaveLength(1);
    expect(updated.assignees?.[0]?.username).toBe('alice');
    expect(updated.reminders).toHaveLength(1);
    expect(updated.related_tasks?.subtask?.[0]?.id).toBe(51);

    updateTaskSpy.mockRestore();
  });
});
