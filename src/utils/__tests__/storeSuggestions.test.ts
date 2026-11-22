import { getHistoricalStoreSuggestion } from '../storeSuggestions';
import { Task, Label } from '../../types/vikunja';

describe('Historical Store Suggestions', () => {
  const costcoLabel: Label = { id: 1, title: 'Costco', hex_color: '#e74c3c' };
  const wholeFoodsLabel: Label = { id: 2, title: 'Whole Foods', hex_color: '#2ecc71' };
  const caraluzziLabel: Label = { id: 3, title: 'Caraluzzi', hex_color: '#f39c12' };
  const deletedStoreLabel: Label = { id: 99, title: 'DeletedStore', hex_color: '#999999' };

  const availableLabels: Label[] = [costcoLabel, wholeFoodsLabel, caraluzziLabel];

  const historyTasks: Task[] = [
    { id: 101, title: 'Ground beef', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 102, title: 'Beef steaks for grill', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 103, title: 'Organic beef', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 104, title: 'Frozen croissants', done: true, priority: 0, project_id: 1, labels: [wholeFoodsLabel] },
    { id: 105, title: 'Mini croissants for breakfast', done: true, priority: 0, project_id: 1, labels: [wholeFoodsLabel] },
    { id: 106, title: 'Свинско месо', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 107, title: 'Свинско за пържоли', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 108, title: 'Apples', done: true, priority: 0, project_id: 1, labels: [caraluzziLabel] },
    { id: 109, title: 'Apples', done: true, priority: 0, project_id: 1, labels: [wholeFoodsLabel] },
    { id: 110, title: 'Apples', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 111, title: 'Caviar', done: true, priority: 0, project_id: 1, labels: [wholeFoodsLabel] },
    { id: 112, title: 'Tomatoes', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 113, title: 'Sparkling Water', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 114, title: 'Shampoo', done: true, priority: 0, project_id: 1, labels: [wholeFoodsLabel] },
    { id: 115, title: 'Baby Shampoo', done: true, priority: 0, project_id: 1, labels: [wholeFoodsLabel] },
    { id: 116, title: 'Almonds', done: true, priority: 0, project_id: 1, labels: [deletedStoreLabel] },
    { id: 117, title: 'Roasted Almonds', done: true, priority: 0, project_id: 1, labels: [deletedStoreLabel] },
  ];

  it('suggests store when confidence is 100% (3/3 purchases at Costco)', () => {
    const suggestion = getHistoricalStoreSuggestion('Beef for tacos', historyTasks, availableLabels);
    expect(suggestion).not.toBeNull();
    expect(suggestion?.label.title).toBe('Costco');
    expect(suggestion?.confidence).toBe(1);
  });

  it('suggests store for Bulgarian items with descriptive phrases (Свинско за яхния)', () => {
    const suggestion = getHistoricalStoreSuggestion('Свинско за яхния', historyTasks, availableLabels);
    expect(suggestion).not.toBeNull();
    expect(suggestion?.label.title).toBe('Costco');
  });

  it('suggests Whole Foods for croissants (2/2 purchases at Whole Foods)', () => {
    const suggestion = getHistoricalStoreSuggestion('Croissants', historyTasks, availableLabels);
    expect(suggestion).not.toBeNull();
    expect(suggestion?.label.title).toBe('Whole Foods');
  });

  it('NEVER suggests deleted labels that are absent from availableLabels', () => {
    expect(getHistoricalStoreSuggestion('Almonds', historyTasks, availableLabels)).toBeNull();
    expect(getHistoricalStoreSuggestion('Beef', historyTasks, [])).toBeNull();
  });

  it('NEVER matches short words or mid-word substrings ("at" vs Tomatoes/Water, "tea" vs steaks, "ham" vs Shampoo)', () => {
    expect(getHistoricalStoreSuggestion('at', historyTasks, availableLabels)).toBeNull();
    expect(getHistoricalStoreSuggestion('to', historyTasks, availableLabels)).toBeNull();
    expect(getHistoricalStoreSuggestion('Tea', historyTasks, availableLabels)).toBeNull();
    expect(getHistoricalStoreSuggestion('Ham', historyTasks, availableLabels)).toBeNull();
  });

  it('returns null when item has been bought inconsistently (<75% confidence) or only once', () => {
    expect(getHistoricalStoreSuggestion('Apples for pie', historyTasks, availableLabels)).toBeNull();
    expect(getHistoricalStoreSuggestion('Caviar', historyTasks, availableLabels)).toBeNull();
  });

  it('returns null if user already typed a *store or #store tag', () => {
    expect(getHistoricalStoreSuggestion('Beef *TraderJoes', historyTasks, availableLabels)).toBeNull();
    expect(getHistoricalStoreSuggestion('Beef #Costco', historyTasks, availableLabels)).toBeNull();
  });

  it('returns null for empty or single-character inputs', () => {
    expect(getHistoricalStoreSuggestion('', historyTasks, availableLabels)).toBeNull();
    expect(getHistoricalStoreSuggestion('a', historyTasks, availableLabels)).toBeNull();
  });
});
