import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Play,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../router/Router';
import { ClassGrade, IndianBoard } from '../types/auth';
import {
  ExamAnswerSubmission,
  ExamAttemptRecord,
  ExamMode,
  ExamPaper,
  ExamQuestionType,
  ExamStartResponse,
} from '../types/phase5';
import {
  generateExamPaper,
  startExamSession,
  submitExamAnswers,
} from '../api/client';
import {
  deleteExamAttempt,
  dispatchVerifiedLearningEvent,
  fetchExamAttempts,
  saveExamAttempt,
  syncExamResultToLearningIntelligence,
} from '../lib/firestoreService';
import {
  CLASS_GRADES,
  INDIAN_BOARDS,
  getSampleCurriculum,
} from '../utils/curriculum';
import { sanitizeDocumentId } from '../utils/learningEngine';
import { Button } from '../components/common/Button';
import { ExamActiveRunner } from '../components/exam/ExamActiveRunner';
import { ExamResultAnalysis } from '../components/exam/ExamResultAnalysis';

type SimulatorStage = 'setup' | 'preview' | 'active' | 'results';

interface PersistedExamDraft {
  paper: ExamPaper;
  session: ExamStartResponse;
  answers: Record<string, ExamAnswerSubmission>;
  visitedIds: string[];
  markedIds: string[];
  currentIndex: number;
  pendingSubmissionId: string | null;
}

const DRAFT_STORAGE_PREFIX = 'eduverse_exam_active_draft_';

const QUESTION_FORMAT_OPTIONS: Array<{
  id: ExamQuestionType;
  label: string;
  marksHint: string;
}> = [
  { id: 'mcq', label: 'MCQ (Single)', marksHint: '1m' },
  { id: 'multiple-select', label: 'Multiple Select', marksHint: '2m' },
  { id: 'true-false', label: 'True / False', marksHint: '1m' },
  { id: 'fill-blank', label: 'Fill in Blank', marksHint: '1m' },
  { id: 'numerical', label: 'Numerical', marksHint: '2m' },
  { id: 'short-answer', label: 'Short Answer', marksHint: '3m' },
  { id: 'long-answer', label: 'Long Answer', marksHint: '5m' },
];

