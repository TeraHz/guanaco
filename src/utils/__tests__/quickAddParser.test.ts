import { parseQuickAdd } from '../quickAddParser';

describe('Quick Add Magic Parser', () => {
  const referenceDate = new Date('2026-09-20T10:00:00Z'); // Sunday

  describe('Skipping parsing with quotes', () => {
    it('treats text wrapped in quotes as literal title without parsing dates or flags', () => {
      const result = parseQuickAdd('"Buy milk tomorrow *urgent !3"', referenceDate);
      expect(result.title).toBe('Buy milk tomorrow *urgent !3');
      expect(result.labels).toEqual([]);
      expect(result.priority).toBeUndefined();
      expect(result.dueDate).toBeNull();
    });
  });

  describe('Labels parsing (*)', () => {
    it('extracts single-word labels with *', () => {
      const result = parseQuickAdd('Order supplies *logistics', referenceDate);
      expect(result.title).toBe('Order supplies');
      expect(result.labels).toEqual(['logistics']);
    });

    it('extracts multi-word labels with quotes *\"waiting on others\"', () => {
      const result = parseQuickAdd('Check shipment *"waiting on others" *urgent', referenceDate);
      expect(result.title).toBe('Check shipment');
      expect(result.labels).toEqual(['waiting on others', 'urgent']);
    });
  });

  describe('Assignees parsing (@)', () => {
    it('extracts assignees with @', () => {
      const result = parseQuickAdd('Finalize seating chart @david @sarah', referenceDate);
      expect(result.title).toBe('Finalize seating chart');
      expect(result.assignees).toEqual(['david', 'sarah']);
    });
  });

  describe('Project parsing (+)', () => {
    it('extracts single-word project with +', () => {
      const result = parseQuickAdd('Pay rent +Personal', referenceDate);
      expect(result.title).toBe('Pay rent');
      expect(result.projectName).toBe('Personal');
    });

    it('extracts multi-word project with +\"Office Move\"', () => {
      const result = parseQuickAdd('Moving check-in +"Office Move"', referenceDate);
      expect(result.title).toBe('Moving check-in');
      expect(result.projectName).toBe('Office Move');
    });
  });

  describe('Priority parsing (!)', () => {
    it('extracts priority from !1 to !5', () => {
      const r1 = parseQuickAdd('Fix minor typo !1', referenceDate);
      expect(r1.title).toBe('Fix minor typo');
      expect(r1.priority).toBe(1);

      const r5 = parseQuickAdd('Production outage !5', referenceDate);
      expect(r5.title).toBe('Production outage');
      expect(r5.priority).toBe(5);
    });
  });

  describe('Dates and Times parsing', () => {
    it('parses "today" as due date', () => {
      const result = parseQuickAdd('Submit report today', referenceDate);
      expect(result.title).toBe('Submit report');
      expect(result.dueDate).toMatch(/^2026-09-20/);
    });

    it('parses "tomorrow" as due date', () => {
      const result = parseQuickAdd('Call plumber tomorrow', referenceDate);
      expect(result.title).toBe('Call plumber');
      expect(result.dueDate).toMatch(/^2026-09-21/);
    });

    it('parses "tomorrow at 5pm"', () => {
      const result = parseQuickAdd('Order supplies tomorrow at 5pm', referenceDate);
      expect(result.title).toBe('Order supplies');
      expect(result.dueDate).toBeDefined();
      const date = new Date(result.dueDate!);
      expect(date.getHours()).toBe(17);
    });

    it('parses weekdays like "monday"', () => {
      const result = parseQuickAdd('Team sync monday', referenceDate);
      expect(result.title).toBe('Team sync');
      expect(result.dueDate).toBeDefined();
    });

    it('parses "in 5 days"', () => {
      const result = parseQuickAdd('Renew passport in 5 days', referenceDate);
      expect(result.title).toBe('Renew passport');
      expect(result.dueDate).toMatch(/^2026-09-25/);
    });
  });

  describe('Repeating tasks (every)', () => {
    it('parses "every day"', () => {
      const result = parseQuickAdd('Drink water every day', referenceDate);
      expect(result.title).toBe('Drink water');
      expect(result.repeatAfter).toBe(86400); // 1 day in seconds
    });

    it('parses "every week"', () => {
      const result = parseQuickAdd('Weekly review every week', referenceDate);
      expect(result.title).toBe('Weekly review');
      expect(result.repeatAfter).toBe(604800); // 7 days in seconds
    });

    it('parses "every 3 days"', () => {
      const result = parseQuickAdd('Water plants every 3 days', referenceDate);
      expect(result.title).toBe('Water plants');
      expect(result.repeatAfter).toBe(3 * 86400);
    });
  });

  describe('Putting it all together (Full Vikunja Magic)', () => {
    it('parses complex task with labels, project, priority, and date', () => {
      const result = parseQuickAdd(
        'Moving check-in +"Office Move" *urgent !3 tomorrow at 10am',
        referenceDate
      );

      expect(result.title).toBe('Moving check-in');
      expect(result.projectName).toBe('Office Move');
      expect(result.labels).toEqual(['urgent']);
      expect(result.priority).toBe(3);
      expect(result.dueDate).toBeDefined();
    });

    it('parses multiple labels and assignees', () => {
      const result = parseQuickAdd(
        'Finalize seating chart *urgent *logistics @david in 5 days',
        referenceDate
      );

      expect(result.title).toBe('Finalize seating chart');
      expect(result.labels).toEqual(['urgent', 'logistics']);
      expect(result.assignees).toEqual(['david']);
      expect(result.dueDate).toMatch(/^2026-09-25/);
    });
  });
});
