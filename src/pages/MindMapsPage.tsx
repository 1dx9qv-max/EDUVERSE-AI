import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Download,
  FileImage,
  FileText,
  FolderOpen,
  GitFork,
  Link2,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AiApiClientError, generateMindMap } from '../api/client';
import {
  deleteMindMap,
  dispatchVerifiedLearningEvent,
  fetchMindMaps,
  fetchVerifiedSyllabus,
  saveMindMap,
} from '../lib/firestoreService';
import {
  AVAILABLE_SUBJECTS_BY_GRADE,
  CLASS_GRADES,
  INDIAN_BOARDS,
  getSampleCurriculum,
} from '../utils/curriculum';
import {
  addChildNode,
  addCrossLink,
  addParentBranchNode,
  computeMindMapLayout,
  deleteNodeBranch,
  editNodeDetails,
  sanitizeMindMapForStorage,
  setAllNodesCollapsed,
  toggleNodeCollapse,
} from '../utils/mindMapEngine';
import { exportMindMapAsPdf, exportMindMapAsPng } from '../utils/mindMapExport';
import {
  normalizeLanguageForTutor,
  sanitizeFirestoreId,
  TUTOR_LANGUAGES,
} from '../utils/aiValidation';
import {
  MindMapDocument,
  MindMapNode,
  MindMapNodeCategory,
} from '../types/phase3';
import { TutorLanguage } from '../types/ai';
import { ClassGrade, IndianBoard } from '../types/auth';
import { ChapterNode } from '../types/curriculum';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';

const CATEGORY_BADGE: Record<MindMapNodeCategory, { label: string; classes: string }> = {
  root: { label: 'Central Topic', classes: 'bg-indigo-600/25 border-indigo-400 text-white' },
  pillar: { label: 'Major Branch', classes: 'bg-sky-950/80 border-sky-400/70 text-sky-100' },
  concept: { label: 'Concept', classes: 'bg-slate-900 border-indigo-500/50 text-slate-100' },
  formula: { label: 'Formula / Law', classes: 'bg-violet-950/70 border-purple-400/70 text-purple-100' },
  example: { label: 'Example', classes: 'bg-emerald-950/70 border-emerald-400/70 text-emerald-100' },
};

function createStarterMindMap(
  userId: string,
  board: IndianBoard,
  classGrade: ClassGrade,
  subject: string,
  language: TutorLanguage
): MindMapDocument {
  const now = new Date().toISOString();
  return sanitizeMindMapForStorage({
    id: `map_starter_${Date.now()}`,
    userId,
    title: `${subject} — Core Concept Starter`,
    topic: `${subject} Foundations`,
    subject,
    classGrade,
    board,
    language,
    syllabusStatus: 'sample',
    summary: 'Enter any chapter or topic above and click Generate Mind Map for an AI-structured breakdown, or start adding nodes directly below.',
    syllabusNote: `Starter map for ${classGrade} (${board}). Connect with your chapter topic to build a full revision tree.`,
    nodes: [
      { id: 'root', parentId: null, label: `${subject} Foundations`, note: 'Central root concept', category: 'root' },
      { id: 'p1', parentId: 'root', label: 'Core Principles', relationshipLabel: 'built on', note: 'Fundamental definitions and axioms', category: 'pillar' },
      { id: 'c1', parentId: 'p1', label: 'Key Laws & Theorems', relationshipLabel: 'includes', note: 'Primary rules tested in board exams', category: 'formula' },
      { id: 'p2', parentId: 'root', label: 'Applications', relationshipLabel: 'applies to', note: 'Everyday problem-solving use cases', category: 'pillar' },
      { id: 'c2', parentId: 'p2', label: 'Worked Numericals', relationshipLabel: 'practiced via', note: 'Step-by-step sample derivations', category: 'example' },
    ],
    crossLinks: [
      { id: 'xl_starter', fromId: 'c1', toId: 'c2', label: 'drives solution steps' },
    ],
    createdAt: now,
    updatedAt: now,
  });
}

