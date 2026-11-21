import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Compass,
  FileText,
  History,
  Info,
  MapPin,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouter } from '../router/Router';
import { CORE_EXAM_MODULES } from '../constants/navigation';
import { fetchExamActivities, fetchExamDatesheets } from '../lib/firestoreService';
import type { ExamActivityItem, SavedDatesheet } from '../types/datesheet';
import { buildDashboardExamSummary, formatDisplayDate } from '../utils/datesheetEngine';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { OnboardingWizard } from '../components/onboarding/OnboardingWizard';

const MODULE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CalendarDays,
  ClipboardList,
  FileText,
  Clock,
  Compass,
};

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();

  const [datesheets, setDatesheets] = useState<SavedDatesheet[]>([]);
  const [activities, setActivities] = useState<ExamActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadExamWorkspace = useCallback(async () => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }
    try {
      const [loadedDatesheets, loadedActivities] = await Promise.all([
        fetchExamDatesheets(user.uid),
        fetchExamActivities(user.uid),
      ]);
      setDatesheets(loadedDatesheets);
      setActivities(loadedActivities);
    } catch {
      // Keep honest empty state if unavailable
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    void loadExamWorkspace();
  }, [loadExamWorkspace]);

  useEffect(() => {
    const onDirty = () => {
      void loadExamWorkspace();
    };
    window.addEventListener('eduverse:datesheet-dirty', onDirty);
    return () => window.removeEventListener('eduverse:datesheet-dirty', onDirty);
  }, [loadExamWorkspace]);

  const summary = useMemo(() => buildDashboardExamSummary(datesheets), [datesheets]);

  if (user && user.onboardingCompleted === false) {
    return <OnboardingWizard />;
  }

  const board = user?.board || 'CBSE';
  const grade = user?.classGrade || 'Class 10';
  const state = user?.state || 'Delhi (NCT)';

  return (
    <div className="space-y-7">
      {/* 1. EXAM WORKSPACE HEADER */}
      <Card className="p-6 sm:p-8 border-indigo-200 dark:border-indigo-500/25">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="purple" size="md">
                {board} • {grade}
              </Badge>
              <Badge variant="default" size="md">
                <MapPin className="w-3 h-3 inline mr-1" />
                {state}
              </Badge>
              <Badge variant="info" size="md">
                {user?.language || 'English'} Medium
              </Badge>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Welcome back, {user?.displayName || 'Student'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-2xl">
              {summary.confirmedDatesheet
                ? `Active exam schedule: ${summary.confirmedDatesheet.title}. Track upcoming papers, exam gaps, and upcoming preparation modules.`
                : summary.latestDraftDatesheet
                  ? `You have an unconfirmed draft datesheet ("${summary.latestDraftDatesheet.title}"). Confirm it in Module 1 to activate live exam countdowns.`
                  : 'Upload your school or board exam datesheet in Module 1 to activate real countdowns, chronological views, and gap alerts.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => navigate('/datesheet-analyzer')}
              icon={<CalendarDays className="w-4 h-4" />}
            >
              {summary.confirmedDatesheet ? 'Open Datesheet' : 'Upload Datesheet'}
            </Button>
          </div>
        </div>
      </Card>

      {/* 2. ACTIVE EXAM SUMMARY + NEXT EXAM COUNTDOWN */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Active Exam Overview
            </h2>
            {summary.confirmedDatesheet && (
              <Badge variant="success" size="sm">
                Confirmed
              </Badge>
            )}
          </div>

          {loading ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Loading your saved datesheets...
            </div>
          ) : summary.confirmedDatesheet && summary.analysis ? (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                    Next Exam Countdown
                  </span>
                  {summary.nextExam ? (
                    <>
                      <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
                        {summary.nextExam.subject}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 font-mono-num">
                        {formatDisplayDate(summary.nextExam.date)} ({summary.nextExam.weekday})
                        {summary.nextExam.rawTimeText
                          ? ` • ${summary.nextExam.rawTimeText}`
                          : ''}
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                        Schedule Completed
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        All dates in "{summary.confirmedDatesheet.title}" are in the past.
                      </p>
                    </>
                  )}
                </div>

                {summary.nextExam && (
                  <div className="px-5 py-3 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-500/40 text-center shrink-0">
                    <span className="font-mono-num text-2xl sm:text-3xl font-extrabold text-indigo-600 dark:text-indigo-300 block">
                      {summary.nextExam.daysRemaining === 0
                        ? 'TODAY'
                        : `${summary.nextExam.daysRemaining}d`}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {summary.nextExam.daysRemaining === 0 ? 'Exam Day' : 'Days Remaining'}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Total Papers
                  </span>
                  <span className="font-mono-num text-base font-extrabold text-slate-900 dark:text-white">
                    {summary.analysis.totalExams}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Upcoming
                  </span>
                  <span className="font-mono-num text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                    {summary.analysis.upcomingExamsCount}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Window Span
                  </span>
                  <span className="font-mono-num text-base font-extrabold text-slate-900 dark:text-white">
                    {summary.analysis.totalSpanDays !== null
                      ? `${summary.analysis.totalSpanDays}d`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center space-y-3">
              <div className="mx-auto w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-center">
                <Upload className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {summary.latestDraftDatesheet
                    ? 'Draft datesheet saved — confirmation required'
                    : 'No confirmed exam datesheet yet'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {summary.latestDraftDatesheet
                    ? `Open "${summary.latestDraftDatesheet.title}" in the Datesheet Analyzer to review and confirm your exam dates.`
                    : 'Upload your PDF or JPG/PNG exam schedule in Module 1 to unlock live countdowns and gap highlights.'}
                </p>
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => navigate('/datesheet-analyzer')}
                icon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                {summary.latestDraftDatesheet ? 'Review & Confirm Draft' : 'Analyze Your Datesheet'}
              </Button>
            </div>
          )}
        </Card>

        {/* Alerts & Highlights */}
        <Card className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Alerts &amp; Highlights
            </h2>
          </div>

          {summary.alerts.length > 0 ? (
            <div className="space-y-2.5">
              {summary.alerts.map((alert) => {
                const style =
                  alert.level === 'urgent'
                    ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/25 text-rose-800 dark:text-rose-200'
                    : alert.level === 'warning'
                      ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/25 text-amber-800 dark:text-amber-200'
                      : 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/25 text-blue-800 dark:text-blue-200';
                return (
                  <div key={alert.id} className={`p-3 rounded-xl border text-xs space-y-1 ${style}`}>
                    <p className="font-bold">{alert.title}</p>
                    <p className="opacity-90 leading-relaxed">{alert.detail}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center space-y-2 text-xs text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="w-5 h-5 mx-auto text-emerald-500" />
              <p>
                {summary.confirmedDatesheet
                  ? 'No urgent schedule conflicts or tight-gap warnings right now.'
                  : 'Schedule alerts will appear here automatically after you upload or confirm a datesheet.'}
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* 3. UPCOMING EXAMS + TODAY'S STUDY TASKS (COMING SOON) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Upcoming Exams Chronological List
            </h2>
            {summary.confirmedDatesheet && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => navigate('/datesheet-analyzer')}
              >
                Full Schedule →
              </Button>
            )}
          </div>

          {summary.upcomingSchedule.length > 0 ? (
            <div className="space-y-2.5">
              {summary.upcomingSchedule.slice(0, 5).map((item) => (
                <div
                  key={item.entry.id}
                  className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                        {item.entry.subject}
                      </span>
                      {item.isNextUpcoming && (
                        <Badge size="sm" variant="purple">
                          Next
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                      {formatDisplayDate(item.entry.date)} • {item.entry.weekday || '—'}
                      {item.entry.rawTimeText ? ` • ${item.entry.rawTimeText}` : ''}
                      {item.prepDaysFromPrevious !== null
                        ? ` • ${item.prepDaysFromPrevious}d gap from prev`
                        : ''}
                    </p>
                  </div>
                  <span className="font-mono-num text-xs font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
                    {item.daysRemaining === 0 ? 'Today' : `In ${item.daysRemaining}d`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              {summary.confirmedDatesheet
                ? 'No upcoming papers remaining on your active datesheet.'
                : 'Your upcoming exams will appear here chronologically once you confirm a datesheet.'}
            </div>
          )}
        </Card>

        {/* Honest Coming Soon: Today's Study Tasks */}
        <Card className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-slate-400" />
              Today&apos;s Study Tasks
            </h2>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Coming Soon
            </span>
          </div>

          <div className="py-4 space-y-3 text-xs text-slate-600 dark:text-slate-400">
            <p className="font-semibold text-slate-800 dark:text-slate-200">
              Connected to Module 2: Personal Study Planner
            </p>
            <p className="leading-relaxed">
              Once Personal Study Planner launches, your daily study tasks will be generated
              directly from your confirmed exam datesheet and prep gaps. No placeholder tasks are
              shown beforehand.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate('/study-planner')}
            >
              View Module 2 Details
            </Button>
          </div>
        </Card>
      </div>

      {/* 4. QUICK MODULE ACCESS (5 CORE MODULES) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
              EDUVERSE AI Exam Modules
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Focused 5-module exam preparation system for Class 6–12 students.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {CORE_EXAM_MODULES.map((mod) => {
            const Icon = MODULE_ICONS[mod.iconName] || CalendarDays;
            const isActive = mod.status === 'active';
            return (
              <button
                key={mod.path}
                type="button"
                onClick={() => navigate(mod.path)}
                className={`text-left rounded-2xl p-4 border transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                  isActive
                    ? 'bg-white dark:bg-slate-900 border-indigo-300 dark:border-indigo-500/40 hover:border-indigo-500 shadow-xs'
                    : 'bg-slate-50/80 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className={`p-2 rounded-xl ${
                        isActive
                          ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                          : 'bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        isActive
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {isActive ? 'Active' : 'Coming Soon'}
                    </span>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Module 0{mod.moduleNumber}
                    </p>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                      {mod.shortTitle || mod.title}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-3 leading-relaxed">
                      {mod.description}
                    </p>
                  </div>
                </div>

                <span
                  className={`text-xs font-semibold inline-flex items-center gap-1 ${
                    isActive
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {isActive ? 'Open Analyzer' : 'Module Preview'}
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 5. RECENT ACTIVITY */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <History className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Recent Datesheet Activity
          </h2>
        </div>

        {activities.length > 0 ? (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {activities.slice(0, 6).map((act) => (
              <div
                key={act.id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
              >
                <div>
                  <span className="font-bold text-slate-900 dark:text-white">{act.title}</span>
                  {act.detail && (
                    <span className="text-slate-500 dark:text-slate-400"> — {act.detail}</span>
                  )}
                </div>
                <span className="font-mono-num text-[11px] text-slate-400 shrink-0">
                  {formatDisplayDate(act.timestamp.slice(0, 10))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-4 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Info className="w-4 h-4 text-slate-400 shrink-0" />
            <span>
              No datesheet activity recorded yet. Upload and confirm your first exam schedule to
              start tracking updates.
            </span>
          </div>
        )}
      </Card>
    </div>
  );
};
