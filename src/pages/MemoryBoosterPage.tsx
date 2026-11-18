import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Eye,
  Flame,
  Layers,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../router/Router';
import { getSampleCurriculum } from '../utils/curriculum';
import { generateFlashcards } from '../api/client';
import {
  deleteFlashcard,
  dispatchVerifiedLearningEvent,
  fetchFlashcardReviews,
  fetchFlashcards,
  fetchPracticeAttempts,
  fetchTopicMasteryList,
  saveFlashcard,
  saveFlashcardReview,
  saveFlashcardsBatch,
  saveTopicMastery,
} from '../lib/firestoreService';
import {
  buildTopicMasteryId,
  recomputeTopicMastery,
} from '../utils/learningEngine';
import {
  computeNextSm2Schedule,
  createFlashcardRecord,
  groupCardsByChapter,
  previewNextIntervals,
  sortDailyRevisionQueue,
} from '../utils/memoryEngine';
import {
  FlashcardRecord,
  FlashcardReviewLog,
  PracticeAttemptRecord,
  Sm2Rating,
  TopicMasteryRecord,
} from '../types/phase4';
import { Button } from '../components/common/Button';

type MemoryTab = 'queue' | 'chapters' | 'difficult' | 'create';

export const MemoryBoosterPage: React.FC = () => {
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
  const paramErrorTag = searchParams.get('errorTag') || '';

  const [cards, setCards] = useState<FlashcardRecord[]>([]);
  const [reviews, setReviews] = useState<FlashcardReviewLog[]>([]);
  const [masteryList, setMasteryList] = useState<TopicMasteryRecord[]>([]);
  const [attempts, setAttempts] = useState<PracticeAttemptRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [activeTab, setActiveTab] = useState<MemoryTab>(
    paramTopic ? 'create' : 'queue'
  );

  // Active Recall Stage state
  const [chapterFilterKey, setChapterFilterKey] = useState<string>('all');
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [showHint, setShowHint] = useState<boolean>(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);

  // AI Generator Form state
  const [genSubject, setGenSubject] = useState<string>(
    paramSubject || curriculum[0]?.name || 'Mathematics'
  );
  const [genChapter, setGenChapter] = useState<string>(
    paramChapter || curriculum[0]?.chapters[0]?.title || 'Core Chapter'
  );
  const [genTopic, setGenTopic] = useState<string>(
    paramTopic || curriculum[0]?.chapters[0]?.keyTopics[0] || 'Core Concept'
  );
  const [genFocusError, setGenFocusError] = useState<string>(paramErrorTag);
  const [genCount, setGenCount] = useState<number>(4);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Custom Student Flashcard Form state
  const [customSubject, setCustomSubject] = useState<string>(
    paramSubject || curriculum[0]?.name || 'Mathematics'
  );
  const [customChapter, setCustomChapter] = useState<string>(
    paramChapter || curriculum[0]?.chapters[0]?.title || 'Personal Notes'
  );
  const [customTopic, setCustomTopic] = useState<string>(
    paramTopic || 'Key Formula'
  );
  const [customFront, setCustomFront] = useState<string>('');
  const [customBack, setCustomBack] = useState<string>('');
  const [customHint, setCustomHint] = useState<string>('');
  const [isSavingCustom, setIsSavingCustom] = useState<boolean>(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (paramSubject) {
      setGenSubject(paramSubject);
      setCustomSubject(paramSubject);
    }
    if (paramChapter) {
      setGenChapter(paramChapter);
      setCustomChapter(paramChapter);
    }
    if (paramTopic) {
      setGenTopic(paramTopic);
      setCustomTopic(paramTopic);
      setActiveTab('create');
    }
    if (paramErrorTag) {
      setGenFocusError(paramErrorTag);
    }
  }, [paramSubject, paramChapter, paramTopic, paramErrorTag]);

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    Promise.all([
      fetchFlashcards(user.uid),
      fetchFlashcardReviews(user.uid),
      fetchTopicMasteryList(user.uid),
      fetchPracticeAttempts(user.uid),
    ])
      .then(([cList, rList, mList, aList]) => {
        if (!active) return;
        setCards(cList);
        setReviews(rList);
        setMasteryList(mList);
        setAttempts(aList);
      })
      .catch(() => {
        if (active) setErrorMessage('Unable to load your spaced repetition deck.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.uid]);

  const dailyQueue = useMemo(() => {
    const filtered =
      chapterFilterKey === 'all'
        ? cards
        : cards.filter((c) => `${c.subject}::${c.chapter}` === chapterFilterKey);
    return sortDailyRevisionQueue(filtered);
  }, [cards, chapterFilterKey]);

  const chapterDecks = useMemo(() => groupCardsByChapter(cards), [cards]);
  const difficultCards = useMemo(
    () => cards.filter((c) => c.difficultyTag === 'difficult' || c.source === 'error-remediation'),
    [cards]
  );

  const activeCard = dailyQueue[0] || null;
  const nextIntervalPreview = useMemo(
    () => (activeCard ? previewNextIntervals(activeCard) : null),
    [activeCard]
  );

  const handleRateCard = async (quality: Sm2Rating) => {
    if (!activeCard || !user?.uid) return;
    setErrorMessage(null);
    const nowIso = new Date().toISOString();
    const { updatedCard, reviewLog, wasCorrect } = computeNextSm2Schedule(
      activeCard,
      quality,
      nowIso
    );

    try {
      const savedCard = await saveFlashcard(updatedCard);
      const savedReview = await saveFlashcardReview(reviewLog);

      setCards((prev) => prev.map((c) => (c.id === savedCard.id ? savedCard : c)));
      setReviews((prev) => [savedReview, ...prev].slice(0, 80));
      setIsFlipped(false);
      setShowHint(false);

      const intervalLabel =
        savedReview.nextIntervalDays === 0
          ? 're-queued for today'
          : `scheduled in ${savedReview.nextIntervalDays} day${savedReview.nextIntervalDays === 1 ? '' : 's'}`;
      setReviewFeedback(
        `Rated "${activeCard.topic}" — ${wasCorrect ? 'Recall logged' : 'Marked for extra reinforcement'}, ${intervalLabel}.`
      );

      // Update TopicMastery revision count in Learning Intelligence
      const topicAttempts = attempts.filter(
        (a) =>
          a.subject.toLowerCase() === activeCard.subject.toLowerCase() &&
          a.topic.toLowerCase() === activeCard.topic.toLowerCase()
      );
      const existingMastery =
        masteryList.find(
          (m) =>
            m.id === buildTopicMasteryId(user.uid, activeCard.subject, activeCard.topic) ||
            (m.subject.toLowerCase() === activeCard.subject.toLowerCase() &&
              m.topic.toLowerCase() === activeCard.topic.toLowerCase())
        ) || null;

      const updatedMastery = recomputeTopicMastery({
        existing: existingMastery,
        userId: user.uid,
        subject: activeCard.subject,
        chapter: activeCard.chapter,
        topic: activeCard.topic,
        allTopicAttempts: topicAttempts,
        revisionIncrement: 1,
        nowIso,
      });

      const savedMastery = await saveTopicMastery(updatedMastery);
      setMasteryList((prev) => [
        savedMastery,
        ...prev.filter((m) => m.id !== savedMastery.id),
      ]);

      void dispatchVerifiedLearningEvent({
        eventType: 'flashcard_reviewed',
        subject: activeCard.subject,
        chapter: activeCard.chapter,
        topic: activeCard.topic,
        sourceModule: 'memory-booster',
        idempotencyKey: `fc_review_${savedReview.id}`,
        isCorrect: wasCorrect,
        title: `Reviewed recall card: ${activeCard.topic}`,
        description: `SM-2 spaced repetition review (${intervalLabel}).`,
        recId: searchParams.get('recId') || undefined,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not save your review schedule.'
      );
    }
  };

  const handleGenerateAiDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.uid) return;
    if (!genTopic.trim()) {
      setErrorMessage('Enter a topic to generate AI active-recall flashcards.');
      return;
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await generateFlashcards({
        board,
        classGrade,
        subject: genSubject,
        chapter: genChapter || genTopic,
        topic: genTopic.trim(),
        count: genCount,
        language,
        focusErrorTag: genFocusError.trim() || undefined,
      });

      const records = res.cards.map((c) =>
        createFlashcardRecord({
          userId: user.uid,
          subject: genSubject,
          chapter: genChapter || genTopic,
          topic: c.topic || genTopic.trim(),
          board,
          classGrade,
          front: c.front,
          back: c.back,
          hint: c.hint,
          source: genFocusError.trim() ? 'error-remediation' : 'ai-generated',
          linkedErrorTag: c.linkedErrorTag || genFocusError.trim() || undefined,
        })
      );

      const saved = await saveFlashcardsBatch(records);
      setCards((prev) => [...saved, ...prev]);
      setSuccessMessage(`Added ${saved.length} active recall cards for "${genTopic}" to your queue.`);
      setActiveTab('queue');
      setChapterFilterKey('all');
      setIsFlipped(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to generate flashcards.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveCustomCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.uid) return;
    if (!customFront.trim() || !customBack.trim()) {
      setErrorMessage('Please enter both the Front Question and Back Answer for your custom card.');
      return;
    }

    setIsSavingCustom(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const newCard = createFlashcardRecord({
        userId: user.uid,
        subject: customSubject,
        chapter: customChapter.trim() || customTopic.trim() || 'Personal Deck',
        topic: customTopic.trim() || 'Custom Concept',
        board,
        classGrade,
        front: customFront.trim(),
        back: customBack.trim(),
        hint: customHint.trim() || undefined,
        source: 'student-custom',
      });
      const saved = await saveFlashcard(newCard);
      setCards((prev) => [saved, ...prev]);
      setCustomFront('');
      setCustomBack('');
      setCustomHint('');
      setSuccessMessage(`Custom flashcard saved to "${saved.chapter}" and queued for review.`);
      setActiveTab('queue');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not save custom flashcard.');
    } finally {
      setIsSavingCustom(false);
    }
  };

  const handleDeleteCard = async (card: FlashcardRecord) => {
    if (!user?.uid) return;
    try {
      await deleteFlashcard(user.uid, card.id);
      setCards((prev) => prev.filter((c) => c.id !== card.id));
    } catch {
      setErrorMessage('Could not delete flashcard right now.');
    }
  };

  const handleQuickDrillCard = async (card: FlashcardRecord) => {
    if (!user?.uid) return;
    const dueNowCard: FlashcardRecord = {
      ...card,
      dueDate: new Date().toISOString(),
    };
    const saved = await saveFlashcard(dueNowCard);
    setCards((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
    setChapterFilterKey(`${saved.subject}::${saved.chapter}`);
    setIsFlipped(false);
    setShowHint(false);
    setActiveTab('queue');
  };

  const genSubjectChapters = useMemo(() => {
    const found = curriculum.find((s) => s.name === genSubject);
    return found?.chapters || [];
  }, [curriculum, genSubject]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="space-y-1">
          <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
            Memory Booster · SM-2 Spaced Repetition · {board} · {classGrade}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Active Recall & Spaced Repetition
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            Lock formulas, definitions, and error-remediation concepts into long-term memory with adaptive intervals.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/learning-intelligence')}
            className="whitespace-nowrap shrink-0"
          >
            Learning Intelligence
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/practice')}
            className="whitespace-nowrap shrink-0"
          >
            Adaptive Practice
          </Button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4">
          <span className="text-xs text-slate-500 dark:text-slate-400">Due Today</span>
          <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums mt-1">
            {dailyQueue.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4">
          <span className="text-xs text-slate-500 dark:text-slate-400">Total Flashcards</span>
          <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">
            {cards.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4">
          <span className="text-xs text-slate-500 dark:text-slate-400">Difficult / Remediation</span>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums mt-1">
            {difficultCards.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4">
          <span className="text-xs text-slate-500 dark:text-slate-400">Reviews Completed</span>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
            {reviews.length}
          </p>
        </div>
      </div>

      {/* Segmented Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
        <div
          role="tablist"
          aria-label="Memory booster sections"
          className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-full"
        >
          {(
            [
              { id: 'queue', label: `Daily Queue (${dailyQueue.length})` },
              { id: 'chapters', label: `Chapter Decks (${chapterDecks.length})` },
              { id: 'difficult', label: `Difficult Cards (${difficultCards.length})` },
              { id: 'create', label: 'AI & Custom Cards' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'queue' && chapterDecks.length > 0 && (
          <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
            <label htmlFor="mb-deck-filter" className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
              Deck:
            </label>
            <select
              id="mb-deck-filter"
              value={chapterFilterKey}
              onChange={(e) => {
                setChapterFilterKey(e.target.value);
                setIsFlipped(false);
                setShowHint(false);
              }}
              className="w-full sm:w-auto max-w-full min-w-0 truncate rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-white"
            >
              <option value="all">All Due Chapters</option>
              {chapterDecks.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.subject} — {d.chapter} ({d.dueCount} due)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300 flex items-center justify-between"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-xs font-semibold underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
          <span>{successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-xs font-semibold underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TAB 1: DAILY REVISION QUEUE */}
      {activeTab === 'queue' && !loading && (
        <div className="max-w-3xl mx-auto space-y-4">
          {reviewFeedback && (
            <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 px-4 py-2.5 text-xs text-indigo-700 dark:text-indigo-300 text-center">
              {reviewFeedback}
            </div>
          )}

          {activeCard && nextIntervalPreview ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 sm:p-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                    {activeCard.subject}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{activeCard.chapter}</span>
                  <span aria-hidden="true">·</span>
                  <span>{activeCard.topic}</span>
                </div>
                <div className="flex items-center gap-2">
                  {activeCard.difficultyTag === 'difficult' && (
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      Difficult Card
                    </span>
                  )}
                  <span className="tabular-nums">
                    Reps: {activeCard.repetitions} · EF: {activeCard.easeFactor.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Active Recall Face */}
              <div className="min-h-[180px] flex flex-col justify-center py-4 space-y-4 border-y border-slate-200 dark:border-slate-800">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  {isFlipped ? 'Answer & Key Takeaway' : 'Active Recall Prompt'}
                </span>
                <p className="text-lg sm:text-xl font-semibold text-slate-900 dark:text-white whitespace-pre-line leading-relaxed">
                  {isFlipped ? activeCard.back : activeCard.front}
                </p>

                {!isFlipped && showHint && activeCard.hint && (
                  <p className="text-xs text-indigo-600 dark:text-indigo-300 bg-indigo-500/5 border border-indigo-500/20 rounded-xl px-3.5 py-2.5">
                    <strong>Hint:</strong> {activeCard.hint}
                  </p>
                )}

                {activeCard.linkedErrorTag && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Linked error focus: {activeCard.linkedErrorTag.replace(/-/g, ' ')}
                  </p>
                )}
              </div>

              {/* Flip or SM-2 Rate Controls */}
              {!isFlipped ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {activeCard.hint ? (
                    <button
                      type="button"
                      onClick={() => setShowHint((v) => !v)}
                      className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 cursor-pointer"
                    >
                      {showHint ? 'Hide Hint' : 'Show Memory Hint'}
                    </button>
                  ) : (
                    <span />
                  )}

                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => setIsFlipped(true)}
                    icon={<Eye className="w-4 h-4" />}
                  >
                    Reveal Answer
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-center text-slate-500 dark:text-slate-400">
                    How well did you recall this? SM-2 schedules your next review automatically:
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleRateCard(0)}
                      className="rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 px-3 py-3 text-center transition-colors cursor-pointer"
                    >
                      <span className="block text-sm font-semibold text-rose-700 dark:text-rose-300">
                        Again
                      </span>
                      <span className="block text-xs text-rose-600/80 dark:text-rose-400 tabular-nums">
                        {nextIntervalPreview[0]}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRateCard(2)}
                      className="rounded-xl border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-3 text-center transition-colors cursor-pointer"
                    >
                      <span className="block text-sm font-semibold text-amber-700 dark:text-amber-300">
                        Hard
                      </span>
                      <span className="block text-xs text-amber-600/80 dark:text-amber-400 tabular-nums">
                        {nextIntervalPreview[2]}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRateCard(4)}
                      className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-3 text-center transition-colors cursor-pointer"
                    >
                      <span className="block text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                        Good
                      </span>
                      <span className="block text-xs text-indigo-600/80 dark:text-indigo-400 tabular-nums">
                        {nextIntervalPreview[4]}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRateCard(5)}
                      className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-3 text-center transition-colors cursor-pointer"
                    >
                      <span className="block text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                        Easy
                      </span>
                      <span className="block text-xs text-emerald-600/80 dark:text-emerald-400 tabular-nums">
                        {nextIntervalPreview[5]}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {cards.length === 0
                    ? 'Your Flashcard Deck Is Empty'
                    : 'Daily Revision Queue Caught Up'}
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {cards.length === 0
                    ? 'Generate board-aligned chapter flashcards with AI or create your own custom memory cards.'
                    : 'All due cards are reviewed! Generate a new chapter deck or drill any saved chapter deck.'}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  variant="primary"
                  onClick={() => setActiveTab('create')}
                  icon={<Sparkles className="w-4 h-4" />}
                >
                  Generate Chapter Flashcards
                </Button>
                {chapterFilterKey !== 'all' && (
                  <Button variant="outline" onClick={() => setChapterFilterKey('all')}>
                    Show All Chapters
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CHAPTER DECKS */}
      {activeTab === 'chapters' && (
        <div className="space-y-4">
          {chapterDecks.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-8 text-center space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No chapter flashcard decks created yet.
              </p>
              <Button variant="primary" onClick={() => setActiveTab('create')}>
                Create or Generate First Deck
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {chapterDecks.map((deck) => (
                <div
                  key={deck.key}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                        {deck.subject}
                      </span>
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                        {deck.chapter}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {deck.totalCards} card{deck.totalCards === 1 ? '' : 's'} · {deck.dueCount} due ·{' '}
                        {deck.difficultCount} difficult
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickDrillCard(deck.cards[0])}
                    >
                      Drill Deck
                    </Button>
                  </div>

                  <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800">
                    {deck.cards.slice(0, 5).map((card) => (
                      <div
                        key={card.id}
                        className="py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
                            {card.front}
                          </p>
                          <p className="text-slate-500 dark:text-slate-400 tabular-nums">
                            {card.topic} · Next:{' '}
                            {card.intervalDays === 0 ? 'Today' : `${card.intervalDays}d`}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Delete card ${card.front.slice(0, 32)}`}
                          onClick={() => handleDeleteCard(card)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DIFFICULT CARDS */}
      {activeTab === 'difficult' && (
        <div className="space-y-4">
          {difficultCards.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No difficult or error-remediation cards right now. Cards rated "Again" repeatedly or generated from Learning Intelligence errors appear here automatically.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {difficultCards.map((card) => (
                <div
                  key={card.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-amber-600 dark:text-amber-400">
                      {card.subject} · {card.topic}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                      Lapses: {card.lapses} · EF: {card.easeFactor.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {card.front}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                    {card.back}
                  </p>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() =>
                        navigate('/practice', {
                          subject: card.subject,
                          chapter: card.chapter,
                          topic: card.topic,
                          difficulty: 'foundation',
                          errorTag: card.linkedErrorTag,
                        })
                      }
                      className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    >
                      Practice This Topic →
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickDrillCard(card)}
                    >
                      Review Now
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: AI GENERATOR & CUSTOM FLASHCARD CREATOR */}
      {activeTab === 'create' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* AI Chapter / Remediation Card Generator */}
          <form
            onSubmit={handleGenerateAiDeck}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6 space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                AI Chapter Flashcard Generator
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Generate board-aligned active recall cards in {language} for any chapter or recurring error pattern.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="mb-gen-subject" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Subject
                </label>
                <select
                  id="mb-gen-subject"
                  value={genSubject}
                  onChange={(e) => {
                    const nextSub = e.target.value;
                    setGenSubject(nextSub);
                    const subObj = curriculum.find((s) => s.name === nextSub);
                    if (subObj?.chapters[0]) {
                      setGenChapter(subObj.chapters[0].title);
                      setGenTopic(subObj.chapters[0].keyTopics[0] || subObj.chapters[0].title);
                    }
                  }}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  {curriculum.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="mb-gen-count" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Deck Size
                </label>
                <select
                  id="mb-gen-count"
                  value={genCount}
                  onChange={(e) => setGenCount(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  {[3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} Cards
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="mb-gen-chapter" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Chapter
              </label>
              <input
                id="mb-gen-chapter"
                type="text"
                list="mb-chapter-suggestions"
                value={genChapter}
                onChange={(e) => setGenChapter(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
              <datalist id="mb-chapter-suggestions">
                {genSubjectChapters.map((c) => (
                  <option key={c.id} value={c.title} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1">
              <label htmlFor="mb-gen-topic" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Specific Topic
              </label>
              <input
                id="mb-gen-topic"
                type="text"
                value={genTopic}
                onChange={(e) => setGenTopic(e.target.value)}
                placeholder="e.g., Snell's Law & Refractive Index"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mb-gen-error" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Optional Target Mistake / Error Tag
              </label>
              <input
                id="mb-gen-error"
                type="text"
                value={genFocusError}
                onChange={(e) => setGenFocusError(e.target.value)}
                placeholder="e.g., sign-convention-error"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={isGenerating}
              icon={<Sparkles className="w-4 h-4" />}
            >
              {isGenerating ? 'Generating Flashcards...' : 'Generate Active Recall Deck'}
            </Button>
          </form>

          {/* Custom Student-Created Flashcard Form */}
          <form
            onSubmit={handleSaveCustomCard}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6 space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-500" />
                Create Custom Student Card
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add your own formulas, textbook definitions, or tricky class notes to the SM-2 schedule.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="mb-custom-subject" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Subject
                </label>
                <select
                  id="mb-custom-subject"
                  value={customSubject}
                  onChange={(e) => setCustomSubject(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  {curriculum.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="mb-custom-chapter" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Chapter / Deck Name
                </label>
                <input
                  id="mb-custom-chapter"
                  type="text"
                  value={customChapter}
                  onChange={(e) => setCustomChapter(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="mb-custom-topic" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Topic
              </label>
              <input
                id="mb-custom-topic"
                type="text"
                value={customTopic}
                onChange={(e) => setCustomTopic(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mb-custom-front" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Front (Question or Recall Trigger)
              </label>
              <textarea
                id="mb-custom-front"
                rows={2}
                value={customFront}
                onChange={(e) => setCustomFront(e.target.value)}
                placeholder="e.g., State Ohm's Law and when a conductor is non-ohmic."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mb-custom-back" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Back (Answer / Formula)
              </label>
              <textarea
                id="mb-custom-back"
                rows={3}
                value={customBack}
                onChange={(e) => setCustomBack(e.target.value)}
                placeholder="e.g., V = IR at constant temperature. Non-ohmic devices like diodes do not show a linear V-I graph."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="mb-custom-hint" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Optional Memory Hint
              </label>
              <input
                id="mb-custom-hint"
                type="text"
                value={customHint}
                onChange={(e) => setCustomHint(e.target.value)}
                placeholder="e.g., Constant physical condition = temperature!"
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <Button
              type="submit"
              variant="secondary"
              className="w-full"
              loading={isSavingCustom}
              icon={<Plus className="w-4 h-4" />}
            >
              {isSavingCustom ? 'Saving Custom Card...' : 'Save Custom Flashcard'}
            </Button>
          </form>
        </div>
      )}

      {/* Recent Review History Log */}
      {reviews.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Recent Revision Schedule Log
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {reviews.length} total reviews
            </span>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {reviews.slice(0, 6).map((rev) => (
              <div key={rev.id} className="px-5 py-2.5 flex items-center justify-between gap-4 text-xs">
                <div className="min-w-0">
                  <span className="font-medium text-slate-900 dark:text-white">
                    {rev.subject} · {rev.topic}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0 tabular-nums">
                  <span
                    className={
                      rev.wasCorrect
                        ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                        : 'text-amber-600 dark:text-amber-400 font-medium'
                    }
                  >
                    {rev.previousIntervalDays}d → {rev.nextIntervalDays === 0 ? 'Today' : `${rev.nextIntervalDays}d`}
                  </span>
                  <span className="text-slate-400">
                    {new Date(rev.reviewedAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
