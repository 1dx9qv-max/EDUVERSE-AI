import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookmarkPlus,
  CheckCircle2,
  ChevronRight,
  Clock,
  HelpCircle,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../router/Router';
import { getSampleCurriculum } from '../utils/curriculum';
import {
  evaluateShortAnswer,
  generateAdaptivePractice,
  submitRecommendationAction,
} from '../api/client';
import {
  dispatchVerifiedLearningEvent,
  fetchPracticeAttempts,
  fetchTopicMasteryList,
  fetchVerifiedSyllabus,
  saveFlashcard,
  savePracticeAttempt,
  savePracticeSummaryRecord,
  saveTopicMastery,
} from '../lib/firestoreService';
import {
  buildTopicMasteryId,
  calculateAdaptiveDifficulty,
  gradePracticeAnswer,
  recomputeTopicMastery,
  sanitizeDocumentId,
} from '../utils/learningEngine';
import { createFlashcardRecord } from '../utils/memoryEngine';
import {
  DifficultyTier,
  PracticeAttemptRecord,
  PracticeQuestion,
  QuestionType,
  TopicMasteryRecord,
} from '../types/phase4';
import { Button } from '../components/common/Button';

const QUESTION_TYPE_LABELS: Array<{ id: QuestionType; label: string }> = [
  { id: 'mcq', label: 'Multiple Choice' },
  { id: 'true-false', label: 'True / False' },
  { id: 'fill-blank', label: 'Fill in Blank' },
  { id: 'short-answer', label: 'Short Answer' },
  { id: 'numerical', label: 'Numerical' },
];

const DIFFICULTY_LABELS: Array<{ id: DifficultyTier | 'auto'; label: string }> = [
  { id: 'auto', label: 'Auto-Adaptive' },
  { id: 'foundation', label: 'Foundation' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'board-challenge', label: 'Board Challenge' },
];

interface GradedFeedbackState {
  isCorrect: boolean;
  scoreRatio: number;
  feedback: string;
  detectedErrorTag: string;
  misconceptionNote: string;
  userAnswer: string;
  timeSpentSeconds: number;
  savedFlashcard?: boolean;
}