export const MindMapsPage: React.FC = () => {
  const { user } = useAuth();
  const userId = user?.uid || '';

  const [board, setBoard] = useState<IndianBoard>(user?.board || 'CBSE');
  const [classGrade, setClassGrade] = useState<ClassGrade>(user?.classGrade || 'Class 10');
  const [language, setLanguage] = useState<TutorLanguage>(() =>
    normalizeLanguageForTutor(user?.language)
  );

  const subjectOptions = useMemo(() => {
    const gradeSubjects = AVAILABLE_SUBJECTS_BY_GRADE[classGrade] || [];
    const enrolled = user?.subjects || [];
    return Array.from(
      new Set([
        ...enrolled,
        ...gradeSubjects,
        'Physics',
        'Chemistry',
        'Mathematics',
        'Biology',
        'Geography',
        'History',
        'Economics',
      ])
    );
  }, [classGrade, user?.subjects]);

  const [subject, setSubject] = useState<string>(() => subjectOptions[0] || 'Science');
  const [topicInput, setTopicInput] = useState('');
  const [verifiedChapters, setVerifiedChapters] = useState<ChapterNode[]>([]);

  const [activeMap, setActiveMap] = useState<MindMapDocument>(() =>
    createStarterMindMap(userId, board, classGrade, subjectOptions[0] || 'Science', language)
  );
  const [savedMaps, setSavedMaps] = useState<MindMapDocument[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(true);
  const [showSavedDrawer, setShowSavedDrawer] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'canvas' | 'outline'>('canvas');
  const [zoom, setZoom] = useState(0.68);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('root');

  // Editor state for selected node
  const [editLabel, setEditLabel] = useState('');
  const [editHindiLabel, setEditHindiLabel] = useState('');
  const [editRelationship, setEditRelationship] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editCategory, setEditCategory] = useState<MindMapNodeCategory>('concept');

  // Add Child / Add Parent / Add CrossLink forms
  const [newChildLabel, setNewChildLabel] = useState('');
  const [newChildRelation, setNewChildRelation] = useState('includes');
  const [newParentLabel, setNewParentLabel] = useState('');
  const [crossTargetId, setCrossTargetId] = useState('');
  const [crossLabel, setCrossLabel] = useState('relates to');

  useEffect(() => {
    if (user) {
      setBoard(user.board || 'CBSE');
      setClassGrade(user.classGrade || 'Class 10');
      setLanguage(normalizeLanguageForTutor(user.language));
    }
  }, [user?.uid, user?.board, user?.classGrade, user?.language]);

  useEffect(() => {
    if (!subjectOptions.includes(subject) && subjectOptions.length > 0) {
      setSubject(subjectOptions[0]);
    }
  }, [subjectOptions, subject]);

  useEffect(() => {
    if (!userId) {
      setLoadingMaps(false);
      return;
    }
    let active = true;
    setLoadingMaps(true);
    fetchMindMaps(userId)
      .then((maps) => {
        if (!active) return;
        setSavedMaps(maps);
        if (maps.length > 0) {
          setActiveMap(maps[0]);
          setSelectedNodeId(maps[0].nodes[0]?.id || 'root');
        }
      })
      .catch((err) => {
        console.warn('Could not load saved mind maps:', err);
      })
      .finally(() => {
        if (active) setLoadingMaps(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!user?.uid) {
      setVerifiedChapters([]);
      return;
    }
    let active = true;
    fetchVerifiedSyllabus(board, classGrade, subject.toLowerCase().split(' ')[0])
      .then((rows) => {
        if (active) setVerifiedChapters(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.uid, board, classGrade, subject]);

  const chapterSuggestions = useMemo(() => {
    if (verifiedChapters.length > 0) {
      return verifiedChapters.map((c) => ({ title: c.chapterTitle, isVerified: true }));
    }
    const sample = getSampleCurriculum(board, classGrade);
    const matched =
      sample.find(
        (s) =>
          subject.toLowerCase().includes(s.name.toLowerCase()) ||
          s.name.toLowerCase().includes(subject.toLowerCase())
      ) || sample[0];
    return (matched?.chapters || []).map((c) => ({ title: c.title, isVerified: false }));
  }, [verifiedChapters, board, classGrade, subject]);

  const selectedNode: MindMapNode | undefined = useMemo(
    () => activeMap.nodes.find((n) => n.id === selectedNodeId) || activeMap.nodes[0],
    [activeMap.nodes, selectedNodeId]
  );

  // Sync inspector inputs when selected node changes
  useEffect(() => {
    if (!selectedNode) return;
    setEditLabel(selectedNode.label);
    setEditHindiLabel(selectedNode.hindiLabel || '');
    setEditRelationship(selectedNode.relationshipLabel || '');
    setEditNote(selectedNode.note || '');
    setEditCategory(selectedNode.category);
    const firstOther = activeMap.nodes.find((n) => n.id !== selectedNode.id);
    setCrossTargetId(firstOther?.id || '');
  }, [selectedNode?.id, selectedNode?.label, activeMap.id]);

  const layout = useMemo(
    () => computeMindMapLayout(activeMap.nodes, activeMap.crossLinks),
    [activeMap.nodes, activeMap.crossLinks]
  );

  const handleGenerate = async (overrideTopic?: string) => {
    const queryTopic = (overrideTopic ?? topicInput).trim();
    if (queryTopic.length < 2) {
      setErrorMsg('Please enter a chapter or topic (at least 2 characters) to generate a mind map.');
      return;
    }
    setErrorMsg(null);
    setSaveMessage(null);
    setGenerating(true);

    try {
      const matchedSuggestion = chapterSuggestions.find(
        (s) => s.title.toLowerCase() === queryTopic.toLowerCase()
      );
      const generated = await generateMindMap({
        topic: queryTopic,
        subject,
        classGrade,
        board,
        language,
        chapterContext: matchedSuggestion ? `Syllabus Chapter: ${matchedSuggestion.title}` : undefined,
      });

      const now = new Date().toISOString();
      const newDoc = sanitizeMindMapForStorage({
        id: sanitizeFirestoreId(`map_${Date.now()}`),
        userId,
        title: generated.title,
        topic: queryTopic,
        subject,
        classGrade,
        board,
        language,
        syllabusStatus: matchedSuggestion?.isVerified
          ? 'verified'
          : matchedSuggestion
            ? 'sample'
            : 'custom',
        summary: generated.summary,
        syllabusNote: generated.syllabusNote,
        nodes: generated.nodes,
        crossLinks: generated.crossLinks,
        createdAt: now,
        updatedAt: now,
      });

      const persisted = await saveMindMap(newDoc);
      setActiveMap(persisted);
      setSelectedNodeId(persisted.nodes[0]?.id || 'root');
      setSavedMaps((prev) => [persisted, ...prev.filter((m) => m.id !== persisted.id)]);
      setSaveMessage('Generated and saved to your Mind Map library.');

      if (user?.uid) {
        void dispatchVerifiedLearningEvent({
          eventType: 'mindmap_created',
          subject,
          topic: persisted.topic,
          sourceModule: 'mind-maps',
          idempotencyKey: `mindmap_${persisted.id}`,
          title: `Mind Map: ${persisted.topic}`,
          description: `Generated ${persisted.nodes.length}-node concept map in ${subject}.`,
        });
      }
    } catch (err) {
      if (err instanceof AiApiClientError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Failed to generate Mind Map. Please check your connection and retry.');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveMap = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const saved = await saveMindMap(activeMap);
      setActiveMap(saved);
      setSavedMaps((prev) => [saved, ...prev.filter((m) => m.id !== saved.id)]);
      setSaveMessage('Mind map changes saved cleanly.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save mind map.');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyNodeEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode) return;
    const updatedNodes = editNodeDetails(activeMap.nodes, selectedNode.id, {
      label: editLabel,
      hindiLabel: editHindiLabel,
      relationshipLabel: editRelationship,
      note: editNote,
      category: editCategory,
    });
    setActiveMap((prev) => ({
      ...prev,
      nodes: updatedNodes,
      title: selectedNode.parentId === null && editLabel.trim() ? editLabel.trim() : prev.title,
    }));
    setSaveMessage('Node updated — click Save Map to persist changes.');
  };

  const handleAddChild = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode || !newChildLabel.trim()) return;
    const { nodes, createdId } = addChildNode(
      activeMap.nodes,
      selectedNode.id,
      newChildLabel,
      newChildRelation,
      'concept'
    );
    if (createdId) {
      setActiveMap((prev) => ({ ...prev, nodes }));
      setSelectedNodeId(createdId);
      setNewChildLabel('');
      setSaveMessage('Child node added.');
    }
  };

  const handleInsertParent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode || !newParentLabel.trim()) return;
    const { nodes, createdId } = addParentBranchNode(
      activeMap.nodes,
      selectedNode.id,
      newParentLabel,
      'organizes'
    );
    if (createdId) {
      setActiveMap((prev) => ({ ...prev, nodes }));
      setSelectedNodeId(createdId);
      setNewParentLabel('');
      setSaveMessage(
        selectedNode.parentId === null
          ? 'Top-level parent branch created under Root.'
          : 'Inserted parent branch above selected node.'
      );
    }
  };

  const handleDeleteNode = () => {
    if (!selectedNode || selectedNode.parentId === null) return;
    const res = deleteNodeBranch(activeMap.nodes, activeMap.crossLinks, selectedNode.id);
    setActiveMap((prev) => ({ ...prev, nodes: res.nodes, crossLinks: res.crossLinks }));
    setSelectedNodeId(res.nodes[0]?.id || 'root');
    setSaveMessage('Branch deleted.');
  };

  const handleAddCrossLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode || !crossTargetId || !crossLabel.trim()) return;
    const nextLinks = addCrossLink(
      activeMap.crossLinks,
      activeMap.nodes,
      selectedNode.id,
      crossTargetId,
      crossLabel
    );
    setActiveMap((prev) => ({ ...prev, crossLinks: nextLinks }));
    setSaveMessage('Cross-concept link added.');
  };

  const handleExportPng = async () => {
    try {
      const fileName = await exportMindMapAsPng(activeMap);
      setExportStatus(`Exported image: ${fileName}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'PNG export failed.');
    }
  };

  const handleExportPdf = () => {
    try {
      const fileName = exportMindMapAsPdf(activeMap);
      setExportStatus(`Exported PDF: ${fileName}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'PDF export failed.');
    }
  };

  const handleDeleteSavedMap = async (mapId: string) => {
    if (!userId) return;
    await deleteMindMap(userId, mapId);
    setSavedMaps((prev) => prev.filter((m) => m.id !== mapId));
  };

  // Recursive outline renderer for mobile & accessible tree navigation
  const renderOutlineBranch = (node: MindMapNode, depth: number) => {
    const children = activeMap.nodes.filter((n) => n.parentId === node.id);
    const isSelected = node.id === selectedNode?.id;
    const cat = CATEGORY_BADGE[node.category] || CATEGORY_BADGE.concept;
    return (
      <div key={node.id} className="space-y-1.5" style={{ paddingLeft: depth > 0 ? 16 : 0 }}>
        <div
          className={`flex items-start justify-between gap-2 p-2.5 rounded-xl border transition-colors ${
            isSelected
              ? 'bg-indigo-600/20 border-indigo-400'
              : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0 flex-1">
            {children.length > 0 ? (
              <button
                type="button"
                aria-label={`${node.collapsed ? 'Expand' : 'Collapse'} ${node.label}`}
                onClick={() =>
                  setActiveMap((prev) => ({
                    ...prev,
                    nodes: toggleNodeCollapse(prev.nodes, node.id),
                  }))
                }
                className="mt-0.5 p-1 rounded hover:bg-slate-800 text-slate-300 cursor-pointer shrink-0"
              >
                {node.collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}

            <button
              type="button"
              onClick={() => setSelectedNodeId(node.id)}
              className="text-left min-w-0 flex-1 cursor-pointer"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {node.relationshipLabel && (
                  <span className="text-[10px] font-medium text-indigo-300">
                    ({node.relationshipLabel})
                  </span>
                )}
                <span className="text-xs font-bold text-white">{node.label}</span>
                {node.hindiLabel && (
                  <span className="text-[11px] text-slate-300">· {node.hindiLabel}</span>
                )}
              </div>
              {node.note && <p className="text-[11px] text-slate-400 mt-0.5">{node.note}</p>}
            </button>
          </div>

          <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${cat.classes}`}>
            {cat.label}
          </span>
        </div>

        {!node.collapsed && children.map((ch) => renderOutlineBranch(ch, depth + 1))}
      </div>
    );
  };

  const rootNode = activeMap.nodes.find((n) => n.parentId === null) || activeMap.nodes[0];

  return (
    <div className="space-y-6 animate-in fade-in duration-200 min-w-0">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-semibold text-indigo-300">{board}</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-200">{classGrade}</span>
            <span aria-hidden="true">·</span>
            <span>{subject}</span>
            <span aria-hidden="true">·</span>
            <span>Mind Map Generator</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Interactive AI Mind Map Studio
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
            Generate hierarchical chapter maps, create parent & child branches, map concept relationships, and export directly to PNG or PDF.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowSavedDrawer((v) => !v)}
            icon={<FolderOpen className="w-3.5 h-3.5" />}
          >
            Saved Maps ({savedMaps.length})
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={handleSaveMap}
            loading={saving}
            icon={<Save className="w-3.5 h-3.5" />}
          >
            Save Map
          </Button>
        </div>
      </div>

      {/* Saved Mind Maps Drawer */}
      {showSavedDrawer && (
        <Card className="p-4 space-y-3 bg-slate-900/95 border-indigo-500/30">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-indigo-400" />
              Saved Mind Maps
            </h2>
            <button
              type="button"
              onClick={() => setShowSavedDrawer(false)}
              className="text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Close
            </button>
          </div>
          {loadingMaps ? (
            <p className="text-xs text-slate-400">Loading saved maps...</p>
          ) : savedMaps.length === 0 ? (
            <p className="text-xs text-slate-400">No saved mind maps yet. Generate or edit a map and click Save Map.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {savedMaps.map((m) => (
                <div
                  key={m.id}
                  className={`p-3 rounded-xl border flex items-start justify-between gap-2 ${
                    activeMap.id === m.id
                      ? 'bg-indigo-600/15 border-indigo-500/50'
                      : 'bg-slate-950 border-slate-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMap(m);
                      setSelectedNodeId(m.nodes[0]?.id || 'root');
                      setShowSavedDrawer(false);
                    }}
                    className="text-left min-w-0 flex-1 cursor-pointer"
                  >
                    <p className="text-xs font-bold text-white truncate">{m.title}</p>
                    {m.topic && m.topic !== m.title && (
                      <p className="text-[10px] text-indigo-300 truncate">{m.topic}</p>
                    )}
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                      {m.board} · {m.classGrade} · {m.subject} · {m.nodes.length} nodes
                    </p>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete mind map ${m.title}`}
                    onClick={() => handleDeleteSavedMap(m.id)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Generator & Curriculum Controls */}
      <Card className="p-4 space-y-4 bg-slate-900/80 border-slate-800">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="space-y-1 block">
            <span className="text-[11px] font-semibold text-slate-400">Board</span>
            <select
              value={board}
              onChange={(e) => setBoard(e.target.value as IndianBoard)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-medium text-white"
            >
              {INDIAN_BOARDS.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 block">
            <span className="text-[11px] font-semibold text-slate-400">Class</span>
            <select
              value={classGrade}
              onChange={(e) => setClassGrade(e.target.value as ClassGrade)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-medium text-white"
            >
              {CLASS_GRADES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 block">
            <span className="text-[11px] font-semibold text-slate-400">Subject</span>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-medium text-white"
            >
              {subjectOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1 block">
            <span className="text-[11px] font-semibold text-slate-400">Map Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as TutorLanguage)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-medium text-white"
            >
              {TUTOR_LANGUAGES.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Topic Input + Generate CTA */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleGenerate();
          }}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="Enter chapter or topic (e.g., Light - Reflection & Refraction, Quadratic Equations, Chemical Bonding)"
            aria-label="Chapter or topic for mind map"
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none text-sm text-white placeholder:text-slate-500"
          />
          <Button
            type="submit"
            variant="primary"
            loading={generating}
            icon={<Sparkles className="w-4 h-4" />}
          >
            Generate Mind Map
          </Button>
        </form>

        {/* Connected Syllabus Chapter Suggestions */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-400 font-semibold flex items-center gap-1 mr-1">
            <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
            {verifiedChapters.length > 0 ? 'Verified Chapters:' : 'Sample Syllabus Topics:'}
          </span>
          {chapterSuggestions.map((ch, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setTopicInput(ch.title);
                handleGenerate(ch.title);
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-500/60 text-slate-300 hover:text-white cursor-pointer transition-colors"
            >
              {ch.title}
            </button>
          ))}
        </div>

        {errorMsg && (
          <div className="rounded-xl bg-rose-950/60 border border-rose-500/40 p-3 flex items-center justify-between gap-3 text-xs text-rose-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => handleGenerate()}
              className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 font-semibold cursor-pointer shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {(saveMessage || exportStatus) && (
          <div className="rounded-xl bg-emerald-950/40 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-300 flex flex-wrap items-center justify-between gap-2">
            <span>{exportStatus || saveMessage}</span>
            <button
              type="button"
              onClick={() => {
                setSaveMessage(null);
                setExportStatus(null);
              }}
              className="text-emerald-400 hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </Card>

      {/* Main Workspace: Interactive Canvas / Outline + Node Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Canvas / Outline Column */}
        <div className="lg:col-span-8 space-y-3 min-w-0">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-2xl bg-slate-900 border border-slate-800">
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={() => setViewMode('canvas')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  viewMode === 'canvas' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Visual Canvas
              </button>
              <button
                type="button"
                onClick={() => setViewMode('outline')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  viewMode === 'outline' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Outline Tree
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {viewMode === 'canvas' && (
                <>
                  <button
                    type="button"
                    aria-label="Zoom out mind map"
                    onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))}
                    className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-mono tabular-nums text-slate-400 px-1">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    aria-label="Zoom in mind map"
                    onClick={() => setZoom((z) => Math.min(1.4, Number((z + 0.1).toFixed(2))))}
                    className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Reset zoom"
                    onClick={() => setZoom(0.68)}
                    className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() =>
                  setActiveMap((prev) => ({ ...prev, nodes: setAllNodesCollapsed(prev.nodes, false) }))
                }
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap"
              >
                Expand All
              </button>
              <button
                type="button"
                onClick={() =>
                  setActiveMap((prev) => ({ ...prev, nodes: setAllNodesCollapsed(prev.nodes, true) }))
                }
                className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap"
              >
                Collapse
              </button>

              <button
                type="button"
                onClick={handleExportPng}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-cyan-500/60 text-xs font-semibold text-cyan-300 cursor-pointer whitespace-nowrap"
              >
                <FileImage className="w-3.5 h-3.5" />
                PNG
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-indigo-500/60 text-xs font-semibold text-indigo-300 cursor-pointer whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" />
                PDF
              </button>
            </div>
          </div>

          {/* Mind Map Overview Banner */}
          <div className="rounded-xl bg-slate-900/70 border border-slate-800 px-4 py-3 space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-white">{activeMap.title}</h2>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                {activeMap.nodes.length} nodes · {activeMap.crossLinks.length} cross-links
              </span>
            </div>
            {activeMap.summary && <p className="text-xs text-slate-300">{activeMap.summary}</p>}
          </div>

          {viewMode === 'canvas' ? (
            <div className="rounded-2xl bg-[#070b14] border border-slate-800 overflow-auto max-h-[560px] p-3">
              <div
                style={{
                  width: Math.round(layout.width * zoom),
                  height: Math.round(layout.height * zoom),
                }}
              >
                <svg
                  width={layout.width * zoom}
                  height={layout.height * zoom}
                  viewBox={`0 0 ${layout.width} ${layout.height}`}
                  className="block select-none"
                  role="img"
                  aria-label="Interactive Mind Map Hierarchy Canvas"
                >
                  {/* Subtle grid */}
                  <defs>
                    <pattern id="mmGrid" width="32" height="32" patternUnits="userSpaceOnUse">
                      <circle cx="2" cy="2" r="1" fill="rgba(148,163,184,0.16)" />
                    </pattern>
                  </defs>
                  <rect width={layout.width} height={layout.height} fill="url(#mmGrid)" />

                  {/* Cross-Concept Synergy Links */}
                  {layout.visibleCrossLinks.map((cl) => {
                    const ctrlX = (cl.x1 + cl.x2) / 2 + 45;
                    const ctrlY = Math.min(cl.y1, cl.y2) - 48;
                    const labelX = (cl.x1 + ctrlX * 2 + cl.x2) / 4;
                    const labelY = (cl.y1 + ctrlY * 2 + cl.y2) / 4;
                    return (
                      <g key={cl.link.id}>
                        <path
                          d={`M ${cl.x1} ${cl.y1} Q ${ctrlX} ${ctrlY} ${cl.x2} ${cl.y2}`}
                          fill="none"
                          stroke="#fbbf24"
                          strokeWidth="1.6"
                          strokeDasharray="6 4"
                          opacity="0.7"
                        />
                        <rect
                          x={labelX - 48}
                          y={labelY - 10}
                          width="96"
                          height="18"
                          rx="6"
                          fill="#451a03"
                          stroke="#f59e0b"
                          strokeWidth="1"
                        />
                        <text
                          x={labelX}
                          y={labelY + 2.5}
                          textAnchor="middle"
                          fill="#fde68a"
                          fontSize="9.5"
                          fontWeight="600"
                        >
                          {cl.link.label.slice(0, 18)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Parent-Child Connectors & Relationship Labels */}
                  {layout.edges.map((edge) => {
                    const midX = (edge.x1 + edge.x2) / 2;
                    const pillX = (edge.x1 + 12 + edge.x2) / 2;
                    const labelY = (edge.y1 + edge.y2) / 2;
                    return (
                      <g key={edge.id}>
                        <path
                          d={`M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2} ${edge.y2}`}
                          fill="none"
                          stroke="#6366f1"
                          strokeWidth="2"
                          opacity="0.7"
                        />
                        {edge.label && (
                          <g>
                            <rect
                              x={pillX - 44}
                              y={labelY - 9}
                              width="88"
                              height="17"
                              rx="6"
                              fill="#0f172a"
                              stroke="#334155"
                              strokeWidth="1"
                            />
                            <text
                              x={pillX}
                              y={labelY + 2.5}
                              textAnchor="middle"
                              fill="#c7d2fe"
                              fontSize="9.5"
                              fontWeight="600"
                            >
                              {edge.label.slice(0, 16)}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}

                  {/* Positioned Mind Map Nodes */}
                  {layout.positionedNodes.map((item) => {
                    const isSelected = item.node.id === selectedNode?.id;
                    const fill =
                      item.node.category === 'root'
                        ? '#312e81'
                        : item.node.category === 'pillar'
                          ? '#1e293b'
                          : item.node.category === 'formula'
                            ? '#2e1065'
                            : item.node.category === 'example'
                              ? '#064e3b'
                              : '#0f172a';
                    const stroke = isSelected
                      ? '#38bdf8'
                      : item.node.category === 'root'
                        ? '#818cf8'
                        : item.node.category === 'pillar'
                          ? '#38bdf8'
                          : item.node.category === 'formula'
                            ? '#a855f7'
                            : item.node.category === 'example'
                              ? '#10b981'
                              : '#475569';

                    return (
                      <g
                        key={item.node.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Select node ${item.node.label}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedNodeId(item.node.id);
                          }
                        }}
                        className="focus:outline-none"
                      >
                        <rect
                          x={item.x}
                          y={item.y}
                          width={item.width}
                          height={item.height}
                          rx="12"
                          fill={fill}
                          stroke={stroke}
                          strokeWidth={isSelected ? 2.8 : 1.5}
                          className="cursor-pointer"
                          onClick={() => setSelectedNodeId(item.node.id)}
                        />
                        <foreignObject
                          x={item.x + 10}
                          y={item.y + 8}
                          width={item.width - 28}
                          height={item.height - 16}
                          className="pointer-events-none"
                        >
                          <div className="h-full flex flex-col justify-center overflow-hidden">
                            <div className="text-[12px] font-bold text-white leading-tight line-clamp-2">
                              {item.node.label}
                            </div>
                            {item.node.hindiLabel && (
                              <div className="text-[10.5px] text-slate-300 truncate mt-0.5">
                                {item.node.hindiLabel}
                              </div>
                            )}
                          </div>
                        </foreignObject>

                        {/* Collapse / Expand toggle button right on node edge */}
                        {item.childCount > 0 && (
                          <g
                            className="cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMap((prev) => ({
                                ...prev,
                                nodes: toggleNodeCollapse(prev.nodes, item.node.id),
                              }));
                            }}
                          >
                            <circle
                              cx={item.x + item.width}
                              cy={item.y + item.height / 2}
                              r="11"
                              fill="#1e293b"
                              stroke="#818cf8"
                              strokeWidth="1.5"
                            />
                            <text
                              x={item.x + item.width}
                              y={item.y + item.height / 2 + 3.5}
                              textAnchor="middle"
                              fill="#e0e7ff"
                              fontSize="11"
                              fontWeight="800"
                            >
                              {item.node.collapsed ? `+${item.hiddenDescendantCount}` : '−'}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-2 max-h-[560px] overflow-y-auto">
              {rootNode && renderOutlineBranch(rootNode, 0)}
            </div>
          )}

          <p className="text-[11px] text-slate-400 px-1">{activeMap.syllabusNote}</p>
        </div>

        {/* Right Node Inspector, Relationship Manager & Branch Creator */}
        <div className="lg:col-span-4 space-y-4">
          {selectedNode && (
            <Card className="p-4 space-y-4 bg-slate-900/90 border-slate-800">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div className="min-w-0">
                  <span className="text-[11px] font-semibold text-indigo-300 block">Selected Node</span>
                  <h3 className="text-sm font-bold text-white truncate">{selectedNode.label}</h3>
                </div>
                {selectedNode.parentId !== null && (
                  <button
                    type="button"
                    aria-label={`Delete branch ${selectedNode.label}`}
                    onClick={handleDeleteNode}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 text-xs font-semibold cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                )}
              </div>

              {/* Edit Selected Node Details */}
              <form onSubmit={handleApplyNodeEdit} className="space-y-2.5">
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400">Node Label</span>
                  <input
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    aria-label="Edit node label"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400">Hindi Label (Optional)</span>
                  <input
                    type="text"
                    value={editHindiLabel}
                    onChange={(e) => setEditHindiLabel(e.target.value)}
                    placeholder="उदाहरण के लिए हिंदी शीर्षक"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                {selectedNode.parentId !== null && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className="text-[11px] font-semibold text-slate-400">Relationship</span>
                      <input
                        type="text"
                        value={editRelationship}
                        onChange={(e) => setEditRelationship(e.target.value)}
                        placeholder="e.g. governed by"
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] font-semibold text-slate-400">Category</span>
                      <select
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value as MindMapNodeCategory)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                      >
                        <option value="pillar">Major Branch</option>
                        <option value="concept">Concept</option>
                        <option value="formula">Formula / Law</option>
                        <option value="example">Example</option>
                      </select>
                    </label>
                  </div>
                )}

                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400">Concept Explanation Note</span>
                  <textarea
                    rows={2}
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </label>

                <Button type="submit" size="sm" variant="secondary" className="w-full">
                  Update Node Label & Details
                </Button>
              </form>

              {/* Create Child & Create Parent Nodes */}
              <div className="pt-3 border-t border-slate-800 space-y-3">
                <form onSubmit={handleAddChild} className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                    Add Child Node under “{selectedNode.label}”
                  </span>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newChildLabel}
                      onChange={(e) => setNewChildLabel(e.target.value)}
                      placeholder="New child concept"
                      aria-label="New child node label"
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                    <input
                      type="text"
                      value={newChildRelation}
                      onChange={(e) => setNewChildRelation(e.target.value)}
                      placeholder="relation"
                      aria-label="Child relationship label"
                      className="w-24 px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer shrink-0"
                    >
                      Add
                    </button>
                  </div>
                </form>

                <form onSubmit={handleInsertParent} className="space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                    <GitFork className="w-3.5 h-3.5 text-sky-400" />
                    {selectedNode.parentId === null
                      ? 'Create Top-Level Parent Branch'
                      : `Insert Parent Node above “${selectedNode.label}”`}
                  </span>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newParentLabel}
                      onChange={(e) => setNewParentLabel(e.target.value)}
                      placeholder="New parent group"
                      aria-label="New parent node label"
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer shrink-0"
                    >
                      Create
                    </button>
                  </div>
                </form>
              </div>

              {/* Cross-Concept Relationships */}
              <div className="pt-3 border-t border-slate-800 space-y-2.5">
                <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-amber-400" />
                  Concept Cross-Links ({activeMap.crossLinks.length})
                </span>

                <form onSubmit={handleAddCrossLink} className="space-y-1.5">
                  <select
                    value={crossTargetId}
                    onChange={(e) => setCrossTargetId(e.target.value)}
                    aria-label="Target node for cross link"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                  >
                    {activeMap.nodes
                      .filter((n) => n.id !== selectedNode.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          Link to: {n.label}
                        </option>
                      ))}
                  </select>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={crossLabel}
                      onChange={(e) => setCrossLabel(e.target.value)}
                      placeholder="Relationship (e.g. depends on)"
                      aria-label="Cross link label"
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold cursor-pointer shrink-0"
                    >
                      Link
                    </button>
                  </div>
                </form>

                {activeMap.crossLinks.length > 0 && (
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {activeMap.crossLinks.map((cl) => {
                      const from = activeMap.nodes.find((n) => n.id === cl.fromId)?.label || cl.fromId;
                      const to = activeMap.nodes.find((n) => n.id === cl.toId)?.label || cl.toId;
                      return (
                        <div
                          key={cl.id}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px]"
                        >
                          <span className="text-slate-300 truncate">
                            {from} <span className="text-amber-300">→ {cl.label} →</span> {to}
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove link ${cl.label}`}
                            onClick={() =>
                              setActiveMap((prev) => ({
                                ...prev,
                                crossLinks: prev.crossLinks.filter((item) => item.id !== cl.id),
                              }))
                            }
                            className="text-slate-500 hover:text-rose-400 cursor-pointer shrink-0"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
