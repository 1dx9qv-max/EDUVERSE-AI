import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  List,
  Route,
} from 'lucide-react';
import type { SavedDatesheet } from '../../types/datesheet';
import {
  buildEnrichedSchedule,
  computePreparationAnalysis,
  formatDisplayDate,
  getExpectedWeekday,
  parseStrictIsoDate,
} from '../../utils/datesheetEngine';
import { Badge } from '../common/Badge';
import { Card } from '../common/Card';

type ScheduleViewTab = 'timeline' | 'calendar' | 'list';

interface DatesheetViewsPanelProps {
  datesheet: SavedDatesheet;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const DatesheetViewsPanel: React.FC<DatesheetViewsPanelProps> = ({ datesheet }) => {
  const [activeTab, setActiveTab] = useState<ScheduleViewTab>('timeline');

  const enrichedSchedule = useMemo(
    () => buildEnrichedSchedule(datesheet.entries),
    [datesheet.entries]
  );

  const prepAnalysis = useMemo(
    () => computePreparationAnalysis(datesheet.entries),
    [datesheet.entries]
  );

  const initialMonthState = useMemo(() => {
    const anchorDate =
      prepAnalysis.nextUpcomingExam?.date ||
      prepAnalysis.firstExam?.date ||
      new Date().toISOString().slice(0, 10);
    const parsed = parseStrictIsoDate(anchorDate);
    if (parsed.valid && parsed.year && parsed.month) {
      return { year: parsed.year, monthIndex: parsed.month - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  }, [prepAnalysis.nextUpcomingExam?.date, prepAnalysis.firstExam?.date]);

  const [calendarYear, setCalendarYear] = useState(initialMonthState.year);
  const [calendarMonth, setCalendarMonth] = useState(initialMonthState.monthIndex);
  const [selectedDayIso, setSelectedDayIso] = useState<string | null>(
    prepAnalysis.nextUpcomingExam?.date || prepAnalysis.firstExam?.date || null
  );

  useEffect(() => {
    setCalendarYear(initialMonthState.year);
    setCalendarMonth(initialMonthState.monthIndex);
    setSelectedDayIso(
      prepAnalysis.nextUpcomingExam?.date || prepAnalysis.firstExam?.date || null
    );
  }, [datesheet.id, initialMonthState.year, initialMonthState.monthIndex, prepAnalysis.nextUpcomingExam?.date, prepAnalysis.firstExam?.date]);

  const examsByDate = useMemo(() => {
    const map = new Map<string, typeof enrichedSchedule>();
    for (const item of enrichedSchedule) {
      if (!parseStrictIsoDate(item.entry.date).valid) continue;
      const list = map.get(item.entry.date) || [];
      list.push(item);
      map.set(item.entry.date, list);
    }
    return map;
  }, [enrichedSchedule]);

  const examMonths = useMemo(() => {
    const seen = new Map<string, { year: number; monthIndex: number; label: string }>();
    for (const item of enrichedSchedule) {
      const parsed = parseStrictIsoDate(item.entry.date);
      if (!parsed.valid || !parsed.year || !parsed.month) continue;
      const key = `${parsed.year}-${parsed.month}`;
      if (!seen.has(key)) {
        seen.set(key, {
          year: parsed.year,
          monthIndex: parsed.month - 1,
          label: `${MONTH_NAMES[parsed.month - 1].slice(0, 3)} ${parsed.year}`,
        });
      }
    }
    return Array.from(seen.values());
  }, [enrichedSchedule]);

  const calendarCells = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(calendarYear, calendarMonth, 1));
    const startWeekday = firstOfMonth.getUTCDay();
    const daysInMonth = new Date(Date.UTC(calendarYear, calendarMonth + 1, 0)).getUTCDate();

    const cells: Array<{ dayNumber: number | null; isoDate: string | null }> = [];
    for (let i = 0; i < startWeekday; i += 1) {
      cells.push({ dayNumber: null, isoDate: null });
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      const iso = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ dayNumber: d, isoDate: iso });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dayNumber: null, isoDate: null });
    }
    return cells;
  }, [calendarYear, calendarMonth]);

  const handleShiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(calendarYear, calendarMonth + delta, 1));
    setCalendarYear(d.getUTCFullYear());
    setCalendarMonth(d.getUTCMonth());
  };

  const renderCountdownLabel = (days: number | null) => {
    if (days === null) return 'Date Missing';
    if (days === 0) return 'Exam Today';
    if (days > 0) return `${days}d left`;
    return `${Math.abs(days)}d ago`;
  };

  return (
    <div className="space-y-6">
      {/* Spotlight & Schedule Switcher */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 flex flex-col justify-between gap-4 border-indigo-200 dark:border-indigo-500/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                Next Upcoming Paper
              </span>
              {prepAnalysis.nextUpcomingExam ? (
                <>
                  <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">
                    {prepAnalysis.nextUpcomingExam.subject}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 font-mono-num">
                    {formatDisplayDate(prepAnalysis.nextUpcomingExam.date)} (
                    {prepAnalysis.nextUpcomingExam.weekday})
                    {prepAnalysis.nextUpcomingExam.rawTimeText
                      ? ` • ${prepAnalysis.nextUpcomingExam.rawTimeText}`
                      : ''}
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    No Upcoming Exams Remaining
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {prepAnalysis.overallSummary}
                  </p>
                </>
              )}
            </div>

            {prepAnalysis.nextUpcomingExam && (
              <div className="px-4 py-3 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-200 dark:border-indigo-500/30 text-center min-w-[110px]">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                  Countdown
                </span>
                <span className="font-mono-num text-2xl font-extrabold text-indigo-700 dark:text-white">
                  {prepAnalysis.nextUpcomingExam.daysRemaining === 0
                    ? 'TODAY'
                    : `${prepAnalysis.nextUpcomingExam.daysRemaining}d`}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Total Papers
              </span>
              <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                {prepAnalysis.totalExams}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Upcoming
              </span>
              <span className="font-mono-num text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {prepAnalysis.upcomingExamsCount}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Exam Span
              </span>
              <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                {prepAnalysis.totalSpanDays !== null ? `${prepAnalysis.totalSpanDays} days` : '—'}
              </span>
            </div>
          </div>
        </Card>

        {/* Quick Prep Gap Insights Card */}
        <Card className="space-y-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 block">
            Schedule &amp; Gap Snapshot
          </span>
          <div className="space-y-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                First &amp; Last Paper
              </span>
              {prepAnalysis.firstExam && prepAnalysis.lastExam ? (
                <p className="font-semibold text-slate-900 dark:text-white mt-0.5 font-mono-num">
                  {formatDisplayDate(prepAnalysis.firstExam.date)} ({prepAnalysis.firstExam.subject})
                  {prepAnalysis.lastExam.id !== prepAnalysis.firstExam.id &&
                    ` → ${formatDisplayDate(prepAnalysis.lastExam.date)} (${prepAnalysis.lastExam.subject})`}
                </p>
              ) : (
                <p className="text-slate-500 mt-0.5">No valid exam dates</p>
              )}
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Largest Prep Gap
              </span>
              {prepAnalysis.largestGap ? (
                <p className="font-semibold text-slate-900 dark:text-white mt-0.5">
                  <span className="font-mono-num text-emerald-600 dark:text-emerald-400">
                    {prepAnalysis.largestGap.prepDays} prep day
                    {prepAnalysis.largestGap.prepDays === 1 ? '' : 's'}
                  </span>{' '}
                  before {prepAnalysis.largestGap.toSubject}
                </p>
              ) : (
                <p className="text-slate-500 mt-0.5">Need 2+ dated papers</p>
              )}
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Back-to-Back Exams
              </span>
              <p className="font-semibold text-slate-900 dark:text-white mt-0.5">
                {prepAnalysis.consecutiveExamPairs.length > 0 ? (
                  <span className="text-amber-700 dark:text-amber-300 font-mono-num">
                    {prepAnalysis.consecutiveExamPairs.length} pair
                    {prepAnalysis.consecutiveExamPairs.length === 1 ? '' : 's'} (0 gap days)
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    None — at least 1 gap day between all papers
                  </span>
                )}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* View Mode Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div
          className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
          role="tablist"
          aria-label="Datesheet display views"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'timeline'}
            onClick={() => setActiveTab('timeline')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'timeline'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Route className="w-3.5 h-3.5" />
            Timeline
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'calendar'}
            onClick={() => setActiveTab('calendar')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'calendar'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            Calendar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'list'}
            onClick={() => setActiveTab('list')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'list'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            Subject List
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">{prepAnalysis.overallSummary}</p>
      </div>

      {/* VIEW 1: TIMELINE */}
      {activeTab === 'timeline' && (
        <Card className="space-y-4">
          {enrichedSchedule.length === 0 ? (
            <p className="text-xs text-slate-500 py-6 text-center">No exam entries to display.</p>
          ) : (
            <div className="space-y-3">
              {enrichedSchedule.map((item, idx) => {
                const { entry, daysRemaining, status, isNextUpcoming, prepDaysFromPrevious } = item;
                const displayWeekday = entry.weekday || getExpectedWeekday(entry.date) || '—';

                return (
                  <React.Fragment key={entry.id}>
                    {idx > 0 && prepDaysFromPrevious !== null && (
                      <div className="flex items-center gap-3 px-4 py-1.5 text-[11px]">
                        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                        <span
                          className={`font-mono-num font-semibold ${
                            prepDaysFromPrevious === 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : prepDaysFromPrevious === 1
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {prepDaysFromPrevious === 0
                            ? '0 prep days (back-to-back paper)'
                            : `${prepDaysFromPrevious} prep day${prepDaysFromPrevious === 1 ? '' : 's'} between papers`}
                        </span>
                        <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                      </div>
                    )}

                    <div
                      className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isNextUpcoming
                          ? 'bg-indigo-50/70 dark:bg-indigo-500/10 border-indigo-300 dark:border-indigo-500/40'
                          : status === 'past'
                            ? 'bg-slate-50/60 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800/80 opacity-75'
                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex items-start gap-3.5 min-w-0">
                        <div className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center shrink-0 min-w-[92px]">
                          <span className="font-mono-num text-xs font-bold text-slate-900 dark:text-white block">
                            {formatDisplayDate(entry.date)}
                          </span>
                          <span className="text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                            {displayWeekday}
                          </span>
                        </div>

                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                              {entry.subject || 'Untitled Subject'}
                            </h4>
                            {entry.subjectCode && (
                              <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                                ({entry.subjectCode})
                              </span>
                            )}
                            <Badge
                              size="sm"
                              variant={entry.entryType === 'practical' ? 'info' : 'default'}
                            >
                              {entry.entryType}
                            </Badge>
                            {isNextUpcoming && (
                              <Badge size="sm" variant="purple">
                                Next Up
                              </Badge>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                            <span className="inline-flex items-center gap-1 font-mono-num">
                              <Clock className="w-3.5 h-3.5" />
                              {entry.rawTimeText ||
                                (entry.startTime && entry.endTime
                                  ? `${entry.startTime} – ${entry.endTime}`
                                  : entry.startTime || 'Timing not specified')}
                            </span>
                            {entry.notes && <span>• {entry.notes}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="sm:text-right shrink-0">
                        <span
                          className={`font-mono-num text-xs font-bold px-2.5 py-1 rounded-md inline-block ${
                            status === 'today'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'
                              : status === 'upcoming'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {renderCountdownLabel(daysRemaining)}
                        </span>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* VIEW 2: CALENDAR */}
      {activeTab === 'calendar' && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleShiftMonth(-1)}
                aria-label="Previous month"
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white min-w-[140px] text-center">
                {MONTH_NAMES[calendarMonth]} {calendarYear}
              </h3>
              <button
                type="button"
                onClick={() => handleShiftMonth(1)}
                aria-label="Next month"
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {examMonths.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {examMonths.map((m) => {
                  const active = m.year === calendarYear && m.monthIndex === calendarMonth;
                  return (
                    <button
                      key={`${m.year}-${m.monthIndex}`}
                      type="button"
                      onClick={() => {
                        setCalendarYear(m.year);
                        setCalendarMonth(m.monthIndex);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                        active
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {SHORT_WEEKDAYS.map((day) => (
              <div key={day} className="py-1.5">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((cell, idx) => {
              if (!cell.dayNumber || !cell.isoDate) {
                return (
                  <div
                    key={`empty_${idx}`}
                    className="h-16 sm:h-24 rounded-xl bg-slate-50/50 dark:bg-slate-950/30"
                  />
                );
              }
              const dayExams = examsByDate.get(cell.isoDate) || [];
              const hasExams = dayExams.length > 0;
              const isSelected = selectedDayIso === cell.isoDate;

              return (
                <button
                  key={cell.isoDate}
                  type="button"
                  onClick={() => setSelectedDayIso(cell.isoDate)}
                  className={`h-16 sm:h-24 p-1.5 sm:p-2 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer overflow-hidden ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15 ring-1 ring-indigo-500'
                      : hasExams
                        ? 'border-indigo-300 dark:border-indigo-500/40 bg-indigo-50/50 dark:bg-indigo-950/30 hover:border-indigo-400'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/70 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <span
                    className={`font-mono-num text-[11px] font-bold ${
                      hasExams
                        ? 'text-indigo-700 dark:text-indigo-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>

                  {hasExams && (
                    <div className="space-y-0.5 w-full">
                      <span className="sm:hidden block w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                      {dayExams.slice(0, 2).map((dItem) => (
                        <span
                          key={dItem.entry.id}
                          className="hidden sm:block truncate text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-600 text-white"
                        >
                          {dItem.entry.subject}
                        </span>
                      ))}
                      {dayExams.length > 2 && (
                        <span className="hidden sm:block text-[9px] text-indigo-600 dark:text-indigo-300 font-bold">
                          +{dayExams.length - 2} more
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {selectedDayIso && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <p className="text-xs font-bold text-slate-900 dark:text-white font-mono-num">
                {formatDisplayDate(selectedDayIso)} ({getExpectedWeekday(selectedDayIso) || ''})
              </p>
              {(examsByDate.get(selectedDayIso) || []).length > 0 ? (
                <div className="space-y-2">
                  {(examsByDate.get(selectedDayIso) || []).map((item) => (
                    <div
                      key={item.entry.id}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">
                          {item.entry.subject}
                          {item.entry.subjectCode ? ` (${item.entry.subjectCode})` : ''}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400 font-mono-num">
                          {item.entry.rawTimeText || item.entry.startTime || 'Timing not specified'}
                        </p>
                      </div>
                      <Badge size="sm" variant="purple">
                        {renderCountdownLabel(item.daysRemaining)}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No exam scheduled on this date — available as a preparation/revision day.
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      {/* VIEW 3: SUBJECT LIST */}
      {activeTab === 'list' && (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Day</th>
                  <th className="py-3 px-4">Timing</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4 text-right">Countdown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {enrichedSchedule.map((item) => (
                  <tr
                    key={item.entry.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-950/60 transition-colors"
                  >
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                      {item.entry.subject || 'Untitled'}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-slate-500 dark:text-slate-400">
                      {item.entry.subjectCode || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-slate-700 dark:text-slate-300">
                      {formatDisplayDate(item.entry.date)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {item.entry.weekday || getExpectedWeekday(item.entry.date) || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-slate-600 dark:text-slate-300">
                      {item.entry.rawTimeText || item.entry.startTime || '—'}
                    </td>
                    <td className="py-3 px-4 capitalize text-slate-600 dark:text-slate-300">
                      {item.entry.entryType}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-bold text-indigo-600 dark:text-indigo-400">
                      {renderCountdownLabel(item.daysRemaining)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Preparation Analysis (Strictly Analysis — No Study Timetable) */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
            Preparation Gap &amp; Schedule Analysis
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Datesheet Insights
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Shortest Prep Gap
            </span>
            {prepAnalysis.shortestGap ? (
              <p className="text-slate-800 dark:text-slate-200 font-medium">
                <strong className="font-mono-num">
                  {prepAnalysis.shortestGap.prepDays} prep day
                  {prepAnalysis.shortestGap.prepDays === 1 ? '' : 's'}
                </strong>{' '}
                between {prepAnalysis.shortestGap.fromSubject} and{' '}
                {prepAnalysis.shortestGap.toSubject} (
                {formatDisplayDate(prepAnalysis.shortestGap.fromDate)} →{' '}
                {formatDisplayDate(prepAnalysis.shortestGap.toDate)})
              </p>
            ) : (
              <p className="text-slate-500">Add 2+ dated exams to compare preparation gaps.</p>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Tight Exam Clusters
            </span>
            {prepAnalysis.tightSequences.length > 0 ? (
              <div className="space-y-1">
                {prepAnalysis.tightSequences.map((seq, i) => (
                  <p key={i} className="text-amber-700 dark:text-amber-300 font-medium">
                    {seq.subjects.join(' → ')} ({formatDisplayDate(seq.startDate)} –{' '}
                    {formatDisplayDate(seq.endDate)})
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-emerald-700 dark:text-emerald-400 font-medium">
                No tightly compressed multi-exam sequences detected.
              </p>
            )}
          </div>
        </div>

        {datesheet.metadata.importantInstructions.length > 0 && (
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-indigo-500" />
              Datesheet Rules &amp; Notes
            </p>
            <ul className="list-disc pl-5 space-y-1 text-xs text-slate-700 dark:text-slate-300">
              {datesheet.metadata.importantInstructions.map((rule, idx) => (
                <li key={idx}>{rule}</li>
              ))}
            </ul>
          </div>
        )}

        {prepAnalysis.consecutiveExamPairs.length > 0 && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Pay special attention to back-to-back papers:{' '}
              {prepAnalysis.consecutiveExamPairs
                .map((p) => `${p.firstSubject} → ${p.secondSubject}`)
                .join('; ')}
              .
            </span>
          </div>
        )}
      </Card>
    </div>
  );
};
