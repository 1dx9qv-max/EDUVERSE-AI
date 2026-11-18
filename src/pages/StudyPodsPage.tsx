import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users,
  Lock,
  Unlock,
  KeyRound,
  Plus,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Target,
  HelpCircle,
  GitFork,
  Flag,
  Pin,
  EyeOff,
  Eye,
  Sparkles,
  RefreshCw,
  ThumbsUp,
  UserX,
  VolumeX,
  Volume2,
  Wifi,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  createPrivateStudyRoom,
  createStudyRoomGoal,
  createStudyRoomQuiz,
  endorseStudyRoomMindMap,
  fetchMyStudyRooms,
  generateAiRoomQuiz,
  getFirebaseIdToken,
  incrementStudyRoomGoal,
  joinStudyRoomByInvite,
  moderateStudyRoom,
  postStudyRoomNote,
  reportStudyRoomItem,
  shareStudyRoomMindMap,
  submitStudyRoomQuiz,
} from '../api/client';
import {
  dispatchVerifiedLearningEvent,
  fetchMindMaps as fetchLocalOrFirestoreMindMaps,
  subscribeStudyRoomMetadata,
  syncStudyRoomCreationToFirestore,
  syncStudyRoomJoinToFirestore,
} from '../lib/firestoreService';
import { computeGroupProgress, canUserModerateRoom } from '../utils/collaborationEngine';
import { MindMapDocument } from '../types/phase3';
import {
  StudyRoom,
  StudyRoomQuiz,
  StudyRoomReportReason,
} from '../types/phase7';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';

type RoomTab = 'notes' | 'goals' | 'quizzes' | 'mindmaps' | 'members';

const REPORT_REASONS: Array<{ value: StudyRoomReportReason; label: string }> = [
  { value: 'spam-or-offtopic', label: 'Off-topic / Spam' },
  { value: 'inappropriate-language', label: 'Inappropriate Language' },
  { value: 'personal-info-shared', label: 'Personal Contact / PII Shared' },
  { value: 'external-link', label: 'External Link / Invite' },
  { value: 'harassment', label: 'Disrespectful / Harassment' },
];

