import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MINDMAP_NODES,
  addChildNode,
  addCrossLink,
  addParentBranchNode,
  computeMindMapLayout,
  deleteNodeBranch,
  editNodeDetails,
  sanitizeMindMapForStorage,
  setAllNodesCollapsed,
  toggleNodeCollapse,
  validateMindMapGenerateRequest,
} from './mindMapEngine';
import { buildPdfFromJpegBytes } from './mindMapExport';
import { MindMapDocument, MindMapNode } from '../types/phase3';

describe('Mind Map Generator Pure Logic & Export', () => {
  const sampleNodes: MindMapNode[] = [
    { id: 'root', parentId: null, label: 'Light & Optics', note: 'Core chapter', category: 'root' },
    { id: 'p1', parentId: 'root', label: 'Reflection', relationshipLabel: 'splits into', note: 'Mirrors', category: 'pillar' },
    { id: 'c1', parentId: 'p1', label: 'Mirror Formula', relationshipLabel: 'equation', note: '1/f = 1/v + 1/u', category: 'formula' },
    { id: 'p2', parentId: 'root', label: 'Refraction', relationshipLabel: 'splits into', note: 'Lenses', category: 'pillar' },
  ];

  it('validates topic & subject generation requests properly', () => {
    const emptyTopic = validateMindMapGenerateRequest({ topic: ' ', subject: 'Physics' });
    assert.equal(emptyTopic.valid, false);

    const ok = validateMindMapGenerateRequest({
      topic: 'Quadratic Equations',
      subject: 'Mathematics',
      classGrade: 'Class 10',
      board: 'CBSE',
      language: 'Bilingual',
    });
    assert.equal(ok.valid, true);
    assert.equal(ok.sanitized?.language, 'Bilingual');
  });

  it('adds child nodes, inserts parent wrapper nodes, edits labels, and deletes branches safely', () => {
    const withChild = addChildNode(sampleNodes, 'p2', 'Snells Law', 'governed by', 'formula', 'n1 sin i = n2 sin r');
    assert.ok(withChild.createdId);
    assert.equal(withChild.nodes.length, 5);

    const withParent = addParentBranchNode(withChild.nodes, 'c1', 'Spherical Mirrors', 'sub-topic');
    assert.ok(withParent.createdId);
    const reparentedChild = withParent.nodes.find((n) => n.id === 'c1');
    assert.equal(reparentedChild?.parentId, withParent.createdId);

    const edited = editNodeDetails(withParent.nodes, 'c1', {
      label: 'Cartesian Mirror Formula',
      hindiLabel: 'दर्पण सूत्र',
    });
    assert.equal(edited.find((n) => n.id === 'c1')?.label, 'Cartesian Mirror Formula');
    assert.equal(edited.find((n) => n.id === 'c1')?.hindiLabel, 'दर्पण सूत्र');

    // Cannot delete root
    const protectedRoot = deleteNodeBranch(edited, [], 'root');
    assert.equal(protectedRoot.nodes.length, edited.length);

    // Deleting p1 removes p1 and its nested descendants
    const links = addCrossLink([], edited, 'c1', withChild.createdId!, 'analogous sign rule');
    assert.equal(links.length, 1);

    const afterDelete = deleteNodeBranch(edited, links, 'p1');
    assert.equal(afterDelete.nodes.some((n) => n.id === 'p1'), false);
    assert.equal(afterDelete.nodes.some((n) => n.id === 'c1'), false);
    assert.equal(afterDelete.crossLinks.length, 0);
  });

  it('expands/collapses branches and hides collapsed descendants from layout coordinates', () => {
    const collapsed = toggleNodeCollapse(sampleNodes, 'p1');
    const layoutCollapsed = computeMindMapLayout(collapsed);
    assert.equal(layoutCollapsed.positionedNodes.some((p) => p.node.id === 'c1'), false);
    const p1Placed = layoutCollapsed.positionedNodes.find((p) => p.node.id === 'p1');
    assert.equal(p1Placed?.hiddenDescendantCount, 1);

    const expandedAll = setAllNodesCollapsed(collapsed, false);
    const layoutExpanded = computeMindMapLayout(expandedAll);
    assert.equal(layoutExpanded.positionedNodes.some((p) => p.node.id === 'c1'), true);
  });

  it('enforces blueprint size bounds and strips dangling cross-links when sanitizing for storage', () => {
    const oversizeNodes: MindMapNode[] = Array.from({ length: 75 }, (_, i) => ({
      id: `n-${i}`,
      parentId: i === 0 ? null : 'n-0',
      label: `Node ${i}`,
      note: 'Test note',
      category: i === 0 ? 'root' : 'concept',
    }));

    const doc: MindMapDocument = {
      id: 'map/../../bad',
      userId: 'user-1',
      title: 'A'.repeat(250),
      topic: 'Optics',
      subject: 'Science',
      classGrade: 'Class 10',
      board: 'CBSE',
      language: 'English',
      syllabusStatus: 'sample',
      summary: 'Summary',
      syllabusNote: 'Note',
      nodes: oversizeNodes,
      crossLinks: [{ id: 'xl1', fromId: 'n-1', toId: 'missing-node', label: 'bad link' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const sanitized = sanitizeMindMapForStorage(doc);
    assert.doesNotMatch(sanitized.id, /[/.]/);
    assert.equal(sanitized.title.length, 200);
    assert.equal(sanitized.nodes.length, MAX_MINDMAP_NODES);
    assert.equal(sanitized.crossLinks.length, 0);
  });

  it('builds a valid PDF-1.4 binary buffer with embedded JPEG XObject and %%EOF trailer', () => {
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    const pdfBytes = buildPdfFromJpegBytes(fakeJpeg, 1200, 800);
    const pdfText = new TextDecoder().decode(pdfBytes);
    assert.ok(pdfText.startsWith('%PDF-1.4'));
    assert.ok(pdfText.includes('/Subtype /Image'));
    assert.ok(pdfText.includes('/Filter /DCTDecode'));
    assert.ok(pdfText.trim().endsWith('%%EOF'));
  });
});
