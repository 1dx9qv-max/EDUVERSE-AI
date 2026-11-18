import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  HelpCircle,
  History,
  Layers,
  Lightbulb,
  MessageSquarePlus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../router/Router';
import { sendTeacherMessage, AiApiClientError } from '../api/client';
import {
  deleteTeacherSession,
  dispatchVerifiedLearningEvent,
  fetchTeacherSessions,
  saveTeacherSession,
} from '../lib/firestoreService';
import {
  AVAILABLE_SUBJECTS_BY_GRADE,
  CLASS_GRADES,
  INDIAN_BOARDS,
  getSampleCurriculum,
} from '../utils/curriculum';
import {
  EXPLANATION_LEVELS,
  TEACHING_MODES,
  TUTOR_LANGUAGES,
  getTutorLanguageLabel,
  normalizeLanguageForTutor,
  sanitizeFirestoreId,
} from '../utils/aiValidation';
import {
  ExplanationLevel,
  TeacherMessage,
  TeacherSession,
  TeachingMode,
  TutorLanguage,
} from '../types/ai';
import { ClassGrade, IndianBoard } from '../types/auth';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';

const EXTRA_SCHOOL_SUBJECTS = [
  'Mathematics',
  'Science',
  'Physics',
  'Chemistry',
  'Biology',
  'Social Science',
  'History',
  'Geography',
  'Political Science',
  'Economics',
  'Accountancy',
  'Business Studies',
  'Computer Science',
  'English',
  'Hindi',
];