export const StudyPodsPage: React.FC = () => {
  const { user } = useAuth();
  const uid = user?.uid || '';

  const [rooms, setRooms] = useState<StudyRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [onlineUids, setOnlineUids] = useState<string[]>([]);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'offline'>('offline');
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<RoomTab>('notes');

  // Create & Join Panels
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createSubject, setCreateSubject] = useState(user?.subjects?.[0] || 'Science');
  const [createTopic, setCreateTopic] = useState('');
  const [createMaxMembers, setCreateMaxMembers] = useState(10);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [submittingModal, setSubmittingModal] = useState(false);

  // Copy feedback
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Notes composer
  const [noteTitle, setNoteTitle] = useState('');
  const [noteTopic, setNoteTopic] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [postingNote, setPostingNote] = useState(false);

  // Inline report modal state
  const [reportingNoteId, setReportingNoteId] = useState<string | null>(null);
  const [reportingMemberUid, setReportingMemberUid] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<StudyRoomReportReason>('spam-or-offtopic');
  const [reportDetails, setReportDetails] = useState('');

  // Goals composer
  const [goalTitle, setGoalTitle] = useState('');
  const [goalTarget, setGoalTarget] = useState(5);
  const [goalUnit, setGoalUnit] = useState('problems');
  const [creatingGoal, setCreatingGoal] = useState(false);

  // Quiz builder & active runner
  const [quizTitle, setQuizTitle] = useState('');
  const [quizPrompt, setQuizPrompt] = useState('');
  const [quizOptA, setQuizOptA] = useState('');
  const [quizOptB, setQuizOptB] = useState('');
  const [quizOptC, setQuizOptC] = useState('');
  const [quizOptD, setQuizOptD] = useState('');
  const [quizCorrectIdx, setQuizCorrectIdx] = useState(0);
  const [generatingAiQuiz, setGeneratingAiQuiz] = useState(false);
  const [quizAnswersMap, setQuizAnswersMap] = useState<Record<string, Record<number, number>>>({});

  // Mind Map sharing
  const [savedMindMaps, setSavedMindMaps] = useState<MindMapDocument[]>([]);
  const [customMapTitle, setCustomMapTitle] = useState('');
  const [customMapBranches, setCustomMapBranches] = useState('Key Formula, Solved Example, Common Mistake');

  const wsRef = useRef<WebSocket | null>(null);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) || rooms[0] || null,
    [rooms, selectedRoomId]
  );

  const isModerator = useMemo(
    () => (activeRoom ? canUserModerateRoom(activeRoom, uid) : false),
    [activeRoom, uid]
  );

  const currentMember = useMemo(
    () => (activeRoom ? activeRoom.members.find((m) => m.uid === uid) || null : null),
    [activeRoom, uid]
  );

  const postingBlockedReason = useMemo(() => {
    if (!activeRoom) return null;
    if (currentMember?.status === 'muted') {
      return 'Your posting permission is currently muted by the room moderator (read-only mode).';
    }
    if (activeRoom.isLocked && !isModerator) {
      return 'This study pod is temporarily locked by the host (read-only mode).';
    }
    return null;
  }, [activeRoom, currentMember, isModerator]);

  const groupProgress = useMemo(
    () => (activeRoom ? computeGroupProgress(activeRoom) : null),
    [activeRoom]
  );

  const upsertRoomInList = useCallback((updated: StudyRoom) => {
    setRooms((prev) => {
      const exists = prev.some((r) => r.id === updated.id);
      if (!exists) return [updated, ...prev];
      return prev.map((r) => (r.id === updated.id ? updated : r));
    });
  }, []);

  const loadRooms = useCallback(
    async (targetUid: string, isCancelled?: () => boolean) => {
      if (!targetUid) return;
      setLoading(true);
      try {
        const list = await fetchMyStudyRooms(targetUid);
        if (isCancelled?.()) return;
        setRooms(list);
        setSelectedRoomId((prevSelected) => {
          if (list.length === 0) return null;
          if (prevSelected && list.some((r) => r.id === prevSelected)) {
            return prevSelected;
          }
          return list[0].id;
        });
      } catch (err: any) {
        if (!isCancelled?.()) {
          setErrorBanner(err?.message || 'Could not load your private study pods.');
        }
      } finally {
        if (!isCancelled?.()) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    setRooms([]);
    setSelectedRoomId(null);
    setOnlineUids([]);
    setErrorBanner(null);
    setSuccessBanner(null);
    loadRooms(uid, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [uid, loadRooms]);

  useEffect(() => {
    if (!uid) return;
    fetchLocalOrFirestoreMindMaps(uid)
      .then((maps) => setSavedMindMaps(maps))
      .catch(() => {});
  }, [uid]);

  // Real-time WebSocket subscription for active room
  useEffect(() => {
    const activeMembership =
      activeRoom &&
      (activeRoom.hostUid === uid || activeRoom.members.some((m) => m.uid === uid));
    if (!activeRoom?.id || !uid || !activeMembership) {
      setWsStatus('offline');
      return;
    }

    let closed = false;
    let activeWs: WebSocket | null = null;
    let unsubFirestore = () => {};

    const startRealtime = async () => {
      const idToken = await getFirebaseIdToken();
      if (closed || !idToken) {
        if (!closed) setWsStatus('offline');
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/study-rooms`;
      setWsStatus('connecting');

      const ws = new WebSocket(wsUrl);
      activeWs = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        setWsStatus('connected');
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            roomId: activeRoom.id,
            uid,
            idToken,
          })
        );
      };

      ws.onmessage = (ev) => {
        if (closed) return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'room:state' || msg.type === 'room:update') {
            if (msg.room) {
              const roomPayload = msg.room as StudyRoom;
              const belongsToUser =
                roomPayload.hostUid === uid ||
                roomPayload.members.some((m) => m.uid === uid && m.status !== 'removed');
              if (belongsToUser) {
                upsertRoomInList(roomPayload);
              }
            }
            if (Array.isArray(msg.onlineUids)) setOnlineUids(msg.onlineUids);
          } else if (msg.type === 'presence:update') {
            if (Array.isArray(msg.onlineUids)) setOnlineUids(msg.onlineUids);
          } else if (msg.type === 'room:revoked') {
            setRooms((prev) => prev.filter((r) => r.id !== msg.roomId));
            setErrorBanner(msg.message || 'Access to this room was removed.');
          } else if (msg.type === 'error' && msg.code === 'FORBIDDEN') {
            setErrorBanner(msg.message || 'Access denied.');
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (!closed) setWsStatus('offline');
      };

      ws.onerror = () => {
        if (!closed) setWsStatus('offline');
      };

      unsubFirestore = subscribeStudyRoomMetadata(
        activeRoom.id,
        (meta) => {
          setRooms((prev) =>
            prev.map((r) =>
              r.id === activeRoom.id
                ? {
                    ...r,
                    isLocked: typeof meta.isLocked === 'boolean' ? meta.isLocked : r.isLocked,
                    title: typeof meta.title === 'string' ? meta.title : r.title,
                  }
                : r
            )
          );
        }
      );
    };

    void startRealtime();

    return () => {
      closed = true;
      unsubFirestore();
      if (activeWs && (activeWs.readyState === WebSocket.OPEN || activeWs.readyState === WebSocket.CONNECTING)) {
        activeWs.close();
      }
      wsRef.current = null;
    };
  }, [activeRoom?.id, uid, upsertRoomInList]);

  const clearAlerts = () => {
    setErrorBanner(null);
    setSuccessBanner(null);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();
    setSubmittingModal(true);
    try {
      const { room, invite } = await createPrivateStudyRoom({
        uid,
        displayName: user?.displayName || 'Eduverse Scholar',
        board: user?.board || 'CBSE',
        classGrade: user?.classGrade || 'Class 10',
        subject: createSubject || 'Science',
        title: createTitle,
        topic: createTopic || createSubject,
        maxMembers: createMaxMembers,
      });
      await syncStudyRoomCreationToFirestore(room, invite).catch(() => {});
      upsertRoomInList(room);
      setSelectedRoomId(room.id);
      setShowCreateForm(false);
      setCreateTitle('');
      setCreateTopic('');
      setSuccessBanner(`Private pod created! Share invite code ${room.inviteCode} only with trusted classmates.`);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Unable to create study pod.');
    } finally {
      setSubmittingModal(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();
    setSubmittingModal(true);
    try {
      const { room } = await joinStudyRoomByInvite({
        inviteCode: joinCodeInput,
        uid,
        displayName: user?.displayName || 'Eduverse Scholar',
        board: user?.board || 'CBSE',
        classGrade: user?.classGrade || 'Class 10',
      });
      await syncStudyRoomJoinToFirestore(room).catch(() => {});
      upsertRoomInList(room);
      setSelectedRoomId(room.id);
      setShowJoinForm(false);
      setJoinCodeInput('');
      setSuccessBanner(`Joined "${room.title}" safely.`);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Invite code rejected.');
    } finally {
      setSubmittingModal(false);
    }
  };

  const handleCopyInvite = () => {
    if (!activeRoom || activeRoom.inviteCode === 'INVITE-ONLY') return;
    navigator.clipboard?.writeText(activeRoom.inviteCode).catch(() => {});
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1800);
  };

  const handlePostNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom) return;
    clearAlerts();
    setPostingNote(true);
    try {
      const { room } = await postStudyRoomNote(activeRoom.id, {
        uid,
        title: noteTitle,
        topic: noteTopic || activeRoom.topic,
        body: noteBody,
      });
      upsertRoomInList(room);
      setNoteTitle('');
      setNoteTopic('');
      setNoteBody('');
      void dispatchVerifiedLearningEvent({
        eventType: 'study_goal_completed',
        subject: activeRoom.subject,
        topic: noteTopic || activeRoom.topic,
        sourceModule: 'dashboard',
        idempotencyKey: `pod_note_${activeRoom.id}_${Date.now()}`,
        title: `Shared Study Note in ${activeRoom.title}`,
        description: noteTitle,
      });
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not post note.');
    } finally {
      setPostingNote(false);
    }
  };

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom) return;
    clearAlerts();
    setCreatingGoal(true);
    try {
      const { room } = await createStudyRoomGoal(activeRoom.id, {
        uid,
        title: goalTitle,
        targetCount: goalTarget,
        unit: goalUnit,
      });
      upsertRoomInList(room);
      setGoalTitle('');
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not add collaborative goal.');
    } finally {
      setCreatingGoal(false);
    }
  };

  const handleIncrementGoal = async (goalId: string) => {
    if (!activeRoom) return;
    clearAlerts();
    try {
      const { room } = await incrementStudyRoomGoal(activeRoom.id, goalId, uid);
      upsertRoomInList(room);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not update goal progress.');
    }
  };

  const handleAiGenerateQuiz = async () => {
    if (!activeRoom) return;
    clearAlerts();
    setGeneratingAiQuiz(true);
    try {
      const generated = await generateAiRoomQuiz({
        subject: activeRoom.subject,
        topic: activeRoom.topic,
        board: activeRoom.board,
        classGrade: activeRoom.classGrade,
        count: 3,
      });
      const { room } = await createStudyRoomQuiz(activeRoom.id, {
        uid,
        title: generated.title,
        subject: activeRoom.subject,
        topic: activeRoom.topic,
        questions: generated.questions,
      });
      upsertRoomInList(room);
      setSuccessBanner(`AI generated & launched "${generated.title}" for your study pod.`);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not generate AI group quiz.');
    } finally {
      setGeneratingAiQuiz(false);
    }
  };

  const handleManualCreateQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom) return;
    clearAlerts();
    try {
      const { room } = await createStudyRoomQuiz(activeRoom.id, {
        uid,
        title: quizTitle || `${activeRoom.topic} Quick Check`,
        subject: activeRoom.subject,
        topic: activeRoom.topic,
        questions: [
          {
            prompt: quizPrompt,
            options: [quizOptA, quizOptB, quizOptC, quizOptD].filter((o) => o.trim().length > 0),
            correctIndex: quizCorrectIdx,
            explanation: `Peer-authored question in ${activeRoom.title}.`,
          },
        ],
      });
      upsertRoomInList(room);
      setQuizTitle('');
      setQuizPrompt('');
      setQuizOptA('');
      setQuizOptB('');
      setQuizOptC('');
      setQuizOptD('');
      setQuizCorrectIdx(0);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not create group quiz.');
    }
  };

  const handleSubmitQuiz = async (quiz: StudyRoomQuiz) => {
    if (!activeRoom) return;
    clearAlerts();
    const userMap = quizAnswersMap[quiz.id] || {};
    const answers = quiz.questions.map((_, idx) =>
      typeof userMap[idx] === 'number' ? userMap[idx] : -1
    );
    try {
      const { room } = await submitStudyRoomQuiz(activeRoom.id, quiz.id, {
        uid,
        answers,
      });
      upsertRoomInList(room);
      void dispatchVerifiedLearningEvent({
        eventType: 'practice_attempted',
        subject: activeRoom.subject,
        topic: activeRoom.topic,
        sourceModule: 'practice',
        idempotencyKey: `pod_quiz_${quiz.id}_${uid}`,
        isCorrect: true,
        title: `Completed Pod Quiz: ${quiz.title}`,
        description: `Collaborated in ${activeRoom.title}`,
      });
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not submit quiz.');
    }
  };

  const handleShareSavedMindMap = async (map: MindMapDocument) => {
    if (!activeRoom) return;
    clearAlerts();
    try {
      const { room } = await shareStudyRoomMindMap(activeRoom.id, {
        uid,
        sourceMindMapId: map.id,
        title: map.title,
        subject: map.subject,
        topic: map.topic,
        nodes: map.nodes.slice(0, 30).map((n) => ({
          id: n.id,
          label: n.label,
          parentId: n.parentId,
          summary: n.note,
        })),
      });
      upsertRoomInList(room);
      setSuccessBanner(`Shared Mind Map "${map.title}" with your pod.`);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not share mind map.');
    }
  };

  const handleCreateCustomRoomMap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom) return;
    clearAlerts();
    const branches = customMapBranches
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!customMapTitle.trim() || branches.length === 0) {
      setErrorBanner('Enter a central concept title and at least one branch.');
      return;
    }
    try {
      const nodes = [
        { id: 'root', label: customMapTitle.trim(), parentId: null, summary: activeRoom.topic },
        ...branches.map((label, idx) => ({
          id: `b_${idx}`,
          label,
          parentId: 'root',
        })),
      ];
      const { room } = await shareStudyRoomMindMap(activeRoom.id, {
        uid,
        title: customMapTitle.trim(),
        subject: activeRoom.subject,
        topic: activeRoom.topic,
        nodes,
      });
      upsertRoomInList(room);
      setCustomMapTitle('');
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not publish concept map.');
    }
  };

  const handleEndorseMap = async (mapId: string) => {
    if (!activeRoom) return;
    try {
      const { room } = await endorseStudyRoomMindMap(activeRoom.id, mapId, uid);
      upsertRoomInList(room);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not endorse mind map.');
    }
  };

  const handleSubmitReport = async (
    targetId: string,
    targetPreview: string,
    targetType: 'note' | 'member' = 'note'
  ) => {
    if (!activeRoom) return;
    clearAlerts();
    try {
      const { room } = await reportStudyRoomItem(activeRoom.id, {
        uid,
        targetType,
        targetId,
        targetPreview,
        reason: reportReason,
        details: reportDetails,
      });
      upsertRoomInList(room);
      setReportingNoteId(null);
      setReportingMemberUid(null);
      setReportDetails('');
      setSuccessBanner('Safety report submitted to the room moderator.');
    } catch (err: any) {
      setErrorBanner(err?.message || 'Could not submit report.');
    }
  };

  const handleModerate = async (
    action:
      | 'hide-note'
      | 'restore-note'
      | 'toggle-pin-note'
      | 'resolve-report'
      | 'dismiss-report'
      | 'mute-member'
      | 'unmute-member'
      | 'remove-member'
      | 'toggle-lock'
      | 'rotate-invite',
    targetId?: string
  ) => {
    if (!activeRoom) return;
    clearAlerts();
    try {
      const { room } = await moderateStudyRoom(activeRoom.id, { uid, action, targetId });
      upsertRoomInList(room);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Moderation action rejected.');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>EDUVERSE</span>
            <span>/</span>
            <span className="text-sky-300 font-semibold">Peer Study Pods</span>
            <Badge variant="default" size="sm">Invite-Only</Badge>
            <Badge variant="success" size="sm">DMs Disabled · Moderated</Badge>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Users className="w-6 h-6 text-sky-400" />
            Moderated Study Spaces
          </h1>
          <p className="text-xs text-slate-400 max-w-2xl">
            Collaborate inside private invitation-only study rooms with real-time shared notes, group goals, quizzes, and mind maps. Private student profiles and public direct messaging stay disabled by default.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              clearAlerts();
              setShowJoinForm((v) => !v);
              setShowCreateForm(false);
            }}
            icon={<KeyRound className="w-4 h-4" />}
          >
            Join via Invite
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              clearAlerts();
              setShowCreateForm((v) => !v);
              setShowJoinForm(false);
            }}
            icon={<Plus className="w-4 h-4" />}
          >
            Create Private Pod
          </Button>
        </div>
      </div>

      {/* Feedback Banners */}
      {errorBanner && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-rose-300 hover:text-white text-xs font-semibold shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {successBanner && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-300 hover:text-white text-xs font-semibold shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Create Private Pod Panel */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateRoom}
          className="p-5 rounded-2xl bg-slate-900 border border-sky-500/30 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-sky-400" />
              Create Private Invitation-Only Pod
            </h2>
            <span className="text-[11px] text-slate-400">
              {user?.board || 'CBSE'} · {user?.classGrade || 'Class 10'}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label htmlFor="pod-title-input" className="block text-[11px] font-semibold text-slate-300 mb-1">
                Study Pod Title
              </label>
              <input
                id="pod-title-input"
                type="text"
                required
                maxLength={120}
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="e.g., Class 10 Optics Revision Group"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label htmlFor="pod-subject-input" className="block text-[11px] font-semibold text-slate-300 mb-1">
                Subject
              </label>
              <input
                id="pod-subject-input"
                type="text"
                required
                maxLength={80}
                value={createSubject}
                onChange={(e) => setCreateSubject(e.target.value)}
                placeholder="Science / Mathematics"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label htmlFor="pod-topic-input" className="block text-[11px] font-semibold text-slate-300 mb-1">
                Focus Chapter / Topic
              </label>
              <input
                id="pod-topic-input"
                type="text"
                required
                maxLength={140}
                value={createTopic}
                onChange={(e) => setCreateTopic(e.target.value)}
                placeholder="e.g., Refraction & Lens Formula"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <label htmlFor="pod-max-members" className="text-[11px] text-slate-400">
                Max Scholars:
              </label>
              <input
                id="pod-max-members"
                type="number"
                min={2}
                max={25}
                value={createMaxMembers}
                onChange={(e) => setCreateMaxMembers(Number(e.target.value) || 10)}
                className="w-20 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white tabular-nums"
              />
              <span className="text-[11px] text-slate-500">
                Only classmates with the secret invite code can join.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" variant="primary" disabled={submittingModal}>
                {submittingModal ? 'Creating...' : 'Create Private Pod'}
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* Join via Invite Panel */}
      {showJoinForm && (
        <form
          onSubmit={handleJoinRoom}
          className="p-5 rounded-2xl bg-slate-900 border border-indigo-500/30 flex flex-col sm:flex-row sm:items-end gap-3"
        >
          <div className="flex-1">
            <label htmlFor="pod-invite-input" className="block text-[11px] font-semibold text-slate-300 mb-1">
              Enter Secret Pod Invite Code
            </label>
            <input
              id="pod-invite-input"
              type="text"
              required
              maxLength={24}
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              placeholder="e.g., K7M4P9QR"
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono tracking-widest text-white uppercase focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowJoinForm(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="primary" disabled={submittingModal}>
              {submittingModal ? 'Verifying Invite...' : 'Join Study Pod'}
            </Button>
          </div>
        </form>
      )}

      {/* Joined Pods Strip */}
      {rooms.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {rooms.map((r) => {
            const active = activeRoom?.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedRoomId(r.id)}
                className={`px-3.5 py-2 rounded-xl border text-left transition-colors shrink-0 ${
                  active
                    ? 'bg-sky-500/15 border-sky-500/40 text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-bold">
                  <Lock className="w-3.5 h-3.5 text-sky-400" />
                  <span>{r.title}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                  {r.subject} · {r.members.filter((m) => m.status !== 'removed').length} members
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Empty State vs Active Workspace */}
      {loading && rooms.length === 0 ? (
        <div className="p-10 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
          Loading your private study pods...
        </div>
      ) : !activeRoom ? (
        <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-base font-bold text-white">No Study Pods Joined Yet</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              For student safety, Eduverse never lists public chatrooms. Create a private study pod for your class chapter or join one using an invite code shared by a classmate or teacher.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Button size="sm" variant="primary" onClick={() => setShowCreateForm(true)} icon={<Plus className="w-4 h-4" />}>
              Create Private Pod
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowJoinForm(true)} icon={<KeyRound className="w-4 h-4" />}>
              Enter Invite Code
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Active Room Control Header */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-sky-300">{activeRoom.board} · {activeRoom.classGrade} · {activeRoom.subject}</span>
                  {activeRoom.isLocked && (
                    <Badge variant="warning" size="sm">Read-Only Locked</Badge>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                    <Wifi className="w-3.5 h-3.5" />
                    {wsStatus === 'connected' ? 'Real-Time Sync Live' : wsStatus === 'connecting' ? 'Connecting Sync...' : 'Sync Paused'}
                  </span>
                </div>
                <h2 className="text-xl font-extrabold text-white">{activeRoom.title}</h2>
                <p className="text-xs text-slate-400">
                  Focus Topic: <span className="text-slate-200 font-medium">{activeRoom.topic}</span> · Host: <span className="text-slate-200">{activeRoom.hostAlias}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {activeRoom.inviteCode !== 'INVITE-ONLY' && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[11px] text-slate-400">Invite Code:</span>
                    <code className="text-xs font-mono font-bold text-sky-300 tracking-wider">
                      {activeRoom.inviteCode}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyInvite}
                      aria-label="Copy invite code"
                      className="text-slate-400 hover:text-white p-1"
                    >
                      {copiedInvite ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}

                {isModerator && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleModerate('rotate-invite')}
                      icon={<RefreshCw className="w-3.5 h-3.5" />}
                    >
                      Rotate Invite
                    </Button>
                    <Button
                      size="sm"
                      variant={activeRoom.isLocked ? 'secondary' : 'outline'}
                      onClick={() => handleModerate('toggle-lock')}
                      icon={activeRoom.isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    >
                      {activeRoom.isLocked ? 'Unlock Room' : 'Lock Room'}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Group Progress Metrics (Single-Elevation Grid, Tabular Numerals) */}
            {groupProgress && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-800">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 block">Shared Notes</span>
                  <span className="text-lg font-extrabold text-white tabular-nums">
                    {groupProgress.totalNotesVisible}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 block">Collaborative Goals</span>
                  <span className="text-lg font-extrabold text-emerald-400 tabular-nums">
                    {groupProgress.completedGoals}/{groupProgress.totalGoals} ({groupProgress.goalCompletionPercent}%)
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 block">Group Quiz Accuracy</span>
                  <span className="text-lg font-extrabold text-sky-400 tabular-nums">
                    {groupProgress.totalQuizSubmissions > 0 ? `${groupProgress.averageQuizAccuracy}%` : '—'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                  <span className="text-[11px] text-slate-400 block">Mind Maps & Peers</span>
                  <span className="text-lg font-extrabold text-indigo-300 tabular-nums">
                    {groupProgress.sharedMindMapsCount} maps · {activeRoom.members.filter((m) => m.status !== 'removed').length}/{activeRoom.maxMembers}
                  </span>
                </div>
              </div>
            )}

            {/* Tab Bar */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
              {(
                [
                  { id: 'notes', label: 'Shared Notes', icon: FileText, count: activeRoom.notes.length },
                  { id: 'goals', label: 'Study Goals', icon: Target, count: activeRoom.goals.length },
                  { id: 'quizzes', label: 'Group Quizzes', icon: HelpCircle, count: activeRoom.quizzes.length },
                  { id: 'mindmaps', label: 'Shared Mind Maps', icon: GitFork, count: activeRoom.mindMaps.length },
                  {
                    id: 'members',
                    label: isModerator && (groupProgress?.openReportsCount || 0) > 0
                      ? `Members & Safety (${groupProgress?.openReportsCount})`
                      : 'Members & Safety',
                    icon: ShieldCheck,
                    count: activeRoom.members.filter((m) => m.status !== 'removed').length,
                  },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const isSelected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors ${
                      isSelected
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                    <span className="text-[10px] opacity-80 tabular-nums">({tab.count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {postingBlockedReason && (
            <div
              role="status"
              className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center gap-2"
            >
              <Lock className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{postingBlockedReason}</span>
            </div>
          )}

          {/* TAB 1: SHARED NOTES */}
          {activeTab === 'notes' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <form
                onSubmit={handlePostNote}
                className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 h-fit"
              >
                <h3 className="text-sm font-bold text-white">Post Study Note</h3>
                <p className="text-[11px] text-slate-400">
                  Age-safe filter active: external links, phone numbers, and email addresses are automatically blocked.
                </p>
                <div>
                  <label htmlFor="note-title" className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Note Heading
                  </label>
                  <input
                    id="note-title"
                    type="text"
                    required
                    maxLength={160}
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="e.g., Mirror Formula Sign Convention"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label htmlFor="note-topic" className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Sub-topic
                  </label>
                  <input
                    id="note-topic"
                    type="text"
                    maxLength={140}
                    value={noteTopic}
                    onChange={(e) => setNoteTopic(e.target.value)}
                    placeholder={activeRoom.topic}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label htmlFor="note-body" className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Summary / Formula / Key Explanation
                  </label>
                  <textarea
                    id="note-body"
                    required
                    rows={4}
                    maxLength={2000}
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    placeholder="Write clear revision points for your group..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="w-full"
                  disabled={postingNote || Boolean(postingBlockedReason)}
                >
                  {postingNote ? 'Sharing Note...' : 'Share Note with Pod'}
                </Button>
              </form>

              <div className="lg:col-span-2 space-y-3">
                {activeRoom.notes.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
                    No shared notes yet. Post the first summary, formula sheet, or key proof for your study circle!
                  </div>
                ) : (
                  [...activeRoom.notes]
                    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
                    .map((note) => (
                      <div
                        key={note.id}
                        className={`p-4 rounded-2xl border space-y-2.5 ${
                          note.status === 'hidden'
                            ? 'bg-slate-950/70 border-rose-500/30 opacity-75'
                            : note.pinned
                              ? 'bg-slate-900 border-amber-500/40'
                              : 'bg-slate-900 border-slate-800'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white">{note.title}</span>
                            {note.pinned && <Badge variant="warning" size="sm">Pinned</Badge>}
                            {note.status === 'flagged' && <Badge variant="rose" size="sm">Flagged for Review</Badge>}
                            {note.status === 'hidden' && <Badge variant="rose" size="sm">Hidden by Moderator</Badge>}
                          </div>
                          <span className="text-[11px] text-slate-400">
                            By <strong className="text-slate-200">{note.authorAlias}</strong> · {note.topic}
                          </span>
                        </div>

                        <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                          {note.body}
                        </p>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-500">
                          <span className="tabular-nums">{new Date(note.createdAt).toLocaleString()}</span>
                          <div className="flex items-center gap-2">
                            {isModerator && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleModerate('toggle-pin-note', note.id)}
                                  className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-300 flex items-center gap-1"
                                >
                                  <Pin className="w-3 h-3" />
                                  {note.pinned ? 'Unpin' : 'Pin'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleModerate(note.status === 'hidden' ? 'restore-note' : 'hide-note', note.id)
                                  }
                                  className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-rose-300 flex items-center gap-1"
                                >
                                  {note.status === 'hidden' ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                  {note.status === 'hidden' ? 'Restore' : 'Hide'}
                                </button>
                              </>
                            )}
                            {note.authorUid !== uid && (
                              <button
                                type="button"
                                onClick={() =>
                                  setReportingNoteId(reportingNoteId === note.id ? null : note.id)
                                }
                                className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-rose-300 flex items-center gap-1"
                              >
                                <Flag className="w-3 h-3" />
                                Report
                              </button>
                            )}
                          </div>
                        </div>

                        {reportingNoteId === note.id && (
                          <div className="p-3 rounded-xl bg-slate-950 border border-rose-500/30 space-y-2">
                            <div className="flex flex-col sm:flex-row gap-2">
                              <select
                                aria-label="Report reason"
                                value={reportReason}
                                onChange={(e) => setReportReason(e.target.value as StudyRoomReportReason)}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                              >
                                {REPORT_REASONS.map((r) => (
                                  <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={reportDetails}
                                onChange={(e) => setReportDetails(e.target.value)}
                                placeholder="Optional details for moderator..."
                                className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="danger"
                                onClick={() => handleSubmitReport(note.id, note.title)}
                              >
                                Submit Report
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                )}
              </div>
            </div>
          )}

          {/* TAB 2: COLLABORATIVE STUDY GOALS */}
          {activeTab === 'goals' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <form
                onSubmit={handleCreateGoal}
                className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 h-fit"
              >
                <h3 className="text-sm font-bold text-white">Add Collaborative Study Goal</h3>
                <div>
                  <label htmlFor="goal-title" className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Shared Milestone Title
                  </label>
                  <input
                    id="goal-title"
                    type="text"
                    required
                    maxLength={160}
                    value={goalTitle}
                    onChange={(e) => setGoalTitle(e.target.value)}
                    placeholder="e.g., Solve NCERT Lens Numericals Together"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="goal-target" className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Target Count
                    </label>
                    <input
                      id="goal-target"
                      type="number"
                      min={1}
                      max={200}
                      value={goalTarget}
                      onChange={(e) => setGoalTarget(Number(e.target.value) || 5)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="goal-unit" className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Unit
                    </label>
                    <input
                      id="goal-unit"
                      type="text"
                      maxLength={40}
                      value={goalUnit}
                      onChange={(e) => setGoalUnit(e.target.value)}
                      placeholder="problems"
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="w-full"
                  disabled={creatingGoal || Boolean(postingBlockedReason)}
                >
                  {creatingGoal ? 'Adding Goal...' : 'Create Shared Goal'}
                </Button>
              </form>

              <div className="lg:col-span-2 space-y-3">
                {activeRoom.goals.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
                    No collaborative goals yet. Set a shared chapter target and track group progress together!
                  </div>
                ) : (
                  activeRoom.goals.map((goal) => {
                    const pct = Math.min(100, Math.round((goal.currentCount / Math.max(1, goal.targetCount)) * 100));
                    return (
                      <div key={goal.id} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-bold text-white flex items-center gap-2">
                              {goal.title}
                              {goal.completed && <Badge variant="success" size="sm">Goal Completed</Badge>}
                            </h4>
                            <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                              Started by {goal.createdByAlias} · {goal.contributorUids.length} contributor(s)
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant={goal.completed ? 'ghost' : 'secondary'}
                            disabled={goal.completed}
                            onClick={() => handleIncrementGoal(goal.id)}
                          >
                            {goal.completed ? 'Completed' : '+1 Progress'}
                          </Button>
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-xs tabular-nums">
                            <span className="text-slate-400">Group Progress</span>
                            <span className="font-bold text-emerald-400">
                              {goal.currentCount} / {goal.targetCount} {goal.unit} ({pct}%)
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 3: GROUP QUIZZES */}
          {activeTab === 'quizzes' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 h-fit">
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-white">Launch Group Quiz</h3>
                  <p className="text-[11px] text-slate-400">
                    Generate a 3-question board-aligned quiz instantly with AI or add a quick peer challenge question.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={generatingAiQuiz || Boolean(postingBlockedReason)}
                    onClick={handleAiGenerateQuiz}
                    icon={<Sparkles className="w-3.5 h-3.5" />}
                  >
                    {generatingAiQuiz ? 'Generating Pod Quiz...' : 'AI Generate 3-Question Quiz'}
                  </Button>
                </div>

                <form onSubmit={handleManualCreateQuiz} className="space-y-2.5 pt-3 border-t border-slate-800">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                    Or Add Manual Question
                  </span>
                  <input
                    type="text"
                    aria-label="Quiz title"
                    value={quizTitle}
                    onChange={(e) => setQuizTitle(e.target.value)}
                    placeholder="Quiz title (e.g., Snell's Law Check)"
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                  />
                  <input
                    type="text"
                    aria-label="Question prompt"
                    required
                    value={quizPrompt}
                    onChange={(e) => setQuizPrompt(e.target.value)}
                    placeholder="Question prompt..."
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      aria-label="Option A"
                      required
                      value={quizOptA}
                      onChange={(e) => setQuizOptA(e.target.value)}
                      placeholder="Option A"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                    <input
                      type="text"
                      aria-label="Option B"
                      required
                      value={quizOptB}
                      onChange={(e) => setQuizOptB(e.target.value)}
                      placeholder="Option B"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                    <input
                      type="text"
                      aria-label="Option C"
                      value={quizOptC}
                      onChange={(e) => setQuizOptC(e.target.value)}
                      placeholder="Option C"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                    <input
                      type="text"
                      aria-label="Option D"
                      value={quizOptD}
                      onChange={(e) => setQuizOptD(e.target.value)}
                      placeholder="Option D"
                      className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="quiz-correct-idx" className="text-[11px] text-slate-400">
                      Correct Option:
                    </label>
                    <select
                      id="quiz-correct-idx"
                      value={quizCorrectIdx}
                      onChange={(e) => setQuizCorrectIdx(Number(e.target.value))}
                      className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
                    >
                      <option value={0}>Option A</option>
                      <option value={1}>Option B</option>
                      <option value={2}>Option C</option>
                      <option value={3}>Option D</option>
                    </select>
                  </div>
                  <Button
                    type="submit"
                    size="sm"
                    variant="primary"
                    className="w-full"
                    disabled={Boolean(postingBlockedReason)}
                  >
                    Publish Peer Quiz
                  </Button>
                </form>
              </div>

              <div className="lg:col-span-2 space-y-4">
                {activeRoom.quizzes.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
                    No group quizzes posted yet. Generate one with AI or challenge your classmates with a concept question!
                  </div>
                ) : (
                  activeRoom.quizzes.map((quiz) => {
                    const mySub = quiz.submissions.find((s) => s.uid === uid);
                    const selectedAnswers = quizAnswersMap[quiz.id] || {};
                    return (
                      <div key={quiz.id} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                          <div>
                            <h4 className="text-sm font-bold text-white">{quiz.title}</h4>
                            <p className="text-[11px] text-slate-400">
                              Created by {quiz.createdByAlias} · {quiz.questions.length} question(s)
                            </p>
                          </div>
                          {mySub && (
                            <Badge variant="success" size="sm">
                              Your Score: {mySub.score}/{mySub.total}
                            </Badge>
                          )}
                        </div>

                        <div className="space-y-4">
                          {quiz.questions.map((q, qIdx) => {
                            const chosen = selectedAnswers[qIdx];
                            return (
                              <div key={q.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                                <p className="text-xs font-semibold text-white">
                                  Q{qIdx + 1}. {q.prompt}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {q.options.map((opt, optIdx) => {
                                    const effectiveChoice = chosen !== undefined ? chosen : mySub?.answers[qIdx];
                                    const activeChoice = effectiveChoice === optIdx;
                                    const isCorrectOpt = Boolean(mySub) && q.correctIndex === optIdx;
                                    return (
                                      <button
                                        key={optIdx}
                                        type="button"
                                        onClick={() =>
                                          setQuizAnswersMap((prev) => ({
                                            ...prev,
                                            [quiz.id]: { ...(prev[quiz.id] || {}), [qIdx]: optIdx },
                                          }))
                                        }
                                        className={`px-3 py-2 rounded-lg border text-left text-xs transition-colors ${
                                          isCorrectOpt
                                            ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200'
                                            : activeChoice
                                              ? 'bg-indigo-500/20 border-indigo-500/50 text-white'
                                              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                                        }`}
                                      >
                                        {opt}
                                      </button>
                                    );
                                  })}
                                </div>
                                {mySub && (
                                  <p className="text-[11px] text-slate-400 pt-1">
                                    Explanation: {q.explanation}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={currentMember?.status === 'muted'}
                            onClick={() => handleSubmitQuiz(quiz)}
                          >
                            {mySub ? 'Re-submit Answers' : 'Submit Quiz Answers'}
                          </Button>
                          {quiz.submissions.length > 0 && (
                            <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-2 tabular-nums">
                              <span className="font-semibold text-slate-300">Peer Results:</span>
                              {[...quiz.submissions]
                                .sort((a, b) => b.score - a.score)
                                .map((s) => (
                                  <span
                                    key={s.uid}
                                    className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-200"
                                  >
                                    {s.alias}: {s.score}/{s.total}
                                  </span>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 4: SHARED MIND MAPS */}
          {activeTab === 'mindmaps' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 h-fit">
                <h3 className="text-sm font-bold text-white">Share a Concept Mind Map</h3>
                {savedMindMaps.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[11px] font-semibold text-slate-400 block">
                      From Your Mind Map Studio:
                    </span>
                    {savedMindMaps.slice(0, 4).map((m) => (
                      <div
                        key={m.id}
                        className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{m.title}</p>
                          <p className="text-[10px] text-slate-400 truncate">{m.subject} · {m.nodes.length} nodes</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleShareSavedMindMap(m)}>
                          Share
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleCreateCustomRoomMap} className="space-y-2.5 pt-2 border-t border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-300 block">
                    Or Build Quick Pod Concept Map:
                  </span>
                  <input
                    type="text"
                    aria-label="Central concept topic"
                    required
                    value={customMapTitle}
                    onChange={(e) => setCustomMapTitle(e.target.value)}
                    placeholder="Central Topic (e.g., Snell's Law)"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  />
                  <textarea
                    rows={2}
                    aria-label="Mind map branches"
                    value={customMapBranches}
                    onChange={(e) => setCustomMapBranches(e.target.value)}
                    placeholder="Comma-separated branches..."
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="primary"
                    className="w-full"
                    disabled={Boolean(postingBlockedReason)}
                  >
                    Publish Concept Map to Pod
                  </Button>
                </form>
              </div>

              <div className="lg:col-span-2 space-y-3">
                {activeRoom.mindMaps.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
                    No mind maps shared yet. Share one from your Mind Map Studio or create a chapter concept tree here.
                  </div>
                ) : (
                  activeRoom.mindMaps.map((m) => {
                    const root = m.nodes.find((n) => !n.parentId) || m.nodes[0];
                    const children = m.nodes.filter((n) => n.id !== root?.id);
                    const endorsed = m.endorsements.includes(uid);
                    return (
                      <div key={m.id} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-bold text-white">{m.title}</h4>
                            <p className="text-[11px] text-slate-400">
                              Shared by {m.sharedByAlias} · {m.subject} · {m.nodes.length} nodes
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleEndorseMap(m.id)}
                            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 tabular-nums ${
                              endorsed
                                ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                                : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                            {m.endorsements.length}
                          </button>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                          {root && (
                            <div className="text-xs font-bold text-sky-300">
                              Central Node: {root.label}
                            </div>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {children.slice(0, 12).map((node) => (
                              <div
                                key={node.id}
                                className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200"
                              >
                                <span className="font-semibold">{node.label}</span>
                                {node.summary && (
                                  <span className="block text-[11px] text-slate-400 mt-0.5">
                                    {node.summary}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 5: MEMBERS & MODERATION SAFETY */}
          {activeTab === 'members' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">Safe Classroom Roster</h3>
                  <span className="text-[11px] text-slate-400">Private PII & DMs hidden</span>
                </div>

                <div className="divide-y divide-slate-800">
                  {activeRoom.members.map((member) => {
                    const isOnline = onlineUids.includes(member.uid);
                    return (
                      <div key={member.uid} className="py-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-300 font-bold text-xs flex items-center justify-center shrink-0">
                            {member.avatarInitial}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white truncate">{member.alias}</span>
                              {member.role === 'host' && <Badge variant="purple" size="sm">Host</Badge>}
                              {member.status === 'muted' && <Badge variant="warning" size="sm">Muted</Badge>}
                              {member.status === 'removed' && <Badge variant="rose" size="sm">Removed</Badge>}
                              {isOnline && member.status !== 'removed' && (
                                <span className="text-[10px] font-semibold text-emerald-400">● Live</span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 tabular-nums">
                              {member.board} · {member.classGrade} · {member.contributionsCount} contributions · {member.quizPoints} quiz pts
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {member.uid !== uid && member.status !== 'removed' && (
                            <button
                              type="button"
                              onClick={() =>
                                setReportingMemberUid(reportingMemberUid === member.uid ? null : member.uid)
                              }
                              aria-label={`Report ${member.alias}`}
                              className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-rose-300"
                            >
                              <Flag className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isModerator && member.uid !== activeRoom.hostUid && member.status !== 'removed' && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  handleModerate(
                                    member.status === 'muted' ? 'unmute-member' : 'mute-member',
                                    member.uid
                                  )
                                }
                                aria-label={member.status === 'muted' ? `Unmute ${member.alias}` : `Mute ${member.alias}`}
                                className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-amber-300"
                              >
                                {member.status === 'muted' ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleModerate('remove-member', member.uid)}
                                aria-label={`Remove ${member.alias}`}
                                className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-rose-400"
                              >
                                <UserX className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {reportingMemberUid && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-rose-500/30 space-y-2">
                    <p className="text-[11px] font-semibold text-rose-200">
                      Submit Member Safety Report
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        aria-label="Member report reason"
                        value={reportReason}
                        onChange={(e) => setReportReason(e.target.value as StudyRoomReportReason)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                      >
                        {REPORT_REASONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        aria-label="Member report details"
                        value={reportDetails}
                        onChange={(e) => setReportDetails(e.target.value)}
                        placeholder="Describe unsafe behavior..."
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          const target = activeRoom.members.find((m) => m.uid === reportingMemberUid);
                          handleSubmitReport(reportingMemberUid, target?.alias || reportingMemberUid, 'member');
                        }}
                      >
                        Submit Report
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">Safety & Moderation Queue</h3>
                  <Badge variant="default" size="sm">
                    {activeRoom.reports.filter((r) => r.status === 'open').length} Open
                  </Badge>
                </div>
                {activeRoom.reports.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4">
                    No safety reports filed in this pod. Age-appropriate content screening is actively protecting shared posts.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {activeRoom.reports.map((rep) => (
                      <div key={rep.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-white">
                            Report on {rep.targetType}: {rep.targetPreview || rep.targetId}
                          </span>
                          <Badge
                            variant={rep.status === 'open' ? 'rose' : 'default'}
                            size="sm"
                          >
                            {rep.status}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Reason: <strong className="text-slate-200">{rep.reason}</strong> · Reported by {rep.reporterAlias}
                          {rep.details ? ` — "${rep.details}"` : ''}
                        </p>
                        {isModerator && rep.status === 'open' && (
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => handleModerate('resolve-report', rep.id)}
                            >
                              Hide Item & Resolve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleModerate('dismiss-report', rep.id)}
                            >
                              Dismiss
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