export const ExamSimulatorPage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();

  const userId = user?.uid || '';
  const defaultBoard: IndianBoard = user?.board || 'CBSE';
  const defaultGrade: ClassGrade = user?.classGrade || 'Class 10';
  const defaultLanguage: 'English' | 'Hindi' | 'Bilingual' =
    user?.language === 'Hindi' || user?.language === 'Bilingual' ? user.language : 'English';

  const [stage, setStage] = useState<SimulatorStage>('setup');
  const [history, setHistory] = useState<ExamAttemptRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Setup Form State
  const [board, setBoard] = useState<IndianBoard>(defaultBoard);
  const [classGrade, setClassGrade] = useState<ClassGrade>(defaultGrade);
  const curriculum = useMemo(() => getSampleCurriculum(board, classGrade), [board, classGrade]);

  const [subject, setSubject] = useState<string>(curriculum[0]?.name || 'Mathematics');
  const [examMode, setExamMode] = useState<ExamMode>('chapter-test');
  const [chapter, setChapter] = useState<string>(curriculum[0]?.chapters[0]?.title || '');
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [questionCount, setQuestionCount] = useState<number>(7);
  const [difficultyMix, setDifficultyMix] = useState<
    'balanced' | 'foundation-focus' | 'board-challenge'
  >('balanced');
  const [negativeMarkingEnabled, setNegativeMarkingEnabled] = useState<boolean>(false);
  const [language, setLanguage] = useState<'English' | 'Hindi' | 'Bilingual'>(defaultLanguage);
  const [selectedTypes, setSelectedTypes] = useState<ExamQuestionType[]>([
    'mcq',
    'multiple-select',
    'true-false',
    'fill-blank',
    'numerical',
    'short-answer',
    'long-answer',
  ]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Active Exam & Result State
  const [paper, setPaper] = useState<ExamPaper | null>(null);
  const [session, setSession] = useState<ExamStartResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, ExamAnswerSubmission>>({});
  const [visitedIds, setVisitedIds] = useState<Set<string>>(new Set());
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [pendingSubmissionId, setPendingSubmissionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [activeResult, setActiveResult] = useState<ExamAttemptRecord | null>(null);
  const [serverTimingMessage, setServerTimingMessage] = useState<string | null>(null);

  const autoSubmitTriggeredRef = useRef<boolean>(false);

  const currentSubjectObj = useMemo(
    () => curriculum.find((s) => s.name === subject) || curriculum[0],
    [curriculum, subject]
  );

  useEffect(() => {
    if (!curriculum.some((s) => s.name === subject)) {
      const nextSub = curriculum[0];
      if (nextSub) {
        setSubject(nextSub.name);
        setChapter(nextSub.chapters[0]?.title || '');
        setSelectedTopics([]);
      }
    }
  }, [curriculum, subject]);

  const currentChapterObj = useMemo(
    () =>
      currentSubjectObj?.chapters.find((c) => c.title === chapter) ||
      currentSubjectObj?.chapters[0],
    [currentSubjectObj, chapter]
  );

  // Load history and restore unfinished draft if present
  useEffect(() => {
    if (!userId) {
      setHistoryLoading(false);
      return;
    }
    let mounted = true;
    setHistoryLoading(true);
    fetchExamAttempts(userId)
      .then((items) => {
        if (!mounted) return;
        setHistory(items);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setHistoryLoading(false);
      });

    try {
      const rawDraft = localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${userId}`);
      if (rawDraft) {
        const draft = JSON.parse(rawDraft) as PersistedExamDraft;
        const graceExpired = Date.now() > draft.session.expiresAt + 240_000;
        if (draft?.paper?.questions?.length > 0 && draft?.session?.examToken && !graceExpired) {
          setPaper(draft.paper);
          setSession(draft.session);
          setAnswers(draft.answers || {});
          setVisitedIds(new Set(draft.visitedIds || [draft.paper.questions[0].id]));
          setMarkedIds(new Set(draft.markedIds || []));
          setCurrentIndex(draft.currentIndex || 0);
          setPendingSubmissionId(draft.pendingSubmissionId || null);
          setRemainingSeconds(
            Math.max(0, Math.floor((draft.session.expiresAt - Date.now()) / 1000))
          );
          setStage('active');
        } else {
          localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${userId}`);
        }
      }
    } catch {
      // Ignore corrupt local draft
    }

    return () => {
      mounted = false;
    };
  }, [userId]);

  // Persist active exam draft across reloads
  useEffect(() => {
    if (stage !== 'active' || !paper || !session) return;
    try {
      const draft: PersistedExamDraft = {
        paper,
        session,
        answers,
        visitedIds: Array.from(visitedIds),
        markedIds: Array.from(markedIds),
        currentIndex,
        pendingSubmissionId,
      };
      localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${userId}`, JSON.stringify(draft));
    } catch {
      // Ignore storage quota issues
    }
  }, [stage, paper, session, answers, visitedIds, markedIds, currentIndex, pendingSubmissionId, userId]);

  const executeSubmission = useCallback(
    async (autoSubmittedOnTimeout: boolean) => {
      if (!paper || !session || isSubmitting) return;
      const subId =
        pendingSubmissionId ||
        sanitizeDocumentId(
          `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          'sub'
        );
      setPendingSubmissionId(subId);
      setIsSubmitting(true);
      setSubmitError(null);

      const answerPayloads: ExamAnswerSubmission[] = paper.questions.map((q) => {
        const existing = answers[q.id] || { questionId: q.id };
        return {
          ...existing,
          questionId: q.id,
          markedForReview: markedIds.has(q.id),
        };
      });

      try {
        const response = await submitExamAnswers({
          submissionId: subId,
          sessionId: session.sessionId,
          examToken: session.examToken,
          paper,
          answers: answerPayloads,
          autoSubmittedOnTimeout,
          userId,
        });

        const savedAttempt = await saveExamAttempt(response.attempt);
        await syncExamResultToLearningIntelligence(savedAttempt).catch(() => {});
        void dispatchVerifiedLearningEvent({
          eventType: 'exam_attempted',
          subject: savedAttempt.subject,
          topic: savedAttempt.paperTitle,
          sourceModule: 'exam-simulator',
          idempotencyKey: `exam_${savedAttempt.id}`,
          scoreRatio: Math.max(0, Math.min(1, savedAttempt.percentage / 100)),
          title: `Exam Simulation: ${savedAttempt.paperTitle}`,
          description: `Scored ${savedAttempt.marksObtained}/${savedAttempt.totalMarks} (${savedAttempt.percentage}%)`,
        });

        try {
          localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${userId}`);
        } catch {
          // Ignore storage error
        }

        setHistory((prev) => [
          savedAttempt,
          ...prev.filter((item) => item.id !== savedAttempt.id),
        ]);
        setActiveResult(savedAttempt);
        setServerTimingMessage(response.serverTimingMessage);
        setPendingSubmissionId(null);
        setStage('results');
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Network interruption while grading exam submission.';
        setSubmitError(msg);
      } finally {
        setIsSubmitting(false);
      }
    },
    [paper, session, isSubmitting, pendingSubmissionId, answers, markedIds, userId]
  );

  // Live Drift-Free Exam Timer
  useEffect(() => {
    if (stage !== 'active' || !session) return;
    const syncRemaining = () => {
      const secs = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
      setRemainingSeconds(secs);
      if (secs === 0 && !autoSubmitTriggeredRef.current && !isSubmitting) {
        autoSubmitTriggeredRef.current = true;
        executeSubmission(true);
      }
    };

    syncRemaining();
    const intervalId = window.setInterval(syncRemaining, 1000);
    return () => window.clearInterval(intervalId);
  }, [stage, session, isSubmitting, executeSubmission]);

  const toggleQuestionType = (typeId: ExamQuestionType) => {
    setSelectedTypes((prev) => {
      if (prev.includes(typeId)) {
        return prev.length > 1 ? prev.filter((item) => item !== typeId) : prev;
      }
      return [...prev, typeId];
    });
  };

  const toggleTopicSelection = (topicName: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topicName) ? prev.filter((t) => t !== topicName) : [...prev, topicName]
    );
  };

  const handleGeneratePaper = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);
    setIsGenerating(true);

    try {
      const generated = await generateExamPaper({
        board,
        classGrade,
        subject,
        chapter: examMode === 'full-syllabus' ? undefined : chapter,
        topics: examMode === 'full-syllabus' ? [] : selectedTopics,
        examMode,
        durationMinutes,
        questionCount,
        questionTypes: selectedTypes,
        difficultyMix,
        negativeMarkingEnabled,
        language,
      });
      setPaper(generated);
      setStage('preview');
    } catch (err) {
      setSetupError(
        err instanceof Error ? err.message : 'Unable to generate exam paper right now.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStartTimedExam = async () => {
    if (!paper) return;
    setSetupError(null);
    setIsStartingSession(true);
    try {
      const started = await startExamSession({
        examId: paper.id,
        durationMinutes: paper.durationMinutes,
        totalMarks: paper.totalMarks,
        questionCount: paper.questions.length,
      });

      autoSubmitTriggeredRef.current = false;
      setSession(started);
      setAnswers({});
      setVisitedIds(new Set([paper.questions[0].id]));
      setMarkedIds(new Set());
      setCurrentIndex(0);
      setPendingSubmissionId(null);
      setSubmitError(null);
      setRemainingSeconds(
        Math.max(1, Math.floor((started.expiresAt - Date.now()) / 1000))
      );
      setStage('active');
    } catch (err) {
      setSetupError(
        err instanceof Error ? err.message : 'Could not initialize server exam timer.'
      );
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleSelectQuestion = (idx: number) => {
    if (!paper) return;
    const bounded = Math.max(0, Math.min(paper.questions.length - 1, idx));
    setCurrentIndex(bounded);
    const qId = paper.questions[bounded].id;
    setVisitedIds((prev) => {
      if (prev.has(qId)) return prev;
      const next = new Set(prev);
      next.add(qId);
      return next;
    });
  };

  const handleUpdateAnswer = (qId: string, patch: Partial<ExamAnswerSubmission>) => {
    setAnswers((prev) => ({
      ...prev,
      [qId]: {
        ...(prev[qId] || { questionId: qId }),
        ...patch,
        questionId: qId,
      },
    }));
  };

  const handleClearAnswer = (qId: string) => {
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[qId];
      return next;
    });
  };

  const handleToggleMark = (qId: string) => {
    setMarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(qId)) next.delete(qId);
      else next.add(qId);
      return next;
    });
  };

  const handleDeleteAttempt = async (attemptId: string) => {
    if (!userId) return;
    await deleteExamAttempt(userId, attemptId).catch(() => {});
    setHistory((prev) => prev.filter((item) => item.id !== attemptId));
  };

  if (stage === 'active' && paper && session) {
    return (
      <ExamActiveRunner
        paper={paper}
        remainingSeconds={remainingSeconds}
        answers={answers}
        visitedIds={visitedIds}
        markedIds={markedIds}
        currentIndex={currentIndex}
        isSubmitting={isSubmitting}
        submitError={submitError}
        onSelectQuestion={handleSelectQuestion}
        onUpdateAnswer={handleUpdateAnswer}
        onClearAnswer={handleClearAnswer}
        onToggleMarkForReview={handleToggleMark}
        onConfirmSubmit={() => executeSubmission(false)}
      />
    );
  }

  if (stage === 'results' && activeResult) {
    return (
      <ExamResultAnalysis
        attempt={activeResult}
        history={history}
        serverTimingMessage={serverTimingMessage}
        onBackToSetup={() => {
          setActiveResult(null);
          setStage('setup');
        }}
        onNavigateToPractice={(topic, errorTag) => {
          navigate('/practice', {
            subject: activeResult.subject,
            topic,
            errorTag,
          });
        }}
        onNavigateToFlashcards={(topic, errorTag) => {
          navigate('/memory-booster', {
            subject: activeResult.subject,
            chapter: activeResult.chapter || activeResult.subject,
            topic,
            errorTag,
          });
        }}
        onNavigateToIntelligence={() => navigate('/learning-intelligence')}
      />
    );
  }

  if (stage === 'preview' && paper) {
    const typeCounts = paper.questions.reduce<Record<string, number>>((acc, q) => {
      acc[q.questionType] = (acc[q.questionType] || 0) + 1;
      return acc;
    }, {});

    return (
      <div className="max-w-3xl mx-auto space-y-6" data-testid="exam-preview-gate">
        <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-4 flex items-start gap-3 text-xs text-amber-200">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-100">{paper.paperDisclaimer}</div>
            <p className="text-amber-200/80">{paper.syllabusNote}</p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="space-y-1">
            <div className="text-xs text-indigo-400 font-semibold">
              {paper.board} · {paper.classGrade} · {paper.subject} · {paper.language}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">{paper.title}</h1>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 tabular-nums">
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-400">Questions</div>
              <div className="text-lg font-bold text-white mt-0.5">{paper.questions.length}</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-400">Total Marks</div>
              <div className="text-lg font-bold text-white mt-0.5">{paper.totalMarks}</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-400">Time Limit</div>
              <div className="text-lg font-bold text-white mt-0.5">{paper.durationMinutes} min</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-400">Negative Marking</div>
              <div className="text-lg font-bold text-white mt-0.5">
                {paper.negativeMarkingEnabled ? '-25% Obj' : 'None'}
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <div className="font-semibold text-white">Paper Composition & Rules</div>
            <p>
              Formats included:{' '}
              {Object.entries(typeCounts)
                .map(([k, v]) => `${v}× ${k}`)
                .join(' · ')}
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li>Server starts a signed countdown timer when you click Start Timed Exam.</li>
              <li>Your answers auto-save locally so page refreshes do not lose progress.</li>
              <li>Objective items grade deterministically; subjective items grade via AI examiner rubric.</li>
            </ul>
          </div>

          {setupError && (
            <div className="bg-rose-950/60 border border-rose-700/60 rounded-lg p-3 text-xs text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{setupError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStage('setup')}
              disabled={isStartingSession}
            >
              Change Configuration
            </Button>
            <Button
              variant="primary"
              onClick={handleStartTimedExam}
              disabled={isStartingSession}
              icon={<Play className="w-4 h-4" />}
            >
              {isStartingSession ? 'Starting Server Timer...' : 'Start Timed Exam'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="exam-simulator-setup">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-indigo-400 font-semibold">
            <Clock className="w-3.5 h-3.5" />
            <span>Timed Practice Environment · Server-Validated</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Exam Simulator</h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
            Configure board-aligned chapter tests, full-syllabus mocks, or custom papers across 7 question types. AI-generated practice papers are clearly labeled and never presented as official board examinations.
          </p>
        </div>
      </div>

      {/* Main Split: Setup Form + Attempt History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleGeneratePaper}
          className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-5"
        >
          {/* Mode Tabs */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-300">Exam Mode</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  { id: 'chapter-test', label: 'Chapter-wise Test', sub: 'Focused chapter drill' },
                  { id: 'full-syllabus', label: 'Full Syllabus Mock', sub: 'Multi-chapter revision' },
                  { id: 'custom-test', label: 'Custom Test', sub: 'Select specific topics' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setExamMode(m.id)}
                  className={`text-left px-3.5 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                    examMode === m.id
                      ? 'bg-indigo-600/20 border-indigo-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold">{m.label}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{m.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Board, Class, Subject, Language */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="exam-board" className="block text-xs font-medium text-slate-300 mb-1">
                Board
              </label>
              <select
                id="exam-board"
                value={board}
                onChange={(e) => setBoard(e.target.value as IndianBoard)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                {INDIAN_BOARDS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="exam-class" className="block text-xs font-medium text-slate-300 mb-1">
                Class
              </label>
              <select
                id="exam-class"
                value={classGrade}
                onChange={(e) => setClassGrade(e.target.value as ClassGrade)}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                {CLASS_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="exam-subject" className="block text-xs font-medium text-slate-300 mb-1">
                Subject
              </label>
              <select
                id="exam-subject"
                value={subject}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setSubject(nextName);
                  const found = curriculum.find((s) => s.name === nextName);
                  setChapter(found?.chapters[0]?.title || '');
                  setSelectedTopics([]);
                }}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                {curriculum.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="exam-language" className="block text-xs font-medium text-slate-300 mb-1">
                Paper Language
              </label>
              <select
                id="exam-language"
                value={language}
                onChange={(e) =>
                  setLanguage(e.target.value as 'English' | 'Hindi' | 'Bilingual')
                }
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
                <option value="Bilingual">Bilingual (EN + HI)</option>
              </select>
            </div>
          </div>

          {/* Chapter & Topic Selection */}
          {examMode !== 'full-syllabus' && currentSubjectObj && (
            <div className="space-y-3">
              <div>
                <label htmlFor="exam-chapter" className="block text-xs font-medium text-slate-300 mb-1">
                  Chapter Scope
                </label>
                <select
                  id="exam-chapter"
                  value={chapter}
                  onChange={(e) => {
                    setChapter(e.target.value);
                    setSelectedTopics([]);
                  }}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  {currentSubjectObj.chapters.map((ch) => (
                    <option key={ch.id} value={ch.title}>
                      Ch {ch.number}: {ch.title}
                    </option>
                  ))}
                </select>
              </div>

              {currentChapterObj && currentChapterObj.keyTopics.length > 0 && (
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium text-slate-300">
                    Focus Topics {examMode === 'custom-test' ? '(Pick 1 or more)' : '(Optional)'}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {currentChapterObj.keyTopics.map((topicName) => {
                      const active = selectedTopics.includes(topicName);
                      return (
                        <button
                          key={topicName}
                          type="button"
                          onClick={() => toggleTopicSelection(topicName)}
                          aria-pressed={active}
                          className={`px-2.5 py-1 rounded-md border text-xs cursor-pointer transition-colors ${
                            active
                              ? 'bg-indigo-600/25 border-indigo-500 text-indigo-200'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {topicName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Timing, Question Count, Difficulty, Negative Marking */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="exam-duration" className="block text-xs font-medium text-slate-300 mb-1">
                Duration
              </label>
              <select
                id="exam-duration"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value={10}>10 Minutes (Quick Sprint)</option>
                <option value={20}>20 Minutes</option>
                <option value={30}>30 Minutes</option>
                <option value={45}>45 Minutes</option>
                <option value={60}>60 Minutes (1 Hour)</option>
                <option value={90}>90 Minutes</option>
                <option value={180}>180 Minutes (3 Hours Mock)</option>
              </select>
            </div>

            <div>
              <label htmlFor="exam-count" className="block text-xs font-medium text-slate-300 mb-1">
                Question Count
              </label>
              <select
                id="exam-count"
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value={5}>5 Questions</option>
                <option value={7}>7 Questions (All Formats)</option>
                <option value={10}>10 Questions</option>
                <option value={15}>15 Questions</option>
                <option value={20}>20 Questions</option>
              </select>
            </div>

            <div>
              <label htmlFor="exam-difficulty" className="block text-xs font-medium text-slate-300 mb-1">
                Difficulty Profile
              </label>
              <select
                id="exam-difficulty"
                value={difficultyMix}
                onChange={(e) =>
                  setDifficultyMix(
                    e.target.value as 'balanced' | 'foundation-focus' | 'board-challenge'
                  )
                }
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="balanced">Balanced Board Mix</option>
                <option value="foundation-focus">Foundation Focus</option>
                <option value="board-challenge">Board Challenge</option>
              </select>
            </div>
          </div>

          {/* 7 Question Formats Selector */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-300">
              Question Formats (Select 1–7)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {QUESTION_FORMAT_OPTIONS.map((fmt) => {
                const checked = selectedTypes.includes(fmt.id);
                return (
                  <label
                    key={fmt.id}
                    className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-2 cursor-pointer transition-colors ${
                      checked
                        ? 'bg-indigo-600/20 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleQuestionType(fmt.id)}
                      className="rounded border-slate-600 bg-slate-900 text-indigo-500"
                    />
                    <span className="truncate flex-1">{fmt.label}</span>
                    <span className="text-[10px] text-slate-400 tabular-nums">{fmt.marksHint}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Negative Marking & Submit */}
          <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={negativeMarkingEnabled}
                onChange={(e) => setNegativeMarkingEnabled(e.target.checked)}
                className="rounded border-slate-600 bg-slate-900 text-indigo-500"
              />
              <span>Enable negative marking (-25% on wrong objective answers)</span>
            </label>

            <Button
              type="submit"
              variant="primary"
              disabled={isGenerating}
              icon={<Sparkles className="w-4 h-4" />}
            >
              {isGenerating ? 'Generating Practice Paper...' : 'Generate Practice Exam'}
            </Button>
          </div>

          {setupError && (
            <div
              role="alert"
              className="bg-rose-950/60 border border-rose-700/60 rounded-lg p-3 text-xs text-rose-200 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{setupError}</span>
            </div>
          )}
        </form>

        {/* Attempt History Panel */}
        <aside className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-400" />
              Past Exam Attempts
            </h2>
            <span className="text-xs text-slate-400 tabular-nums">{history.length} saved</span>
          </div>

          {historyLoading ? (
            <p className="text-xs text-slate-400 py-4">Loading attempt history...</p>
          ) : history.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <BookOpen className="w-7 h-7 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                No exam attempts recorded yet. Generate a practice paper to track scores, timing, and topic analytics.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800 max-h-[500px] overflow-y-auto">
              {history.map((att) => (
                <div key={att.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveResult(att);
                        setServerTimingMessage(null);
                        setStage('results');
                      }}
                      className="text-left text-xs font-semibold text-white hover:text-indigo-300 cursor-pointer"
                    >
                      {att.paperTitle}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAttempt(att.id)}
                      aria-label={`Delete attempt ${att.paperTitle}`}
                      className="text-slate-500 hover:text-rose-400 cursor-pointer shrink-0 p-0.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400 tabular-nums">
                    <span>
                      {att.subject} · {new Date(att.submittedAt).toLocaleDateString()}
                    </span>
                    <span
                      className={`font-bold flex items-center gap-1 ${
                        att.percentage >= 75
                          ? 'text-emerald-400'
                          : att.percentage >= 50
                            ? 'text-amber-400'
                            : 'text-rose-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      {att.marksObtained}/{att.totalMarks} ({att.percentage}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
