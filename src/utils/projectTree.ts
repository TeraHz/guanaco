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
  const showArchived = options?.showArchived ?? false;
  return projects.filter((p) => {
    if (!showArchived && p.is_archived) return false;
    return true;
  });
}

/**
 * Sorts project nodes: favorites first, then by position or title.
 */
function sortNodes(a: ProjectTreeNode, b: ProjectTreeNode): number {
  const aFav = a.project.is_favorite ? 1 : 0;
  const bFav = b.project.is_favorite ? 1 : 0;
  if (aFav !== bFav) return bFav - aFav;

  const aPos = a.project.position ?? 0;
  const bPos = b.project.position ?? 0;
  if (aPos !== bPos) return aPos - bPos;

  return (a.project.title || '').localeCompare(b.project.title || '');
}

/**
 * Converts a flat array of projects into a parent/child tree hierarchy.
 */
export function buildProjectTree(
  projects: Project[],
  options?: { showArchived?: boolean }
): ProjectTreeNode[] {
  const filtered = filterProjects(projects, options);
  const nodeMap = new Map<number, ProjectTreeNode>();

  filtered.forEach((p) => {
    nodeMap.set(p.id, { project: p, children: [] });
  });

  const roots: ProjectTreeNode[] = [];

  filtered.forEach((p) => {
    const node = nodeMap.get(p.id)!;
    const parentId = p.parent_project_id || 0;

    if (parentId > 0 && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortRecursive = (nodes: ProjectTreeNode[]) => {
    nodes.sort(sortNodes);
    nodes.forEach((n) => sortRecursive(n.children));
  };

  sortRecursive(roots);
  return roots;
}

/**
 * Flattens a project tree for display with indented levels (depth).
 */
export function flattenProjectTree(
  nodes: ProjectTreeNode[],
  depth = 0
): FlattenedProjectNode[] {
  const result: FlattenedProjectNode[] = [];

  for (const node of nodes) {
    result.push({
      project: node.project,
      depth,
      hasChildren: node.children.length > 0,
    });
    if (node.children.length > 0) {
      result.push(...flattenProjectTree(node.children, depth + 1));
    }
  }

  return result;
}

/**
 * Checks whether making `candidateParentId` the parent of `projectId` would cause a cycle.
 */
export function wouldCreateProjectCycle(
  projects: Project[],
  projectId: number,
  candidateParentId?: number | null
): boolean {
  if (!candidateParentId || candidateParentId <= 0) return false;
  if (projectId === candidateParentId) return true;

  // Find all descendants of projectId
  const projectMap = new Map<number, Project>(projects.map((p) => [p.id, p]));
  const childrenMap = new Map<number, number[]>();

  projects.forEach((p) => {
    const parent = p.parent_project_id || 0;
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent)!.push(p.id);
  });

  const isDescendant = (parentId: number, targetId: number): boolean => {
    const directChildren = childrenMap.get(parentId) || [];
    for (const childId of directChildren) {
      if (childId === targetId) return true;
      if (isDescendant(childId, targetId)) return true;
    }
    return false;
  };

  return isDescendant(projectId, candidateParentId);
}
