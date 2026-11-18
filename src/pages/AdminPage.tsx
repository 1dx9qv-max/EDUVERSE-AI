import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Cpu,
  FileCheck,
  Filter,
  Gavel,
  Layers,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Users2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  AdminClassItem,
  AdminSubjectItem,
  deleteAdminQuestion,
  deleteAdminSyllabusNode,
  fetchAdminAuditLogs,
  fetchAdminContent,
  fetchAdminCurriculum,
  fetchAdminGuardians,
  fetchAdminModeration,
  fetchAdminOverview,
  fetchAdminQuestions,
  fetchAdminUsers,
  resolveAdminModeration,
  saveAdminBoard,
  saveAdminContent,
  saveAdminQuestion,
  saveAdminSubject,
  saveAdminSyllabusNode,
  updateAdminClass,
  updateAdminGuardianLink,
  updateAdminUser,
  verifyAdminSyllabusNode,
} from '../api/client';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { ClassGrade, IndianBoard, UserRole } from '../types/auth';
import { BoardConfig, SyllabusNode } from '../types/curriculum';
import {
  AccountStatus,
  AdminAuditLogEntry,
  AdminQuestionDifficulty,
  AdminQuestionFormat,
  GuardianLinkRecord,
  LearningContentItem,
  LearningContentStatus,
  LearningContentType,
  ManagedQuestionItem,
  ManagedUserAccount,
  PlatformModerationItem,
  PlatformUsageAnalytics,
  SecurityPostureCheck,
  SystemHealthSnapshot,
} from '../types/phase8';
import { CLASS_GRADES, INDIAN_BOARDS } from '../utils/curriculum';

type AdminTab =
  | 'overview'
  | 'users'
  | 'curriculum'
  | 'syllabus'
  | 'questions'
  | 'moderation'
  | 'guardians'
  | 'audit';

const QUESTION_TYPES: Array<{ value: AdminQuestionFormat; label: string }> = [
  { value: 'mcq', label: 'MCQ' },
  { value: 'multiple-select', label: 'Multiple Select' },
  { value: 'true-false', label: 'True / False' },
  { value: 'fill-blank', label: 'Fill in the Blanks' },
  { value: 'short-answer', label: 'Short Answer' },
  { value: 'long-answer', label: 'Long Answer' },
  { value: 'numerical', label: 'Numerical Problem' },
];

const CONTENT_TYPES: Array<{ value: LearningContentType; label: string }> = [
  { value: 'concept-guide', label: 'Concept Guide' },
  { value: 'formula-sheet', label: 'Formula Sheet' },
  { value: 'solved-example', label: 'Solved Example' },
  { value: 'revision-note', label: 'Revision Note' },
];

