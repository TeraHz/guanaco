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

  const mockAvailableLabels = ['Costco', 'Produce', 'TraderJoes', 'Dairy', 'Пазар', 'Млечни'];

  describe('Task Suggestions (from done/staple tasks)', () => {
    it('returns matching completed tasks when user types prefix', () => {
      const suggestions = getTaskSuggestions('Mil', mockDoneTasks);
      expect(suggestions.map((s) => s.title)).toEqual(['Whole Milk', 'Oat Milk']);
    });

    it('returns empty array when input is too short, magic token, or no match', () => {
      expect(getTaskSuggestions('Z', mockDoneTasks)).toEqual([]);
      expect(getTaskSuggestions('', mockDoneTasks)).toEqual([]);
      expect(getTaskSuggestions('#pro', mockDoneTasks)).toEqual([]);
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

  describe('Label Suggestions (* and #, Unicode/Cyrillic)', () => {
    it('returns all labels when input ends with * or #', () => {
      expect(getLabelSuggestions('Buy groceries *', mockAvailableLabels)).toEqual(
        mockAvailableLabels
      );
      expect(getLabelSuggestions('Buy groceries #', mockAvailableLabels)).toEqual(
        mockAvailableLabels
      );
    });

    it('filters labels when typing partial ASCII or Cyrillic label after * or #', () => {
      expect(getLabelSuggestions('Buy apples *pro', mockAvailableLabels)).toEqual(['Produce']);
      expect(getLabelSuggestions('Buy apples #pro', mockAvailableLabels)).toEqual(['Produce']);
      expect(getLabelSuggestions('Купи мляко #паз', mockAvailableLabels)).toEqual(['Пазар']);
      expect(getLabelSuggestions('Купи сирене *млеч', mockAvailableLabels)).toEqual(['Млечни']);
    });

    it('returns empty array if input does not end with active label typing', () => {
      expect(getLabelSuggestions('Buy apples', mockAvailableLabels)).toEqual([]);
      expect(getLabelSuggestions('2*3', mockAvailableLabels)).toEqual([]);
    });

    it('preserves * or # trigger and wraps multi-word labels in quotes', () => {
      expect(applyLabelSuggestion('Buy apples *pro', 'Produce')).toBe('Buy apples *Produce ');
      expect(applyLabelSuggestion('Buy apples #pro', 'Produce')).toBe('Buy apples #Produce ');
      expect(applyLabelSuggestion('Buy snacks *Tra', 'Trader Joes')).toBe(
        'Buy snacks *"Trader Joes" '
      );
      expect(applyLabelSuggestion('Buy snacks #Tra', 'Trader Joes')).toBe(
        'Buy snacks #"Trader Joes" '
      );
      expect(applyLabelSuggestion('Learn #c', 'C++')).toBe('Learn #"C++" ');
      expect(applyLabelSuggestion('Fix *p1', 'P1!Urgent')).toBe('Fix *"P1!Urgent" ');
      expect(applyLabelSuggestion('Купи #паз', 'Пазар')).toBe('Купи #Пазар ');
    });

    it('prioritizes last used label first', () => {
      const suggestions = getLabelSuggestions('Buy groceries #', mockAvailableLabels, 'Dairy');
      expect(suggestions[0]).toBe('Dairy');
    });
  });
});
