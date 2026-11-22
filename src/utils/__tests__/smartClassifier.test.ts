import { isShoppingList, classifyTaskContextually, groupTasksContextually } from '../smartClassifier';
import { Task } from '../../types/vikunja';

describe('Smart Contextual Classifier', () => {
  describe('isShoppingList', () => {
    it('identifies shopping-related lists by title in English and Bulgarian', () => {
      expect(isShoppingList('Groceries')).toBe(true);
      expect(isShoppingList('Weekly Shopping')).toBe(true);
      expect(isShoppingList('Supermarket Run')).toBe(true);
      expect(isShoppingList('Costco Market')).toBe(true);
      expect(isShoppingList('Pantry Restock')).toBe(true);
      expect(isShoppingList("Trader Joe's")).toBe(true);
      expect(isShoppingList('Седмичен пазар')).toBe(true);
      expect(isShoppingList('Пазаруване')).toBe(true);
      expect(isShoppingList('Покупки за вкъщи')).toBe(true);
      expect(isShoppingList('Хранителен магазин')).toBe(true);
    });

    it('returns false for generic/work task lists without substring false positives', () => {
      expect(isShoppingList('Work')).toBe(false);
      expect(isShoppingList('General')).toBe(false);
      expect(isShoppingList('Home Maintenance')).toBe(false);
      expect(isShoppingList('Vikunja App')).toBe(false);
      expect(isShoppingList('Marketing Plan')).toBe(false);
      expect(isShoppingList('Design Workshop')).toBe(false);
      expect(isShoppingList('App Store Release')).toBe(false);
      expect(isShoppingList('Q4 Sales Target')).toBe(false);
      expect(isShoppingList(undefined)).toBe(false);
    });
  });

  describe('classifyTaskContextually', () => {
    const makeTask = (title: string): Task => ({
      id: 1,
      title,
      done: false,
      priority: 0,
      project_id: 1,
    });

    it('does not allow store/task labels to override category section', () => {
      const task: Task = {
        ...makeTask('Fresh Bread'),
        labels: [{ id: 10, title: 'Costco' }],
      };
      expect(classifyTaskContextually(task, 'Groceries')).toBe('General');
    });

    it('detects bracketed prefix category tags in English and Cyrillic', () => {
      expect(classifyTaskContextually(makeTask('[Deli] Sliced Turkey'), 'Groceries')).toBe('Deli');
      expect(classifyTaskContextually(makeTask('[Отдел] Пълнозърнест хляб'), 'Пазар')).toBe('Отдел');
    });

    it('detects colon prefix category tags in English and Cyrillic', () => {
      expect(classifyTaskContextually(makeTask('Produce: Organic Apples'), 'Groceries')).toBe('Produce');
      expect(classifyTaskContextually(makeTask('Млечни: Кисело мляко'), 'Пазар')).toBe('Млечни');
    });

    it('ignores email, note, and checkbox prefixes like Re:, Fwd:, Note:, TODO:, [x]', () => {
      expect(classifyTaskContextually(makeTask('Re: Quarterly budget'), 'Work')).toBe('General');
      expect(classifyTaskContextually(makeTask('Fwd: Flight itinerary'), 'Inbox')).toBe('General');
      expect(classifyTaskContextually(makeTask('Note: Ask dentist about crown'), 'Personal')).toBe('General');
      expect(classifyTaskContextually(makeTask('TODO: Refactor sync queue'), 'Dev')).toBe('General');
      expect(classifyTaskContextually(makeTask('[x] Checked item'), 'Inbox')).toBe('General');
    });

    it('falls back to General if no category prefix is present', () => {
      expect(classifyTaskContextually(makeTask('Pick up package'), 'Errands')).toBe('General');
    });
  });

  describe('groupTasksContextually', () => {
    it('groups tasks into categories preserving task lists', () => {
      const tasks: Task[] = [
        { id: 1, title: '[Dairy] Milk', done: false, priority: 0, project_id: 1, labels: [{ id: 1, title: 'Costco' }] },
        { id: 2, title: '[Dairy] Cheese', done: false, priority: 0, project_id: 1, labels: [{ id: 2, title: "Trader Joe's" }] },
        { id: 3, title: '[Bakery] Sourdough', done: false, priority: 0, project_id: 1 },
        { id: 4, title: 'Napkins', done: false, priority: 0, project_id: 1 },
      ];

      const grouped = groupTasksContextually(tasks, 'Groceries');
      const dairyGroup = grouped.find((g) => g.category === 'Dairy');
      expect(dairyGroup?.tasks.map((t) => t.title)).toEqual(['[Dairy] Milk', '[Dairy] Cheese']);

      const bakeryGroup = grouped.find((g) => g.category === 'Bakery');
      expect(bakeryGroup?.tasks.map((t) => t.title)).toEqual(['[Bakery] Sourdough']);
    });
  });
});
