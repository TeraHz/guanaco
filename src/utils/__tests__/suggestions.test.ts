import {
  getTaskSuggestions,
  getLabelSuggestions,
  applyLabelSuggestion,
} from '../suggestions';
import { Task } from '../../types/vikunja';

describe('Suggestions Utility', () => {
  const mockDoneTasks: Task[] = [
    { id: 1, title: 'Whole Milk', done: true, priority: 1, project_id: 1 },
    { id: 2, title: 'Sourdough Bread', done: true, priority: 2, project_id: 1 },
    { id: 3, title: 'Oat Milk', done: true, priority: 0, project_id: 1 },
    { id: 4, title: 'Eggs', done: true, priority: 3, project_id: 1 },
  ];

  const mockAvailableLabels = ['Costco', 'Produce', 'TraderJoes', 'Dairy'];

  describe('Task Suggestions (from done/staple tasks)', () => {
    it('returns matching completed tasks when user types prefix', () => {
      const suggestions = getTaskSuggestions('Mil', mockDoneTasks);
      expect(suggestions.map((s) => s.title)).toEqual(['Whole Milk', 'Oat Milk']);
    });

    it('returns empty array when input is too short or no match', () => {
      expect(getTaskSuggestions('Z', mockDoneTasks)).toEqual([]);
      expect(getTaskSuggestions('', mockDoneTasks)).toEqual([]);
    });

    it('deduplicates tasks with the same title', () => {
      const duplicateTasks: Task[] = [
        ...mockDoneTasks,
        { id: 5, title: 'Whole Milk', done: true, priority: 1, project_id: 1 },
      ];
      const suggestions = getTaskSuggestions('Whole', duplicateTasks);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].title).toBe('Whole Milk');
    });
  });

  describe('Label Suggestions (*)', () => {
    it('returns all labels when input ends with *', () => {
      const suggestions = getLabelSuggestions('Buy groceries *', mockAvailableLabels);
      expect(suggestions).toEqual(['Costco', 'Produce', 'TraderJoes', 'Dairy']);
    });

    it('filters labels when typing partial label after *', () => {
      const suggestions = getLabelSuggestions('Buy apples *pro', mockAvailableLabels);
      expect(suggestions).toEqual(['Produce']);
    });

    it('returns null if input does not end with active label typing (*)', () => {
      const suggestions = getLabelSuggestions('Buy apples', mockAvailableLabels);
      expect(suggestions).toEqual([]);
    });

    it('correctly inserts label into input text with quotes if multi-word', () => {
      const res1 = applyLabelSuggestion('Buy apples *pro', 'Produce');
      expect(res1).toBe('Buy apples *Produce ');

      const res2 = applyLabelSuggestion('Buy snacks *Tra', 'Trader Joes');
      expect(res2).toBe('Buy snacks *"Trader Joes" ');
    });
  });
});
