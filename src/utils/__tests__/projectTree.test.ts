import {
  buildProjectTree,
  flattenProjectTree,
  wouldCreateProjectCycle,
  filterProjects,
  ProjectTreeNode,
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
      expect(tree).toHaveLength(2);
      const personal = tree.find((node) => node.project.id === 1);
      expect(personal).toBeDefined();
      expect(personal?.children).toHaveLength(1);
      expect(personal?.children[0].project.id).toBe(3);
      expect(personal?.children[0].children[0].project.id).toBe(4);
    });

    it('places favorites first among siblings', () => {
      const tree = buildProjectTree(sampleProjects);
      expect(tree[0].project.id).toBe(1);
      expect(tree[1].project.id).toBe(2);
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

    it('handles self-parenting projects without vanishing or stack overflow', () => {
      const selfParented: Project[] = [
        { id: 10, title: 'Self Loop', parent_project_id: 10 },
        { id: 11, title: 'Normal', parent_project_id: 0 },
      ];
      const tree = buildProjectTree(selfParented);
      const flat = flattenProjectTree(tree);
      expect(flat.map((n) => n.project.id).sort()).toEqual([10, 11]);
    });

    it('handles 2-node and 3-node server cycles (1 <-> 2) without dropping projects or stack overflow', () => {
      const cyclicProjects: Project[] = [
        { id: 1, title: 'Alpha', parent_project_id: 2 },
        { id: 2, title: 'Beta', parent_project_id: 1 },
        { id: 3, title: 'Child of Alpha', parent_project_id: 1 },
      ];
      const tree = buildProjectTree(cyclicProjects);
      expect(tree.length).toBeGreaterThanOrEqual(1);
      const flat = flattenProjectTree(tree);
      expect(flat.map((n) => n.project.id).sort()).toEqual([1, 2, 3]);
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

    it('protects flattenProjectTree with visited set even if passed manually cyclic ProjectTreeNodes', () => {
      const nodeA: ProjectTreeNode = { project: { id: 1, title: 'A' }, children: [] };
      const nodeB: ProjectTreeNode = { project: { id: 2, title: 'B' }, children: [nodeA] };
      nodeA.children.push(nodeB);

      const flat = flattenProjectTree([nodeA]);
      expect(flat.map((f) => f.project.id)).toEqual([1, 2]);
      expect(flat[1].hasChildren).toBe(false);
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
      expect(wouldCreateProjectCycle(sampleProjects, 1, 4)).toBe(true);
      expect(wouldCreateProjectCycle(sampleProjects, 1, 3)).toBe(true);
    });

    it('returns false for safe valid parenting', () => {
      expect(wouldCreateProjectCycle(sampleProjects, 3, 2)).toBe(false);
    });

    it('never stack-overflows when the existing project list already contains a cycle', () => {
      const corruptedServerProjects: Project[] = [
        { id: 1, title: 'Cycle A', parent_project_id: 2 },
        { id: 2, title: 'Cycle B', parent_project_id: 1 },
        { id: 3, title: 'Healthy Root', parent_project_id: 0 },
      ];

      expect(() => wouldCreateProjectCycle(corruptedServerProjects, 1, 3)).not.toThrow();
      expect(wouldCreateProjectCycle(corruptedServerProjects, 1, 3)).toBe(false);
      expect(wouldCreateProjectCycle(corruptedServerProjects, 1, 2)).toBe(true);
      expect(wouldCreateProjectCycle(corruptedServerProjects, 3, 1)).toBe(false);
    });
  });
});
