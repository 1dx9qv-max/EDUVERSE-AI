import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Info,
  Layers,
  Play,
  RotateCcw,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../router/Router';
import { fetchErrorRemediation, generateFlashcards } from '../api/client';
import {
  fetchFlashcardReviews,
  fetchFlashcards,
  fetchPracticeAttempts,
  fetchTopicMasteryList,
  saveFlashcardsBatch,
} from '../lib/firestoreService';
import {
  AggregatedErrorPattern,
  aggregateErrorPatterns,
  buildLearningRecommendations,
} from '../utils/learningEngine';
import { createFlashcardRecord, isCardDue } from '../utils/memoryEngine';
import {
  FlashcardRecord,
  FlashcardReviewLog,
  PracticeAttemptRecord,
  RemediateResponse,
  TopicMasteryRecord,
} from '../types/phase4';
import { Button } from '../components/common/Button';

type StatusFilter = 'all' | 'mastered' | 'needs-revision' | 'developing';

export const LearningIntelligencePage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();

  const board = user?.board || 'CBSE';
  const classGrade = user?.classGrade || 'Class 10';
  const language =
    user?.language === 'Hindi' || user?.language === 'Bilingual' ? user.language : 'English';

  const [masteryList, setMasteryList] = useState<TopicMasteryRecord[]>([]);
  const [attempts, setAttempts] = useState<PracticeAttemptRecord[]>([]);
  const [flashcards, setFlashcards] = useState<FlashcardRecord[]>([]);
  const [reviews, setReviews] = useState<FlashcardReviewLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Targeted Remediation State
  const [activeErrorKey, setActiveErrorKey] = useState<string | null>(null);
  const [remediationMap, setRemediationMap] = useState<Record<string, RemediateResponse>>({});
  const [loadingRemediationKey, setLoadingRemediationKey] = useState<string | null>(null);
  const [creatingCardsKey, setCreatingCardsKey] = useState<string | null>(null);
  const [cardsCreatedKey, setCardsCreatedKey] = useState<string | null>(null);
  const [showQuickCheckAnswer, setShowQuickCheckAnswer] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    Promise.all([
      fetchTopicMasteryList(user.uid),
      fetchPracticeAttempts(user.uid),
      fetchFlashcards(user.uid),
      fetchFlashcardReviews(user.uid),
    ])
      .then(([mList, aList, fList, rList]) => {
        if (!active) return;
        setMasteryList(mList);
        setAttempts(aList);
        setFlashcards(fList);
        setReviews(rList);
      })
      .catch(() => {
        if (active) setErrorBanner('Could not load complete analytics history right now.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.uid]);

  const subjects = useMemo(() => {
    const set = new Set<string>();
    masteryList.forEach((m) => set.add(m.subject));
    return Array.from(set).sort();
  }, [masteryList]);

  const filteredMastery = useMemo(() => {
    return masteryList.filter((m) => {
      if (subjectFilter !== 'all' && m.subject !== subjectFilter) return false;
      if (statusFilter === 'mastered') return m.status === 'mastered';
      if (statusFilter === 'needs-revision') return m.status === 'needs-revision';
      if (statusFilter === 'developing') {
        return m.status === 'developing' || m.status === 'insufficient-data';
      }
      return true;
    });
  }, [masteryList, subjectFilter, statusFilter]);

  const strongConcepts = useMemo(
    () => masteryList.filter((m) => m.status === 'mastered'),
    [masteryList]
  );
  const revisionConcepts = useMemo(
    () => masteryList.filter((m) => m.status === 'needs-revision'),
    [masteryList]
  );
  const dueFlashcardsCount = useMemo(
    () => flashcards.filter((c) => isCardDue(c)).length,
    [flashcards]
  );

  const errorPatterns = useMemo(() => aggregateErrorPatterns(masteryList), [masteryList]);
  const recommendations = useMemo(
    () => buildLearningRecommendations(masteryList, dueFlashcardsCount),
    [masteryList, dueFlashcardsCount]
  );

  const avgMastery = useMemo(() => {
    const qualified = masteryList.filter((m) => m.attemptsCount > 0);
    if (qualified.length === 0) return 0;
    return Math.round(
      qualified.reduce((acc, m) => acc + m.weightedMasteryScore, 0) / qualified.length
    );
  }, [masteryList]);

  const totalTimeMinutes = useMemo(() => {
    const totalSec = masteryList.reduce((acc, m) => acc + (m.totalTimeSpentSeconds || 0), 0);
    return Math.round(totalSec / 60);
  }, [masteryList]);

  // Progress Over Time points built chronologically from real attempts
  const timelinePoints = useMemo(() => {
    const chronological = [...attempts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (chronological.length === 0) return [];
    // Group into up to 8 sequential checkpoints
    const chunkSize = Math.max(1, Math.ceil(chronological.length / 8));
    const points: Array<{ label: string; accuracy: number; count: number }> = [];
    for (let i = 0; i < chronological.length; i += chunkSize) {
      const slice = chronological.slice(0, i + chunkSize);
      const avgAcc = Math.round(
        (slice.reduce((acc, a) => acc + (typeof a.scoreRatio === 'number' ? a.scoreRatio : a.isCorrect ? 1 : 0), 0) /
          slice.length) *
          100
      );
      const lastDate = slice[slice.length - 1].createdAt.slice(5, 10);
      points.push({
        label: lastDate,
        accuracy: avgAcc,
        count: slice.length,
      });
    }
    return points;
  }, [attempts]);

  const mergedActivityHistory = useMemo(() => {
    const attemptItems = attempts.slice(0, 12).map((a) => ({
      id: a.id,
      kind: 'practice' as const,
      title: `${a.subject} · ${a.topic}`,
      detail: `${a.questionType.toUpperCase()} (${a.difficulty}) — ${a.isCorrect ? 'Correct' : 'Reviewed'}`,
      timestamp: a.createdAt,
      positive: a.isCorrect,
    }));
    const reviewItems = reviews.slice(0, 12).map((r) => ({
      id: r.id,
      kind: 'revision' as const,
      title: `${r.subject} · ${r.topic}`,
      detail: `Flashcard recall — next review in ${r.nextIntervalDays === 0 ? 'today' : `${r.nextIntervalDays}d`}`,
      timestamp: r.reviewedAt,
      positive: r.wasCorrect,
    }));
    return [...attemptItems, ...reviewItems]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 10);
  }, [attempts, reviews]);

  const handleRequestRemediation = async (pattern: AggregatedErrorPattern) => {
    const key = `${pattern.subject}::${pattern.topic}::${pattern.errorTag}`;
    setActiveErrorKey(key);
    setShowQuickCheckAnswer(false);
    if (remediationMap[key]) return;

    setLoadingRemediationKey(key);
    setErrorBanner(null);
    try {
      const res = await fetchErrorRemediation({
        board,
        classGrade,
        subject: pattern.subject,
        topic: pattern.topic,
        errorTag: pattern.errorTag,
        sampleMisconception: pattern.sampleMisconception,
        language,
      });
      setRemediationMap((prev) => ({ ...prev, [key]: res }));
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Unable to generate targeted explanation right now.'
      );
    } finally {
      setLoadingRemediationKey(null);
    }
  };

  const handleCreateRemediationCards = async (pattern: AggregatedErrorPattern) => {
    if (!user?.uid) return;
    const key = `${pattern.subject}::${pattern.topic}::${pattern.errorTag}`;
    setCreatingCardsKey(key);
    setErrorBanner(null);
    try {
      const res = await generateFlashcards({
        board,
        classGrade,
        subject: pattern.subject,
        chapter: pattern.chapter,
        topic: pattern.topic,
        count: 3,
        language,
        focusErrorTag: pattern.errorTag,
        misconceptionNote: pattern.sampleMisconception,
      });
      const records = res.cards.map((c) =>
        createFlashcardRecord({
          userId: user.uid,
          subject: pattern.subject,
          chapter: pattern.chapter,
          topic: c.topic || pattern.topic,
          board,
          classGrade,
          front: c.front,
          back: c.back,
          hint: c.hint,
          source: 'error-remediation',
          linkedErrorTag: pattern.errorTag,
        })
      );
      await saveFlashcardsBatch(records);
      setFlashcards((prev) => [...records, ...prev]);
      setCardsCreatedKey(key);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Could not create remediation flashcards.'
      );
    } finally {
      setCreatingCardsKey(null);
    }
  };

  const formatStatusLabel = (status: TopicMasteryRecord['status']) => {
    if (status === 'mastered') return 'Strong Concept';
    if (status === 'needs-revision') return 'Needs Revision';
    if (status === 'insufficient-data') return 'Early Signal';
    return 'Developing';
  };

  const formatStatusColor = (status: TopicMasteryRecord['status']) => {
    if (status === 'mastered') return 'text-emerald-600 dark:text-emerald-400';
    if (status === 'needs-revision') return 'text-amber-600 dark:text-amber-400';
    return 'text-indigo-600 dark:text-indigo-400';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div className="space-y-1">
          <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
            Learning Intelligence Engine · {board} · {classGrade}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Transparent Mastery & Error Analytics
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            Honest topic-level diagnostics computed from your real practice attempts, difficulty level, time spent, and active-recall revisions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/practice')}
            icon={<Play className="w-3.5 h-3.5" />}
            className="whitespace-nowrap shrink-0"
          >
            Start Practice
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/memory-booster')}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            className="whitespace-nowrap shrink-0"
          >
            Memory Booster ({dueFlashcardsCount})
          </Button>
        </div>
      </div>

      {/* Transparency & Non-Punitive Model Notice */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 flex items-start gap-3">
        <Info className="w-4 h-4 text-indigo-500 mt-0.5 shrink-0" />
        <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
          <p className="font-semibold text-slate-900 dark:text-white">
            How Mastery Works (Single-Miss Protection Active)
          </p>
          <p>
            A single incorrect answer never marks you weak — topics with 1–2 attempts stay in{' '}
            <strong className="text-slate-900 dark:text-white">Early Signal / Developing</strong>. Mastery blends recency-weighted accuracy, difficulty tier (Foundation 0.85×, Intermediate 1.0×, Board Challenge 1.15×), and spaced-repetition bonuses (+2% per revision, capped at +8%).
          </p>
        </div>
      </div>

      {errorBanner && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300 flex items-center justify-between"
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-xs font-semibold underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty State when no attempts/reviews exist yet */}
      {!loading && attempts.length === 0 && reviews.length === 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-8 sm:p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 flex items-center justify-center mx-auto">
            <BrainCircuit className="w-6 h-6" />
          </div>
          <div className="space-y-1.5 max-w-lg mx-auto">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              No Learning Analytics Recorded Yet
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Complete your first Adaptive Practice set or Memory Booster recall session to see strong concepts, recurring error diagnostics, and personalized next lessons — zero fabricated scores.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              variant="primary"
              onClick={() => navigate('/practice')}
              icon={<Play className="w-4 h-4" />}
            >
              Launch First Adaptive Practice
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate('/memory-booster')}
              icon={<RotateCcw className="w-4 h-4" />}
            >
              Explore Memory Booster
            </Button>
          </div>
        </div>
      )}

      {/* Populated Analytics Workspace */}
      {!loading && (attempts.length > 0 || reviews.length > 0) && (
        <>
          {/* 4-Column KPI Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">Weighted Mastery</span>
              <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {avgMastery}%
              </p>
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Across {masteryList.length} topic{masteryList.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">Strong Concepts</span>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {strongConcepts.length}
              </p>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                80%+ mastery & verified attempts
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">Needs Revision</span>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                {revisionConcepts.length}
              </p>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Multi-attempt or recurring gaps
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 space-y-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">Practice & Recall</span>
              <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                {attempts.length + reviews.length}
              </p>
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {totalTimeMinutes} min active study logged
              </span>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 max-w-full">
              {(
                [
                  { id: 'all', label: 'All Topics' },
                  { id: 'mastered', label: 'Strong Concepts' },
                  { id: 'needs-revision', label: 'Needs Revision' },
                  { id: 'developing', label: 'Early Signal / Developing' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === tab.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
              <label htmlFor="li-subject-filter" className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                Subject:
              </label>
              <select
                id="li-subject-filter"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="w-full sm:w-auto max-w-full min-w-0 truncate rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-white"
              >
                <option value="all">All Subjects</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Concept Mastery Table + Progress Over Time Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Topic Mastery List */}
            <div className="lg:col-span-7 min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Topic Mastery Breakdown
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {filteredMastery.length} shown
                </span>
              </div>

              {filteredMastery.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  No topics match this filter yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredMastery.map((tm) => (
                    <div
                      key={tm.id}
                      className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {tm.subject}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className={`font-semibold ${formatStatusColor(tm.status)}`}>
                            {formatStatusLabel(tm.status)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">
                            Next: {tm.currentRecommendedDifficulty.replace('-', ' ')}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {tm.topic}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          {tm.correctCount}/{tm.attemptsCount} correct · {tm.revisionCount} recall review
                          {tm.revisionCount === 1 ? '' : 's'} · {Math.round((tm.totalTimeSpentSeconds || 0) / 60)}m spent
                        </p>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <span className="text-lg font-bold text-slate-900 dark:text-white tabular-nums block">
                            {Math.round(tm.weightedMasteryScore)}%
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                            Recent {Math.round(tm.recentAccuracy)}%
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            navigate('/practice', {
                              subject: tm.subject,
                              chapter: tm.chapter || tm.topic,
                              topic: tm.topic,
                              difficulty: tm.currentRecommendedDifficulty,
                              errorTag: tm.recurringErrors?.[0]?.errorTag,
                            })
                          }
                        >
                          Practice
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Progress Over Time Chart & Recommended Next Lessons */}
            <div className="lg:col-span-5 min-w-0 space-y-6">
              {/* SVG Chart */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-indigo-500" />
                    Improvement Over Time
                  </h2>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {attempts.length} attempts
                  </span>
                </div>

                {timelinePoints.length >= 2 ? (
                  <div className="space-y-2">
                    <svg
                      viewBox="0 0 360 140"
                      className="w-full h-36 overflow-hidden"
                      role="img"
                      aria-label="Cumulative accuracy improvement chart"
                    >
                      {[25, 50, 75, 100].map((yVal) => {
                        const y = 120 - (yVal / 100) * 100;
                        return (
                          <g key={yVal}>
                            <line
                              x1="28"
                              y1={y}
                              x2="348"
                              y2={y}
                              stroke="currentColor"
                              className="text-slate-200 dark:text-slate-800"
                              strokeDasharray="3 3"
                            />
                            <text
                              x="0"
                              y={y + 4}
                              fontSize="10"
                              className="fill-slate-400 tabular-nums"
                            >
                              {yVal}%
                            </text>
                          </g>
                        );
                      })}

                      {(() => {
                        const coords = timelinePoints.map((pt, i) => {
                          const x = 36 + (i / (timelinePoints.length - 1)) * 304;
                          const y = 120 - (pt.accuracy / 100) * 100;
                          return { x, y, ...pt };
                        });
                        const poly = coords.map((c) => `${c.x},${c.y}`).join(' ');
                        return (
                          <>
                            <polyline
                              fill="none"
                              stroke="#6366f1"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={poly}
                            />
                            {coords.map((c, idx) => (
                              <g key={idx}>
                                <circle cx={c.x} cy={c.y} r="4" fill="#6366f1" />
                                <text
                                  x={c.x}
                                  y="136"
                                  textAnchor="middle"
                                  fontSize="9"
                                  className="fill-slate-400 tabular-nums"
                                >
                                  #{c.count}
                                </text>
                              </g>
                            ))}
                          </>
                        );
                      })()}
                    </svg>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Tracks cumulative accuracy progression from your first question (#1) to your latest attempt (#{attempts.length}).
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
                    Complete at least 2 practice questions to plot your accuracy trajectory.
                  </p>
                )}
              </div>

              {/* Recommended Next Lessons */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 space-y-3">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Recommended Next Steps
                </h2>
                {recommendations.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Keep practicing topics to unlock tailored next-lesson paths.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {recommendations.map((rec) => (
                      <div key={rec.id} className="py-3 first:pt-1 last:pb-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {rec.topic}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">{rec.subject}</span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400">{rec.reason}</p>
                        <button
                          type="button"
                          onClick={() => {
                            if (rec.actionType === 'flashcards') {
                              navigate('/memory-booster');
                            } else {
                              navigate('/practice', {
                                subject: rec.subject,
                                chapter: rec.chapter,
                                topic: rec.topic,
                                difficulty: rec.recommendedDifficulty,
                                errorTag: rec.errorTag,
                              });
                            }
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                        >
                          {rec.actionType === 'flashcards'
                            ? 'Open Daily Recall Queue'
                            : 'Launch Recommended Session'}
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recurring Error Patterns & Closed-Loop Remediation */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Recurring Error Patterns & Targeted Remediation
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  When a mistake repeats, launch an AI explanation, practice targeted questions, or generate remediation flashcards.
                </p>
              </div>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                {errorPatterns.length} detected pattern{errorPatterns.length === 1 ? '' : 's'}
              </span>
            </div>

            {errorPatterns.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                No recurring mistake patterns detected yet — clean precision across your attempts.
              </div>
            ) : (
              <div className="space-y-4">
                {errorPatterns.slice(0, 6).map((err) => {
                  const key = `${err.subject}::${err.topic}::${err.errorTag}`;
                  const remediation = remediationMap[key];
                  const isExpanded = activeErrorKey === key;

                  return (
                    <div
                      key={key}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-3"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold text-amber-600 dark:text-amber-400">
                              {err.errorTag.replace(/-/g, ' ')}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-700 dark:text-slate-300">
                              {err.subject} · {err.topic}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums font-medium text-slate-600 dark:text-slate-400">
                              Seen {err.count}×
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            {err.sampleMisconception}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            loading={loadingRemediationKey === key}
                            onClick={() => handleRequestRemediation(err)}
                            icon={<Sparkles className="w-3.5 h-3.5" />}
                          >
                            Targeted Explanation
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() =>
                              navigate('/practice', {
                                subject: err.subject,
                                chapter: err.chapter,
                                topic: err.topic,
                                difficulty: 'foundation',
                                errorTag: err.errorTag,
                              })
                            }
                          >
                            Practice Fix
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={creatingCardsKey === key}
                            onClick={() => handleCreateRemediationCards(err)}
                            icon={<RotateCcw className="w-3.5 h-3.5" />}
                          >
                            {cardsCreatedKey === key ? 'Cards Saved!' : 'Generate Recall Cards'}
                          </Button>
                        </div>
                      </div>

                      {cardsCreatedKey === key && (
                        <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                          <span>3 targeted remediation flashcards added to your Memory Booster queue.</span>
                          <button
                            type="button"
                            onClick={() => navigate('/memory-booster')}
                            className="font-semibold underline cursor-pointer"
                          >
                            Review Queue →
                          </button>
                        </div>
                      )}

                      {isExpanded && remediation && (
                        <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3 text-xs">
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                            {remediation.headline}
                          </h3>
                          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                            {remediation.coreExplanation}
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                            <div className="rounded-lg bg-rose-500/5 border border-rose-500/20 p-3 space-y-1">
                              <span className="font-semibold text-rose-600 dark:text-rose-400 block">
                                Common Trap
                              </span>
                              <p className="text-slate-700 dark:text-slate-300">
                                {remediation.wrongVsRightComparison.commonTrap}
                              </p>
                            </div>
                            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 space-y-1">
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400 block">
                                Right Approach
                              </span>
                              <p className="text-slate-700 dark:text-slate-300">
                                {remediation.wrongVsRightComparison.correctApproach}
                              </p>
                            </div>
                          </div>
                          <div className="pt-1 border-t border-slate-200 dark:border-slate-800 space-y-1">
                            <p className="font-medium text-slate-900 dark:text-white">
                              Quick Self-Check: {remediation.quickCheckQuestion.prompt}
                            </p>
                            {showQuickCheckAnswer ? (
                              <p className="text-emerald-600 dark:text-emerald-400">
                                Answer: {remediation.quickCheckQuestion.answer}
                              </p>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setShowQuickCheckAnswer(true)}
                                className="text-indigo-600 dark:text-indigo-400 font-semibold underline cursor-pointer"
                              >
                                Reveal Check Answer
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Revision & Practice History Log */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-500" />
                Recent Revision & Practice History
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Latest {mergedActivityHistory.length} events
              </span>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {mergedActivityHistory.map((item) => (
                <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-4 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white truncate">{item.title}</p>
                    <p className="text-slate-500 dark:text-slate-400 truncate">{item.detail}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`font-semibold ${
                        item.positive
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {item.positive ? 'Solid' : 'Revisit'}
                    </span>
                    <span className="text-slate-400 tabular-nums">
                      {new Date(item.timestamp).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
