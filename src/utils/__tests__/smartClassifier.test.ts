import { isShoppingList, classifyTaskContextually, groupTasksContextually } from '../smartClassifier';
import { Task } from '../../types/vikunja';

describe('Smart Contextual Classifier', () => {
  describe('isShoppingList', () => {
    it('identifies shopping-related lists by title', () => {
      expect(isShoppingList('Groceries')).toBe(true);
      expect(isShoppingList('Weekly Shopping')).toBe(true);
      expect(isShoppingList('Supermarket Run')).toBe(true);
      expect(isShoppingList('Costco Market')).toBe(true);
      expect(isShoppingList('Pantry Restock')).toBe(true);
      expect(isShoppingList('Trader Joe\'s')).toBe(true);
      expect(isShoppingList('Седмичен пазар')).toBe(true);
      expect(isShoppingList('Пазаруване')).toBe(true);
      expect(isShoppingList('Покупки за вкъщи')).toBe(true);
      expect(isShoppingList('Хранителен магазин')).toBe(true);
    });

    it('returns false for generic task lists', () => {
      expect(isShoppingList('Work')).toBe(false);
      expect(isShoppingList('General')).toBe(false);
      expect(isShoppingList('Home Maintenance')).toBe(false);
      expect(isShoppingList('Vikunja App')).toBe(false);
      expect(isShoppingList(undefined)).toBe(false);
    });
  });

  describe('classifyTaskContextually', () => {
    it('does not allow store/task labels to override category section', () => {
      const task: Task = {
        id: 1,
        title: 'Fresh Bread',
        done: false,
        priority: 0,
        project_id: 1,
        labels: [{ id: 10, title: 'Costco' }],
      };
      // Store tags like #Costco must not override section category
      expect(classifyTaskContextually(task, 'Groceries')).toBe('General');
    });

    it('detects bracketed prefix category tags', () => {
      const task: Task = {
        id: 2,
        title: '[Deli] Sliced Turkey',
        done: false,
        priority: 0,
        project_id: 1,
      };
      expect(classifyTaskContextually(task, 'Groceries')).toBe('Deli');
    });

    it('detects colon prefix category tags', () => {
      const task: Task = {
        id: 3,
        title: 'Produce: Organic Apples',
        done: false,
        priority: 0,
        project_id: 1,
      };
      expect(classifyTaskContextually(task, 'Groceries')).toBe('Produce');
    });

    it('falls back to General if no category prefix is present', () => {
      const task: Task = {
        id: 4,
        title: 'Pick up package',
        done: false,
        priority: 0,
        project_id: 1,
      };
      expect(classifyTaskContextually(task, 'Errands')).toBe('General');
    });
  });

  describe('groupTasksContextually', () => {
    it('groups tasks into categories preserving task lists', () => {
      const tasks: Task[] = [
        { id: 1, title: '[Dairy] Milk', done: false, priority: 0, project_id: 1, labels: [{ id: 1, title: 'Costco' }] },
        { id: 2, title: '[Dairy] Cheese', done: false, priority: 0, project_id: 1, labels: [{ id: 2, title: 'Trader Joe\'s' }] },
        { id: 3, title: '[Bakery] Sourdough', done: false, priority: 0, project_id: 1 },
        { id: 4, title: 'Napkins', done: false, priority: 0, project_id: 1 },
      ];

      const grouped = groupTasksContextually(tasks, 'Groceries');
      expect(grouped.length).toBeGreaterThanOrEqual(2);

      const dairyGroup = grouped.find((g) => g.category === 'Dairy');
      expect(dairyGroup).toBeDefined();
      expect(dairyGroup?.tasks.map((t) => t.title)).toEqual(['[Dairy] Milk', '[Dairy] Cheese']);

      const bakeryGroup = grouped.find((g) => g.category === 'Bakery');
      expect(bakeryGroup).toBeDefined();
      expect(bakeryGroup?.tasks.map((t) => t.title)).toEqual(['[Bakery] Sourdough']);
    });
  });
});
