import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eraser,
  Flag,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  ExamAnswerSubmission,
  ExamPaper,
  ExamQuestion,
  ExamQuestionStatus,
  ExamQuestionType,
} from '../../types/phase5';
import {
  formatExamTimer,
  getQuestionPaletteStatus,
  hasStudentProvidedAnswer,
} from '../../utils/examEngine';
import { Button } from '../common/Button';

interface ExamActiveRunnerProps {
  paper: ExamPaper;
  remainingSeconds: number;
  answers: Record<string, ExamAnswerSubmission>;
  visitedIds: Set<string>;
  markedIds: Set<string>;
  currentIndex: number;
  isSubmitting: boolean;
  submitError: string | null;
  onSelectQuestion: (index: number) => void;
  onUpdateAnswer: (questionId: string, patch: Partial<ExamAnswerSubmission>) => void;
  onClearAnswer: (questionId: string) => void;
  onToggleMarkForReview: (questionId: string) => void;
  onConfirmSubmit: () => void;
}

const QUESTION_TYPE_NAME: Record<ExamQuestionType, string> = {
  mcq: 'Single-Choice MCQ',
  'multiple-select': 'Multiple Select',
  'true-false': 'True / False',
  'fill-blank': 'Fill in the Blank',
  'short-answer': 'Short Answer',
  'long-answer': 'Long Answer',
  numerical: 'Numerical Problem',
};

const PALETTE_STYLE: Record<ExamQuestionStatus, string> = {
  answered: 'bg-emerald-600 text-white border-emerald-500',
  'marked-for-review': 'bg-amber-600 text-white border-amber-400',
  'answered-and-marked': 'bg-indigo-600 text-white border-indigo-400',
  unanswered: 'bg-slate-800 text-slate-200 border-slate-600',
  'not-visited': 'bg-slate-950 text-slate-400 border-slate-800',
};

const STATUS_LABEL: Record<ExamQuestionStatus, string> = {
  answered: 'Answered',
  'marked-for-review': 'Marked for review',
  'answered-and-marked': 'Answered and marked',
  unanswered: 'Visited, unanswered',
  'not-visited': 'Not visited',
};

