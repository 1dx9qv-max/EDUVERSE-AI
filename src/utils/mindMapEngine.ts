import type { TutorLanguage } from '../types/ai.ts';
import type {
  MindMapCrossLink,
  MindMapDocument,
  MindMapGenerateRequest,
  MindMapNode,
  MindMapNodeCategory,
} from '../types/phase3.ts';
import { normalizeLanguageForTutor, sanitizeFirestoreId } from './aiValidation.ts';

export const MAX_MINDMAP_NODES = 60;
export const MAX_MINDMAP_CROSSLINKS = 20;

export function validateMindMapGenerateRequest(payload: Partial<MindMapGenerateRequest>): {
  valid: boolean;
  error?: string;
  sanitized?: MindMapGenerateRequest;
} {
  const topic = (payload.topic || '').trim().slice(0, 200);
  const subject = (payload.subject || '').trim().slice(0, 100);
  const classGrade = (payload.classGrade || 'Class 10').trim().slice(0, 30);
  const board = (payload.board || 'CBSE').trim().slice(0, 32);
  const language: TutorLanguage = normalizeLanguageForTutor(payload.language);
  const chapterContext = (payload.chapterContext || '').trim().slice(0, 500);

  if (!topic || topic.length < 2) {
    return {
      valid: false,
      error: 'Please enter a chapter name or topic (at least 2 characters) to generate a mind map.',
    };
  }
  if (!subject) {
    return {
      valid: false,
      error: 'Please select a subject before generating a mind map.',
    };
  }

  return {
    valid: true,
    sanitized: {
      topic,
      subject,
      classGrade,
      board,
      language,
      chapterContext: chapterContext || undefined,
    },
  };
}

const VALID_CATEGORIES: MindMapNodeCategory[] = ['root', 'pillar', 'concept', 'formula', 'example'];

export function normalizeMindMapNodes(rawNodes: MindMapNode[], fallbackTitle = 'Chapter Overview'): MindMapNode[] {
  const seenIds = new Set<string>();
  const cleaned: MindMapNode[] = [];

  for (let i = 0; i < Math.min(rawNodes.length, MAX_MINDMAP_NODES); i++) {
    const raw = rawNodes[i];
    if (!raw || typeof raw.label !== 'string') continue;
    let id = sanitizeFirestoreId(raw.id || `node_${i + 1}`);
    if (seenIds.has(id)) {
      id = `${id}_${i + 1}`;
    }
    seenIds.add(id);
    const category: MindMapNodeCategory = VALID_CATEGORIES.includes(raw.category)
      ? raw.category
      : i === 0
        ? 'root'
        : 'concept';

    const rawParent = typeof raw.parentId === 'string' ? raw.parentId.trim() : '';
    const normalizedParent =
      !rawParent || rawParent.toLowerCase() === 'null' || rawParent.toLowerCase() === 'none'
        ? null
        : sanitizeFirestoreId(rawParent);

    cleaned.push({
      id,
      parentId: normalizedParent,
      label: raw.label.trim().slice(0, 90) || `Concept ${i + 1}`,
      hindiLabel: typeof raw.hindiLabel === 'string' && raw.hindiLabel.trim()
        ? raw.hindiLabel.trim().slice(0, 90)
        : undefined,
      relationshipLabel: typeof raw.relationshipLabel === 'string' && raw.relationshipLabel.trim()
        ? raw.relationshipLabel.trim().slice(0, 48)
        : undefined,
      note: (raw.note || '').trim().slice(0, 360),
      category,
      collapsed: Boolean(raw.collapsed),
    });
  }

  if (cleaned.length === 0) {
    return [
      {
        id: 'root',
        parentId: null,
        label: fallbackTitle.slice(0, 90),
        note: 'Central chapter concept node',
        category: 'root',
        collapsed: false,
      },
    ];
  }

  // Ensure exact root exists and no dangling parentId references break tree layout
  const hasRoot = cleaned.some((n) => n.parentId === null);
  if (!hasRoot) {
    cleaned[0].parentId = null;
    cleaned[0].category = 'root';
  }
  const rootId = cleaned.find((n) => n.parentId === null)!.id;
  const idSet = new Set(cleaned.map((n) => n.id));

  return cleaned.map((node) => {
    if (node.id === rootId) {
      return { ...node, parentId: null, category: 'root' };
    }
    if (!node.parentId || !idSet.has(node.parentId) || node.parentId === node.id) {
      return { ...node, parentId: rootId };
    }
    return node;
  });
}

