import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  Flame,
  Target,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Clock,
  Sparkles,
  RefreshCw,
  BookOpen,
  Mic,
  FileText,
  Users,
  Zap,
  HeartHandshake,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../router/Router';
import { loadVerifiedMotivationDashboard } from '../lib/firestoreService';
import { AchievementCategory, MotivationDashboardState } from '../types/phase7';
import { AppRoute } from '../types/modules';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';

const CATEGORY_FILTERS: Array<{ id: 'all' | AchievementCategory; label: string }> = [
  { id: 'all', label: 'All Badges' },
  { id: 'streak', label: 'Streaks' },
  { id: 'mastery', label: 'Topic Mastery' },
  { id: 'revision', label: 'Revision' },
  { id: 'assessment', label: 'Exams' },
  { id: 'voice', label: 'Voice Classroom' },
  { id: 'collaboration', label: 'Study Pods' },
];

const TIER_STYLES: Record<string, string> = {
  bronze: 'border-amber-700/50 text-amber-300 bg-amber-950/30',
  silver: 'border-slate-500/50 text-slate-200 bg-slate-800/50',
  gold: 'border-yellow-500/50 text-yellow-300 bg-yellow-950/30',
  diamond: 'border-cyan-400/50 text-cyan-200 bg-cyan-950/30',
};

const SOURCE_ICONS: Record<AchievementCategory, React.ReactNode> = {
  streak: <Flame className="w-4 h-4 text-amber-400" />,
  mastery: <BookOpen className="w-4 h-4 text-emerald-400" />,
  revision: <Zap className="w-4 h-4 text-amber-300" />,
  assessment: <FileText className="w-4 h-4 text-rose-400" />,
  voice: <Mic className="w-4 h-4 text-teal-400" />,
  collaboration: <Users className="w-4 h-4 text-sky-400" />,
};

