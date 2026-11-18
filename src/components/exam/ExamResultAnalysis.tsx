import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Layers,
  RotateCcw,
  ShieldAlert,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { ExamAttemptRecord, ExamQuestionType } from '../../types/phase5';
import {
  compareWithPreviousAttempts,
  formatExamTimer,
} from '../../utils/examEngine';
import { Button } from '../common/Button';

interface ExamResultAnalysisProps {
  attempt: ExamAttemptRecord;
  history: ExamAttemptRecord[];
  serverTimingMessage?: string | null;
  onBackToSetup: () => void;
  onNavigateToPractice: (topic: string, errorTag?: string) => void;
  onNavigateToFlashcards: (topic: string, errorTag?: string) => void;
  onNavigateToIntelligence: () => void;
}

type ReviewFilter = 'all' | 'incorrect' | 'unattempted' | 'marked';

const TYPE_LABEL: Record<ExamQuestionType, string> = {
  mcq: 'MCQ',
  'multiple-select': 'Multi-Select',
  'true-false': 'True/False',
  'fill-blank': 'Fill Blank',
  'short-answer': 'Short Answer',
  'long-answer': 'Long Answer',
  numerical: 'Numerical',
};

export const ExamResultAnalysis: React.FC<ExamResultAnalysisProps> = ({
  attempt,
  history,
  serverTimingMessage,
  onBackToSetup,
  onNavigateToPractice,
  onNavigateToFlashcards,
  onNavigateToIntelligence,
}) => {
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');

  const comparison = useMemo(
    () => compareWithPreviousAttempts(attempt, history),
    [attempt, history]
  );

  const filteredQuestions = useMemo(() => {
    if (reviewFilter === 'incorrect') {
      return attempt.questionResults.filter((q) => q.isAttempted && !q.isCorrect);
    }
    if (reviewFilter === 'unattempted') {
      return attempt.questionResults.filter((q) => !q.isAttempted);
    }
    if (reviewFilter === 'marked') {
      return attempt.questionResults.filter((q) => q.markedForReview);
    }
    return attempt.questionResults;
  }, [attempt.questionResults, reviewFilter]);

  return (
    <div className="space-y-6" data-testid="exam-result-analysis">
      {/* Header & Disclaimer */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span>
              AI-Generated Practice Result ({attempt.board} · {attempt.classGrade}) — Not an Official Board Exam
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">{attempt.paperTitle}</h1>
          <p className="text-xs text-slate-400">
            {serverTimingMessage ||
              `Timing validated on server (${attempt.timingStatus}) · Completed in ${formatExamTimer(attempt.elapsedSeconds)}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onNavigateToIntelligence}
            icon={<TrendingUp className="w-3.5 h-3.5" />}
          >
            Learning Intelligence
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={onBackToSetup}
            icon={<ArrowLeft className="w-3.5 h-3.5" />}
          >
            Configure New Test
          </Button>
        </div>
      </div>

      {/* Top KPI Strip (Single-Elevation Cards, Tabular Numbers) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">Marks Scored</div>
          <div className="text-2xl font-bold text-white tabular-nums">
            {attempt.marksObtained} / {attempt.totalMarks}
          </div>
          <div className="text-xs text-indigo-400 font-semibold tabular-nums">
            {attempt.percentage}% Overall Accuracy
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">Question Outcomes</div>
          <div className="text-2xl font-bold text-white tabular-nums">
            {attempt.correctCount} Correct
          </div>
          <div className="text-xs text-slate-400 tabular-nums">
            {attempt.incorrectCount} Incorrect · {Math.max(0, attempt.totalQuestions - attempt.attemptedCount)} Skipped
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">Server Time Verification</div>
          <div className="text-2xl font-bold text-white tabular-nums flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" />
            {formatExamTimer(attempt.elapsedSeconds)}
          </div>
          <div className="text-xs text-emerald-400 capitalize">
            {attempt.timingStatus.replace(/-/g, ' ')} ({attempt.durationMinutes}m limit)
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <div className="text-xs text-slate-400">Previous Attempt Comparison</div>
          {comparison.previousCount > 0 ? (
            <>
              <div
                className={`text-2xl font-bold tabular-nums ${
                  (comparison.deltaFromLast || 0) >= 0 ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {(comparison.deltaFromLast || 0) >= 0 ? '+' : ''}
                {comparison.deltaFromLast}% vs Last
              </div>
              <div className="text-xs text-slate-400 tabular-nums">
                Prior Avg {comparison.averagePreviousPercentage}% · Best {comparison.bestPreviousPercentage}%
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-slate-200">Baseline Set</div>
              <div className="text-xs text-slate-400">
                First recorded {attempt.subject} exam
              </div>
            </>
          )}
        </div>
      </div>

      {/* Topic-Wise & Difficulty-Wise Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              Topic-Wise Performance
            </h2>
            <span className="text-xs text-slate-400 tabular-nums">
              {attempt.topicBreakdown.length} topic{attempt.topicBreakdown.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">Topic</th>
                  <th className="py-2 px-2 font-medium text-right">Marks</th>
                  <th className="py-2 px-2 font-medium text-right">Accuracy</th>
                  <th className="py-2 pl-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 tabular-nums">
                {attempt.topicBreakdown.map((t) => (
                  <tr key={`${t.chapter}-${t.topic}`}>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-slate-200">{t.topic}</div>
                      <div className="text-slate-400">{t.correctCount}/{t.totalQuestions} correct</div>
                    </td>
                    <td className="py-2.5 px-2 text-right text-slate-200">
                      {t.marksAwarded}/{t.maxMarks}
                    </td>
                    <td
                      className={`py-2.5 px-2 text-right font-semibold ${
                        t.accuracyPercent >= 75
                          ? 'text-emerald-400'
                          : t.accuracyPercent >= 50
                            ? 'text-amber-400'
                            : 'text-rose-400'
                      }`}
                    >
                      {t.accuracyPercent}%
                    </td>
                    <td className="py-2.5 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => onNavigateToPractice(t.topic)}
                        className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
                      >
                        Practice
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-400" />
              Difficulty-Wise Breakdown
            </h2>
            <span className="text-xs text-slate-400">Balanced Calibration</span>
          </div>

          <div className="space-y-4">
            {attempt.difficultyBreakdown.map((d) => (
              <div key={d.difficulty} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs tabular-nums">
                  <span className="font-medium text-slate-200 capitalize">
                    {d.difficulty.replace('-', ' ')} ({d.correctCount}/{d.totalQuestions} Qs)
                  </span>
                  <span className="text-slate-300 font-semibold">
                    {d.marksAwarded}/{d.maxMarks} Marks · {d.accuracyPercent}%
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      d.accuracyPercent >= 75
                        ? 'bg-emerald-500'
                        : d.accuracyPercent >= 50
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                    }`}
                    style={{ width: `${d.accuracyPercent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Recommended Revision Topics */}
          <div className="pt-3 border-t border-slate-800 space-y-2">
            <div className="text-xs font-semibold text-slate-300">Recommended Next Revision</div>
            {attempt.recommendedRevisionTopics.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {attempt.recommendedRevisionTopics.map((topic) => (
                  <Button
                    key={topic}
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigateToFlashcards(topic)}
                    icon={<RotateCcw className="w-3 h-3" />}
                  >
                    Revise {topic}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-emerald-400">
                Strong across all tested topics — ready for Board Challenge sets!
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Mistake Analysis Section */}
      {attempt.mistakeSummary.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              Mistake Analysis & Synced Remediation
            </h2>
            <span className="text-xs text-slate-400">
              Synced to Learning Intelligence (non-punitive)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {attempt.mistakeSummary.map((m) => (
              <div
                key={`${m.topic}-${m.errorTag}`}
                className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-amber-300">
                    {m.errorTag.replace(/-/g, ' ')}
                  </span>
                  <span className="text-slate-400 tabular-nums">
                    {m.topic} · {m.count}x
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{m.sampleMisconception}</p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onNavigateToPractice(m.topic, m.errorTag)}
                    icon={<ArrowRight className="w-3 h-3" />}
                  >
                    Targeted Practice
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onNavigateToFlashcards(m.topic, m.errorTag)}
                  >
                    Create Recall Card
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Question-by-Question Review */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-white">Question-by-Question Review</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All (${attempt.questionResults.length})` },
                { id: 'incorrect', label: `Incorrect (${attempt.incorrectCount})` },
                {
                  id: 'unattempted',
                  label: `Unattempted (${attempt.totalQuestions - attempt.attemptedCount})`,
                },
                {
                  id: 'marked',
                  label: `Marked (${attempt.questionResults.filter((q) => q.markedForReview).length})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setReviewFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  reviewFilter === tab.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {filteredQuestions.map((q) => (
            <div
              key={q.questionId}
              className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 text-slate-400">
                  <span className="font-bold text-white tabular-nums">Q{q.questionNumber}</span>
                  <span>·</span>
                  <span>{TYPE_LABEL[q.questionType]}</span>
                  <span>·</span>
                  <span>{q.topic}</span>
                  <span>·</span>
                  <span className="capitalize">{q.difficulty.replace('-', ' ')}</span>
                </div>
                <div className="flex items-center gap-2 tabular-nums">
                  {q.isCorrect ? (
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> +{q.marksAwarded}/{q.maxMarks}
                    </span>
                  ) : q.isAttempted ? (
                    <span className="text-rose-400 font-semibold flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> {q.marksAwarded}/{q.maxMarks}
                    </span>
                  ) : (
                    <span className="text-slate-400 font-semibold">0/{q.maxMarks} (Skipped)</span>
                  )}
                </div>
              </div>

              <p className="text-sm font-medium text-white">{q.prompt}</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                  <div className="text-slate-400 mb-1">Your Answer</div>
                  <div className="text-slate-200 whitespace-pre-wrap">{q.studentAnswerDisplay}</div>
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-3">
                  <div className="text-slate-400 mb-1">Expected Key / Rubric</div>
                  <div className="text-emerald-300 whitespace-pre-wrap">{q.expectedAnswerDisplay}</div>
                </div>
              </div>

              <div className="text-xs space-y-1 text-slate-300">
                <div>
                  <span className="font-semibold text-indigo-300">Examiner Feedback:</span> {q.feedback}
                </div>
                <div>
                  <span className="font-semibold text-slate-200">Solution Explanation:</span> {q.explanation}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