export function sanitizeMindMapForStorage(doc: MindMapDocument): MindMapDocument {
  const nodes = normalizeMindMapNodes(doc.nodes || [], doc.topic || doc.title);
  const validNodeIds = new Set(nodes.map((n) => n.id));
  const crossLinks: MindMapCrossLink[] = (doc.crossLinks || [])
    .filter(
      (link) =>
        link &&
        validNodeIds.has(link.fromId) &&
        validNodeIds.has(link.toId) &&
        link.fromId !== link.toId &&
        typeof link.label === 'string' &&
        link.label.trim().length > 0
    )
    .slice(0, MAX_MINDMAP_CROSSLINKS)
    .map((link, idx) => ({
      id: sanitizeFirestoreId(link.id || `xlink_${idx + 1}`),
      fromId: link.fromId,
      toId: link.toId,
      label: link.label.trim().slice(0, 60),
    }));

  const now = new Date().toISOString();
  return {
    id: sanitizeFirestoreId(doc.id || `map_${Date.now()}`),
    userId: sanitizeFirestoreId(doc.userId || 'user_unassigned'),
    title: (doc.title || doc.topic || 'Concept Mind Map').trim().slice(0, 200),
    topic: (doc.topic || doc.title || 'Core Topic').trim().slice(0, 200),
    subject: (doc.subject || 'Science').trim().slice(0, 100),
    classGrade: (doc.classGrade || 'Class 10').trim().slice(0, 30),
    board: (doc.board || 'CBSE').trim().slice(0, 32),
    language: normalizeLanguageForTutor(doc.language),
    syllabusStatus:
      doc.syllabusStatus === 'verified' || doc.syllabusStatus === 'sample'
        ? doc.syllabusStatus
        : 'custom',
    summary: (doc.summary || '').trim().slice(0, 1000),
    syllabusNote: (doc.syllabusNote || '').trim().slice(0, 600),
    nodes,
    crossLinks,
    createdAt: doc.createdAt || now,
    updatedAt: doc.updatedAt || now,
  };
}