export const BadgesPage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const uid = user?.uid || '';

  const [dashboard, setDashboard] = useState<MotivationDashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<'all' | AchievementCategory>('all');

  const refreshDashboard = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const computed = await loadVerifiedMotivationDashboard(uid);
      setDashboard(computed);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  const filteredBadges = useMemo(() => {
    if (!dashboard) return [];
    if (categoryFilter === 'all') return dashboard.badges;
    return dashboard.badges.filter((b) => b.category === categoryFilter);
  }, [dashboard, categoryFilter]);

  const completedGoalsCount = useMemo(
    () => (dashboard ? dashboard.dailyGoals.filter((g) => g.completed).length : 0),
    [dashboard]
  );

  const dayLabels = useMemo(() => {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const labels: string[] = [];
    for (let offset = -6; offset <= 0; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      labels.push(offset === 0 ? 'Today' : names[d.getDay()]);
    }
    return labels;
  }, []);

  if (loading && !dashboard) {
    return (
      <div className="p-10 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
        Verifying learning activities, topic mastery, and achievements...
      </div>
    );
  }

  if (!dashboard) return null;

  const xpRatio = Math.min(100, Math.round((dashboard.todayXpEarned / dashboard.todayXpCap) * 100));
  const goalRatio = dashboard.dailyGoals.length > 0
    ? Math.round((completedGoalsCount / dashboard.dailyGoals.length) * 100)
    : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>EDUVERSE</span>
            <span>/</span>
            <span className="text-amber-300 font-semibold">Badges & Trophy Hall</span>
            <Badge variant="success" size="sm">Verified Activities Only</Badge>
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <Award className="w-6 h-6 text-amber-400" />
            Meaningful Learning Motivation
          </h1>
          <p className="text-xs text-slate-400 max-w-2xl">
            Every streak, milestone, and badge is earned exclusively from real verified practice, spaced recall, exams, voice lessons, and peer study contributions.
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={refreshDashboard}
          disabled={loading}
          icon={<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
        >
          Sync Verified Progress
        </Button>
      </div>

      {/* Healthy Study Habits Banner */}
      <div
        className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          dashboard.healthyCapReached
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-100'
            : 'bg-slate-900 border-emerald-500/25 text-slate-200'
        }`}
      >
        <div className="flex items-start gap-3">
          <HeartHandshake className={`w-5 h-5 shrink-0 mt-0.5 ${dashboard.healthyCapReached ? 'text-amber-400' : 'text-emerald-400'}`} />
          <div className="space-y-0.5 text-xs">
            <p className="font-bold">
              {dashboard.healthyCapReached
                ? 'Healthy Daily Cap Reached — Rest & Consolidation Encouraged'
                : 'Balanced Study Guardrail Active (Consistent Habits > Marathon Cramming)'}
            </p>
            <p className="text-slate-300">
              {dashboard.wellnessNotice ||
                `Daily XP is capped at ${dashboard.todayXpCap} XP (${dashboard.healthyMinuteCap} min healthy ceiling) so steady daily learning beats late-night binge sessions.`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums">
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Today XP / Cap</span>
            <span className="font-bold text-emerald-400">{dashboard.todayXpEarned} / {dashboard.todayXpCap}</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Est. Focus Today</span>
            <span className="font-bold text-sky-300">{dashboard.todayEstimatedMinutes} / {dashboard.healthyMinuteCap}m</span>
          </div>
        </div>
      </div>

      {/* 4 Primary Metric Cards (Tabular Numerals, Single Elevation) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Verified Streak
            </span>
            <p className="text-2xl font-extrabold text-amber-400 tabular-nums mt-1">
              {dashboard.streakDays} Day{dashboard.streakDays === 1 ? '' : 's'}
            </p>
            <span className="text-[11px] text-slate-500">Calendar continuity</span>
          </div>
          <div
            className={`w-11 h-11 rounded-2xl border flex items-center justify-center transition-transform duration-300 ${
              dashboard.streakDays > 0
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-400 motion-safe:animate-pulse'
                : 'bg-slate-950 border-slate-800 text-slate-600'
            }`}
          >
            <Flame className="w-6 h-6" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Total Verified XP
            </span>
            <p className="text-2xl font-extrabold text-emerald-400 tabular-nums mt-1">
              {dashboard.totalVerifiedXp.toLocaleString()} XP
            </p>
            <span className="text-[11px] text-slate-500">Capped at {dashboard.todayXpCap} XP/day</span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Badges Unlocked
            </span>
            <p className="text-2xl font-extrabold text-white tabular-nums mt-1">
              {dashboard.unlockedCount} / {dashboard.totalBadgesCount}
            </p>
            <span className="text-[11px] text-slate-500">Across 6 learning pillars</span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 flex items-center justify-center">
            <Award className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Topics Mastered
            </span>
            <p className="text-2xl font-extrabold text-teal-300 tabular-nums mt-1">
              {dashboard.masteryProgress.masteredTopics}
            </p>
            <span className="text-[11px] text-slate-500 tabular-nums">
              {dashboard.masteryProgress.developingTopics} developing · {dashboard.masteryProgress.totalRevisions} reviews
            </span>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-300 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 7-Day Consistency + Healthy Daily Goals + Activity Mix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Daily Goals */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-400" />
                Today’s Healthy Learning Goals
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Auto-completed strictly from real activities logged today ({completedGoalsCount}/{dashboard.dailyGoals.length} complete)
              </p>
            </div>
            <span className="text-sm font-extrabold text-emerald-400 tabular-nums">{goalRatio}%</span>
          </div>

          <div className="w-full h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-300"
              style={{ width: `${goalRatio}%` }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {dashboard.dailyGoals.map((goal) => (
              <div
                key={goal.id}
                className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 ${
                  goal.completed
                    ? 'bg-emerald-500/5 border-emerald-500/30'
                    : 'bg-slate-950 border-slate-800'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-white">{goal.title}</p>
                    <p className="text-[11px] text-slate-400 tabular-nums">
                      Progress: <strong className="text-slate-200">{goal.current} / {goal.target}</strong> · +{goal.xpReward} XP
                    </p>
                  </div>
                  {goal.completed && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="w-24 h-1.5 rounded-full bg-slate-900 overflow-hidden">
                    <div
                      className={`h-full ${goal.completed ? 'bg-emerald-400' : 'bg-indigo-400'}`}
                      style={{ width: `${Math.min(100, Math.round((goal.current / goal.target) * 100))}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(goal.route as AppRoute)}
                    className="text-[11px] font-semibold text-indigo-300 hover:text-indigo-200 flex items-center gap-1"
                  >
                    {goal.completed ? 'Review' : 'Start'}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 7-Day Habit Strip, Healthy XP Chart & Balanced Pillar Visualizer */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">7-Day Consistency & Healthy XP</h2>
              <span className="text-[11px] text-slate-400 tabular-nums">Daily XP: {xpRatio}% of cap</span>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {dashboard.activeDaysLast7.map((active, idx) => (
                <div
                  key={idx}
                  className={`py-2 rounded-xl border text-center transition-colors ${
                    active
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'bg-slate-950 border-slate-800 text-slate-600'
                  }`}
                >
                  <Flame className={`w-3.5 h-3.5 mx-auto mb-1 ${active ? 'text-amber-400' : 'text-slate-700'}`} />
                  <span className="text-[10px] font-semibold block">{dayLabels[idx]}</span>
                </div>
              ))}
            </div>

            {/* 7-Day Verified XP vs 300 XP Ceiling Bar Visualization */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-[10px] text-slate-400 tabular-nums">
                <span>7-Day Verified XP Pace</span>
                <span>Cap: {dashboard.todayXpCap} XP/day</span>
              </div>
              <div className="grid grid-cols-7 gap-2 items-end h-20 pt-1">
                {(dashboard.dailyBreakdownLast7 || []).map((pt, idx) => {
                  const pct = Math.min(100, Math.round((pt.xp / Math.max(1, dashboard.todayXpCap)) * 100));
                  return (
                    <div key={pt.dateKey} className="flex flex-col items-center gap-1 h-full justify-end">
                      <span className="text-[9px] text-slate-400 tabular-nums">{pt.xp}</span>
                      <div className="w-full flex-1 flex items-end bg-slate-900 rounded-md overflow-hidden border border-slate-800/70">
                        <div
                          style={{ height: `${Math.max(pt.xp > 0 ? 12 : 0, pct)}%` }}
                          className={`w-full rounded-t-sm transition-all duration-500 ${
                            pt.capped ? 'bg-amber-400' : 'bg-gradient-to-t from-indigo-500 to-emerald-400'
                          }`}
                          title={`${pt.dateKey}: ${pt.xp} XP (${pt.minutes} min)`}
                        />
                      </div>
                      <span className="text-[9px] text-slate-500">{dayLabels[idx]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-3 border-t border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Verified Activity Breakdown
            </h3>
            {[
              { label: 'Topics Mastered', val: dashboard.masteryProgress.masteredTopics, max: 5, color: 'bg-emerald-500' },
              { label: 'Recall Revisions', val: dashboard.masteryProgress.totalRevisions, max: 20, color: 'bg-amber-500' },
              { label: 'Exam Simulations', val: dashboard.masteryProgress.examsCompleted, max: 5, color: 'bg-rose-500' },
              { label: 'Voice Lessons', val: dashboard.masteryProgress.voiceLessons, max: 5, color: 'bg-teal-500' },
              { label: 'Study Pods Joined', val: dashboard.masteryProgress.studyRoomsJoined, max: 3, color: 'bg-sky-500' },
            ].map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex justify-between text-[11px] tabular-nums">
                  <span className="text-slate-300">{row.label}</span>
                  <span className="font-bold text-white">{row.val}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden">
                  <div
                    className={`h-full ${row.color} transition-all duration-300`}
                    style={{ width: `${Math.min(100, Math.round((row.val / row.max) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Achievement Badges Grid */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-white">Achievement Badges & Milestones</h2>
            <p className="text-xs text-slate-400">
              Filter by learning domain — every badge shows real progress evidence from your history.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {CATEGORY_FILTERS.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  categoryFilter === cat.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBadges.map((badge) => (
            <div
              key={badge.id}
              className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 transition-transform duration-200 hover:-translate-y-0.5 ${
                badge.unlocked
                  ? 'bg-slate-950 border-indigo-500/40'
                  : 'bg-slate-950/60 border-slate-800/80 opacity-85'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                      {SOURCE_ICONS[badge.category]}
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-white">{badge.title}</h3>
                      <span className="text-[10px] text-slate-400">{badge.hindiTitle}</span>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md border ${
                      TIER_STYLES[badge.tier] || TIER_STYLES.bronze
                    }`}
                  >
                    {badge.unlocked ? 'Unlocked' : badge.tier}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{badge.description}</p>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-[11px] tabular-nums">
                  <span className={badge.unlocked ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                    {badge.evidenceLabel}
                  </span>
                  <span className="font-bold text-white">{badge.progressPercent}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      badge.unlocked ? 'bg-emerald-400' : 'bg-indigo-500'
                    }`}
                    style={{ width: `${badge.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Personal Progress Timeline */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-extrabold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" />
              Personal Progress Timeline
            </h2>
            <p className="text-xs text-slate-400">
              Verified chronological record connecting achievements back to real learning sessions.
            </p>
          </div>
          <span className="text-xs text-slate-400 tabular-nums">{dashboard.milestones.length} verified events</span>
        </div>

        {dashboard.milestones.length === 0 ? (
          <div className="p-6 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-3">
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              No verified learning milestones recorded yet. Complete an Adaptive Practice set, review flashcards in Memory Booster, finish an Exam Mock, or contribute to a Study Pod to populate your progress timeline!
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" variant="primary" onClick={() => navigate('/practice')}>
                Adaptive Practice
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/memory-booster')}>
                Memory Booster
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/collaborative-learning')}>
                Peer Study Pods
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {dashboard.milestones.map((ms) => (
              <div
                key={ms.id}
                className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                    {SOURCE_ICONS[ms.category]}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white">{ms.title}</p>
                    <p className="text-[11px] text-slate-400">
                      {ms.subtitle} · Source: <strong className="text-slate-300">{ms.verifiedSource}</strong>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] tabular-nums shrink-0">
                  <span className="text-emerald-400 font-bold">+{ms.xpCredited} XP</span>
                  <span className="text-slate-500">{new Date(ms.timestamp).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
