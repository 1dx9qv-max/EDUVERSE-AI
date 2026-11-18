import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Flame,
  Target,
  BookOpen,
  ArrowRight,
  Bot,
  HelpCircle,
  Atom,
  Clock,
  TrendingUp,
  RotateCcw,
  BrainCircuit,
  FileText,
  Mic,
  Users2,
  Trophy,
  Play,
  MapPin,
  Compass,
  RefreshCw,
  CheckCircle2,
  SkipForward,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../router/Router';
import {
  DashboardLearningSyncRequest,
  refreshServerRecommendations,
  submitRecommendationAction,
} from '../api/client';
import { loadDynamicDashboardSummary } from '../lib/firestoreService';
import { sortDailyRevisionQueue } from '../utils/memoryEngine';
import { getLocalDateKey } from '../utils/recommendationEngine';
import { DoubtTicket } from '../types/ai';
import { FlashcardRecord, TopicMasteryRecord } from '../types/phase4';
import {
  AdaptivePracticeRecommendation,
  ChapterProgressSummary,
  DashboardLearningSummary,
} from '../types/learning';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { OnboardingWizard } from '../components/onboarding/OnboardingWizard';
import { FEATURE_FLAGS } from '../config/featureFlags';
import { VisualLearningComingSoonCard } from '../components/visual-lab/VisualLearningComingSoonCard';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();

  const board = user?.board || 'CBSE';
  const grade = user?.classGrade || 'Class 10';
  const state = user?.state || 'Delhi (NCT)';

  const [summary, setSummary] = useState<DashboardLearningSummary | null>(null);
  const [recentDoubts, setRecentDoubts] = useState<DoubtTicket[]>([]);
  const [dueFlashcards, setDueFlashcards] = useState<FlashcardRecord[]>([]);
  const [topicMasteryList, setTopicMasteryList] = useState<TopicMasteryRecord[]>([]);
  const [loadingDashboard, setLoadingDashboard] = useState<boolean>(true);
  const [refreshingRecs, setRefreshingRecs] = useState<boolean>(false);
  const [actingRecId, setActingRecId] = useState<string | null>(null);
  const [selectedChapterSubject, setSelectedChapterSubject] = useState<string>('All');
  const lastLoadedDateRef = useRef<string>(getLocalDateKey(new Date()));

  const buildSyncContextPayload = useCallback(
    (overrideRecs?: AdaptivePracticeRecommendation[]): DashboardLearningSyncRequest => {
      const timezone =
        typeof Intl !== 'undefined'
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          : 'UTC';
      const localDateKey = getLocalDateKey(new Date(), timezone);
      return {
        board: user?.board,
        classGrade: user?.classGrade,
        subjects: user?.subjects || [],
        learningGoals: user?.learningGoals || [],
        localDateKey,
        timezone,
        currentRecIds: (overrideRecs || summary?.recommendations || []).map((r) => r.id),
      };
    },
    [user?.board, user?.classGrade, user?.subjects, user?.learningGoals, summary?.recommendations]
  );

  const loadDashboard = useCallback(async () => {
    if (!user?.uid) {
      setLoadingDashboard(false);
      return;
    }
    try {
      const result = await loadDynamicDashboardSummary(user);
      setSummary(result.summary);
      setRecentDoubts(result.recentDoubts.slice(0, 3));
      setDueFlashcards(sortDailyRevisionQueue(result.dueFlashcards).slice(0, 3));
      setTopicMasteryList(result.topicMastery.slice(0, 4));
      lastLoadedDateRef.current = result.summary.localDateKey;
    } catch {
      // Keep honest zeroed defaults when offline / unavailable
    } finally {
      setLoadingDashboard(false);
    }
  }, [user]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // Refresh cleanly whenever any learning module records an event
  useEffect(() => {
    const onDirty = () => {
      void loadDashboard();
    };
    window.addEventListener('eduverse:stats-dirty', onDirty);
    return () => window.removeEventListener('eduverse:stats-dirty', onDirty);
  }, [loadDashboard]);

  // Automatic local midnight rollover check (every 60s)
  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentLocalDate = getLocalDateKey(new Date());
      if (currentLocalDate !== lastLoadedDateRef.current) {
        void loadDashboard();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadDashboard]);

  // Hooks above onboarding guard — compute chapter tabs unconditionally
  const chapterProgressList: ChapterProgressSummary[] = useMemo(
    () => summary?.chapterProgress || [],
    [summary?.chapterProgress]
  );

  const availableSubjects = useMemo(() => {
    const set = new Set<string>();
    for (const ch of chapterProgressList) {
      if (ch.subject) set.add(ch.subject);
    }
    return ['All', ...Array.from(set)];
  }, [chapterProgressList]);

  const visibleChapters = useMemo(() => {
    const filtered =
      selectedChapterSubject === 'All'
        ? chapterProgressList
        : chapterProgressList.filter((c) => c.subject === selectedChapterSubject);
    return filtered.slice(0, 4);
  }, [chapterProgressList, selectedChapterSubject]);

  // If user onboarding is incomplete, show the wizard
  if (user && user.onboardingCompleted === false) {
    return <OnboardingWizard />;
  }

  const verifiedXp = summary?.verifiedXp ?? 0;
  const streakDays = summary?.streakDays ?? 0;
  const dailyGoals = summary?.dailyGoals || [];
  const completedGoalsCount = dailyGoals.filter((g) => g.completed).length;
  const totalGoalsCount = dailyGoals.length;
  const dailyCompletionPct =
    totalGoalsCount > 0 ? Math.round((completedGoalsCount / totalGoalsCount) * 100) : 0;
  const earnedGoalXpToday = dailyGoals
    .filter((g) => g.completed)
    .reduce((acc, g) => acc + g.xpReward, 0);
  const potentialGoalXp = dailyGoals.reduce((acc, g) => acc + g.xpReward, 0);

  const recommendations = summary?.recommendations || [];
  const hasAnyRealActivity =
    verifiedXp > 0 ||
    (summary?.totalCompletedActivities ?? 0) > 0 ||
    recentDoubts.length > 0 ||
    topicMasteryList.length > 0 ||
    chapterProgressList.some((c) => c.status !== 'not_started');

  const handleRefreshRecommendations = async () => {
    if (refreshingRecs) return;
    setRefreshingRecs(true);
    try {
      const ctx = buildSyncContextPayload();
      const res = await refreshServerRecommendations({ ...ctx, refresh: true });
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              recommendations: res.recommendations,
              recommendationRefreshCount: res.refreshCount,
            }
          : prev
      );
    } catch {
      await loadDashboard();
    } finally {
      setRefreshingRecs(false);
    }
  };

  const handleStartRecommendation = (rec: AdaptivePracticeRecommendation) => {
    setActingRecId(rec.id);
    submitRecommendationAction(rec.id, 'started', {
      subject: rec.subject,
      chapter: rec.chapter,
      topic: rec.topic,
      category: rec.category,
    })
      .catch(() => {})
      .finally(() => setActingRecId(null));
    navigate(rec.actionRoute);
  };

  const handleSkipRecommendation = async (rec: AdaptivePracticeRecommendation) => {
    setActingRecId(rec.id);
    try {
      const ctx = buildSyncContextPayload();
      const res = await submitRecommendationAction(
        rec.id,
        'skipped',
        {
          subject: rec.subject,
          chapter: rec.chapter,
          topic: rec.topic,
          category: rec.category,
        },
        ctx
      );
      setSummary((prev) =>
        prev ? { ...prev, recommendations: res.recommendations } : prev
      );
    } catch {
      // Fallback: filter locally so student sees immediate response
      setSummary((prev) =>
        prev
          ? {
              ...prev,
              recommendations: prev.recommendations.filter((r) => r.id !== rec.id),
            }
          : prev
      );
    } finally {
      setActingRecId(null);
    }
  };

  const openChapterLesson = (
    chapter: ChapterProgressSummary,
    target: 'ai-teacher' | 'visual-lab'
  ) => {
    const nextTopic =
      chapter.topics.find((t) => !chapter.completedTopicTitles.includes(t)) ||
      chapter.topics[0] ||
      chapter.chapterTitle;
    const params = new URLSearchParams({
      subject: chapter.subject,
      chapter: chapter.chapterTitle,
      topic: nextTopic,
    });
    navigate(`/${target}?${params.toString()}`);
  };

  // 11 Core Modules Registry for Quick Access
  const CORE_MODULES = [
    {
      id: 'ai-teacher',
      title: 'AI Socratic Teacher',
      desc: 'Interactive concept dialogue guiding understanding',
      route: '/ai-teacher' as const,
      icon: Bot,
      badge: 'Interactive Dialogue',
    },
    {
      id: 'doubt-solver',
      title: 'Instant Doubt Solver',
      desc: 'Step-by-step derivations & NCERT problem solving',
      route: '/doubt-solver' as const,
      icon: HelpCircle,
      badge: 'Step-by-Step AI',
    },
    ...(FEATURE_FLAGS.visualLearningEnabled
      ? [
          {
            id: 'visual-lab',
            title: 'Visual Learning Lab',
            desc: 'Simulations, animations & diagrams for Physics, Chem, Math, Bio & Geo',
            route: '/visual-lab' as const,
            icon: Atom,
            badge: '5 Subjects',
          },
        ]
      : []),
    {
      id: 'practice',
      title: 'Adaptive Practice Bank',
      desc: 'Board-pattern MCQs & assertion-reasoning engine',
      route: '/practice' as const,
      icon: Target,
      badge: 'Adaptive MCQs',
    },
    {
      id: 'learning-intelligence',
      title: 'Learning Intelligence',
      desc: 'Cognitive growth analysis & subject weak spot heatmaps',
      route: '/learning-intelligence' as const,
      icon: BrainCircuit,
      badge: 'Analytics',
    },
    {
      id: 'memory-booster',
      title: 'Memory Booster',
      desc: 'Spaced repetition flashcards with SM-2 recall algorithms',
      route: '/memory-booster' as const,
      icon: RotateCcw,
      badge: 'Spaced Recall',
    },
    {
      id: 'mindmaps',
      title: 'AI Mind Map Studio',
      desc: 'Generate, edit, link, save & export hierarchical concept maps (PNG/PDF)',
      route: '/mindmaps' as const,
      icon: Compass,
      badge: 'PNG / PDF',
    },
    {
      id: 'exam-simulator',
      title: 'Exam Simulator',
      desc: 'Timed AI practice mocks across 7 formats with server validation & analytics',
      route: '/exam-simulator' as const,
      icon: FileText,
      badge: '7 Formats',
    },
    {
      id: 'voice-learning',
      title: 'Voice Learning Classroom',
      desc: 'Live spoken AI teacher in Hindi, English & Bilingual mode with text fallback',
      route: '/voice-learning' as const,
      icon: Mic,
      badge: 'Voice AI',
    },
    {
      id: 'collaborative-learning',
      title: 'Peer Study Pods',
      desc: 'Invite-only study rooms, shared notes, group quizzes & mind maps',
      route: '/collaborative-learning' as const,
      icon: Users2,
      badge: 'Live Pods',
    },
    {
      id: 'achievements',
      title: 'Badges & Trophy Hall',
      desc: 'Verified streaks, healthy daily goals, mastery badges & progress timeline',
      route: '/achievements' as const,
      icon: Trophy,
      badge: 'Healthy Habits',
    },
  ];

  const getDifficultyBadgeVariant = (diff: AdaptivePracticeRecommendation['difficulty']) => {
    if (diff === 'board-challenge') return 'rose' as const;
    if (diff === 'intermediate') return 'warning' as const;
    return 'default' as const;
  };

  const getDifficultyLabel = (diff: AdaptivePracticeRecommendation['difficulty']) => {
    if (diff === 'board-challenge') return 'Board Challenge';
    if (diff === 'intermediate') return 'Intermediate';
    return 'Foundation';
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* 1. WELCOME SECTION */}
      <div className="relative rounded-3xl overflow-hidden border border-indigo-500/20 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 p-6 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="purple" size="md">
                {board} • {grade}
              </Badge>
              <Badge variant="default" size="md">
                <MapPin className="w-3 h-3 inline mr-1" />
                {state}
              </Badge>
              <Badge variant="success" size="md">
                Curriculum Aligned
              </Badge>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Namaste, {user?.displayName || 'Scholar'}!
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl">
              {streakDays > 0 ? (
                <>
                  You are on a{' '}
                  <strong className="text-amber-400 font-bold">
                    {streakDays}-day active study streak
                  </strong>
                  !
                </>
              ) : (
                <>
                  Complete your first verified lesson, doubt, or practice set today to start your
                  study streak.
                </>
              )}
              <span className="italic block mt-1 text-slate-400">
                “Vidya dadati vinayam (Knowledge bestows humility and true discipline).”
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/achievements')}
              className="px-4 py-3 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/40 text-center flex-1 sm:flex-initial shadow-sm transition-colors cursor-pointer"
            >
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Verified XP
              </span>
              <span
                data-testid="dashboard-verified-xp"
                className="text-xl font-extrabold text-emerald-400 tabular-nums"
              >
                {verifiedXp.toLocaleString()} XP
              </span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/achievements')}
              className="px-4 py-3 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-amber-500/40 text-center flex-1 sm:flex-initial shadow-sm transition-colors cursor-pointer"
            >
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Verified Streak
              </span>
              <span
                data-testid="dashboard-verified-streak"
                className="text-xl font-extrabold text-amber-400 flex items-center justify-center gap-1 tabular-nums"
              >
                <Flame className="w-5 h-5 fill-amber-400 text-amber-500" />
                {streakDays}d
              </span>
            </button>
            <div className="px-4 py-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-center flex-1 sm:flex-initial shadow-sm">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Language
              </span>
              <span className="text-sm font-bold text-indigo-300 flex items-center justify-center gap-1 mt-0.5">
                {user?.language || 'English'}
              </span>
            </div>
          </div>
        </div>

        {!loadingDashboard && !hasAnyRealActivity && (
          <div className="mt-6 pt-5 border-t border-indigo-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-indigo-300 uppercase tracking-wider">
                Fresh Workspace Ready
              </p>
              <p className="text-xs text-slate-300">
                Your progress, XP, and streaks start cleanly at 0 and update as you learn. Pick any
                module below to begin.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button
                size="sm"
                variant="primary"
                onClick={() => navigate('/ai-teacher')}
                icon={<Bot className="w-3.5 h-3.5" />}
              >
                Start First Lesson
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/practice')}
                icon={<Target className="w-3.5 h-3.5" />}
              >
                Try Practice Set
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 2. DAILY LEARNING GOALS & CONTINUE LEARNING (GRID 2 COLS) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SECTION 2: Daily Learning Goals (Verified Auto-Completion) */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Target className="w-4 h-4 text-indigo-400" />
              Daily Learning Goals
            </h2>
            <span className="text-xs font-semibold text-emerald-400 tabular-nums">
              +{earnedGoalXpToday} / {potentialGoalXp} XP
            </span>
          </div>

          <Card className="space-y-4 border-indigo-500/20 bg-gradient-to-b from-slate-900 to-indigo-950/20">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-400">Today’s Target Progress</span>
                <span
                  data-testid="daily-goals-progress"
                  className="font-bold text-white tabular-nums"
                >
                  {completedGoalsCount} of {totalGoalsCount} Completed ({dailyCompletionPct}%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-blue-500 to-emerald-400 transition-all duration-300"
                  style={{ width: `${dailyCompletionPct}%` }}
                />
              </div>
            </div>

            <div className="space-y-2">
              {loadingDashboard && dailyGoals.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  Loading today’s personalized study targets...
                </p>
              ) : (
                dailyGoals.map((goal) => (
                  <button
                    key={goal.id}
                    type="button"
                    onClick={() => navigate(goal.actionRoute)}
                    className={`w-full text-left p-3 rounded-xl border text-xs flex items-start gap-3 transition-all cursor-pointer ${
                      goal.completed
                        ? 'bg-emerald-950/20 border-emerald-500/30 text-slate-300'
                        : 'bg-slate-950 border-slate-800 text-slate-200 hover:border-indigo-500/40'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-lg flex items-center justify-center border mt-0.5 flex-shrink-0 ${
                        goal.completed
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                          : 'border-slate-700 bg-slate-900 text-slate-500'
                      }`}
                      aria-hidden="true"
                    >
                      {goal.completed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Play className="w-2.5 h-2.5" />}
                    </span>
                    <div className="flex-1 space-y-1 min-w-0">
                      <p
                        className={`font-semibold ${
                          goal.completed ? 'line-through text-slate-400' : 'text-white'
                        }`}
                      >
                        {goal.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 tabular-nums">
                        <span>{goal.subject}</span>
                        <span>•</span>
                        <span>
                          {goal.currentCount}/{goal.targetCount} done
                        </span>
                        <span>•</span>
                        <span className="text-emerald-400 font-bold">+{goal.xpReward} XP</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              onClick={() => navigate('/practice')}
              icon={<Play className="w-3.5 h-3.5" />}
            >
              Practice Board Questions
            </Button>
          </Card>
        </div>

        {/* SECTION 3: Chapter Progress & Continue Learning (Real Verified Percentage Only) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-400" />
              Chapter Progress ({board} {grade})
            </h2>
            {availableSubjects.length > 2 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {availableSubjects.slice(0, 5).map((subjName) => (
                  <button
                    key={subjName}
                    type="button"
                    onClick={() => setSelectedChapterSubject(subjName)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                      selectedChapterSubject === subjName
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                    }`}
                  >
                    {subjName}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visibleChapters.length > 0 ? (
              visibleChapters.slice(0, 2).map((chapter) => {
                const statusLabel =
                  chapter.status === 'completed'
                    ? 'Completed'
                    : chapter.status === 'in_progress'
                      ? 'In Progress'
                      : 'Not Started';
                return (
                  <Card
                    key={chapter.chapterId}
                    hover
                    className="flex flex-col justify-between space-y-4 border-indigo-500/25"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="purple" size="sm">
                          {chapter.subject}
                        </Badge>
                        <span className="text-[11px] text-slate-400 flex items-center gap-1 tabular-nums">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {chapter.estimatedMinutesRemaining}m est.
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-white line-clamp-2">
                        {chapter.chapterTitle}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {chapter.completedTopics} of {chapter.totalTopics} concept
                        {chapter.totalTopics === 1 ? '' : 's'} completed •{' '}
                        <span
                          className={
                            chapter.status === 'completed'
                              ? 'text-emerald-400 font-semibold'
                              : chapter.status === 'in_progress'
                                ? 'text-indigo-300 font-semibold'
                                : 'text-slate-400'
                          }
                        >
                          {statusLabel}
                        </span>
                      </p>
                    </div>

                    <div className="space-y-2 pt-2">
                      <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
                        <span>Chapter Progress</span>
                        <span className="font-bold text-indigo-400">
                          {chapter.percentComplete}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            chapter.status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500'
                          }`}
                          style={{ width: `${chapter.percentComplete}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openChapterLesson(chapter, 'ai-teacher')}
                          icon={<Play className="w-3.5 h-3.5" />}
                        >
                          {chapter.status === 'in_progress'
                            ? 'Resume Lesson'
                            : chapter.status === 'completed'
                              ? 'Review Lesson'
                              : 'Start Lesson'}
                        </Button>
                        {FEATURE_FLAGS.visualLearningEnabled && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openChapterLesson(chapter, 'visual-lab')}
                            icon={<Atom className="w-3.5 h-3.5" />}
                          >
                            Visual Lab
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })
            ) : (
              <Card className="sm:col-span-2 py-8 text-center space-y-3">
                <p className="text-sm font-semibold text-white">
                  No chapters loaded for this filter
                </p>
                <p className="text-xs text-slate-400">
                  {FEATURE_FLAGS.visualLearningEnabled
                    ? 'Launch AI Socratic Teacher or Visual Learning Lab to begin your first topic.'
                    : 'Launch AI Socratic Teacher to begin your first topic.'}
                </p>
                <div className="flex justify-center gap-2">
                  <Button size="sm" variant="primary" onClick={() => navigate('/ai-teacher')}>
                    Open AI Teacher
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* 4. RECENT DOUBTS & 5. UPCOMING REVISION (GRID 2 COLS) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SECTION 4: Recent Doubts */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-cyan-400" />
              Recent Doubts Solved
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/doubt-solver')}
              icon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Ask Doubt
            </Button>
          </div>

          <Card className="space-y-3">
            {recentDoubts.length > 0 ? (
              recentDoubts.map((doubt) => (
                <button
                  key={doubt.id}
                  type="button"
                  onClick={() => navigate('/doubt-solver')}
                  className="w-full text-left p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-slate-700 transition-colors flex items-center justify-between group cursor-pointer"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="success" size="sm">
                        Solved
                      </Badge>
                      <span className="text-[11px] text-slate-400 truncate">
                        {doubt.subject}
                        {doubt.topic ? ` • ${doubt.topic}` : ''}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-white group-hover:text-cyan-300 transition-colors truncate">
                      {doubt.title}
                    </p>
                    <span className="text-[10px] text-slate-500">
                      {doubt.structuredSolution?.stepByStepSolution?.length || 1} step AI breakdown
                      {doubt.attachmentLabel ? ` • ${doubt.attachmentLabel}` : ''}
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all flex-shrink-0 ml-2" />
                </button>
              ))
            ) : (
              <div className="py-6 text-center space-y-3">
                <p className="text-xs text-slate-300 font-semibold">No doubts submitted yet</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Stuck on a proof, numerical, or NCERT concept? Submit your question or photo for a
                  step-by-step walkthrough.
                </p>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => navigate('/doubt-solver')}
                  icon={<HelpCircle className="w-3.5 h-3.5" />}
                >
                  Ask First Doubt
                </Button>
              </div>
            )}
          </Card>
        </div>

        {/* SECTION 5: Upcoming Revision (Spaced Repetition Active Recall) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-amber-400" />
              Upcoming Revision (Active Recall)
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/memory-booster')}
              icon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              Review Now
            </Button>
          </div>

          <Card className="space-y-3">
            {dueFlashcards.length > 0 ? (
              dueFlashcards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() =>
                    navigate(
                      `/memory-booster?subject=${encodeURIComponent(card.subject)}&topic=${encodeURIComponent(card.topic)}`
                    )
                  }
                  className="w-full text-left p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-slate-700 transition-colors flex items-center justify-between group cursor-pointer"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Due Today
                      </span>
                      <span className="text-[11px] text-slate-400 truncate">
                        {card.subject} · {card.topic}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-white group-hover:text-amber-300 transition-colors truncate">
                      {card.front}
                    </p>
                    <span className="text-[10px] text-slate-500 tabular-nums">
                      SM-2 EF {card.easeFactor.toFixed(2)} · {card.repetitions} review
                      {card.repetitions === 1 ? '' : 's'}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-slate-300 group-hover:text-amber-300 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 shrink-0 ml-2">
                    Recall
                  </span>
                </button>
              ))
            ) : (
              <div className="py-6 text-center space-y-3">
                <p className="text-xs text-slate-300 font-semibold">No flashcards due for revision</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Generate active-recall flashcards from any chapter or mistake to activate SM-2
                  spaced repetition scheduling.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('/memory-booster')}
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                >
                  Open Memory Booster
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* 6. RECOMMENDED PRACTICE & 7. LEARNING PROGRESS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SECTION 6: Dynamic Adaptive Practice Recommendations */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <Target className="w-4 h-4 text-emerald-400" />
                Recommended Adaptive Practice
              </h2>
              <p className="text-[11px] text-slate-400">
                Ranked dynamically for {board} {grade} from your mastery, due cards & study history
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefreshRecommendations}
              disabled={refreshingRecs}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshingRecs ? 'animate-spin' : ''}`} />}
            >
              {refreshingRecs ? 'Refreshing...' : 'Refresh Suggestions'}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {recommendations.length > 0 ? (
              recommendations.slice(0, 4).map((rec) => (
                <Card key={rec.id} hover className="p-4 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="purple" size="sm">
                        {rec.subject}
                      </Badge>
                      <Badge variant={getDifficultyBadgeVariant(rec.difficulty)} size="sm">
                        {getDifficultyLabel(rec.difficulty)}
                      </Badge>
                    </div>
                    <h4 className="text-xs font-bold text-white">{rec.title}</h4>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {rec.chapter} • {rec.topic}
                    </p>
                    <p className="text-[11px] text-indigo-300 bg-indigo-950/40 border border-indigo-500/20 rounded-lg px-2.5 py-1.5">
                      Why now: {rec.reason}
                    </p>
                  </div>

                  <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-800">
                    <span className="text-[11px] text-emerald-400 font-semibold tabular-nums">
                      +{rec.xpReward} XP • ~{rec.estimatedMinutes}m
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={actingRecId === rec.id}
                        onClick={() => handleSkipRecommendation(rec)}
                        icon={<SkipForward className="w-3 h-3" />}
                        aria-label={`Skip ${rec.title}`}
                      >
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={actingRecId === rec.id}
                        onClick={() => handleStartRecommendation(rec)}
                        icon={<Play className="w-3 h-3" />}
                      >
                        Start
                      </Button>
                    </div>
                  </div>
                </Card>
              ))
            ) : (
              <Card className="sm:col-span-2 py-6 text-center space-y-3">
                <p className="text-xs text-slate-300 font-semibold">
                  {loadingDashboard
                    ? 'Analyzing curriculum and mastery signals...'
                    : 'All current suggestions were completed or skipped'}
                </p>
                <div className="flex justify-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRefreshRecommendations}
                    disabled={refreshingRecs}
                    icon={<RefreshCw className="w-3.5 h-3.5" />}
                  >
                    Load Fresh Suggestions
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => navigate('/practice')}>
                    Open Practice Bank
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* SECTION 7: Learning Progress (Subject Mastery Cards) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              Curriculum Mastery
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate('/learning-intelligence')}
            >
              Deep Insights →
            </Button>
          </div>

          <Card className="space-y-3.5">
            {topicMasteryList.length > 0 ? (
              topicMasteryList.map((tm) => (
                <div key={tm.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-semibold text-slate-200 truncate">
                      {tm.subject}: {tm.topic}
                    </span>
                    <span className="font-bold text-white tabular-nums shrink-0">
                      {Math.round(tm.weightedMasteryScore)}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        tm.status === 'mastered'
                          ? 'bg-emerald-500'
                          : tm.status === 'needs-revision'
                            ? 'bg-amber-500'
                            : 'bg-indigo-500'
                      }`}
                      style={{ width: `${Math.round(tm.weightedMasteryScore)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 tabular-nums">
                    <span>
                      {tm.attemptsCount} attempt{tm.attemptsCount === 1 ? '' : 's'}
                    </span>
                    <span>
                      {tm.revisionCount} recall review{tm.revisionCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-4 text-center space-y-3">
                <p className="text-xs text-slate-400">
                  No topic mastery attempts recorded yet. Practice a set to track real concept
                  mastery over time.
                </p>
                <Button size="sm" variant="outline" onClick={() => navigate('/practice')}>
                  Start Adaptive Practice
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* 8. QUICK ACCESS TO CORE MODULES */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h2 className="text-base font-extrabold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              {FEATURE_FLAGS.visualLearningEnabled
                ? 'Eduverse AI Learning Suite • All 11 Modules'
                : 'Eduverse AI Learning Suite • 10 Active Modules'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Comprehensive Indian school ecosystem built specifically for Class 6 to 12 scholars.
            </p>
          </div>
          <Badge variant="purple" size="md">
            {FEATURE_FLAGS.visualLearningEnabled ? '11 Intelligent Engines' : '10 Active Engines'}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {CORE_MODULES.map((mod) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => navigate(mod.route)}
                className="text-left rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 flex flex-col justify-between group cursor-pointer p-4 transition-all shadow-sm"
              >
                <div className="w-full">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/60 text-indigo-400 flex items-center justify-center group-hover:scale-105 group-hover:bg-indigo-600/20 group-hover:border-indigo-500/40 transition-all">
                      <Icon className="w-4 h-4 text-indigo-300" />
                    </div>
                    <Badge variant="default" size="sm">
                      {mod.badge}
                    </Badge>
                  </div>
                  <h3 className="text-xs font-bold text-white group-hover:text-indigo-300 transition-colors">
                    {mod.title}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {mod.desc}
                  </p>
                </div>

                <div className="w-full mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-semibold text-indigo-400">
                  <span>Launch Engine</span>
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                </div>
              </button>
            );
          })}
          {!FEATURE_FLAGS.visualLearningEnabled && (
            <VisualLearningComingSoonCard variant="grid" />
          )}
        </div>
      </div>
    </div>
  );
};