export const PracticePage: React.FC = () => {
  const { user } = useAuth();
  const { searchParams, navigate } = useRouter();

  const board = user?.board || 'CBSE';
  const classGrade = user?.classGrade || 'Class 10';
  const language =
    user?.language === 'Hindi' || user?.language === 'Bilingual' ? user.language : 'English';

  const curriculum = useMemo(() => getSampleCurriculum(board, classGrade), [board, classGrade]);

  const paramSubject = searchParams.get('subject') || '';
  const paramChapter = searchParams.get('chapter') || '';
  const paramTopic = searchParams.get('topic') || '';
  const paramDifficulty = searchParams.get('difficulty') as DifficultyTier | null;
  const paramErrorTag = searchParams.get('errorTag') || '';
  const paramRecId = searchParams.get('recId') || '';

  const [selectedSubject, setSelectedSubject] = useState<string>(
    paramSubject || curriculum[0]?.name || 'Mathematics'
  );
  const [selectedChapter, setSelectedChapter] = useState<string>(
    paramChapter || curriculum[0]?.chapters[0]?.title || 'Core Chapter'
  );
  const [selectedTopic, setSelectedTopic] = useState<string>(
    paramTopic || curriculum[0]?.chapters[0]?.keyTopics[0] || 'Core Concept'
  );
  const [difficultyMode, setDifficultyMode] = useState<DifficultyTier | 'auto'>(
    paramDifficulty === 'foundation' ||
      paramDifficulty === 'intermediate' ||
      paramDifficulty === 'board-challenge'
      ? paramDifficulty
      : 'auto'
  );
  const [focusErrorTag, setFocusErrorTag] = useState<string>(paramErrorTag);
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    'mcq',
    'true-false',
    'fill-blank',
    'short-answer',
    'numerical',
  ]);
  const [questionCount, setQuestionCount] = useState<number>(5);

  const [verifiedChapters, setVerifiedChapters] = useState<Array<{ title: string; topics: string[] }>>([]);
  const [masteryList, setMasteryList] = useState<TopicMasteryRecord[]>([]);
  const [pastAttempts, setPastAttempts] = useState<PracticeAttemptRecord[]>([]);

  // Active Quiz Session state
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [answerDraft, setAnswerDraft] = useState<string>('');
  const [showHint, setShowHint] = useState<boolean>(false);
  const [gradedState, setGradedState] = useState<GradedFeedbackState | null>(null);
  const [sessionAttempts, setSessionAttempts] = useState<PracticeAttemptRecord[]>([]);
  const [sessionComplete, setSessionComplete] = useState<boolean>(false);
  const [adaptiveBannerReason, setAdaptiveBannerReason] = useState<string>('');
  const [syllabusDisclaimer, setSyllabusDisclaimer] = useState<string>('');

  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [isLoadingFollowUp, setIsLoadingFollowUp] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const questionStartRef = useRef<number>(Date.now());
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  // Sync URL params when navigated from Learning Intelligence
  useEffect(() => {
    if (paramSubject) setSelectedSubject(paramSubject);
    if (paramChapter) setSelectedChapter(paramChapter);
    if (paramTopic) setSelectedTopic(paramTopic);
    if (
      paramDifficulty === 'foundation' ||
      paramDifficulty === 'intermediate' ||
      paramDifficulty === 'board-challenge'
    ) {
      setDifficultyMode(paramDifficulty);
    }
    setFocusErrorTag(paramErrorTag);
  }, [paramSubject, paramChapter, paramTopic, paramDifficulty, paramErrorTag]);

  // Load user's mastery & practice attempts
  useEffect(() => {
    if (!user?.uid) return;
    let active = true;
    Promise.all([
      fetchTopicMasteryList(user.uid),
      fetchPracticeAttempts(user.uid),
    ])
      .then(([mList, aList]) => {
        if (!active) return;
        setMasteryList(mList);
        setPastAttempts(aList);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.uid]);

  // Fetch verified admin syllabus if present for selected subject
  useEffect(() => {
    const subjObj = curriculum.find((s) => s.name === selectedSubject);
    const subjId = subjObj?.id || selectedSubject.toLowerCase().replace(/\s+/g, '-');
    let active = true;
    fetchVerifiedSyllabus(board, classGrade, subjId)
      .then((nodes) => {
        if (!active) return;
        if (nodes.length > 0) {
          setVerifiedChapters(
            nodes.map((n) => ({
              title: n.chapterTitle,
              topics: n.topics.map((t) => t.title),
            }))
          );
        } else {
          setVerifiedChapters([]);
        }
      })
      .catch(() => {
        if (active) setVerifiedChapters([]);
      });
    return () => {
      active = false;
    };
  }, [board, classGrade, selectedSubject, curriculum]);

  const availableChapters = useMemo(() => {
    if (verifiedChapters.length > 0) return verifiedChapters;
    const subjObj = curriculum.find((s) => s.name === selectedSubject) || curriculum[0];
    return (subjObj?.chapters || []).map((c) => ({
      title: c.title,
      topics: c.keyTopics,
    }));
  }, [verifiedChapters, curriculum, selectedSubject]);

  const currentTopicMastery = useMemo(() => {
    const normTopic = selectedTopic.trim().toLowerCase();
    const normSub = selectedSubject.trim().toLowerCase();
    return (
      masteryList.find(
        (m) => m.topic.trim().toLowerCase() === normTopic && m.subject.trim().toLowerCase() === normSub
      ) || null
    );
  }, [masteryList, selectedSubject, selectedTopic]);

  const currentTopicAttempts = useMemo(() => {
    const normTopic = selectedTopic.trim().toLowerCase();
    const normSub = selectedSubject.trim().toLowerCase();
    return pastAttempts.filter(
      (a) => a.topic.trim().toLowerCase() === normTopic && a.subject.trim().toLowerCase() === normSub
    );
  }, [pastAttempts, selectedSubject, selectedTopic]);

  const adaptiveSuggestion = useMemo(
    () => calculateAdaptiveDifficulty(currentTopicMastery, currentTopicAttempts),
    [currentTopicMastery, currentTopicAttempts]
  );

  // Question timer ticker
  useEffect(() => {
    if (questions.length === 0 || sessionComplete || gradedState) return;
    const interval = setInterval(() => {
      setElapsedSec(Math.max(1, Math.round((Date.now() - questionStartRef.current) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [questions.length, currentIndex, sessionComplete, gradedState]);

  const handleSubjectChange = (newSubject: string) => {
    setSelectedSubject(newSubject);
    const subj = curriculum.find((s) => s.name === newSubject);
    const firstChap = subj?.chapters[0];
    if (firstChap) {
      setSelectedChapter(firstChap.title);
      setSelectedTopic(firstChap.keyTopics[0] || firstChap.title);
    }
    setFocusErrorTag('');
  };

  const handleChapterChange = (chapTitle: string) => {
    setSelectedChapter(chapTitle);
    const found = availableChapters.find((c) => c.title === chapTitle);
    if (found && found.topics[0]) {
      setSelectedTopic(found.topics[0]);
    }
  };

  const toggleQuestionType = (typeId: QuestionType) => {
    setSelectedTypes((prev) => {
      if (prev.includes(typeId)) {
        return prev.length > 1 ? prev.filter((t) => t !== typeId) : prev;
      }
      return [...prev, typeId];
    });
  };

  const startPracticeSession = async () => {
    if (!selectedTopic.trim()) {
      setErrorMessage('Please enter or select a topic before starting practice.');
      return;
    }

    setErrorMessage(null);
    setIsGenerating(true);
    setSessionComplete(false);
    setGradedState(null);
    setAnswerDraft('');
    setShowHint(false);
    setSessionAttempts([]);

    const resolvedDifficulty: DifficultyTier =
      difficultyMode === 'auto' ? adaptiveSuggestion.difficulty : difficultyMode;
    const activeFocusError = focusErrorTag || adaptiveSuggestion.focusErrorTag;

    const perfSummary = currentTopicMastery
      ? `Attempts: ${currentTopicMastery.attemptsCount}, Weighted Mastery: ${currentTopicMastery.weightedMasteryScore}%, Status: ${currentTopicMastery.status}${
          currentTopicMastery.recurringErrors[0]
            ? `, Recurring error: ${currentTopicMastery.recurringErrors[0].errorTag}`
            : ''
        }`
      : 'First recorded session on this topic.';

    try {
      const res = await generateAdaptivePractice({
        board,
        classGrade,
        subject: selectedSubject,
        chapter: selectedChapter,
        topic: selectedTopic.trim(),
        difficulty: resolvedDifficulty,
        questionTypes: selectedTypes,
        count: questionCount,
        language,
        focusErrorTag: activeFocusError || undefined,
        previousPerformanceSummary: perfSummary,
      });

      setQuestions(res.questions);
      setCurrentIndex(0);
      setAdaptiveBannerReason(res.adaptiveReason || adaptiveSuggestion.reason);
      setSyllabusDisclaimer(res.syllabusNote);
      questionStartRef.current = Date.now();
      setElapsedSec(0);
      if (paramRecId) {
        submitRecommendationAction(paramRecId, 'started', {
          subject: selectedSubject,
          chapter: selectedChapter,
          topic: selectedTopic.trim(),
        }).catch(() => {});
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not generate practice questions right now. Please try again.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const currentQuestion = questions[currentIndex] || null;

  const handleSubmitAnswer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentQuestion || !user?.uid || gradedState) return;
    if (!answerDraft.trim()) {
      setErrorMessage('Please provide or select an answer before checking.');
      return;
    }

    setErrorMessage(null);
    const timeSpentSeconds = Math.max(1, Math.round((Date.now() - questionStartRef.current) / 1000));
    setIsEvaluating(true);

    try {
      let gradeResult = gradePracticeAnswer(currentQuestion, answerDraft);

      // Enhance short-answer evaluation using Gemini when available
      if (currentQuestion.questionType === 'short-answer') {
        try {
          const aiEval = await evaluateShortAnswer({
            board,
            classGrade,
            subject: currentQuestion.subject,
            topic: currentQuestion.topic,
            questionPrompt: currentQuestion.prompt,
            expectedAnswer: currentQuestion.correctAnswer,
            expectedKeywords: currentQuestion.expectedKeywords,
            studentAnswer: answerDraft,
            language,
          });
          gradeResult = {
            isCorrect: aiEval.isCorrect,
            scoreRatio: aiEval.scoreRatio,
            feedback: aiEval.feedback,
            detectedErrorTag: aiEval.detectedErrorTag,
            misconceptionNote: aiEval.misconceptionNote,
          };
        } catch {
          // Graceful fallback to deterministic keyword grading already computed
        }
      }

      const nowIso = new Date().toISOString();
      const attemptRecord: PracticeAttemptRecord = {
        id: sanitizeDocumentId(`${Date.now()}_${currentIndex}`, 'att'),
        userId: user.uid,
        subject: currentQuestion.subject,
        chapter: currentQuestion.chapter,
        topic: currentQuestion.topic,
        board,
        classGrade,
        questionId: currentQuestion.id,
        questionType: currentQuestion.questionType,
        difficulty: currentQuestion.difficulty,
        prompt: currentQuestion.prompt,
        userAnswer: answerDraft.trim(),
        correctAnswer: currentQuestion.correctAnswer,
        isCorrect: gradeResult.isCorrect,
        scoreRatio: gradeResult.scoreRatio,
        timeSpentSeconds,
        errorTag: gradeResult.isCorrect ? undefined : gradeResult.detectedErrorTag || currentQuestion.errorTag,
        misconceptionNote: gradeResult.isCorrect
          ? undefined
          : gradeResult.misconceptionNote || currentQuestion.commonMistake,
        createdAt: nowIso,
      };

      const savedAttempt = await savePracticeAttempt(attemptRecord);
      const updatedAllAttempts = [savedAttempt, ...pastAttempts];
      setPastAttempts(updatedAllAttempts);
      setSessionAttempts((prev) => [...prev, savedAttempt]);

      // Recompute topic mastery cleanly using ALL attempts for this subject+topic
      const topicAttempts = updatedAllAttempts.filter(
        (a) =>
          a.subject.toLowerCase() === currentQuestion.subject.toLowerCase() &&
          a.topic.toLowerCase() === currentQuestion.topic.toLowerCase()
      );
      const existingMastery =
        masteryList.find(
          (m) =>
            m.id === buildTopicMasteryId(user.uid, currentQuestion.subject, currentQuestion.topic) ||
            (m.subject.toLowerCase() === currentQuestion.subject.toLowerCase() &&
              m.topic.toLowerCase() === currentQuestion.topic.toLowerCase())
        ) || null;

      const updatedMastery = recomputeTopicMastery({
        existing: existingMastery,
        userId: user.uid,
        subject: currentQuestion.subject,
        chapter: currentQuestion.chapter,
        topic: currentQuestion.topic,
        allTopicAttempts: topicAttempts,
        nowIso,
      });

      const savedMastery = await saveTopicMastery(updatedMastery);
      setMasteryList((prev) => [
        savedMastery,
        ...prev.filter((m) => m.id !== savedMastery.id),
      ]);

      void dispatchVerifiedLearningEvent({
        eventType: 'practice_attempted',
        subject: currentQuestion.subject,
        chapter: currentQuestion.chapter,
        topic: currentQuestion.topic,
        sourceModule: 'practice',
        idempotencyKey: `practice_attempt_${savedAttempt.id}`,
        isCorrect: gradeResult.isCorrect,
        scoreRatio: gradeResult.scoreRatio,
        errorTag: attemptRecord.errorTag,
        difficulty: currentQuestion.difficulty,
        recId: paramRecId || undefined,
        title: `Practice: ${currentQuestion.topic}`,
        description: `${currentQuestion.subject} (${currentQuestion.difficulty})`,
      });

      setGradedState({
        ...gradeResult,
        userAnswer: answerDraft.trim(),
        timeSpentSeconds,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to save practice attempt. Please retry.'
      );
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleGenerateSimilarFollowUp = async () => {
    if (!currentQuestion) return;
    setIsLoadingFollowUp(true);
    setErrorMessage(null);
    try {
      const res = await generateAdaptivePractice({
        board,
        classGrade,
        subject: currentQuestion.subject,
        chapter: currentQuestion.chapter,
        topic: currentQuestion.topic,
        difficulty: currentQuestion.difficulty,
        questionTypes: [currentQuestion.questionType],
        count: 1,
        language,
        focusErrorTag: gradedState?.detectedErrorTag || currentQuestion.errorTag,
        similarToQuestion: {
          prompt: currentQuestion.prompt,
          questionType: currentQuestion.questionType,
          errorTag: gradedState?.detectedErrorTag || currentQuestion.errorTag,
        },
      });
      if (res.questions[0]) {
        const nextQuestions = [...questions];
        nextQuestions.splice(currentIndex + 1, 0, res.questions[0]);
        setQuestions(nextQuestions);
        setCurrentIndex(currentIndex + 1);
        setAnswerDraft('');
        setGradedState(null);
        setShowHint(false);
        questionStartRef.current = Date.now();
        setElapsedSec(0);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to generate follow-up question.');
    } finally {
      setIsLoadingFollowUp(false);
    }
  };

  const handleSaveMistakeFlashcard = async () => {
    if (!currentQuestion || !user?.uid || !gradedState) return;
    try {
      const card = createFlashcardRecord({
        userId: user.uid,
        subject: currentQuestion.subject,
        chapter: currentQuestion.chapter,
        topic: currentQuestion.topic,
        board,
        classGrade,
        front: currentQuestion.prompt,
        back: `${currentQuestion.correctAnswer}\n\nWhy: ${currentQuestion.explanation}`,
        hint: currentQuestion.hint,
        source: gradedState.isCorrect ? 'ai-generated' : 'error-remediation',
        linkedErrorTag: gradedState.isCorrect
          ? undefined
          : gradedState.detectedErrorTag || currentQuestion.errorTag,
      });
      await saveFlashcard(card);
      setGradedState((prev) => (prev ? { ...prev, savedFlashcard: true } : prev));
    } catch {
      setErrorMessage('Could not save recall card right now.');
    }
  };

  const handleNextOrFinish = async () => {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex(currentIndex + 1);
      setAnswerDraft('');
      setGradedState(null);
      setShowHint(false);
      questionStartRef.current = Date.now();
      setElapsedSec(0);
      return;
    }

    // Complete session
    setSessionComplete(true);
    if (user?.uid && sessionAttempts.length > 0) {
      const correct = sessionAttempts.filter((a) => a.isCorrect).length;
      const totalSec = sessionAttempts.reduce((acc, a) => acc + a.timeSpentSeconds, 0);
      savePracticeSummaryRecord({
        userId: user.uid,
        subject: selectedSubject,
        topic: selectedTopic,
        score: correct,
        totalQuestions: sessionAttempts.length,
        timeSpentSeconds: totalSec,
      }).catch(() => {});
      if (paramRecId) {
        submitRecommendationAction(paramRecId, 'completed', {
          subject: selectedSubject,
          chapter: selectedChapter,
          topic: selectedTopic.trim(),
        }).catch(() => {});
      }
    }
  };

  const sessionCorrectCount = sessionAttempts.filter((a) => a.isCorrect).length;
  const sessionAccuracy =
    sessionAttempts.length > 0 ? Math.round((sessionCorrectCount / sessionAttempts.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="space-y-1">
          <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
            Adaptive Practice Engine · {board} · {classGrade} · {language}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Adaptive Topic Practice
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            Practice across multiple choice, true/false, fill-in-the-blank, short answer, and numerical problems calibrated to your live mastery profile.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/learning-intelligence')}
            className="whitespace-nowrap shrink-0"
          >
            View Learning Intelligence
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/memory-booster')}
            className="whitespace-nowrap shrink-0"
          >
            Memory Booster
          </Button>
        </div>
      </div>

      {/* Adaptive Signal Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-slate-200">
              {selectedSubject}
            </span>
            <span aria-hidden="true">·</span>
            <span>{selectedTopic}</span>
            {currentTopicMastery && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums font-medium text-indigo-600 dark:text-indigo-400">
                  {Math.round(currentTopicMastery.weightedMasteryScore)}% mastery ({currentTopicMastery.attemptsCount} attempts)
                </span>
              </>
            )}
            {focusErrorTag && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  Targeting: {focusErrorTag.replace(/-/g, ' ')}
                </span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {adaptiveBannerReason || adaptiveSuggestion.reason}
          </p>
        </div>
        {focusErrorTag && (
          <button
            type="button"
            onClick={() => setFocusErrorTag('')}
            className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Clear error focus
          </button>
        )}
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs font-semibold underline cursor-pointer shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Configuration Panel (visible before starting or when resetting) */}
      {questions.length === 0 && !sessionComplete && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Topic & Curriculum Config */}
          <div className="lg:col-span-7 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 sm:p-6 space-y-5">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              1. Choose Topic & Difficulty
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 min-w-0">
                <label
                  htmlFor="practice-subject"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Subject
                </label>
                <select
                  id="practice-subject"
                  value={selectedSubject}
                  onChange={(e) => handleSubjectChange(e.target.value)}
                  className="w-full max-w-full min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {curriculum.map((sub) => (
                    <option key={sub.id} value={sub.name}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 min-w-0">
                <label
                  htmlFor="practice-chapter"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Chapter ({verifiedChapters.length > 0 ? 'Admin Verified' : 'Board Sample'})
                </label>
                <select
                  id="practice-chapter"
                  value={selectedChapter}
                  onChange={(e) => handleChapterChange(e.target.value)}
                  className="w-full max-w-full min-w-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {availableChapters.map((ch) => (
                    <option key={ch.title} value={ch.title}>
                      {ch.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="practice-topic-input"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Topic Focus (Select a suggested topic or type your own)
              </label>
              <input
                id="practice-topic-input"
                type="text"
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
                placeholder="e.g., Lens Formula, Quadratic Equations, Rate Law..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {availableChapters.find((c) => c.title === selectedChapter)?.topics?.length ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {availableChapters
                    .find((c) => c.title === selectedChapter)!
                    .topics.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setSelectedTopic(t)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors max-w-full text-left cursor-pointer ${
                          selectedTopic === t
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Difficulty Level
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DIFFICULTY_LABELS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDifficultyMode(d.id)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      difficultyMode === d.id
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-indigo-500/40'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Question Formats & Launch */}
          <div className="lg:col-span-5 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 sm:p-6 space-y-5">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              2. Question Formats & Session Size
            </h2>

            <div className="space-y-2">
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Active Formats ({selectedTypes.length} selected)
              </span>
              <div className="flex flex-wrap gap-2">
                {QUESTION_TYPE_LABELS.map((qt) => {
                  const active = selectedTypes.includes(qt.id);
                  return (
                    <button
                      key={qt.id}
                      type="button"
                      onClick={() => toggleQuestionType(qt.id)}
                      aria-pressed={active}
                      className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-indigo-600/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/50'
                          : 'bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {active ? '✓ ' : ''}
                      {qt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Questions in Session
              </span>
              <div className="flex items-center gap-2">
                {[3, 5, 6].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setQuestionCount(cnt)}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold border tabular-nums transition-colors cursor-pointer ${
                      questionCount === cnt
                        ? 'bg-indigo-600 text-white border-indigo-500'
                        : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    {cnt} Questions
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                loading={isGenerating}
                onClick={startPracticeSession}
                icon={<Play className="w-4 h-4" />}
              >
                {isGenerating ? 'Generating Adaptive Questions...' : 'Start Adaptive Practice'}
              </Button>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Every response updates your transparent mastery graph and schedules targeted revision where helpful.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active Question Runner */}
      {currentQuestion && !sessionComplete && (
        <div className="max-w-4xl mx-auto space-y-5">
          {/* Progress Header */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                Question {currentIndex + 1} of {questions.length}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {QUESTION_TYPE_LABELS.find((t) => t.id === currentQuestion.questionType)?.label ||
                  currentQuestion.questionType}
              </span>
              <span aria-hidden="true">·</span>
              <span className="capitalize">{currentQuestion.difficulty.replace('-', ' ')}</span>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums inline-flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {elapsedSec}s
              </span>
              <button
                type="button"
                onClick={() => {
                  setQuestions([]);
                  setGradedState(null);
                  setSessionAttempts([]);
                }}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
              >
                Change Topic
              </button>
            </div>
          </div>

          {/* Question Card */}
          <form
            onSubmit={handleSubmitAnswer}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 sm:p-8 space-y-6"
          >
            <div className="space-y-2">
              <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                {currentQuestion.subject} · {currentQuestion.chapter} · {currentQuestion.topic}
              </p>
              <h2 className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white leading-relaxed">
                {currentQuestion.prompt}
              </h2>
            </div>

            {/* Answer Input per Format */}
            {(currentQuestion.questionType === 'mcq' ||
              currentQuestion.questionType === 'true-false') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Answer options">
                {(
                  currentQuestion.options ||
                  (currentQuestion.questionType === 'true-false' ? ['True', 'False'] : [])
                ).map((option, idx) => {
                  const isSelected = answerDraft === option;
                  const isCorrectOption =
                    gradedState &&
                    option.trim().toLowerCase() === currentQuestion.correctAnswer.trim().toLowerCase();
                  return (
                    <button
                      key={`${option}-${idx}`}
                      type="button"
                      disabled={Boolean(gradedState)}
                      onClick={() => setAnswerDraft(option)}
                      className={`text-left px-4 py-3.5 rounded-xl border text-sm font-medium transition-colors flex items-start gap-3 cursor-pointer disabled:cursor-default ${
                        gradedState
                          ? isCorrectOption
                            ? 'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                            : isSelected && !gradedState.isCorrect
                              ? 'bg-rose-500/15 border-rose-500 text-rose-700 dark:text-rose-300'
                              : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-500'
                          : isSelected
                            ? 'bg-indigo-600/15 border-indigo-500 text-indigo-700 dark:text-indigo-200'
                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-indigo-500/50'
                      }`}
                    >
                      <span className="w-6 h-6 rounded-lg border border-current/30 flex items-center justify-center text-xs font-semibold shrink-0 tabular-nums">
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span>{option}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {(currentQuestion.questionType === 'fill-blank' ||
              currentQuestion.questionType === 'numerical') && (
              <div className="space-y-2">
                <label
                  htmlFor="practice-text-answer"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  {currentQuestion.questionType === 'numerical'
                    ? `Enter Numerical Value${currentQuestion.unit ? ` (Unit: ${currentQuestion.unit})` : ''}`
                    : 'Type the exact missing term or phrase'}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="practice-text-answer"
                    type="text"
                    disabled={Boolean(gradedState)}
                    value={answerDraft}
                    onChange={(e) => setAnswerDraft(e.target.value)}
                    placeholder={
                      currentQuestion.questionType === 'numerical'
                        ? `e.g., 15${currentQuestion.unit ? ` ${currentQuestion.unit}` : ''}`
                        : 'Type your answer...'
                    }
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {currentQuestion.questionType === 'numerical' && currentQuestion.unit && (
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400 shrink-0">
                      {currentQuestion.unit}
                    </span>
                  )}
                </div>
              </div>
            )}

            {currentQuestion.questionType === 'short-answer' && (
              <div className="space-y-2">
                <label
                  htmlFor="practice-short-answer"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Write your short explanation (1–3 concise sentences)
                </label>
                <textarea
                  id="practice-short-answer"
                  rows={3}
                  disabled={Boolean(gradedState)}
                  value={answerDraft}
                  onChange={(e) => setAnswerDraft(e.target.value)}
                  placeholder="Explain the reasoning in your own words..."
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {/* Hint Disclosure */}
            {showHint && !gradedState && (
              <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
                <strong className="text-indigo-600 dark:text-indigo-400">Hint: </strong>
                {currentQuestion.hint}
              </div>
            )}

            {/* Pre-submit Actions */}
            {!gradedState && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowHint((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 cursor-pointer"
                >
                  <HelpCircle className="w-4 h-4" />
                  {showHint ? 'Hide Hint' : 'Need a Hint?'}
                </button>

                <Button
                  type="submit"
                  variant="primary"
                  loading={isEvaluating}
                  disabled={!answerDraft.trim() || isEvaluating}
                >
                  {isEvaluating ? 'Checking Answer...' : 'Check Answer'}
                </Button>
              </div>
            )}

            {/* Instant Feedback & Follow-Up Controls */}
            {gradedState && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                <div
                  className={`rounded-xl border p-4 space-y-2 ${
                    gradedState.isCorrect
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-amber-500/40 bg-amber-500/10'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-sm">
                      {gradedState.isCorrect ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          <span className="text-emerald-700 dark:text-emerald-300">
                            Correct Answer
                          </span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-amber-500" />
                          <span className="text-amber-700 dark:text-amber-300">
                            Review Concept · Expected: {currentQuestion.correctAnswer}
                          </span>
                        </>
                      )}
                    </div>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400 tabular-nums">
                      Score: {Math.round(gradedState.scoreRatio * 100)}% · {gradedState.timeSpentSeconds}s
                    </span>
                  </div>

                  <p className="text-sm text-slate-800 dark:text-slate-200">{gradedState.feedback}</p>
                </div>

                <div className="space-y-3 text-sm">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Step-by-Step Explanation
                    </h3>
                    <p className="mt-1 text-slate-700 dark:text-slate-200 leading-relaxed">
                      {currentQuestion.explanation}
                    </p>
                  </div>

                  {!gradedState.isCorrect && (
                    <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3.5 text-xs space-y-1">
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        Watch Out ({(gradedState.detectedErrorTag || currentQuestion.errorTag).replace(/-/g, ' ')}):{' '}
                      </span>
                      <span className="text-slate-700 dark:text-slate-300">
                        {gradedState.misconceptionNote || currentQuestion.commonMistake}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={isLoadingFollowUp}
                      onClick={handleGenerateSimilarFollowUp}
                      icon={<RefreshCw className="w-3.5 h-3.5" />}
                    >
                      Similar Follow-up Question
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={Boolean(gradedState.savedFlashcard)}
                      onClick={handleSaveMistakeFlashcard}
                      icon={<BookmarkPlus className="w-3.5 h-3.5" />}
                    >
                      {gradedState.savedFlashcard ? 'Saved to Memory Booster' : 'Save Recall Card'}
                    </Button>
                  </div>

                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleNextOrFinish}
                    icon={<ChevronRight className="w-4 h-4" />}
                  >
                    {currentIndex + 1 < questions.length ? 'Next Question' : 'Complete Session'}
                  </Button>
                </div>
              </div>
            )}
          </form>

          {syllabusDisclaimer && (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
              {syllabusDisclaimer}
            </p>
          )}
        </div>
      )}

      {/* Session Complete Summary */}
      {sessionComplete && (
        <div className="max-w-3xl mx-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 sm:p-8 space-y-6">
          <div className="space-y-1">
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Session Recorded · {selectedSubject} · {selectedTopic}
            </p>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              Practice Session Complete
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Your attempts have been integrated into Learning Intelligence without penalizing single mistakes.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 border-y border-slate-200 dark:border-slate-800 py-5">
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 block">Accuracy</span>
              <span className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {sessionAccuracy}%
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 block">Solved Correctly</span>
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {sessionCorrectCount} / {sessionAttempts.length}
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 block">Topic Mastery</span>
              <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                {currentTopicMastery ? `${Math.round(currentTopicMastery.weightedMasteryScore)}%` : '—'}
              </span>
            </div>
          </div>

          {currentTopicMastery && (
            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 text-xs space-y-1">
              <div className="font-semibold text-slate-900 dark:text-white">
                Current Mastery Classification: <span className="capitalize">{currentTopicMastery.status.replace('-', ' ')}</span>
              </div>
              <p className="text-slate-600 dark:text-slate-400">
                {currentTopicMastery.status === 'insufficient-data'
                  ? 'Early signal logged. One or two questions never label you weak — solve a couple more to build a reliable score.'
                  : adaptiveSuggestion.reason}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  setSessionComplete(false);
                  setQuestions([]);
                }}
                icon={<Sparkles className="w-4 h-4" />}
              >
                Practice Another Set
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/learning-intelligence')}
                icon={<Target className="w-4 h-4" />}
              >
                Inspect Learning Intelligence
              </Button>
            </div>
            <Button
              variant="ghost"
              onClick={() =>
                navigate('/memory-booster', {
                  subject: selectedSubject,
                  chapter: selectedChapter,
                  topic: selectedTopic,
                })
              }
              icon={<RotateCcw className="w-4 h-4" />}
            >
              Generate Flashcards for {selectedTopic}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
