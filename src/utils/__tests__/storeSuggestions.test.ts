import { getHistoricalStoreSuggestion } from '../storeSuggestions';
import { Task, Label } from '../../types/vikunja';

describe('Historical Store Suggestions', () => {
  const costcoLabel: Label = { id: 1, title: 'Costco', hex_color: '#e74c3c' };
  const wholeFoodsLabel: Label = { id: 2, title: 'Whole Foods', hex_color: '#2ecc71' };
  const caraluzziLabel: Label = { id: 3, title: 'Caraluzzi', hex_color: '#f39c12' };

  const availableLabels: Label[] = [costcoLabel, wholeFoodsLabel, caraluzziLabel];

  const historyTasks: Task[] = [
    { id: 101, title: 'Ground beef', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 102, title: 'Beef steaks for grill', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 103, title: 'Organic beef', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 104, title: 'Frozen croissants', done: true, priority: 0, project_id: 1, labels: [wholeFoodsLabel] },
    { id: 105, title: 'Mini croissants for breakfast', done: true, priority: 0, project_id: 1, labels: [wholeFoodsLabel] },
    // Bulgarian examples:
    { id: 106, title: 'Свинско месо', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    { id: 107, title: 'Свинско за пържоли', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    // Inconsistent item (bought at different stores):
    { id: 108, title: 'Apples', done: true, priority: 0, project_id: 1, labels: [caraluzziLabel] },
    { id: 109, title: 'Apples', done: true, priority: 0, project_id: 1, labels: [wholeFoodsLabel] },
    { id: 110, title: 'Apples', done: true, priority: 0, project_id: 1, labels: [costcoLabel] },
    // Item bought only once:
    { id: 111, title: 'Caviar', done: true, priority: 0, project_id: 1, labels: [wholeFoodsLabel] },
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

  it('returns null when item has been bought inconsistently across different stores (<75% confidence)', () => {
    // Apples: 1 Caraluzzi, 1 Whole Foods, 1 Costco (each 33% < 75%)
    const suggestion = getHistoricalStoreSuggestion('Apples for pie', historyTasks, availableLabels);
    expect(suggestion).toBeNull();
  });

  it('returns null when item has only been bought once (< 2 purchases)', () => {
    // Caviar: only 1 purchase
    const suggestion = getHistoricalStoreSuggestion('Caviar', historyTasks, availableLabels);
    expect(suggestion).toBeNull();
  });

  it('returns null if user has already typed a label tag (*store)', () => {
    const suggestion = getHistoricalStoreSuggestion('Beef *TraderJoes', historyTasks, availableLabels);
    expect(suggestion).toBeNull();
  });

  it('returns null for empty or single-character inputs', () => {
    expect(getHistoricalStoreSuggestion('', historyTasks, availableLabels)).toBeNull();
    expect(getHistoricalStoreSuggestion('a', historyTasks, availableLabels)).toBeNull();
  });
});
