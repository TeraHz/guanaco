import { NativeModules, Platform, Share } from 'react-native';
import {
  buildBackupFilename,
  createBackupPayload,
  exportBackupToSystem,
  GUANACO_BACKUP_FORMAT,
  GUANACO_BACKUP_VERSION,
  isSystemFileDialogRecentlyActive,
  MAX_BACKUP_JSON_BYTES,
  mergeBackupIntoLocalState,
  parseAndValidateBackup,
  pickBackupFileFromSystem,
  serializeLocalBackup,
} from '../localBackup';
import { ReminderRelativeTo, RepeatMode } from '../../types/vikunja';

describe('localBackup utility — serialization, strict validation, merge, and native I/O', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    jest.restoreAllMocks();
  });

  it('round-trips projects (with hierarchy, favorites, archive), labels, tasks, subtasks, reminders, recurrence, and preferences', () => {
    const rawJson = serializeLocalBackup({
      projects: [
        { id: 10, title: 'Work', hex_color: '0A84FF', is_favorite: true, is_archived: false },
        {
          id: 20,
          title: 'Q4 Launch',
          hex_color: '#FF9F0A',
          parent_project_id: 10,
          is_favorite: false,
          is_archived: false,
        },
        { id: 30, title: 'Old 2024', is_archived: true },
        { id: -5, title: 'Saved Filter Pseudo', is_saved_filter: true },
      ],
      labels: [
        { id: 5, title: 'Urgent', hex_color: 'FF453A' },
        { id: 6, title: 'urgent', hex_color: '#000000' }, // case-insensitive duplicate ignored
      ],
      tasks: [
        {
          id: 500,
          title: 'Ship v1.6',
          description: '<p>Release checklist</p>',
          done: false,
          priority: 4,
          percent_done: 0.5,
          color: '#30D158',
          project_id: 20,
          due_date: '2026-12-01T09:00:00.000Z',
          repeat_after: 604800,
          repeat_mode: RepeatMode.FromDueDate,
          reminders: [{ relative_to: ReminderRelativeTo.DueDate, relative_period: -900 }],
          labels: [{ id: 5, title: 'Urgent', hex_color: '#FF453A' }],
          related_tasks: {
            subtask: [
              { id: 501, title: 'Tag git release', done: true, priority: 2, project_id: 20 },
            ],
          },
        },
        {
          id: 501,
          title: 'Tag git release',
          done: true,
          done_at: '2026-11-24T10:00:00.000Z',
          priority: 2,
          project_id: 20,
          related_tasks: {
            parenttask: [{ id: 500, title: 'Ship v1.6', done: false, priority: 4, project_id: 20 }],
          },
        },
      ],
      preferences: {
        reenableStaples: false,
        taskItemScale: 125,
        taskItemTextScale: 150,
        themeMode: 'oled',
        languagePreference: 'bg',
        weekStartDay: 1,
        appBadgeMode: 'due_today',
      },
      now: new Date('2026-11-24T12:00:00.000Z'),
    });

    const parsed = JSON.parse(rawJson);
    expect(parsed.format).toBe(GUANACO_BACKUP_FORMAT);
    expect(parsed.version).toBe(GUANACO_BACKUP_VERSION);
    // Saved filter must be excluded from exported projects
    expect(parsed.data.projects).toHaveLength(3);

    const validated = parseAndValidateBackup(rawJson);
    expect(validated.projects).toHaveLength(3);
    const work = validated.projects.find((p) => p.title === 'Work')!;
    const q4 = validated.projects.find((p) => p.title === 'Q4 Launch')!;
    const archived = validated.projects.find((p) => p.title === 'Old 2024')!;

    expect(work.id).toBeGreaterThan(0);
    expect(work.is_favorite).toBe(true);
    expect(q4.parent_project_id).toBe(work.id);
    expect(archived.is_archived).toBe(true);

    // Labels & tasks receive clean negative local IDs so they never masquerade as synced server IDs
    expect(validated.labels).toHaveLength(1);
    expect(validated.labels[0].id).toBeLessThan(0);
    expect(validated.labels[0].hex_color).toBe('#FF453A');

    expect(validated.tasks).toHaveLength(2);
    const parentTask = validated.tasks.find((t) => t.title === 'Ship v1.6')!;
    const subTask = validated.tasks.find((t) => t.title === 'Tag git release')!;
    expect(parentTask.id).toBeLessThan(0);
    expect(subTask.id).toBeLessThan(0);
    expect(parentTask.project_id).toBe(q4.id);
    expect(parentTask.related_tasks?.subtask?.[0]?.id).toBe(subTask.id);
    expect(subTask.related_tasks?.parenttask?.[0]?.id).toBe(parentTask.id);
    expect(subTask.done).toBe(true);
    expect(validated.preferences.themeMode).toBe('oled');
    expect(validated.preferences.languagePreference).toBe('bg');
  });

  it('rejects empty, oversized, malformed, wrong-format, or future-version backups and breaks project cycles safely', () => {
    expect(() => parseAndValidateBackup('')).toThrow(/empty/i);
    expect(() => parseAndValidateBackup('x'.repeat(MAX_BACKUP_JSON_BYTES + 5))).toThrow(/10 MB/i);
    expect(() => parseAndValidateBackup('{not valid json')).toThrow(/Invalid JSON/i);
    expect(() => parseAndValidateBackup('[]')).toThrow(/root structure/i);
    expect(() =>
      parseAndValidateBackup(JSON.stringify({ format: 'other-app', projects: [], tasks: [] }))
    ).toThrow(/Unrecognized backup format/i);
    expect(() =>
      parseAndValidateBackup(
        JSON.stringify({ format: GUANACO_BACKUP_FORMAT, version: 99, data: { projects: [], tasks: [] } })
      )
    ).toThrow(/Unsupported backup version/i);

    // Cyclic parent_project_id (1 <-> 2) + orphan task referencing non-existent project 999
    const cyclicBackup = JSON.stringify({
      format: GUANACO_BACKUP_FORMAT,
      version: 1,
      data: {
        projects: [
          { id: 1, title: 'Alpha', parent_project_id: 2 },
          { id: 2, title: 'Beta', parent_project_id: 1 },
        ],
        tasks: [{ id: 88, title: 'Orphan Task', done: false, priority: 99, project_id: 999 }],
      },
    });

    const validated = parseAndValidateBackup(cyclicBackup);
    expect(validated.projects).toHaveLength(2);
    // At least one parent link must be dropped so no cycle exists
    const p1 = validated.projects[0];
    const p2 = validated.projects[1];
    expect(p1.parent_project_id === p2.id && p2.parent_project_id === p1.id).toBe(false);
    // Orphan task is safely rescued into fallback project and priority clamped to 5
    expect(validated.tasks[0].project_id).toBe(p1.id);
    expect(validated.tasks[0].priority).toBe(5);
  });

  it('merges backup into existing local state without overwriting existing tasks or colliding project/task IDs', () => {
    const existing = {
      projects: [{ id: 1, title: 'Tasks', hex_color: '#0A84FF' }],
      labels: [{ id: -1, title: 'Home', hex_color: '#30D158' }],
      tasks: [{ id: -10, title: 'Existing Local Task', done: false, priority: 1, project_id: 1 }],
    };

    const incomingRaw = serializeLocalBackup({
      projects: [
        { id: 1, title: 'tasks', hex_color: '#0A84FF' }, // matches existing 'Tasks' case-insensitively!
        { id: 2, title: 'Camping Trip', hex_color: '#FF9F0A' },
      ],
      labels: [
        { id: -1, title: 'home' }, // matches existing 'Home'
        { id: -2, title: 'Outdoor', hex_color: '#64D2FF' },
      ],
      tasks: [
        { id: -10, title: 'Imported Task In Tasks', done: false, priority: 2, project_id: 1 },
        {
          id: -11,
          title: 'Pack Tent',
          done: false,
          priority: 3,
          project_id: 2,
          labels: [{ id: -2, title: 'Outdoor' }],
          related_tasks: {
            subtask: [{ id: -12, title: 'Check tent stakes', done: false, priority: 0, project_id: 2 }],
          },
        },
        { id: -12, title: 'Check tent stakes', done: false, priority: 0, project_id: 2 },
      ],
    });

    const validated = parseAndValidateBackup(incomingRaw);
    const merged = mergeBackupIntoLocalState(existing, validated);

    // 'Tasks' was reused (id: 1) and 'Camping Trip' got id: 2
    expect(merged.projects).toHaveLength(2);
    expect(merged.projects.find((p) => p.title === 'Camping Trip')?.id).toBe(2);

    // Labels deduplicated to ['Home', 'Outdoor']
    expect(merged.labels).toHaveLength(2);

    // All 4 tasks exist with 4 distinct IDs, and Pack Tent -> Check tent stakes subtask relation is intact!
    expect(merged.tasks).toHaveLength(4);
    const uniqueIds = new Set(merged.tasks.map((t) => t.id));
    expect(uniqueIds.size).toBe(4);

    const packTent = merged.tasks.find((t) => t.title === 'Pack Tent')!;
    const checkStakes = merged.tasks.find((t) => t.title === 'Check tent stakes')!;
    expect(packTent.project_id).toBe(2);
    expect(packTent.related_tasks?.subtask?.[0]?.id).toBe(checkStakes.id);
  });

  it('uses Android SAF saveJsonDocument/openJsonDocument when available and falls back cleanly to Share.share', async () => {
    Platform.OS = 'android';
    const saveMock = jest.fn().mockResolvedValue({ status: 'saved' });
    const openMock = jest.fn().mockResolvedValue({
      status: 'loaded',
      content: JSON.stringify(
        createBackupPayload({ projects: [], tasks: [], labels: [] })
      ),
    });
    (NativeModules as any).InAppUpdate = {
      ...(NativeModules as any).InAppUpdate,
      saveJsonDocument: saveMock,
      openJsonDocument: openMock,
    };

    const fname = buildBackupFilename(new Date(2026, 10, 24));
    expect(fname).toBe('guanaco-backup-2026-11-24.json');

    const expRes = await exportBackupToSystem('{"ok":true}', fname);
    expect(expRes).toBe('saved');
    expect(saveMock).toHaveBeenCalledWith(fname, '{"ok":true}');

    const pickRes = await pickBackupFileFromSystem();
    expect(pickRes.status).toBe('loaded');
    expect(pickRes.content).toContain(GUANACO_BACKUP_FORMAT);

    // Fallback to Share.share on iOS
    Platform.OS = 'ios';
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction } as any);
    const iosRes = await exportBackupToSystem('{"ok":true}', fname);
    expect(iosRes).toBe('shared');
    expect(shareSpy).toHaveBeenCalled();

    // Android SAF write failure (SAVE_JSON_FAILED) must throw rather than silently falling back to Share
    Platform.OS = 'android';
    (NativeModules as any).InAppUpdate.saveJsonDocument = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('Disk full'), { code: 'SAVE_JSON_FAILED' }));
    await expect(exportBackupToSystem('{"ok":true}', fname)).rejects.toThrow('Disk full');

    // Android without DocumentsUI (CREATE_DOC_UNAVAILABLE) falls back to Share.share cleanly
    (NativeModules as any).InAppUpdate.saveJsonDocument = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('No SAF'), { code: 'CREATE_DOC_UNAVAILABLE' }));
    const fallbackRes = await exportBackupToSystem('{"ok":true}', fname);
    expect(fallbackRes).toBe('shared');
  });

  it('strips UTF-8 BOM, blocks excessive JSON nesting depth, reconstructs one-sided parenttask links, and defaults omitted relative_period=0', () => {
    const bomJson =
      '\uFEFF' +
      JSON.stringify({
        format: GUANACO_BACKUP_FORMAT,
        version: 1,
        data: {
          projects: [{ id: 1, title: 'Main' }],
          tasks: [
            {
              id: 10,
              title: 'Parent Only',
              done: false,
              priority: 1,
              project_id: 1,
              due_date: '2026-12-01T12:00:00.000Z',
              reminders: [{ relative_to: 'due_date' }], // omitted relative_period -> 0
            },
            {
              id: 11,
              title: 'One-Sided Child',
              done: false,
              priority: 0,
              project_id: 1,
              related_tasks: {
                parenttask: [{ id: 10, title: 'Parent Only', done: false, priority: 1, project_id: 1 }],
              },
            },
          ],
        },
      });

    const parsed = parseAndValidateBackup(bomJson);
    const parent = parsed.tasks.find((t) => t.title === 'Parent Only')!;
    const child = parsed.tasks.find((t) => t.title === 'One-Sided Child')!;
    expect(parent.reminders?.[0]).toEqual({ relative_to: 'due_date', relative_period: 0 });
    expect(parent.related_tasks?.subtask?.[0]?.id).toBe(child.id);
    expect(child.related_tasks?.parenttask?.[0]?.id).toBe(parent.id);

    // Deeply nested JSON (>64 levels) is rejected in O(N) before JSON.parse
    const deepJson = '['.repeat(80) + ']'.repeat(80);
    expect(() => parseAndValidateBackup(deepJson)).toThrow(/nesting depth/i);
  });

  it('caps SAF system-dialog biometric grace at 3 minutes even when canceled after long idle', async () => {
    Platform.OS = 'android';
    let nowVal = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowVal);

    let resolvePicker!: (val: any) => void;
    (NativeModules as any).InAppUpdate = {
      ...(NativeModules as any).InAppUpdate,
      openJsonDocument: jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePicker = resolve;
          })
      ),
    };

    const pickPromise = pickBackupFileFromSystem();
    // 20 seconds into SAF picker -> within 3m grace
    nowVal += 20_000;
    expect(isSystemFileDialogRecentlyActive(nowVal)).toBe(true);

    // 10 minutes later (> 3m cap) -> no longer active, and closing picker must NOT grant post-dialog grace
    nowVal += 10 * 60 * 1000;
    expect(isSystemFileDialogRecentlyActive(nowVal)).toBe(false);
    resolvePicker({ status: 'canceled' });
    await pickPromise;
    expect(isSystemFileDialogRecentlyActive(nowVal + 500)).toBe(false);

    nowSpy.mockRestore();
  });
});
