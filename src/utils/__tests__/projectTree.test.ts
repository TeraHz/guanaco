import {
  buildProjectTree,
  flattenProjectTree,
  wouldCreateProjectCycle,
  filterProjects,
} from '../projectTree';
import { Project } from '../../types/vikunja';

describe('projectTree utils', () => {
  const sampleProjects: Project[] = [
    { id: 1, title: 'Personal', is_favorite: true, parent_project_id: 0 },
    { id: 2, title: 'Work', is_favorite: false, parent_project_id: 0 },
    { id: 3, title: 'Groceries', is_favorite: false, parent_project_id: 1 },
    { id: 4, title: 'Hardware Store', is_favorite: false, parent_project_id: 3 },
    { id: 5, title: 'Archived Project', is_favorite: false, is_archived: true, parent_project_id: 0 },
  ];

  describe('filterProjects', () => {
    it('filters out archived projects by default', () => {
      const active = filterProjects(sampleProjects, { showArchived: false });
      expect(active.find((p) => p.id === 5)).toBeUndefined();
      expect(active).toHaveLength(4);
    });

    it('includes archived projects when requested', () => {
      const all = filterProjects(sampleProjects, { showArchived: true });
      expect(all.find((p) => p.id === 5)).toBeDefined();
      expect(all).toHaveLength(5);
    });
  });

  describe('buildProjectTree', () => {
    it('nests child projects under their parents', () => {
      const tree = buildProjectTree(sampleProjects);
      expect(tree).toHaveLength(2); // Personal, Work (Archived is filtered by default)
      
      const personal = tree.find((node) => node.project.id === 1);
      expect(personal).toBeDefined();
      expect(personal?.children).toHaveLength(1);
      expect(personal?.children[0].project.id).toBe(3);
      expect(personal?.children[0].children[0].project.id).toBe(4);
    });

    it('places favorites first among siblings', () => {
      const tree = buildProjectTree(sampleProjects);
      expect(tree[0].project.id).toBe(1); // Personal is favorite
      expect(tree[1].project.id).toBe(2); // Work is not favorite
    });

    it('always sorts projects alphabetically by title regardless of position', () => {
      const unordered: Project[] = [
        { id: 10, title: 'Zebra', position: 1 },
        { id: 11, title: 'Apple', position: 999 },
        { id: 12, title: 'Mango', position: 50 },
      ];
      const tree = buildProjectTree(unordered);
      expect(tree.map((n) => n.project.title)).toEqual(['Apple', 'Mango', 'Zebra']);
    });
  });

  describe('flattenProjectTree', () => {
    it('flattens tree with depth property for indented rendering', () => {
      const tree = buildProjectTree(sampleProjects);
      const flat = flattenProjectTree(tree);

      expect(flat.map((item) => ({ id: item.project.id, depth: item.depth }))).toEqual([
        { id: 1, depth: 0 },
        { id: 3, depth: 1 },
        { id: 4, depth: 2 },
        { id: 2, depth: 0 },
      ]);
    });
  });

  describe('wouldCreateProjectCycle', () => {
    it('returns false when candidateParentId is 0 or undefined', () => {
      expect(wouldCreateProjectCycle(sampleProjects, 3, 0)).toBe(false);
      expect(wouldCreateProjectCycle(sampleProjects, 3, undefined)).toBe(false);
    });

    it('returns true when a project is set as its own parent', () => {
      expect(wouldCreateProjectCycle(sampleProjects, 1, 1)).toBe(true);
    });

    it('returns true when candidateParentId is a descendant of the project', () => {
      // 1 -> 3 -> 4. Setting 4 as parent of 1 creates cycle!
      expect(wouldCreateProjectCycle(sampleProjects, 1, 4)).toBe(true);
      // Setting 3 as parent of 1 creates cycle
      expect(wouldCreateProjectCycle(sampleProjects, 1, 3)).toBe(true);
    });

    it('returns false for safe valid parenting', () => {
      // Setting Work (2) as parent of Groceries (3) is safe
      expect(wouldCreateProjectCycle(sampleProjects, 3, 2)).toBe(false);
    });
  });
});