export const AdminPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);

  // Domain State
  const [analytics, setAnalytics] = useState<PlatformUsageAnalytics | null>(null);
  const [health, setHealth] = useState<SystemHealthSnapshot | null>(null);
  const [securityChecks, setSecurityChecks] = useState<SecurityPostureCheck[]>([]);
  const [users, setUsers] = useState<ManagedUserAccount[]>([]);
  const [boards, setBoards] = useState<BoardConfig[]>([]);
  const [classes, setClasses] = useState<AdminClassItem[]>([]);
  const [subjects, setSubjects] = useState<AdminSubjectItem[]>([]);
  const [syllabusNodes, setSyllabusNodes] = useState<SyllabusNode[]>([]);
  const [questions, setQuestions] = useState<ManagedQuestionItem[]>([]);
  const [contentItems, setContentItems] = useState<LearningContentItem[]>([]);
  const [moderationItems, setModerationItems] = useState<PlatformModerationItem[]>([]);
  const [guardianLinks, setGuardianLinks] = useState<GuardianLinkRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogEntry[]>([]);

  // Filters
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | UserRole>('all');
  const [syllabusBoardFilter, setSyllabusBoardFilter] = useState<string>('CBSE');
  const [syllabusClassFilter, setSyllabusClassFilter] = useState<string>('Class 10');
  const [moderationFilter, setModerationFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [auditSearch, setAuditSearch] = useState('');
  const [bankSection, setBankSection] = useState<'questions' | 'content'>('questions');
  const [usersLimit, setUsersLimit] = useState(20);
  const [questionsLimit, setQuestionsLimit] = useState(20);
  const [contentLimit, setContentLimit] = useState(20);
  const [auditLimit, setAuditLimit] = useState(25);

  // Forms: Board & Subject
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardFullName, setNewBoardFullName] = useState('');
  const [newBoardVerified, setNewBoardVerified] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectBoard, setNewSubjectBoard] = useState('CBSE');
  const [newSubjectGrade, setNewSubjectGrade] = useState<ClassGrade>('Class 10');

  // Form: Syllabus Import
  const [showSyllabusForm, setShowSyllabusForm] = useState(false);
  const [syllabusSubject, setSyllabusSubject] = useState('science');
  const [syllabusChapterNum, setSyllabusChapterNum] = useState(1);
  const [syllabusChapterTitle, setSyllabusChapterTitle] = useState('');
  const [syllabusSourceDoc, setSyllabusSourceDoc] = useState('NCERT Rationalized 2024-25');
  const [syllabusTopicsText, setSyllabusTopicsText] = useState('Core Principles\nApplied Numericals');
  const [syllabusVerified, setSyllabusVerified] = useState(true);

  // Form: Question Bank
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [qBoard, setQBoard] = useState('CBSE');
  const [qClass, setQClass] = useState<ClassGrade>('Class 10');
  const [qSubject, setQSubject] = useState('Science');
  const [qChapter, setQChapter] = useState('');
  const [qTopic, setQTopic] = useState('');
  const [qType, setQType] = useState<AdminQuestionFormat>('mcq');
  const [qDifficulty, setQDifficulty] = useState<AdminQuestionDifficulty>('intermediate');
  const [qPrompt, setQPrompt] = useState('');
  const [qOptionsText, setQOptionsText] = useState('Option A\nOption B\nOption C\nOption D');
  const [qAnswer, setQAnswer] = useState('');
  const [qExplanation, setQExplanation] = useState('');
  const [qMarks, setQMarks] = useState(2);
  const [qVerified, setQVerified] = useState(true);

  // Form: Learning Content
  const [showContentForm, setShowContentForm] = useState(false);
  const [cBoard, setCBoard] = useState('CBSE');
  const [cClass, setCClass] = useState<ClassGrade>('Class 10');
  const [cSubject, setCSubject] = useState('Science');
  const [cChapter, setCChapter] = useState('');
  const [cType, setCType] = useState<LearningContentType>('concept-guide');
  const [cTitle, setCTitle] = useState('');
  const [cSummary, setCSummary] = useState('');
  const [cBody, setCBody] = useState('');
  const [cStatus, setCStatus] = useState<LearningContentStatus>('published');

  const flashNotice = (msg: string) => {
    setActionNotice(msg);
    window.setTimeout(() => setActionNotice(null), 4000);
  };

  const loadAllAdminData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const [
        overviewRes,
        usersRes,
        curriculumRes,
        questionsRes,
        contentRes,
        moderationRes,
        guardiansRes,
        logsRes,
      ] = await Promise.all([
        fetchAdminOverview(),
        fetchAdminUsers(),
        fetchAdminCurriculum(),
        fetchAdminQuestions(),
        fetchAdminContent(),
        fetchAdminModeration(),
        fetchAdminGuardians(),
        fetchAdminAuditLogs(),
      ]);

      setAnalytics(overviewRes.analytics);
      setHealth(overviewRes.health);
      setSecurityChecks(overviewRes.securityChecks);
      setUsers(usersRes);
      setBoards(curriculumRes.boards);
      setClasses(curriculumRes.classes);
      setSubjects(curriculumRes.subjects);
      setSyllabusNodes(curriculumRes.syllabusNodes);
      setQuestions(questionsRes);
      setContentItems(contentRes);
      setModerationItems(moderationRes);
      setGuardianLinks(guardiansRes);
      setAuditLogs(logsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin console data.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      loadAllAdminData();
    }
  }, [isAdmin, loadAllAdminData]);

  const refreshOverviewAndLogs = async () => {
    try {
      const [overviewRes, logsRes] = await Promise.all([
        fetchAdminOverview(),
        fetchAdminAuditLogs(),
      ]);
      setAnalytics(overviewRes.analytics);
      setHealth(overviewRes.health);
      setSecurityChecks(overviewRes.securityChecks);
      setAuditLogs(logsRes);
    } catch {
      // Ignore background refresh error
    }
  };

  // User mutations
  const handleUserMutation = async (
    targetUid: string,
    updates: { role?: UserRole; status?: AccountStatus }
  ) => {
    setMutatingKey(`user-${targetUid}`);
    setError(null);
    try {
      const updated = await updateAdminUser(targetUid, updates);
      setUsers((prev) => prev.map((u) => (u.uid === targetUid ? updated : u)));
      flashNotice(`Updated ${updated.displayName} (${updated.role} · ${updated.status})`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user account.');
    } finally {
      setMutatingKey(null);
    }
  };

  // Board / Class / Subject mutations
  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBoardName.trim()) return;
    setMutatingKey('board-create');
    setError(null);
    try {
      const saved = await saveAdminBoard({
        name: newBoardName.trim(),
        fullName: newBoardFullName.trim() || newBoardName.trim(),
        supportedClasses: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'],
        isVerified: newBoardVerified,
      });
      setBoards((prev) => {
        const idx = prev.findIndex((b) => b.id === saved.id);
        return idx >= 0 ? prev.map((b) => (b.id === saved.id ? saved : b)) : [saved, ...prev];
      });
      setNewBoardName('');
      setNewBoardFullName('');
      flashNotice(`Saved board ${saved.name}`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save board.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleToggleBoardVerify = async (board: BoardConfig) => {
    setMutatingKey(`board-${board.id}`);
    setError(null);
    try {
      const saved = await saveAdminBoard({
        id: board.id,
        name: board.name,
        fullName: board.fullName,
        supportedClasses: board.supportedClasses,
        isVerified: !board.isVerified,
      });
      setBoards((prev) => prev.map((b) => (b.id === saved.id ? saved : b)));
      flashNotice(`${saved.name} marked ${saved.isVerified ? 'Official Verified' : 'Draft'}`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle board verification.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleToggleClassActive = async (cls: AdminClassItem) => {
    setMutatingKey(`class-${cls.id}`);
    setError(null);
    try {
      const updated = await updateAdminClass(cls.id, { active: !cls.active });
      setClasses((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      flashNotice(`${updated.label} set to ${updated.active ? 'Active' : 'Inactive'}`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update class grade.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    setMutatingKey('subject-create');
    setError(null);
    try {
      const saved = await saveAdminSubject({
        name: newSubjectName.trim(),
        boardIds: [newSubjectBoard],
        grades: [newSubjectGrade],
        active: true,
      });
      setSubjects((prev) => [saved, ...prev]);
      setNewSubjectName('');
      flashNotice(`Added subject "${saved.name}" for ${newSubjectBoard} ${newSubjectGrade}`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create subject.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleToggleSubjectActive = async (sub: AdminSubjectItem) => {
    setMutatingKey(`subject-${sub.id}`);
    setError(null);
    try {
      const saved = await saveAdminSubject({
        id: sub.id,
        name: sub.name,
        boardIds: sub.boardIds,
        grades: sub.grades,
        active: !sub.active,
      });
      setSubjects((prev) => prev.map((s) => (s.id === saved.id ? saved : s)));
      flashNotice(`Subject "${saved.name}" is now ${saved.active ? 'Active' : 'Paused'}`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subject.');
    } finally {
      setMutatingKey(null);
    }
  };

  // Syllabus mutations
  const handleAddSyllabus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!syllabusChapterTitle.trim()) return;
    setMutatingKey('syllabus-create');
    setError(null);
    const topicLines = syllabusTopicsText
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    const topics = topicLines.map((title, idx) => ({
      id: `top-${Date.now()}-${idx}`,
      title,
      order: idx + 1,
      learningObjectives: [
        {
          id: `lo-${Date.now()}-${idx}`,
          description: `Explain and apply key concepts from ${title}`,
          bloomLevel: 'Apply' as const,
          isHighYield: idx === 0,
        },
      ],
    }));

    try {
      const saved = await saveAdminSyllabusNode({
        boardId: syllabusBoardFilter,
        classGrade: syllabusClassFilter as ClassGrade,
        subjectId: syllabusSubject,
        chapterNumber: syllabusChapterNum,
        chapterTitle: syllabusChapterTitle.trim(),
        topics,
        isVerified: syllabusVerified,
        sourceDoc: syllabusSourceDoc.trim() || 'Board Circular Draft',
      });
      setSyllabusNodes((prev) => [saved, ...prev]);
      setSyllabusChapterTitle('');
      setShowSyllabusForm(false);
      flashNotice(`Saved Chapter ${saved.chapterNumber}: ${saved.chapterTitle}`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save syllabus chapter.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleVerifySyllabus = async (nodeId: string, nextVerified: boolean) => {
    setMutatingKey(`syl-verify-${nodeId}`);
    setError(null);
    try {
      const updated = await verifyAdminSyllabusNode(nodeId, nextVerified);
      setSyllabusNodes((prev) => prev.map((n) => (n.id === nodeId ? updated : n)));
      flashNotice(`${updated.chapterTitle} marked ${updated.isVerified ? 'Official Verified' : 'Draft'}`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify syllabus node.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleDeleteSyllabus = async (node: SyllabusNode) => {
    setMutatingKey(`syl-del-${node.id}`);
    setError(null);
    try {
      await deleteAdminSyllabusNode(node.id);
      setSyllabusNodes((prev) => prev.filter((n) => n.id !== node.id));
      flashNotice(`Deleted syllabus node "${node.chapterTitle}"`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete syllabus node.');
    } finally {
      setMutatingKey(null);
    }
  };

  // Question Bank & Content mutations
  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qPrompt.trim() || !qAnswer.trim()) return;
    setMutatingKey('question-create');
    setError(null);
    const needsOptions = qType === 'mcq' || qType === 'multiple-select';
    const options = needsOptions
      ? qOptionsText
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean)
      : undefined;

    try {
      const created = await saveAdminQuestion({
        boardId: qBoard,
        classGrade: qClass,
        subjectId: qSubject,
        chapterTitle: qChapter.trim() || 'Core Chapter',
        topic: qTopic.trim() || 'Core Concept',
        questionType: qType,
        difficulty: qDifficulty,
        prompt: qPrompt.trim(),
        options,
        correctAnswer: qAnswer.trim(),
        explanation: qExplanation.trim() || 'Refer to official board marking scheme.',
        marks: qMarks,
        isVerified: qVerified,
      });
      setQuestions((prev) => [created, ...prev]);
      setQPrompt('');
      setQAnswer('');
      setQExplanation('');
      setShowQuestionForm(false);
      flashNotice(`Added ${created.questionType.toUpperCase()} question to Question Bank`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save question.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleToggleQuestionVerified = async (q: ManagedQuestionItem) => {
    setMutatingKey(`q-verify-${q.id}`);
    setError(null);
    try {
      const saved = await saveAdminQuestion({
        ...q,
        isVerified: !q.isVerified,
      });
      setQuestions((prev) => prev.map((item) => (item.id === saved.id ? saved : item)));
      flashNotice(`Question marked ${saved.isVerified ? 'Verified' : 'Draft'}`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update question.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleDeleteQuestion = async (qId: string) => {
    setMutatingKey(`q-del-${qId}`);
    setError(null);
    try {
      await deleteAdminQuestion(qId);
      setQuestions((prev) => prev.filter((q) => q.id !== qId));
      flashNotice('Deleted question from Question Bank');
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete question.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleCreateContent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cTitle.trim() || !cBody.trim()) return;
    setMutatingKey('content-create');
    setError(null);
    try {
      const saved = await saveAdminContent({
        boardId: cBoard,
        classGrade: cClass,
        subjectId: cSubject,
        chapterTitle: cChapter.trim() || 'General Revision',
        contentType: cType,
        title: cTitle.trim(),
        summary: cSummary.trim() || cTitle.trim(),
        body: cBody.trim(),
        isVerified: cStatus === 'published',
        status: cStatus,
      });
      setContentItems((prev) => [saved, ...prev]);
      setCTitle('');
      setCSummary('');
      setCBody('');
      setShowContentForm(false);
      flashNotice(`Saved learning content "${saved.title}"`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save learning content.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleChangeContentStatus = async (
    item: LearningContentItem,
    nextStatus: LearningContentStatus
  ) => {
    setMutatingKey(`content-${item.id}`);
    setError(null);
    try {
      const saved = await saveAdminContent({
        ...item,
        status: nextStatus,
        isVerified: nextStatus === 'published',
      });
      setContentItems((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
      flashNotice(`Content "${saved.title}" set to ${nextStatus}`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update content status.');
    } finally {
      setMutatingKey(null);
    }
  };

  // Moderation & Guardians
  const handleResolveModeration = async (
    item: PlatformModerationItem,
    decision: 'action-taken' | 'dismissed'
  ) => {
    setMutatingKey(`mod-${item.id}`);
    setError(null);
    try {
      const updatedReports = await resolveAdminModeration(item.id, {
        source: item.source,
        roomId: item.roomId,
        decision,
      });
      setModerationItems(updatedReports);
      flashNotice(`Moderation item resolved (${decision})`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve moderation report.');
    } finally {
      setMutatingKey(null);
    }
  };

  const handleUpdateGuardian = async (
    linkId: string,
    status: 'verified' | 'revoked'
  ) => {
    setMutatingKey(`guard-${linkId}`);
    setError(null);
    try {
      const updated = await updateAdminGuardianLink(linkId, { status });
      setGuardianLinks((prev) => prev.map((g) => (g.id === linkId ? updated : g)));
      flashNotice(`Guardian link for ${updated.studentDisplayName} set to ${updated.status}`);
      refreshOverviewAndLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update guardian link.');
    } finally {
      setMutatingKey(null);
    }
  };

  // Derived filters
  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false;
      if (!query) return true;
      return (
        u.displayName.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query) ||
        u.uid.toLowerCase().includes(query)
      );
    });
  }, [users, userSearch, userRoleFilter]);

  const filteredSyllabus = useMemo(
    () =>
      syllabusNodes.filter(
        (n) => n.boardId === syllabusBoardFilter && n.classGrade === syllabusClassFilter
      ),
    [syllabusNodes, syllabusBoardFilter, syllabusClassFilter]
  );

  const filteredModeration = useMemo(() => {
    if (moderationFilter === 'open') return moderationItems.filter((r) => r.status === 'open');
    if (moderationFilter === 'resolved') return moderationItems.filter((r) => r.status !== 'open');
    return moderationItems;
  }, [moderationItems, moderationFilter]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.summary.toLowerCase().includes(q) ||
        l.actorEmail.toLowerCase().includes(q) ||
        l.targetType.toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-400 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-bold text-white">Restricted Administrator Access</h1>
        <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
          This governance console is enforced server-side with Firebase ID Token verification and role-based access control. Sign in with an authorized administrator account to access platform governance.
        </p>
      </div>
    );
  }

  const tabs: Array<{ id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'overview', label: 'Overview & Health', icon: Activity },
    { id: 'users', label: 'Users & RBAC', icon: Users },
    { id: 'curriculum', label: 'Boards, Classes & Subjects', icon: Layers },
    { id: 'syllabus', label: 'Syllabus & Chapters', icon: BookOpen },
    { id: 'questions', label: 'Question Bank & Content', icon: FileCheck },
    { id: 'moderation', label: 'Moderation Queue', icon: Gavel },
    { id: 'guardians', label: 'Guardian Links', icon: Users2 },
    { id: 'audit', label: 'Security & Audit Logs', icon: ShieldAlert },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-400">
            Governance &amp; Platform Operations · Verified Role: Admin
          </p>
          <h1 className="text-2xl font-extrabold text-white mt-0.5">
            Eduverse Administration Console
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={loadAllAdminData}
            loading={loading}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Refresh Data
          </Button>
        </div>
      </div>

      {/* Status Notices */}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-rose-200 hover:text-white text-xs font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionNotice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Admin Console Sections"
        className="flex flex-wrap border-b border-slate-800 gap-1.5 pb-2.5"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const countHint =
            tab.id === 'moderation' && analytics
              ? analytics.openModerationReports
              : tab.id === 'users' && analytics
              ? analytics.totalUsers
              : null;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap border ${
                isActive
                  ? 'bg-slate-900 border-indigo-500/40 text-white'
                  : 'border-slate-800/70 bg-slate-950/60 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5 text-indigo-400" />
              <span>{tab.label}</span>
              {countHint !== null && (
                <span className="text-[11px] font-mono tabular-nums text-slate-400">
                  ({countHint})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Loading Skeleton */}
      {loading && !analytics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-2">
              <div className="h-3 w-24 bg-slate-800 rounded" />
              <div className="h-6 w-16 bg-slate-800 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* TAB 1: OVERVIEW & SYSTEM HEALTH */}
      {activeTab === 'overview' && analytics && health && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Registered Accounts
              </p>
              <p className="text-2xl font-bold text-white tabular-nums">{analytics.totalUsers}</p>
              <p className="text-xs text-slate-400 tabular-nums">
                {analytics.activeUsersByRole.student}{' '}
                {analytics.activeUsersByRole.student === 1 ? 'student' : 'students'} ·{' '}
                {analytics.activeUsersByRole.guardian}{' '}
                {analytics.activeUsersByRole.guardian === 1 ? 'guardian' : 'guardians'} ·{' '}
                {analytics.suspendedUsersCount} suspended
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Curriculum &amp; Bank
              </p>
              <p className="text-2xl font-bold text-white tabular-nums">
                {analytics.verifiedSyllabusCount}{' '}
                {analytics.verifiedSyllabusCount === 1 ? 'Chapter' : 'Chapters'}
              </p>
              <p className="text-xs text-slate-400 tabular-nums">
                {analytics.pendingSyllabusCount} pending · {analytics.questionBankCount}{' '}
                {analytics.questionBankCount === 1 ? 'question' : 'questions'} ·{' '}
                {analytics.publishedContentCount}{' '}
                {analytics.publishedContentCount === 1 ? 'guide' : 'guides'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Safety &amp; Moderation
              </p>
              <p className="text-2xl font-bold text-white tabular-nums">
                {analytics.openModerationReports} Open
              </p>
              <p className="text-xs text-slate-400 tabular-nums">
                {analytics.activeStudyRooms}{' '}
                {analytics.activeStudyRooms === 1 ? 'study pod' : 'study pods'} ·{' '}
                {analytics.verifiedGuardianLinks}{' '}
                {analytics.verifiedGuardianLinks === 1 ? 'verified guardian' : 'verified guardians'}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                AI Gateway Traffic
              </p>
              <p className="text-2xl font-bold text-white tabular-nums">
                {analytics.aiRequestsTotal} Calls
              </p>
              <p className="text-xs text-slate-400 tabular-nums">
                {analytics.aiSafetyBlocks} safety blocks · {analytics.aiRateLimitBlocks} rate limits
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* System Health Panel */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-indigo-400" />
                  Runtime System Health
                </h2>
                <Badge variant={health.status === 'healthy' ? 'success' : 'warning'} size="sm">
                  {health.status.toUpperCase()}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">Process Uptime</span>
                  <span className="text-white font-semibold tabular-nums font-mono">
                    {health.uptimeSeconds}s
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">Memory (Heap / RSS)</span>
                  <span className="text-white font-semibold tabular-nums font-mono">
                    {health.memoryHeapUsedMb} MB / {health.memoryRssMb} MB
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">Gemini Backend Key</span>
                  <span className={health.geminiConfigured ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                    {health.geminiConfigured ? 'Configured Server-Side' : 'Missing Key'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">Token Verification</span>
                  <span className="text-slate-200 font-semibold">
                    Firebase X.509 RSA
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-400">
                Project ID: <span className="font-mono text-slate-300">{health.firebaseProjectId}</span> · Auth Mode:{' '}
                <span className="text-emerald-400">Firebase Google &amp; Email/Password + X.509 RSA JWT</span>
              </p>
            </div>

            {/* AI Endpoint Usage Table */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  Recent AI Endpoint Activity
                </h2>
                <span className="text-xs text-slate-400 tabular-nums">
                  {analytics.recentAiEndpoints.length} tracked endpoints
                </span>
              </div>

              {analytics.recentAiEndpoints.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">
                  No AI requests recorded since server startup.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-2 font-semibold">Endpoint</th>
                        <th className="py-2 font-semibold text-right">Requests</th>
                        <th className="py-2 font-semibold text-right">Last Called</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {analytics.recentAiEndpoints.map((ep) => (
                        <tr key={ep.endpoint} className="hover:bg-slate-800/30">
                          <td className="py-2 font-mono text-slate-200">{ep.endpoint}</td>
                          <td className="py-2 text-right font-mono tabular-nums text-indigo-300">
                            {ep.count}
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums text-slate-400">
                            {new Date(ep.lastCalledAt).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: USERS & RBAC */}
      {activeTab === 'users' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">User Directory &amp; Role Management</h2>
              <p className="text-xs text-slate-400">
                Assign authoritative server-side roles and suspend compromised accounts.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search name or email..."
                  aria-label="Search users"
                  className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <select
                value={userRoleFilter}
                onChange={(e) => setUserRoleFilter(e.target.value as 'all' | UserRole)}
                aria-label="Filter users by role"
                className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
              >
                <option value="all">All Roles</option>
                <option value="student">Students</option>
                <option value="teacher">Teachers</option>
                <option value="guardian">Guardians</option>
                <option value="admin">Admins</option>
              </select>
            </div>
          </div>

          {filteredUsers.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No matching user accounts.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 pr-3 font-semibold">User</th>
                    <th className="py-2.5 px-3 font-semibold">Board &amp; Grade</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Verified XP</th>
                    <th className="py-2.5 px-3 font-semibold">Role</th>
                    <th className="py-2.5 pl-3 font-semibold text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredUsers.slice(0, usersLimit).map((account) => {
                    const isSelf = account.uid === user?.uid;
                    const busy = mutatingKey === `user-${account.uid}`;
                    return (
                      <tr key={account.uid} className="hover:bg-slate-800/30">
                        <td className="py-3 pr-3">
                          <p className="font-semibold text-white">{account.displayName}</p>
                          <p className="text-[11px] text-slate-400 font-mono">{account.email}</p>
                        </td>
                        <td className="py-3 px-3 text-slate-300">
                          {account.board} · {account.classGrade}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-200">
                          {account.verifiedXp.toLocaleString()} XP
                        </td>
                        <td className="py-3 px-3">
                          <select
                            aria-label={`Role for ${account.displayName}`}
                            value={account.role}
                            disabled={busy || isSelf}
                            onChange={(e) =>
                              handleUserMutation(account.uid, { role: e.target.value as UserRole })
                            }
                            className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white disabled:opacity-50"
                          >
                            <option value="student">student</option>
                            <option value="teacher">teacher</option>
                            <option value="guardian">guardian</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                        <td className="py-3 pl-3 text-right">
                          <Button
                            size="sm"
                            variant={account.status === 'active' ? 'outline' : 'secondary'}
                            disabled={busy || isSelf}
                            onClick={() =>
                              handleUserMutation(account.uid, {
                                status: account.status === 'active' ? 'suspended' : 'active',
                              })
                            }
                          >
                            {isSelf
                              ? 'Current Session'
                              : account.status === 'active'
                              ? 'Active (Suspend)'
                              : 'Suspended (Restore)'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredUsers.length > usersLimit && (
                <div className="pt-3 flex justify-center">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setUsersLimit((n) => n + 20)}
                  >
                    Show more users ({filteredUsers.length - usersLimit} remaining)
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: BOARDS, CLASSES & SUBJECTS */}
      {activeTab === 'curriculum' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Boards Management */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold text-white border-b border-slate-800 pb-3">
              Educational Boards ({boards.length})
            </h2>
            <form onSubmit={handleCreateBoard} className="space-y-2.5">
              <input
                type="text"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                placeholder="Board Code (e.g. NIOS)"
                aria-label="New board code"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                required
              />
              <input
                type="text"
                value={newBoardFullName}
                onChange={(e) => setNewBoardFullName(e.target.value)}
                placeholder="Full official board title"
                aria-label="New board full name"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
              />
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newBoardVerified}
                  onChange={(e) => setNewBoardVerified(e.target.checked)}
                />
                Mark officially verified
              </label>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                className="w-full"
                loading={mutatingKey === 'board-create'}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                Save Board
              </Button>
            </form>

            <div className="space-y-2 pt-2">
              {boards.map((b) => (
                <div
                  key={b.id}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{b.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">{b.fullName}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={b.isVerified ? 'secondary' : 'outline'}
                    onClick={() => handleToggleBoardVerify(b)}
                    disabled={mutatingKey === `board-${b.id}`}
                  >
                    {b.isVerified ? 'Verified' : 'Draft'}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Class Grades Management */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold text-white border-b border-slate-800 pb-3">
              Class Levels (Class 6 – 12)
            </h2>
            <div className="space-y-2">
              {classes.map((cls) => (
                <div
                  key={cls.id}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between"
                >
                  <div>
                    <p className="text-xs font-bold text-white">{cls.label}</p>
                    <p className="text-[11px] text-slate-400 font-mono tabular-nums">{cls.id}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={cls.active ? 'secondary' : 'outline'}
                    onClick={() => handleToggleClassActive(cls)}
                    disabled={mutatingKey === `class-${cls.id}`}
                  >
                    {cls.active ? 'Enabled' : 'Disabled'}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Subject Management */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold text-white border-b border-slate-800 pb-3">
              Subject Registry ({subjects.length})
            </h2>
            <form onSubmit={handleCreateSubject} className="space-y-2.5">
              <input
                type="text"
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
                placeholder="Subject Name (e.g. Economics)"
                aria-label="New subject name"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newSubjectBoard}
                  onChange={(e) => setNewSubjectBoard(e.target.value)}
                  aria-label="Subject board"
                  className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  {INDIAN_BOARDS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.id}
                    </option>
                  ))}
                </select>
                <select
                  value={newSubjectGrade}
                  onChange={(e) => setNewSubjectGrade(e.target.value as ClassGrade)}
                  aria-label="Subject grade"
                  className="px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  {CLASS_GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                className="w-full"
                loading={mutatingKey === 'subject-create'}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                Add Subject
              </Button>
            </form>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {subjects.map((sub) => (
                <div
                  key={sub.id}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">{sub.name}</p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {sub.boardIds.join(', ')} · {sub.grades.length} grades
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={sub.active ? 'secondary' : 'outline'}
                    onClick={() => handleToggleSubjectActive(sub)}
                    disabled={mutatingKey === `subject-${sub.id}`}
                  >
                    {sub.active ? 'Active' : 'Paused'}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SYLLABUS, CHAPTERS & TOPICS */}
      {activeTab === 'syllabus' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                  Board
                </label>
                <select
                  value={syllabusBoardFilter}
                  onChange={(e) => setSyllabusBoardFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  {INDIAN_BOARDS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                  Class / Grade
                </label>
                <select
                  value={syllabusClassFilter}
                  onChange={(e) => setSyllabusClassFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  {CLASS_GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowSyllabusForm(!showSyllabusForm)}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              {showSyllabusForm ? 'Close Form' : 'Add Syllabus Chapter'}
            </Button>
          </div>

          {showSyllabusForm && (
            <form
              onSubmit={handleAddSyllabus}
              className="rounded-2xl border border-indigo-500/30 bg-slate-900 p-5 space-y-4"
            >
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-indigo-400" />
                Create Chapter &amp; Topics ({syllabusBoardFilter} · {syllabusClassFilter})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={syllabusChapterNum}
                  onChange={(e) => setSyllabusChapterNum(Number(e.target.value))}
                  aria-label="Chapter number"
                  className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white tabular-nums"
                  required
                />
                <input
                  type="text"
                  value={syllabusChapterTitle}
                  onChange={(e) => setSyllabusChapterTitle(e.target.value)}
                  placeholder="Chapter Title"
                  aria-label="Chapter title"
                  className="sm:col-span-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  required
                />
                <select
                  value={syllabusSubject}
                  onChange={(e) => setSyllabusSubject(e.target.value)}
                  aria-label="Syllabus subject"
                  className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                >
                  <option value="science">Science</option>
                  <option value="mathematics">Mathematics</option>
                  <option value="physics">Physics</option>
                  <option value="chemistry">Chemistry</option>
                  <option value="social-science">Social Science</option>
                  <option value="english">English</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={syllabusSourceDoc}
                  onChange={(e) => setSyllabusSourceDoc(e.target.value)}
                  placeholder="Official Circular / Textbook Reference"
                  aria-label="Official source document"
                  className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  required
                />
                <label className="flex items-center gap-2 text-xs text-slate-300 px-2">
                  <input
                    type="checkbox"
                    checked={syllabusVerified}
                    onChange={(e) => setSyllabusVerified(e.target.checked)}
                  />
                  Mark Official Verified upon import
                </label>
              </div>
              <textarea
                rows={3}
                value={syllabusTopicsText}
                onChange={(e) => setSyllabusTopicsText(e.target.value)}
                aria-label="Chapter topics one per line"
                placeholder="One topic title per line..."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono"
                required
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowSyllabusForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" loading={mutatingKey === 'syllabus-create'}>
                  Save Syllabus Chapter
                </Button>
              </div>
            </form>
          )}

          {filteredSyllabus.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center space-y-2">
              <p className="text-xs text-slate-400">
                No syllabus chapters found for {syllabusBoardFilter} {syllabusClassFilter}.
              </p>
              <Button size="sm" variant="outline" onClick={() => setShowSyllabusForm(true)}>
                Add First Chapter
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSyllabus.map((node) => (
                <div
                  key={node.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                    <div>
                      <p className="text-sm font-bold text-white">
                        Ch <span className="tabular-nums">{node.chapterNumber}</span>: {node.chapterTitle}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {node.subjectId} · {node.sourceDoc || 'Draft source'} ·{' '}
                        <span className="tabular-nums">{node.topics.length} topics</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={node.isVerified ? 'success' : 'warning'} size="sm">
                        {node.isVerified ? 'Official Verified' : 'Draft / Pending'}
                      </Badge>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={mutatingKey === `syl-verify-${node.id}`}
                        onClick={() => handleVerifySyllabus(node.id, !node.isVerified)}
                      >
                        {node.isVerified ? 'Revert to Draft' : 'Approve Verification'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Delete chapter ${node.chapterTitle}`}
                        disabled={mutatingKey === `syl-del-${node.id}`}
                        onClick={() => handleDeleteSyllabus(node)}
                        icon={<Trash2 className="w-3.5 h-3.5 text-rose-400" />}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {node.topics.map((topic: any) => (
                      <div key={topic.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                        <p className="font-semibold text-indigo-300">
                          {topic.order}. {topic.title}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                          {(topic.learningObjectives || []).length} learning objectives
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: QUESTION BANK & LEARNING CONTENT */}
      {activeTab === 'questions' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-slate-900 border border-slate-800 p-1">
              <button
                type="button"
                onClick={() => setBankSection('questions')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  bankSection === 'questions' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Question Bank ({questions.length})
              </button>
              <button
                type="button"
                onClick={() => setBankSection('content')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  bankSection === 'content' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Learning Content ({contentItems.length})
              </button>
            </div>

            {bankSection === 'questions' ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowQuestionForm(!showQuestionForm)}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                {showQuestionForm ? 'Close Form' : 'New Question'}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowContentForm(!showContentForm)}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                {showContentForm ? 'Close Form' : 'New Study Guide'}
              </Button>
            )}
          </div>

          {bankSection === 'questions' && (
            <div className="space-y-4">
              {showQuestionForm && (
                <form
                  onSubmit={handleCreateQuestion}
                  className="rounded-2xl border border-indigo-500/30 bg-slate-900 p-5 space-y-3"
                >
                  <h3 className="text-sm font-bold text-white">Add Question Bank Item</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <select
                      value={qBoard}
                      onChange={(e) => setQBoard(e.target.value)}
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      {INDIAN_BOARDS.map((b) => (
                        <option key={b.id} value={b.id}>{b.id}</option>
                      ))}
                    </select>
                    <select
                      value={qClass}
                      onChange={(e) => setQClass(e.target.value as ClassGrade)}
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      {CLASS_GRADES.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                    <select
                      value={qType}
                      onChange={(e) => setQType(e.target.value as AdminQuestionFormat)}
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      {QUESTION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <select
                      value={qDifficulty}
                      onChange={(e) => setQDifficulty(e.target.value as AdminQuestionDifficulty)}
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      <option value="foundation">Foundation</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="board-challenge">Board Challenge</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      value={qSubject}
                      onChange={(e) => setQSubject(e.target.value)}
                      placeholder="Subject (e.g. Physics)"
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                      required
                    />
                    <input
                      type="text"
                      value={qChapter}
                      onChange={(e) => setQChapter(e.target.value)}
                      placeholder="Chapter Title"
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={qMarks}
                      onChange={(e) => setQMarks(Number(e.target.value))}
                      aria-label="Question marks"
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white tabular-nums"
                    />
                  </div>
                  <textarea
                    rows={2}
                    value={qPrompt}
                    onChange={(e) => setQPrompt(e.target.value)}
                    placeholder="Question prompt..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    required
                  />
                  {(qType === 'mcq' || qType === 'multiple-select') && (
                    <textarea
                      rows={3}
                      value={qOptionsText}
                      onChange={(e) => setQOptionsText(e.target.value)}
                      placeholder="Options (one per line)"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white font-mono"
                    />
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={qAnswer}
                      onChange={(e) => setQAnswer(e.target.value)}
                      placeholder="Correct Answer / Marking Key"
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                      required
                    />
                    <input
                      type="text"
                      value={qExplanation}
                      onChange={(e) => setQExplanation(e.target.value)}
                      placeholder="Concise step-by-step explanation"
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={qVerified}
                        onChange={(e) => setQVerified(e.target.checked)}
                      />
                      Verified for Live Assessments
                    </label>
                    <Button type="submit" size="sm" variant="primary" loading={mutatingKey === 'question-create'}>
                      Save Question
                    </Button>
                  </div>
                </form>
              )}

              <div className="space-y-3">
                {questions.slice(0, questionsLimit).map((q) => (
                  <div
                    key={q.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900 p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-indigo-300">
                        {q.boardId} · {q.classGrade} · {q.subjectId} · {q.questionType.toUpperCase()} ·{' '}
                        <span className="tabular-nums">{q.marks}m</span>
                      </p>
                      <p className="text-xs font-semibold text-white">{q.prompt}</p>
                      <p className="text-xs text-slate-400">
                        Key: <span className="text-emerald-300 font-medium">{q.correctAnswer}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant={q.isVerified ? 'secondary' : 'outline'}
                        disabled={mutatingKey === `q-verify-${q.id}`}
                        onClick={() => handleToggleQuestionVerified(q)}
                      >
                        {q.isVerified ? 'Verified' : 'Draft'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Delete question ${q.id}`}
                        disabled={mutatingKey === `q-del-${q.id}`}
                        onClick={() => handleDeleteQuestion(q.id)}
                        icon={<Trash2 className="w-3.5 h-3.5 text-rose-400" />}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
                {questions.length > questionsLimit && (
                  <div className="pt-2 flex justify-center">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setQuestionsLimit((n) => n + 20)}
                    >
                      Load more questions ({questions.length - questionsLimit} remaining)
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {bankSection === 'content' && (
            <div className="space-y-4">
              {showContentForm && (
                <form
                  onSubmit={handleCreateContent}
                  className="rounded-2xl border border-indigo-500/30 bg-slate-900 p-5 space-y-3"
                >
                  <h3 className="text-sm font-bold text-white">Create Learning Content Item</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <select
                      value={cBoard}
                      onChange={(e) => setCBoard(e.target.value)}
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      {INDIAN_BOARDS.map((b) => (
                        <option key={b.id} value={b.id}>{b.id}</option>
                      ))}
                    </select>
                    <select
                      value={cClass}
                      onChange={(e) => setCClass(e.target.value as ClassGrade)}
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      {CLASS_GRADES.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                    <select
                      value={cType}
                      onChange={(e) => setCType(e.target.value as LearningContentType)}
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      {CONTENT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <select
                      value={cStatus}
                      onChange={(e) => setCStatus(e.target.value as LearningContentStatus)}
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      <option value="published">Published</option>
                      <option value="draft">Draft</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={cSubject}
                      onChange={(e) => setCSubject(e.target.value)}
                      placeholder="Subject"
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                      required
                    />
                    <input
                      type="text"
                      value={cChapter}
                      onChange={(e) => setCChapter(e.target.value)}
                      placeholder="Chapter Title"
                      className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                  </div>
                  <input
                    type="text"
                    value={cTitle}
                    onChange={(e) => setCTitle(e.target.value)}
                    placeholder="Title (e.g. Ohm's Law & Circuit Formula Sheet)"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    required
                  />
                  <input
                    type="text"
                    value={cSummary}
                    onChange={(e) => setCSummary(e.target.value)}
                    placeholder="One-line student summary"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  />
                  <textarea
                    rows={3}
                    value={cBody}
                    onChange={(e) => setCBody(e.target.value)}
                    placeholder="Content body..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    required
                  />
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" variant="primary" loading={mutatingKey === 'content-create'}>
                      Save Content
                    </Button>
                  </div>
                </form>
              )}

              <div className="space-y-3">
                {contentItems.slice(0, contentLimit).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-indigo-300">
                        {item.boardId} · {item.classGrade} · {item.subjectId} · {item.contentType}
                      </p>
                      <p className="text-xs font-bold text-white">{item.title}</p>
                      <p className="text-xs text-slate-400">{item.summary}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant={
                          item.status === 'published'
                            ? 'success'
                            : item.status === 'draft'
                            ? 'warning'
                            : 'default'
                        }
                        size="sm"
                      >
                        {item.status}
                      </Badge>
                      <select
                        aria-label={`Status for ${item.title}`}
                        value={item.status}
                        disabled={mutatingKey === `content-${item.id}`}
                        onChange={(e) =>
                          handleChangeContentStatus(item, e.target.value as LearningContentStatus)
                        }
                        className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                      >
                        <option value="published">Published</option>
                        <option value="draft">Draft</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>
                  </div>
                ))}
                {contentItems.length > contentLimit && (
                  <div className="pt-2 flex justify-center">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setContentLimit((n) => n + 20)}
                    >
                      Load more guides ({contentItems.length - contentLimit} remaining)
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 6: MODERATION QUEUE */}
      {activeTab === 'moderation' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-white">Safety &amp; Study Pod Moderation Queue</h2>
              <p className="text-xs text-slate-400">
                Unified queue across Study Pod reports and automated K-12 AI safety escalations.
              </p>
            </div>
            <div className="inline-flex rounded-xl bg-slate-950 border border-slate-800 p-1">
              {(['open', 'resolved', 'all'] as const).map((statusKey) => (
                <button
                  key={statusKey}
                  type="button"
                  onClick={() => setModerationFilter(statusKey)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize cursor-pointer ${
                    moderationFilter === statusKey
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {statusKey}
                </button>
              ))}
            </div>
          </div>

          {filteredModeration.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">
              No moderation reports match the selected filter.
            </p>
          ) : (
            <div className="space-y-3">
              {filteredModeration.map((rep) => (
                <div
                  key={rep.id}
                  className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          rep.status === 'open'
                            ? 'rose'
                            : rep.status === 'action-taken'
                            ? 'success'
                            : 'default'
                        }
                        size="sm"
                      >
                        {rep.status}
                      </Badge>
                      <span className="text-xs font-bold text-white">
                        {rep.source === 'study-room' ? `Study Pod: ${rep.roomTitle || rep.roomId}` : rep.source}
                      </span>
                      <span className="text-xs text-slate-400">
                        · {rep.targetType} · Reason: {rep.reason}
                      </span>
                    </div>
                    <p className="text-xs text-slate-200">{rep.targetPreview}</p>
                    <p className="text-[11px] text-slate-400 tabular-nums">
                      Reported by {rep.reporterAlias} · {new Date(rep.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {rep.status === 'open' ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={mutatingKey === `mod-${rep.id}`}
                        onClick={() => handleResolveModeration(rep, 'action-taken')}
                      >
                        Take Action
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutatingKey === `mod-${rep.id}`}
                        onClick={() => handleResolveModeration(rep, 'dismissed')}
                      >
                        Dismiss
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400 font-mono tabular-nums shrink-0">
                      Resolved {rep.resolvedAt ? new Date(rep.resolvedAt).toLocaleDateString() : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 7: GUARDIAN LINKS */}
      {activeTab === 'guardians' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-sm font-bold text-white">Guardian-Student Verification Oversight</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Only student-approved and verified links grant read access to redacted progress, goals, and exam summaries.
            </p>
          </div>

          {guardianLinks.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No guardian links registered yet.</p>
          ) : (
            <div className="space-y-3">
              {guardianLinks.map((link) => (
                <div
                  key={link.id}
                  className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-white">
                        {link.guardianName} ({link.relationship})
                      </span>
                      <span className="text-xs text-indigo-300">
                        → {link.studentDisplayName} ({link.studentBoard} · {link.studentClassGrade})
                      </span>
                      <Badge
                        variant={
                          link.status === 'verified'
                            ? 'success'
                            : link.status === 'pending'
                            ? 'warning'
                            : 'rose'
                        }
                        size="sm"
                      >
                        {link.status}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Permissions: Progress ({link.permissions.canViewProgress ? 'On' : 'Off'}) · Goals (
                      {link.permissions.canViewGoals ? 'On' : 'Off'}) · Assessments (
                      {link.permissions.canViewAssessments ? 'On' : 'Off'}) · Alerts (
                      {link.permissions.canReceiveAlerts ? 'On' : 'Off'})
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {link.status !== 'verified' && (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={mutatingKey === `guard-${link.id}`}
                        onClick={() => handleUpdateGuardian(link.id, 'verified')}
                      >
                        Approve
                      </Button>
                    )}
                    {link.status !== 'revoked' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutatingKey === `guard-${link.id}`}
                        onClick={() => handleUpdateGuardian(link.id, 'revoked')}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 8: SECURITY & AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Active Security Controls
            </h2>
            <div className="space-y-2.5">
              {securityChecks.map((check) => (
                <div
                  key={check.id}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start justify-between gap-3"
                >
                  <div>
                    <p className="text-xs font-bold text-white">{check.control}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{check.detail}</p>
                  </div>
                  <Badge
                    variant={
                      check.status === 'enforced'
                        ? 'success'
                        : check.status === 'partial'
                        ? 'warning'
                        : 'info'
                    }
                    size="sm"
                  >
                    {check.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-white">Immutable Audit Log</h2>
              <div className="relative">
                <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Filter audit trail..."
                  aria-label="Filter audit trail"
                  className="pl-8 pr-3 py-1 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                />
              </div>
            </div>

            {filteredAuditLogs.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">No matching audit log entries.</p>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {filteredAuditLogs.slice(0, auditLimit).map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-indigo-300">{entry.action}</span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-400">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-200">{entry.summary}</p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      {entry.actorEmail} ({entry.actorRole}) · {entry.targetType}:{entry.targetId}
                    </p>
                  </div>
                ))}
                {filteredAuditLogs.length > auditLimit && (
                  <div className="pt-2 flex justify-center">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setAuditLimit((n) => n + 25)}
                    >
                      Show older entries ({filteredAuditLogs.length - auditLimit} remaining)
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