export const ExamActiveRunner: React.FC<ExamActiveRunnerProps> = ({
  paper,
  remainingSeconds,
  answers,
  visitedIds,
  markedIds,
  currentIndex,
  isSubmitting,
  submitError,
  onSelectQuestion,
  onUpdateAnswer,
  onClearAnswer,
  onToggleMarkForReview,
  onConfirmSubmit,
}) => {
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const safeIndex = Math.max(0, Math.min(paper.questions.length - 1, currentIndex));
  const question: ExamQuestion = paper.questions[safeIndex];
  const currentAnswer = answers[question.id];
  const isMarked = markedIds.has(question.id);

  const statusCounts = useMemo(() => {
    const counts: Record<ExamQuestionStatus, number> = {
      answered: 0,
      'marked-for-review': 0,
      'answered-and-marked': 0,
      unanswered: 0,
      'not-visited': 0,
    };
    for (const q of paper.questions) {
      const st = getQuestionPaletteStatus(q, answers, visitedIds, markedIds);
      counts[st] += 1;
    }
    return counts;
  }, [paper.questions, answers, visitedIds, markedIds]);

  const totalAnswered = statusCounts.answered + statusCounts['answered-and-marked'];
  const totalMarked = statusCounts['marked-for-review'] + statusCounts['answered-and-marked'];
  const isLowTime = remainingSeconds <= 300;
  const isCriticalTime = remainingSeconds <= 60;

  const toggleMultiSelectOption = (opt: string) => {
    const prev = currentAnswer?.selectedOptions || [];
    const exists = prev.includes(opt);
    const next = exists ? prev.filter((item) => item !== opt) : [...prev, opt];
    onUpdateAnswer(question.id, { selectedOptions: next });
  };

  const wordCount = (currentAnswer?.textAnswer || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950 text-slate-100 flex flex-col overflow-hidden"
      data-testid="exam-active-runner"
    >
      {/* Top Distraction-Minimized Exam Bar */}
      <header className="border-b border-slate-800 bg-slate-900 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="truncate">
              AI Practice Examination · Not an Official {paper.board} Board Paper
            </span>
          </div>
          <h1 className="text-sm sm:text-base font-bold text-white truncate mt-0.5">
            {paper.title}
          </h1>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <div className="hidden sm:flex items-center gap-3 text-xs text-slate-400 tabular-nums">
            <span>
              <strong className="text-emerald-400">{totalAnswered}</strong>/{paper.questions.length} Answered
            </span>
            <span>·</span>
            <span>
              <strong className="text-amber-400">{totalMarked}</strong> Marked
            </span>
          </div>

          <div
            data-testid="exam-countdown-timer"
            className={`px-3 py-1.5 rounded-lg border font-mono text-sm sm:text-base font-bold tabular-nums flex items-center gap-2 ${
              isCriticalTime
                ? 'bg-rose-950/70 border-rose-500/60 text-rose-300 animate-pulse'
                : isLowTime
                  ? 'bg-amber-950/60 border-amber-500/50 text-amber-300'
                  : 'bg-slate-950 border-slate-700 text-white'
            }`}
          >
            <Clock className="w-4 h-4 shrink-0" />
            <span>{formatExamTimer(remainingSeconds)}</span>
          </div>

          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowSubmitModal(true)}
            disabled={isSubmitting}
            icon={<Send className="w-3.5 h-3.5" />}
          >
            {isSubmitting ? 'Grading...' : 'Submit Exam'}
          </Button>
        </div>
      </header>

      {/* Network Interruption & Retry Banner */}
      {submitError && (
        <div
          role="alert"
          className="bg-rose-950/80 border-b border-rose-700/60 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-200 shrink-0"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              {submitError} Your answers are saved safely on this device — retry with the exact same submission ID.
            </span>
          </div>
          <Button
            size="sm"
            variant="danger"
            onClick={onConfirmSubmit}
            disabled={isSubmitting}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Retry Submission
          </Button>
        </div>
      )}

      {/* Main Workspace: Question Stage + Question Palette */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        {/* Question Stage */}
        <section className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 flex flex-col justify-between gap-6">
          <div className="max-w-3xl w-full mx-auto space-y-6">
            {/* Inline Question Metadata (Zero-Pill Rule) */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800 text-xs text-slate-400 tabular-nums">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-indigo-400">
                  Question {question.questionNumber} of {paper.questions.length}
                </span>
                <span>·</span>
                <span>{question.section}</span>
                <span>·</span>
                <span className="text-slate-200 font-medium">
                  {QUESTION_TYPE_NAME[question.questionType]}
                </span>
                <span>·</span>
                <span className="capitalize">{question.difficulty.replace('-', ' ')}</span>
              </div>
              <div className="font-semibold text-slate-200">
                +{question.marks} Mark{question.marks === 1 ? '' : 's'}
                {paper.negativeMarkingEnabled && question.negativeMarks > 0 && (
                  <span className="text-rose-400 ml-2">(-{question.negativeMarks})</span>
                )}
              </div>
            </div>

            {/* Topic Subtitle */}
            <div className="text-xs text-slate-400">
              Topic: <span className="text-slate-200 font-medium">{question.topic}</span>
              {question.chapter ? ` · ${question.chapter}` : ''}
            </div>

            {/* Question Prompt */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
              <h2 className="text-base sm:text-lg font-semibold text-white leading-relaxed">
                {question.prompt}
              </h2>

              {/* MCQ & True/False */}
              {(question.questionType === 'mcq' || question.questionType === 'true-false') && (
                <div className="space-y-2.5" role="radiogroup" aria-label={`Options for question ${question.questionNumber}`}>
                  {(question.options || (question.questionType === 'true-false' ? ['True', 'False'] : [])).map(
                    (option, idx) => {
                      const selected = currentAnswer?.selectedOption === option;
                      const letter = String.fromCharCode(65 + idx);
                      return (
                        <button
                          key={`${question.id}-opt-${idx}`}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => onUpdateAnswer(question.id, { selectedOption: option })}
                          className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors flex items-center gap-3 cursor-pointer ${
                            selected
                              ? 'bg-indigo-600/20 border-indigo-400 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-600'
                          }`}
                        >
                          <span
                            className={`w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center shrink-0 border ${
                              selected
                                ? 'bg-indigo-600 border-indigo-400 text-white'
                                : 'bg-slate-900 border-slate-700 text-slate-400'
                            }`}
                          >
                            {question.questionType === 'true-false' ? (idx === 0 ? 'T' : 'F') : letter}
                          </span>
                          <span className="flex-1">{option}</span>
                        </button>
                      );
                    }
                  )}
                </div>
              )}

              {/* Multiple Select */}
              {question.questionType === 'multiple-select' && (
                <div className="space-y-2.5">
                  <p className="text-xs text-indigo-300">
                    Multiple correct choices possible — check all that apply (partial credit awarded if no wrong choice is included).
                  </p>
                  {(question.options || []).map((option, idx) => {
                    const checked = Boolean(currentAnswer?.selectedOptions?.includes(option));
                    return (
                      <label
                        key={`${question.id}-msq-${idx}`}
                        className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors flex items-center gap-3 cursor-pointer ${
                          checked
                            ? 'bg-indigo-600/20 border-indigo-400 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMultiSelectOption(option)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-indigo-500 focus:ring-indigo-500"
                        />
                        <span className="flex-1">{option}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Fill in the Blank */}
              {question.questionType === 'fill-blank' && (
                <div className="space-y-2">
                  <label htmlFor="exam-blank-input" className="block text-xs font-medium text-slate-300">
                    Your Answer (Exact Term or Value)
                  </label>
                  <input
                    id="exam-blank-input"
                    type="text"
                    value={currentAnswer?.textAnswer || ''}
                    onChange={(e) => onUpdateAnswer(question.id, { textAnswer: e.target.value })}
                    placeholder="Type the missing word, formula, or phrase..."
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              {/* Numerical */}
              {question.questionType === 'numerical' && (
                <div className="space-y-2">
                  <label htmlFor="exam-numerical-input" className="block text-xs font-medium text-slate-300">
                    Numerical Answer {question.unit ? `(Expected Unit: ${question.unit})` : ''}
                  </label>
                  <input
                    id="exam-numerical-input"
                    type="text"
                    value={currentAnswer?.textAnswer || ''}
                    onChange={(e) => onUpdateAnswer(question.id, { textAnswer: e.target.value })}
                    placeholder={`e.g. ${question.unit ? `12.5 ${question.unit}` : '12.5 or -3/4'}`}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-4 py-2.5 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-xs text-slate-400">
                    Enter integer, decimal, or fraction{question.unit ? ` with unit (${question.unit})` : ''}.
                  </p>
                </div>
              )}

              {/* Short & Long Answer */}
              {(question.questionType === 'short-answer' || question.questionType === 'long-answer') && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="exam-subjective-input" className="font-medium text-slate-300">
                      {question.questionType === 'long-answer'
                        ? 'Structured Long Answer (Evaluated by AI Examiner Rubric)'
                        : 'Concise Short Answer (Evaluated by AI Examiner Rubric)'}
                    </label>
                    <span className="text-slate-400 tabular-nums">{wordCount} words</span>
                  </div>
                  <textarea
                    id="exam-subjective-input"
                    rows={question.questionType === 'long-answer' ? 8 : 5}
                    value={currentAnswer?.textAnswer || ''}
                    onChange={(e) => onUpdateAnswer(question.id, { textAnswer: e.target.value })}
                    placeholder={
                      question.questionType === 'long-answer'
                        ? 'Write step-by-step derivation, key definitions, formulas, and final conclusion...'
                        : 'Explain the key concept concisely in 2–4 sentences...'
                    }
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-y"
                  />
                </div>
              )}
            </div>

            {/* Question Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={isMarked ? 'secondary' : 'outline'}
                  onClick={() => onToggleMarkForReview(question.id)}
                  aria-pressed={isMarked}
                  icon={<Bookmark className="w-3.5 h-3.5" />}
                >
                  {isMarked ? 'Marked for Review' : 'Mark for Review'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onClearAnswer(question.id)}
                  disabled={!hasStudentProvidedAnswer(question, currentAnswer)}
                  icon={<Eraser className="w-3.5 h-3.5" />}
                >
                  Clear Response
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSelectQuestion(Math.max(0, safeIndex - 1))}
                  disabled={safeIndex === 0}
                  icon={<ChevronLeft className="w-4 h-4" />}
                >
                  Previous
                </Button>
                {safeIndex < paper.questions.length - 1 ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onSelectQuestion(safeIndex + 1)}
                    icon={<ChevronRight className="w-4 h-4" />}
                  >
                    Save & Next
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setShowSubmitModal(true)}
                    icon={<CheckCircle2 className="w-4 h-4" />}
                  >
                    Review & Submit
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Right/Bottom Question Palette */}
        <aside
          aria-label="Question Palette"
          className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900/70 p-4 sm:p-5 overflow-y-auto shrink-0 space-y-5"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Flag className="w-3.5 h-3.5 text-indigo-400" />
              Question Palette
            </h3>
            <span className="text-xs text-slate-400 tabular-nums">
              {paper.totalMarks} Total Marks
            </span>
          </div>

          <div
            data-testid="question-palette-grid"
            className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-5 gap-2"
          >
            {paper.questions.map((q, idx) => {
              const st = getQuestionPaletteStatus(q, answers, visitedIds, markedIds);
              const isCurrent = idx === safeIndex;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => onSelectQuestion(idx)}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Question ${q.questionNumber}: ${STATUS_LABEL[st]}`}
                  className={`h-9 rounded-lg border text-xs font-bold tabular-nums transition-all cursor-pointer ${
                    PALETTE_STYLE[st]
                  } ${isCurrent ? 'outline-2 outline-offset-2 outline-white' : 'hover:opacity-90'}`}
                >
                  {q.questionNumber}
                </button>
              );
            })}
          </div>

          {/* 5-State Status Legend */}
          <div className="pt-3 border-t border-slate-800 space-y-2 text-xs text-slate-300 tabular-nums">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-emerald-600 inline-block" /> Answered
              </span>
              <span className="font-semibold">{statusCounts.answered}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-amber-600 inline-block" /> Marked for Review
              </span>
              <span className="font-semibold">{statusCounts['marked-for-review']}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-indigo-600 inline-block" /> Answered & Marked
              </span>
              <span className="font-semibold">{statusCounts['answered-and-marked']}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-slate-800 border border-slate-600 inline-block" /> Unanswered
              </span>
              <span className="font-semibold">{statusCounts.unanswered}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded bg-slate-950 border border-slate-700 inline-block" /> Not Visited
              </span>
              <span className="font-semibold">{statusCounts['not-visited']}</span>
            </div>
          </div>
        </aside>
      </div>

      {/* Submit Confirmation Modal */}
      {showSubmitModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-exam-modal-title"
          className="fixed inset-0 z-60 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="space-y-1">
              <h2 id="submit-exam-modal-title" className="text-lg font-bold text-white">
                Submit Examination?
              </h2>
              <p className="text-xs text-slate-400">
                Time remaining: <span className="text-white font-mono font-semibold">{formatExamTimer(remainingSeconds)}</span>.
                Objective answers grade automatically; subjective answers grade via AI rubric.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs tabular-nums">
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <div className="text-slate-400">Answered</div>
                <div className="text-lg font-bold text-emerald-400 mt-0.5">{totalAnswered}</div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <div className="text-slate-400">Marked for Review</div>
                <div className="text-lg font-bold text-amber-400 mt-0.5">{totalMarked}</div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <div className="text-slate-400">Unanswered</div>
                <div className="text-lg font-bold text-slate-200 mt-0.5">
                  {statusCounts.unanswered + statusCounts['marked-for-review']}
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <div className="text-slate-400">Not Visited</div>
                <div className="text-lg font-bold text-slate-400 mt-0.5">{statusCounts['not-visited']}</div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSubmitModal(false)}
                disabled={isSubmitting}
              >
                Return to Exam
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setShowSubmitModal(false);
                  onConfirmSubmit();
                }}
                disabled={isSubmitting}
                icon={<Send className="w-3.5 h-3.5" />}
              >
                {isSubmitting ? 'Submitting...' : 'Confirm & Submit'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