export function addChildNode(
  nodes: MindMapNode[],
  parentId: string,
  label: string,
  relationshipLabel = 'includes',
  category: MindMapNodeCategory = 'concept',
  note = ''
): { nodes: MindMapNode[]; createdId: string | null } {
  if (nodes.length >= MAX_MINDMAP_NODES) {
    return { nodes, createdId: null };
  }
  const cleanLabel = label.trim().slice(0, 90);
  if (!cleanLabel) return { nodes, createdId: null };
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent) return { nodes, createdId: null };

  const createdId = sanitizeFirestoreId(`node_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
  const nextNodes = nodes.map((n) => (n.id === parentId ? { ...n, collapsed: false } : n));
  nextNodes.push({
    id: createdId,
    parentId,
    label: cleanLabel,
    relationshipLabel: relationshipLabel.trim().slice(0, 48) || undefined,
    note: note.trim().slice(0, 360),
    category: category === 'root' ? 'concept' : category,
    collapsed: false,
  });

  return { nodes: nextNodes, createdId };
}

/**
 * Inserts a new Parent Node immediately above targetNode (or if target is root, adds a top-level pillar parent).
 */
export function addParentBranchNode(
  nodes: MindMapNode[],
  targetNodeId: string,
  label: string,
  relationshipLabel = 'organizes'
): { nodes: MindMapNode[]; createdId: string | null } {
  if (nodes.length >= MAX_MINDMAP_NODES) {
    return { nodes, createdId: null };
  }
  const cleanLabel = label.trim().slice(0, 90);
  if (!cleanLabel) return { nodes, createdId: null };

  const target = nodes.find((n) => n.id === targetNodeId);
  if (!target) return { nodes, createdId: null };

  const createdId = sanitizeFirestoreId(`parent_${Date.now()}_${Math.floor(Math.random() * 1000)}`);

  // If targeting root, create a top-level pillar under root (cannot displace root node)
  if (target.parentId === null) {
    return {
      nodes: [
        ...nodes.map((n) => (n.id === target.id ? { ...n, collapsed: false } : n)),
        {
          id: createdId,
          parentId: target.id,
          label: cleanLabel,
          relationshipLabel: relationshipLabel.trim().slice(0, 48) || 'branch',
          note: '',
          category: 'pillar',
          collapsed: false,
        },
      ],
      createdId,
    };
  }

  // Wrap non-root node under the new intermediate parent
  const nextNodes: MindMapNode[] = nodes.map((n) =>
    n.id === target.id ? { ...n, parentId: createdId } : n
  );
  nextNodes.push({
    id: createdId,
    parentId: target.parentId,
    label: cleanLabel,
    relationshipLabel: relationshipLabel.trim().slice(0, 48) || 'groups',
    note: '',
    category: target.category === 'pillar' ? 'pillar' : 'concept',
    collapsed: false,
  });

  return { nodes: nextNodes, createdId };
}

export function editNodeDetails(
  nodes: MindMapNode[],
  nodeId: string,
  patch: Partial<Pick<MindMapNode, 'label' | 'hindiLabel' | 'relationshipLabel' | 'note' | 'category'>>
): MindMapNode[] {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node;
    const nextLabel = typeof patch.label === 'string' && patch.label.trim()
      ? patch.label.trim().slice(0, 90)
      : node.label;
    return {
      ...node,
      label: nextLabel,
      hindiLabel: patch.hindiLabel !== undefined
        ? patch.hindiLabel.trim().slice(0, 90) || undefined
        : node.hindiLabel,
      relationshipLabel:
        node.parentId === null
          ? undefined
          : patch.relationshipLabel !== undefined
            ? patch.relationshipLabel.trim().slice(0, 48) || undefined
            : node.relationshipLabel,
      note: patch.note !== undefined ? patch.note.trim().slice(0, 360) : node.note,
      category:
        node.parentId === null
          ? 'root'
          : patch.category && patch.category !== 'root'
            ? patch.category
            : node.category,
    };
  });
}

export function toggleNodeCollapse(nodes: MindMapNode[], nodeId: string): MindMapNode[] {
  return nodes.map((n) => (n.id === nodeId ? { ...n, collapsed: !n.collapsed } : n));
}

export function setAllNodesCollapsed(nodes: MindMapNode[], collapsed: boolean): MindMapNode[] {
  return nodes.map((n) => {
    if (n.parentId === null) return { ...n, collapsed: false };
    return { ...n, collapsed };
  });
}

export function deleteNodeBranch(
  nodes: MindMapNode[],
  crossLinks: MindMapCrossLink[],
  nodeId: string
): { nodes: MindMapNode[]; crossLinks: MindMapCrossLink[] } {
  const target = nodes.find((n) => n.id === nodeId);
  if (!target || target.parentId === null) {
    // Protect root node from deletion
    return { nodes, crossLinks };
  }

  const toDelete = new Set<string>([nodeId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const node of nodes) {
      if (node.parentId && toDelete.has(node.parentId) && !toDelete.has(node.id)) {
        toDelete.add(node.id);
        expanded = true;
      }
    }
  }

  return {
    nodes: nodes.filter((n) => !toDelete.has(n.id)),
    crossLinks: crossLinks.filter((l) => !toDelete.has(l.fromId) && !toDelete.has(l.toId)),
  };
}

export function addCrossLink(
  crossLinks: MindMapCrossLink[],
  nodes: MindMapNode[],
  fromId: string,
  toId: string,
  label: string
): MindMapCrossLink[] {
  if (crossLinks.length >= MAX_MINDMAP_CROSSLINKS) return crossLinks;
  const cleanLabel = label.trim().slice(0, 60);
  if (!cleanLabel || fromId === toId) return crossLinks;
  const ids = new Set(nodes.map((n) => n.id));
  if (!ids.has(fromId) || !ids.has(toId)) return crossLinks;
  if (crossLinks.some((l) => (l.fromId === fromId && l.toId === toId) || (l.fromId === toId && l.toId === fromId))) {
    return crossLinks;
  }

  return [
    ...crossLinks,
    {
      id: sanitizeFirestoreId(`xlink_${Date.now()}_${Math.floor(Math.random() * 1000)}`),
      fromId,
      toId,
      label: cleanLabel,
    },
  ];
}

export interface PositionedMindMapNode {
  node: MindMapNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  childCount: number;
  hiddenDescendantCount: number;
}

export interface PositionedEdge {
  id: string;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
}

export interface MindMapLayoutResult {
  positionedNodes: PositionedMindMapNode[];
  edges: PositionedEdge[];
  visibleCrossLinks: Array<{
    link: MindMapCrossLink;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
  width: number;
  height: number;
}

export function computeMindMapLayout(
  nodes: MindMapNode[],
  crossLinks: MindMapCrossLink[] = []
): MindMapLayoutResult {
  const safeNodes = normalizeMindMapNodes(nodes);
  const childrenMap = new Map<string, MindMapNode[]>();
  for (const node of safeNodes) {
    if (node.parentId) {
      const list = childrenMap.get(node.parentId) || [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    }
  }

  const countDescendants = (id: string): number => {
    const kids = childrenMap.get(id) || [];
    let total = kids.length;
    for (const k of kids) {
      total += countDescendants(k.id);
    }
    return total;
  };

  // Compute leaf-span heights for tidy non-overlapping horizontal tree layout
  const NODE_W = 216;
  const NODE_H = 66;
  const LEVEL_GAP_X = 340;
  const ROW_GAP_Y = 92;
  const PADDING_X = 56;
  const PADDING_Y = 56;

  const spanMap = new Map<string, number>();
  const measureSpan = (id: string): number => {
    const node = safeNodes.find((n) => n.id === id)!;
    const kids = node.collapsed ? [] : childrenMap.get(id) || [];
    if (kids.length === 0) {
      spanMap.set(id, 1);
      return 1;
    }
    let sum = 0;
    for (const k of kids) {
      sum += measureSpan(k.id);
    }
    spanMap.set(id, Math.max(1, sum));
    return Math.max(1, sum);
  };

  const root = safeNodes.find((n) => n.parentId === null)!;
  const totalUnits = measureSpan(root.id);

  const positionedNodes: PositionedMindMapNode[] = [];
  const edges: PositionedEdge[] = [];
  const posById = new Map<string, PositionedMindMapNode>();
  let maxDepth = 0;

  const placeNode = (node: MindMapNode, depth: number, topUnit: number) => {
    maxDepth = Math.max(maxDepth, depth);
    const span = spanMap.get(node.id) || 1;
    const centerUnit = topUnit + span / 2;
    const width = depth === 0 ? 236 : NODE_W;
    const height = node.hindiLabel ? 76 : NODE_H;
    const x = PADDING_X + depth * LEVEL_GAP_X;
    const y = PADDING_Y + (centerUnit - 0.5) * ROW_GAP_Y;

    const kids = childrenMap.get(node.id) || [];
    const hiddenDescendantCount = node.collapsed ? countDescendants(node.id) : 0;

    const placed: PositionedMindMapNode = {
      node,
      x,
      y,
      width,
      height,
      depth,
      childCount: kids.length,
      hiddenDescendantCount,
    };
    positionedNodes.push(placed);
    posById.set(node.id, placed);

    if (!node.collapsed) {
      let cursor = topUnit;
      for (const child of kids) {
        const childSpan = spanMap.get(child.id) || 1;
        placeNode(child, depth + 1, cursor);
        const childPos = posById.get(child.id)!;
        edges.push({
          id: `${node.id}->${child.id}`,
          fromId: node.id,
          toId: child.id,
          x1: placed.x + placed.width,
          y1: placed.y + placed.height / 2,
          x2: childPos.x,
          y2: childPos.y + childPos.height / 2,
          label: child.relationshipLabel,
        });
        cursor += childSpan;
      }
    }
  };

  placeNode(root, 0, 0);

  const visibleCrossLinks = crossLinks
    .map((link) => {
      const a = posById.get(link.fromId);
      const b = posById.get(link.toId);
      if (!a || !b) return null;
      return {
        link,
        x1: a.x + a.width / 2,
        y1: a.y + a.height / 2,
        x2: b.x + b.width / 2,
        y2: b.y + b.height / 2,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const width = Math.max(880, PADDING_X * 2 + (maxDepth + 1) * LEVEL_GAP_X - 40);
  const height = Math.max(500, PADDING_Y * 2 + totalUnits * ROW_GAP_Y);

  return {
    positionedNodes,
    edges,
    visibleCrossLinks,
    width,
    height,
  };
}