export const AITeacherPage: React.FC = () => {
  const { user } = useAuth();
  const { searchParams } = useRouter();
  const userId = user?.uid || '';

  const paramSubject = searchParams.get('subject') || '';
  const paramChapter = searchParams.get('chapter') || '';
  const paramTopic = searchParams.get('topic') || '';
  const paramRecId = searchParams.get('recId') || '';

  const [classGrade, setClassGrade] = useState<ClassGrade>(user?.classGrade || 'Class 10');
  const [board, setBoard] = useState<IndianBoard>(user?.board || 'CBSE');
  const [language, setLanguage] = useState<TutorLanguage>(() =>
    normalizeLanguageForTutor(user?.language)
  );
  const [level, setLevel] = useState<ExplanationLevel>('Intermediate');
  const [mode, setMode] = useState<TeachingMode>('explain');

  const subjectOptions = useMemo(() => {
    const gradeSubjects = AVAILABLE_SUBJECTS_BY_GRADE[classGrade] || [];
    const enrolled = user?.subjects || [];
    const merged = Array.from(
      new Set([...(paramSubject ? [paramSubject] : []), ...enrolled, ...gradeSubjects, ...EXTRA_SCHOOL_SUBJECTS])
    );
    return merged;
  }, [classGrade, user?.subjects, paramSubject]);

  const [subject, setSubject] = useState<string>(() => paramSubject || subjectOptions[0] || 'Science');
  const [activeChapter, setActiveChapter] = useState<string>(paramChapter);
  const [activeTopic, setActiveTopic] = useState<string>(paramTopic);
  const [completedLessons, setCompletedLessons] = useState<Record<string, boolean>>({});
  const [completingLesson, setCompletingLesson] = useState<boolean>(false);
  const [sessions, setSessions] = useState<TeacherSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeacherMessage[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [showMobileHistory, setShowMobileHistory] = useState(false);

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [errorState, setErrorState] = useState<{
    message: string;
    lastPrompt: string;
    retryable: boolean;
  } | null>(null);

  const [revealedHints, setRevealedHints] = useState<Record<string, boolean>>({});
  const [revealedAnswers, setRevealedAnswers] = useState<Record<string, boolean>>({});

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (user) {
      setClassGrade(user.classGrade || 'Class 10');
      setBoard(user.board || 'CBSE');
      setLanguage(normalizeLanguageForTutor(user.language));
    }
  }, [user?.uid, user?.classGrade, user?.board, user?.language]);

  useEffect(() => {
    if (paramSubject) setSubject(paramSubject);
    if (paramChapter) setActiveChapter(paramChapter);
    if (paramTopic) setActiveTopic(paramTopic);
  }, [paramSubject, paramChapter, paramTopic]);

  useEffect(() => {
    if (!subjectOptions.includes(subject) && subjectOptions.length > 0) {
      setSubject(subjectOptions[0]);
    }
  }, [subjectOptions, subject]);

  useEffect(() => {
    if (!userId) {
      setSessionsLoading(false);
      return;
    }
    let active = true;
    setSessionsLoading(true);
    fetchTeacherSessions(userId)
      .then((loaded) => {
        if (!active) return;
        setSessions(loaded);
      })
      .catch((err) => {
        console.warn('Failed to load saved AI Teacher sessions:', err);
      })
      .finally(() => {
        if (active) setSessionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending]);

  const sampleChapters = useMemo(() => {
    const curriculum = getSampleCurriculum(board, classGrade);
    const matched = curriculum.find((c) =>
      subject.toLowerCase().includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(subject.toLowerCase())
    );
    return (matched || curriculum[0])?.chapters || [];
  }, [board, classGrade, subject]);

  const activeModeMeta = TEACHING_MODES.find((m) => m.id === mode) || TEACHING_MODES[0];

  const startNewLesson = () => {
    setActiveSessionId(null);
    setMessages([]);
    setErrorState(null);
    setShowMobileHistory(false);
  };

  const loadSession = (session: TeacherSession) => {
    setActiveSessionId(session.id);
    setSubject(session.subject);
    setClassGrade((session.classGrade as ClassGrade) || 'Class 10');
    setBoard((session.board as IndianBoard) || 'CBSE');
    setLanguage(normalizeLanguageForTutor(session.language));
    setLevel(session.difficultyLevel);
    setMode(session.teachingMode);
    setMessages(session.messages || []);
    setErrorState(null);
    setShowMobileHistory(false);
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (!userId) return;
      await deleteTeacherSession(userId, sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        startNewLesson();
      }
    } catch (err) {
      console.warn('Failed to delete session:', err);
    }
  };

  const submitPrompt = async (promptOverride?: string, modeOverride?: TeachingMode) => {
    const promptToSend = (promptOverride ?? inputText).trim();
    if (!promptToSend || sending) return;

    const effectiveMode = modeOverride || mode;
    if (modeOverride) setMode(modeOverride);

    setErrorState(null);
    if (!promptOverride) {
      setInputText('');
    }

    const now = new Date().toISOString();
    const userMsg: TeacherMessage = {
      id: sanitizeFirestoreId(`msg_u_${Date.now()}`),
      role: 'user',
      content: promptToSend,
      mode: effectiveMode,
      level,
      language,
      timestamp: now,
    };

    const priorHistory = messages.map((m) => ({
      role: m.role,
      content: m.structured
        ? `[${getTutorLanguageLabel(m.language)}] ${m.structured.lessonTitle}: ${m.structured.reply}\nChecking question: ${m.structured.checkingQuestion.question}`
        : m.content,
    }));

    const optimisticMessages = [...messages, userMsg];
    setMessages(optimisticMessages);
    setSending(true);

    try {
      const structured = await sendTeacherMessage({
        subject,
        classGrade,
        board,
        language,
        level,
        mode: effectiveMode,
        message: promptToSend,
        history: priorHistory,
      });

      const assistantMsg: TeacherMessage = {
        id: sanitizeFirestoreId(`msg_a_${Date.now()}`),
        role: 'assistant',
        content: structured.reply,
        mode: effectiveMode,
        level,
        language,
        timestamp: new Date().toISOString(),
        structured,
      };

      const nextMessages = [...optimisticMessages, assistantMsg];
      setMessages(nextMessages);

      const sessionId = activeSessionId || sanitizeFirestoreId(`ts_${Date.now()}`);
      const existingSession = sessions.find((s) => s.id === sessionId);
      const sessionTitle =
        existingSession?.title ||
        structured.lessonTitle ||
        `${subject}: ${promptToSend.slice(0, 48)}`;

      const sessionToSave: TeacherSession = {
        id: sessionId,
        userId,
        title: sessionTitle.slice(0, 200),
        subject,
        classGrade,
        board,
        language,
        difficultyLevel: level,
        teachingMode: effectiveMode,
        messages: nextMessages,
        createdAt: existingSession?.createdAt || now,
        updatedAt: new Date().toISOString(),
      };

      const saved = await saveTeacherSession(sessionToSave);
      setActiveSessionId(saved.id);
      setSessions((prev) => [saved, ...prev.filter((s) => s.id !== saved.id)]);

      if (user) {
        const effectiveTopic = activeTopic || structured.lessonTitle || saved.title;
        const effectiveChapter = activeChapter || sampleChapters[0]?.title || effectiveTopic;
        void dispatchVerifiedLearningEvent({
          eventType: 'lesson_started',
          subject,
          chapter: effectiveChapter,
          topic: effectiveTopic,
          sourceModule: 'ai-teacher',
          idempotencyKey: `teacher_start_${saved.id}`,
          title: `Started AI Teacher Lesson: ${saved.title}`,
          description: `${subject} (${classGrade} ${board}) • ${effectiveMode}`,
        });
      }
    } catch (err) {
      // Revert optimistic user message back into composer on error so user never loses text
      setMessages(messages);
      if (!promptOverride) {
        setInputText(promptToSend);
      }
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to reach AI Teacher right now. Please try again.';
      const retryable = err instanceof AiApiClientError ? err.retryable : true;
      setErrorState({
        message,
        lastPrompt: promptToSend,
        retryable,
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitPrompt();
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-indigo-400 font-semibold">
            <Bot className="w-4 h-4" />
            <span>Personal AI Teacher • {board} • {classGrade}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Interactive 1-on-1 Guided Learning
          </h1>
          <p className="text-xs text-slate-400">
            Step-by-step explanations, everyday analogies, conceptual checks, and adaptive exercises in English, हिंदी, or Hinglish mode.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowMobileHistory(!showMobileHistory)}
            className="lg:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-700 bg-slate-900 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <History className="w-3.5 h-3.5 text-indigo-400" />
            <span>Lessons ({sessions.length})</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <Button
            size="sm"
            variant="primary"
            onClick={startNewLesson}
            icon={<MessageSquarePlus className="w-3.5 h-3.5" />}
            className="whitespace-nowrap shrink-0"
          >
            New Lesson
          </Button>
        </div>
      </div>

      {/* Curriculum & Pedagogical Controls */}
      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Subject */}
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Subject
            </span>
            <select
              aria-label="Select subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs font-medium text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {subjectOptions.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </label>

          {/* Class & Board */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Class
              </span>
              <select
                aria-label="Select class"
                value={classGrade}
                onChange={(e) => setClassGrade(e.target.value as ClassGrade)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-2.5 py-2 text-xs font-medium text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {CLASS_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Board
              </span>
              <select
                aria-label="Select board"
                value={board}
                onChange={(e) => setBoard(e.target.value as IndianBoard)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-2.5 py-2 text-xs font-medium text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {INDIAN_BOARDS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Explanation Level */}
          <div className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
              Depth Level
            </span>
            <div className="flex items-center gap-1 rounded-xl bg-slate-950 p-1 border border-slate-800">
              {EXPLANATION_LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setLevel(lvl)}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap text-center cursor-pointer ${
                    level === lvl
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
              Language
            </span>
            <div
              role="group"
              aria-label="Teaching explanation language"
              className="flex items-center gap-1 rounded-xl bg-slate-950 p-1 border border-slate-800"
            >
              {TUTOR_LANGUAGES.map((lang) => {
                const label = getTutorLanguageLabel(lang);
                const active = language === lang;
                return (
                  <button
                    key={lang}
                    type="button"
                    aria-pressed={active}
                    data-testid={`teacher-lang-${lang.toLowerCase()}`}
                    onClick={() => setLanguage(lang)}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap text-center cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {messages.length > 0 && (
              <p className="text-[10px] text-indigo-300/90 leading-tight pt-0.5">
                Next reply continues in {getTutorLanguageLabel(language)}
              </p>
            )}
          </div>
        </div>

        {/* 6 Teaching Modes */}
        <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Teaching Mode
            </span>
            <span className="text-[11px] text-slate-400">{activeModeMeta.description}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {TEACHING_MODES.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`px-3 py-2 rounded-xl border text-left transition-all cursor-pointer ${
                    active
                      ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-200'
                      : 'bg-slate-950/70 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <span className="block text-xs font-semibold truncate">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Main Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Saved Lessons Sidebar */}
        <div
          className={`lg:col-span-3 lg:sticky lg:top-20 space-y-3 ${
            showMobileHistory ? 'block' : 'hidden lg:block'
          }`}
        >
          <Card className="p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-indigo-400" />
                Saved Lessons
              </h2>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                {sessions.length}
              </span>
            </div>

            {sessionsLoading ? (
              <div className="space-y-2">
                <div className="h-12 rounded-xl bg-slate-950 animate-pulse border border-slate-800/60" />
                <div className="h-12 rounded-xl bg-slate-950 animate-pulse border border-slate-800/60" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 text-center space-y-1">
                <p className="text-xs font-medium text-slate-300">No saved lessons yet</p>
                <p className="text-[11px] text-slate-500">
                  Start a conversation on any topic and your lesson timeline will be saved here.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
                {sessions.map((sess) => {
                  const isActive = sess.id === activeSessionId;
                  return (
                    <div
                      key={sess.id}
                      className={`group flex items-start justify-between gap-2 p-2.5 rounded-xl border transition-colors ${
                        isActive
                          ? 'bg-indigo-600/15 border-indigo-500/40'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => loadSession(sess)}
                        className="flex-1 text-left min-w-0 cursor-pointer"
                      >
                        <p className="text-xs font-semibold text-slate-100 truncate">
                          {sess.title}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {sess.subject} • {getTutorLanguageLabel(sess.language)} •{' '}
                          <span className="font-mono tabular-nums">
                            {Math.ceil((sess.messages?.length || 0) / 2)}
                          </span>{' '}
                          turns
                        </p>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete lesson ${sess.title}`}
                        onClick={(e) => handleDeleteSession(sess.id, e)}
                        className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Lesson Conversation Canvas */}
        <div className="lg:col-span-9 space-y-4">
          <Card className="p-4 sm:p-6 space-y-5 min-h-[460px] flex flex-col justify-between">
            <div className="space-y-5">
              {messages.length === 0 ? (
                <div className="space-y-6 py-4">
                  <div className="space-y-2 max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-[11px] font-semibold text-indigo-300">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Ready for {subject} • {classGrade} ({board})</span>
                    </div>
                    <h2 className="text-lg font-bold text-white">
                      What would you like to master today?
                    </h2>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Ask about any theorem, reaction, grammar rule, historical event, or paste your attempted answer for{' '}
                      <strong className="text-slate-200">{activeModeMeta.label}</strong> mode.
                    </p>
                  </div>

                  {/* Quick Topic Launchers */}
                  <div className="space-y-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                      Suggested {subject} Prompts
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {sampleChapters.slice(0, 3).map((ch) => (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() =>
                            submitPrompt(
                              `${activeModeMeta.starterPrompt} Topic: ${ch.title} (${ch.keyTopics.slice(0, 2).join(', ')})`
                            )
                          }
                          className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/40 text-left transition-all flex items-center justify-between gap-2 group cursor-pointer"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-100 group-hover:text-indigo-300 truncate">
                              {ch.title}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                              {ch.keyTopics.slice(0, 3).join(' • ')}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 shrink-0" />
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          submitPrompt(
                            `In ${subject} (${classGrade}), explain the single hardest foundational idea students misunderstand and give an everyday Indian analogy.`
                          )
                        }
                        className="p-3 rounded-xl bg-slate-950 border border-slate-800 hover:border-indigo-500/40 text-left transition-all flex items-center justify-between gap-2 group cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-100 group-hover:text-indigo-300 truncate">
                            Common Conceptual Pitfall Check
                          </p>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            Build intuition with analogies before solving problems
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 shrink-0" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {messages.map((msg) => {
                    if (msg.role === 'user') {
                      return (
                        <div key={msg.id} className="flex justify-end">
                          <div className="max-w-2xl rounded-2xl bg-indigo-600/20 border border-indigo-500/35 px-4 py-3 space-y-1">
                            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                              <span>You</span>
                              <span>•</span>
                              <span>{TEACHING_MODES.find((m) => m.id === msg.mode)?.shortLabel || msg.mode}</span>
                              <span>•</span>
                              <span>{msg.level}</span>
                            </div>
                            <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">
                              {msg.content}
                            </p>
                          </div>
                        </div>
                      );
                    }

                    const s = msg.structured;
                    return (
                      <div key={msg.id} className="space-y-4 rounded-2xl bg-slate-950/85 border border-slate-800 p-4 sm:p-5">
                        {/* Lesson Title & Main Explanation */}
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-300">
                              <Bot className="w-4 h-4 text-indigo-400" />
                              {s?.lessonTitle || 'AI Teacher Lesson'}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {getTutorLanguageLabel(msg.language)} • {msg.level}
                            </span>
                          </div>
                          <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">
                            {s?.reply || msg.content}
                          </p>
                        </div>

                        {/* Progressive Mini-Lessons */}
                        {s?.lessonBreakdown && s.lessonBreakdown.length > 0 && (
                          <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                              <Layers className="w-3.5 h-3.5 text-blue-400" />
                              Step-by-Step Mini-Lessons
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {s.lessonBreakdown.map((sec, idx) => (
                                <div
                                  key={idx}
                                  className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5 space-y-1.5"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-300 font-mono text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums">
                                      {idx + 1}
                                    </span>
                                    <h4 className="text-xs font-bold text-white">{sec.title}</h4>
                                  </div>
                                  <p className="text-xs text-slate-300 leading-relaxed">
                                    {sec.content}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Real-World Examples & Analogy */}
                        {(s?.analogy || (s?.realWorldExamples && s.realWorldExamples.length > 0)) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
                            {s?.realWorldExamples && s.realWorldExamples.length > 0 && (
                              <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5 space-y-2">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                                  <Compass className="w-3.5 h-3.5" />
                                  Real-World Examples
                                </h3>
                                <ul className="space-y-1.5 text-xs text-slate-300">
                                  {s.realWorldExamples.map((ex, idx) => (
                                    <li key={idx} className="flex items-start gap-2">
                                      <span className="text-emerald-400 font-mono mt-0.5">•</span>
                                      <span className="leading-relaxed">{ex}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {s?.analogy && (
                              <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-3.5 space-y-2">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                                  <Lightbulb className="w-3.5 h-3.5" />
                                  Intuitive Analogy
                                </h3>
                                <p className="text-xs text-slate-200 leading-relaxed">
                                  {s.analogy}
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Conceptual Checking Question */}
                        {s?.checkingQuestion?.question && (
                          <div className="rounded-xl bg-indigo-950/30 border border-indigo-500/30 p-3.5 space-y-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                                <HelpCircle className="w-3.5 h-3.5" />
                                Conceptual Check
                              </h3>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRevealedHints((prev) => ({
                                      ...prev,
                                      [msg.id]: !prev[msg.id],
                                    }))
                                  }
                                  className="text-[11px] font-semibold text-amber-300 hover:underline cursor-pointer"
                                >
                                  {revealedHints[msg.id] ? 'Hide Hint' : 'Show Hint'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRevealedAnswers((prev) => ({
                                      ...prev,
                                      [msg.id]: !prev[msg.id],
                                    }))
                                  }
                                  className="text-[11px] font-semibold text-emerald-300 hover:underline cursor-pointer"
                                >
                                  {revealedAnswers[msg.id] ? 'Hide Key Idea' : 'Reveal Key Idea'}
                                </button>
                              </div>
                            </div>
                            <p className="text-xs sm:text-sm font-medium text-white">
                              {s.checkingQuestion.question}
                            </p>
                            {revealedHints[msg.id] && (
                              <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                                Hint: {s.checkingQuestion.hint}
                              </p>
                            )}
                            {revealedAnswers[msg.id] && (
                              <p className="text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                                Key Concept: {s.checkingQuestion.expectedConcept}
                              </p>
                            )}
                            <div>
                              <button
                                type="button"
                                onClick={() =>
                                  setInputText(
                                    language === 'Hindi'
                                      ? `मेरा उत्तर ("${s.checkingQuestion.question}"): `
                                      : language === 'Hinglish' || language === 'Bilingual'
                                        ? `Mera answer ("${s.checkingQuestion.question}"): `
                                        : `My answer to "${s.checkingQuestion.question}": `
                                  )
                                }
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-300 hover:text-indigo-200 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Reply to Check My Understanding
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Follow-Up Exercises */}
                        {s?.followUpExercises && s.followUpExercises.length > 0 && (
                          <div className="space-y-2 pt-2 border-t border-slate-800/80">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5 text-purple-400" />
                              Follow-Up Practice Exercises
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                              {s.followUpExercises.map((ex, idx) => (
                                <div
                                  key={idx}
                                  className="rounded-xl bg-slate-900/90 border border-slate-800 p-3 flex flex-col justify-between gap-2"
                                >
                                  <div className="space-y-1">
                                    <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-md">
                                      {ex.difficulty}
                                    </span>
                                    <p className="text-xs text-slate-100 leading-relaxed">
                                      {ex.prompt}
                                    </p>
                                    <p className="text-[11px] text-slate-500">Hint: {ex.hint}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      submitPrompt(
                                        language === 'Hindi'
                                          ? `कृपया इस अभ्यास को चरण-दर-चरण हल करना सिखाइए: ${ex.prompt}`
                                          : language === 'Hinglish' || language === 'Bilingual'
                                            ? `Is exercise ko step by step solve karvao: ${ex.prompt}`
                                            : `Walk me through solving this exercise step by step: ${ex.prompt}`,
                                        'step-by-step'
                                      )
                                    }
                                    className="self-start text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer"
                                  >
                                    Solve Together →
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Syllabus Honesty & Lesson Completion Bar */}
                        <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[11px] text-slate-500 flex-1 min-w-[200px]">
                            {s?.syllabusNote
                              ? `Curriculum Note: ${s.syllabusNote}`
                              : `Aligned with ${board} ${classGrade} ${subject}.`}
                          </p>
                          {(() => {
                            const lessonTopicTitle = activeTopic || s?.lessonTitle || `${subject} Lesson`;
                            const lessonChapterTitle = activeChapter || sampleChapters[0]?.title || lessonTopicTitle;
                            const completionKey = `${subject}::${lessonChapterTitle}::${lessonTopicTitle}`.toLowerCase();
                            const isDone = Boolean(completedLessons[completionKey]);
                            return (
                              <button
                                type="button"
                                disabled={isDone || completingLesson}
                                onClick={async () => {
                                  if (isDone || completingLesson) return;
                                  setCompletingLesson(true);
                                  try {
                                    await dispatchVerifiedLearningEvent({
                                      eventType: 'lesson_completed',
                                      subject,
                                      chapter: lessonChapterTitle,
                                      topic: lessonTopicTitle,
                                      sourceModule: 'ai-teacher',
                                      idempotencyKey: `lesson_completed_${subject.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${lessonTopicTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
                                      title: `Completed Lesson: ${lessonTopicTitle}`,
                                      description: `${subject} (${lessonChapterTitle}) • ${board} ${classGrade}`,
                                      recId: paramRecId || undefined,
                                    });
                                    setCompletedLessons((prev) => ({ ...prev, [completionKey]: true }));
                                  } finally {
                                    setCompletingLesson(false);
                                  }
                                }}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:cursor-default ${
                                  isDone
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-200 border border-indigo-500/40'
                                }`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {isDone ? 'Lesson Completed' : completingLesson ? 'Saving...' : 'Mark Lesson Complete'}
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  })}

                  {sending && (
                    <div className="rounded-2xl bg-slate-950 border border-slate-800 p-5 space-y-3 animate-pulse">
                      <div className="h-4 w-48 bg-slate-800 rounded" />
                      <div className="h-3 w-full bg-slate-800/80 rounded" />
                      <div className="h-3 w-5/6 bg-slate-800/80 rounded" />
                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <div className="h-16 bg-slate-900 rounded-xl border border-slate-800" />
                        <div className="h-16 bg-slate-900 rounded-xl border border-slate-800" />
                      </div>
                    </div>
                  )}

                  <div ref={threadEndRef} />
                </div>
              )}
            </div>

            {/* Error Alert */}
            {errorState && (
              <div
                role="alert"
                className="rounded-xl bg-rose-950/40 border border-rose-500/40 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-2.5 text-xs text-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{errorState.message}</span>
                </div>
                {errorState.retryable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => submitPrompt(errorState.lastPrompt)}
                    icon={<RefreshCw className="w-3.5 h-3.5" />}
                    className="whitespace-nowrap shrink-0"
                  >
                    Retry
                  </Button>
                )}
              </div>
            )}

            {/* Message Composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitPrompt();
              }}
              className="pt-3 border-t border-slate-800/80 space-y-2.5"
            >
              <label htmlFor="ai-teacher-input" className="sr-only">
                Ask your Personal AI Teacher
              </label>
              <textarea
                id="ai-teacher-input"
                rows={3}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={2500}
                placeholder={`Ask anything about ${subject} (${classGrade}) in ${activeModeMeta.label} mode...`}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                  {inputText.length} / 2500 chars • Enter to send, Shift+Enter for new line
                </span>
                <Button
                  type="submit"
                  size="md"
                  variant="primary"
                  loading={sending}
                  disabled={!inputText.trim() || sending}
                  icon={<Send className="w-4 h-4" />}
                  className="whitespace-nowrap shrink-0"
                >
                  {sending ? 'Teaching...' : 'Ask AI Teacher'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
};
