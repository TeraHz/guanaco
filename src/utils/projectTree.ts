import { Project } from '../types/vikunja';

export interface ProjectTreeNode {
  project: Project;
  children: ProjectTreeNode[];
}

export interface FlattenedProjectNode {
  project: Project;
  depth: number;
  hasChildren: boolean;
}

/**
 * Filters projects based on archive status.
 */
export function filterProjects(
  projects: Project[],
  options?: { showArchived?: boolean }
): Project[] {
  if (!Array.isArray(projects)) return [];
  const showArchived = options?.showArchived ?? false;
  return projects.filter((p) => {
    if (!p) return false;
    if (!showArchived && p.is_archived) return false;
    return true;
  });
}

/**
 * Sorts project nodes: favorites first, then alphabetically by title always.
 */
function sortNodes(a: ProjectTreeNode, b: ProjectTreeNode): number {
  const aFav = a.project.is_favorite ? 1 : 0;
  const bFav = b.project.is_favorite ? 1 : 0;
  if (aFav !== bFav) return bFav - aFav;

  return (a.project.title || '').localeCompare(b.project.title || '', undefined, {
    sensitivity: 'base',
  });
}

/**
 * Converts a flat array of projects into a parent/child tree hierarchy.
 * Guards against self-parenting and cyclic server project graphs (e.g. 1 <-> 2)
 * so cyclic projects never cause stack overflow or silently vanish from roots.
 */
export function buildProjectTree(
  projects: Project[],
  options?: { showArchived?: boolean }
): ProjectTreeNode[] {
  const filtered = filterProjects(projects, options);
  const nodeMap = new Map<number, ProjectTreeNode>();
  const uniqueProjects: Project[] = [];

  for (const p of filtered) {
    if (!nodeMap.has(p.id)) {
      nodeMap.set(p.id, { project: p, children: [] });
      uniqueProjects.push(p);
    }
  }

  const roots: ProjectTreeNode[] = [];
  const acceptedParent = new Map<number, number>();

  const createsCycle = (childId: number, candidateParentId: number): boolean => {
    const visited = new Set<number>([childId]);
    let cur: number | undefined = candidateParentId;
    while (cur !== undefined) {
      if (visited.has(cur)) return true;
      visited.add(cur);
      cur = acceptedParent.get(cur);
    }
    return false;
  };

  for (const p of uniqueProjects) {
    const node = nodeMap.get(p.id)!;
    const parentId = p.parent_project_id || 0;

    if (
      parentId > 0 &&
      parentId !== p.id &&
      nodeMap.has(parentId) &&
      !createsCycle(p.id, parentId)
    ) {
      nodeMap.get(parentId)!.children.push(node);
      acceptedParent.set(p.id, parentId);
    } else {
      roots.push(node);
    }
  }

  const visitedSort = new Set<number>();
  const sortRecursive = (nodes: ProjectTreeNode[]) => {
    nodes.sort(sortNodes);
    for (const n of nodes) {
      if (visitedSort.has(n.project.id)) continue;
      visitedSort.add(n.project.id);
      if (n.children.length > 0) {
        sortRecursive(n.children);
      }
    }
  };

  sortRecursive(roots);
  return roots;
}

/**
 * Flattens a project tree for display with indented levels (depth).
 * Protected with `visited` set against cyclic ProjectTreeNode structures.
 */
export function flattenProjectTree(
  nodes: ProjectTreeNode[],
  depth = 0,
  visited: Set<number> = new Set<number>()
): FlattenedProjectNode[] {
  if (!Array.isArray(nodes)) return [];
  const result: FlattenedProjectNode[] = [];

  for (const node of nodes) {
    if (!node?.project || visited.has(node.project.id)) {
      continue;
    }
    visited.add(node.project.id);

    const unvisitedChildren = Array.isArray(node.children)
      ? node.children.filter((c) => c?.project && !visited.has(c.project.id))
      : [];

    result.push({
      project: node.project,
      depth,
      hasChildren: unvisitedChildren.length > 0,
    });

    if (unvisitedChildren.length > 0) {
      result.push(...flattenProjectTree(unvisitedChildren, depth + 1, visited));
    }
  }

  return result;
}

/**
 * Checks whether making `candidateParentId` the parent of `projectId` would cause a cycle.
 * Protected with `visited` set so pre-existing cycles in `projects` never cause stack overflow.
 */
export function wouldCreateProjectCycle(
  projects: Project[],
  projectId: number,
  candidateParentId?: number | null
): boolean {
  if (!candidateParentId || candidateParentId <= 0) return false;
  if (projectId === candidateParentId) return true;
  if (!Array.isArray(projects) || projects.length === 0) return false;

  const childrenMap = new Map<number, number[]>();
  const parentMap = new Map<number, number>();

  for (const p of projects) {
    if (!p) continue;
    const parent = p.parent_project_id || 0;
    if (parent > 0) {
      parentMap.set(p.id, parent);
    }
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent)!.push(p.id);
  }

  // 1. Check descendants of projectId using visited guard
  const visitedDescendants = new Set<number>([projectId]);
  const isDescendant = (parentId: number, targetId: number): boolean => {
    const directChildren = childrenMap.get(parentId) || [];
    for (const childId of directChildren) {
      if (childId === targetId) return true;
      if (visitedDescendants.has(childId)) continue;
      visitedDescendants.add(childId);
      if (isDescendant(childId, targetId)) return true;
    }
    return false;
  };

  if (isDescendant(projectId, candidateParentId)) {
    return true;
  }

  // 2. Walk ancestor chain from candidateParentId with visited guard
  const visitedAncestors = new Set<number>([projectId]);
  let cur: number | undefined = candidateParentId;
  while (cur !== undefined && cur > 0) {
    if (cur === projectId) return true;
    if (visitedAncestors.has(cur)) break;
    visitedAncestors.add(cur);
    cur = parentMap.get(cur);
  }

  return false;
}
