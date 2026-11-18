import type {
  DifficultyTier,
  PracticeAttemptRecord,
  QuestionType,
} from '../types/phase4.ts';
import type {
  ExamAnswerSubmission,
  ExamAttemptRecord,
  ExamDifficultyBreakdown,
  ExamMistakeEntry,
  ExamPaper,
  ExamQuestion,
  ExamQuestionResult,
  ExamQuestionStatus,
  ExamQuestionType,
  ExamTopicBreakdown,
} from '../types/phase5.ts';
import { sanitizeDocumentId } from './learningEngine.ts';

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;!?]+$/g, '');
}

function extractNumericAndUnit(input: string): { value: number | null; unit: string } {
  const trimmed = input.trim();
  if (!trimmed) return { value: null, unit: '' };

  const fractionMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*\/\s*([+-]?\d+(?:\.\d+)?)(.*)$/);
  if (fractionMatch) {
    const num = Number(fractionMatch[1]);
    const den = Number(fractionMatch[2]);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return { value: num / den, unit: fractionMatch[3].trim().toLowerCase() };
    }
  }

  const numMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(.*)$/i);
  if (!numMatch) return { value: null, unit: '' };
  const parsed = Number(numMatch[1]);
  if (!Number.isFinite(parsed)) return { value: null, unit: '' };
  return {
    value: parsed,
    unit: numMatch[2].trim().toLowerCase().replace(/\s+/g, ''),
  };
}

export function isSubjectiveExamQuestion(questionType: ExamQuestionType): boolean {
  return questionType === 'short-answer' || questionType === 'long-answer';
}

export function hasStudentProvidedAnswer(
  question: ExamQuestion,
  submission?: ExamAnswerSubmission
): boolean {
  if (!submission) return false;
  if (question.questionType === 'multiple-select') {
    return Array.isArray(submission.selectedOptions) && submission.selectedOptions.length > 0;
  }
  if (question.questionType === 'mcq' || question.questionType === 'true-false') {
    return Boolean((submission.selectedOption || submission.textAnswer || '').trim());
  }
  return Boolean((submission.textAnswer || '').trim());
}

export function formatStudentAnswerDisplay(
  question: ExamQuestion,
  submission?: ExamAnswerSubmission
): string {
  if (!submission) return '';
  if (question.questionType === 'multiple-select') {
    return Array.isArray(submission.selectedOptions) && submission.selectedOptions.length > 0
      ? submission.selectedOptions.join(', ')
      : '';
  }
  if (question.questionType === 'mcq' || question.questionType === 'true-false') {
    return (submission.selectedOption || submission.textAnswer || '').trim();
  }
  return (submission.textAnswer || '').trim();
}

export function gradeObjectiveExamQuestion(
  question: ExamQuestion,
  submission: ExamAnswerSubmission | undefined,
  negativeMarkingEnabled: boolean
): ExamQuestionResult {
  const markedForReview = Boolean(submission?.markedForReview);
  const attempted = hasStudentProvidedAnswer(question, submission);
  const studentDisplay = formatStudentAnswerDisplay(question, submission);
  const expectedDisplay =
    question.questionType === 'multiple-select' && question.correctAnswers?.length
      ? question.correctAnswers.join(', ')
      : question.correctAnswer;

  if (!attempted) {
    return {
      questionId: question.id,
      questionNumber: question.questionNumber,
      questionType: question.questionType,
      difficulty: question.difficulty,
      topic: question.topic,
      chapter: question.chapter,
      prompt: question.prompt,
      maxMarks: question.marks,
      marksAwarded: 0,
      isCorrect: false,
      isAttempted: false,
      evaluationMethod: 'unattempted',
      studentAnswerDisplay: 'Not attempted',
      expectedAnswerDisplay: expectedDisplay,
      feedback: 'Question left unattempted (0 marks).',
      explanation: question.explanation,
      detectedErrorTag: '',
      misconceptionNote: '',
      markedForReview,
    };
  }

  const penalty =
    negativeMarkingEnabled && question.negativeMarks > 0
      ? -Math.abs(question.negativeMarks)
      : 0;

  if (question.questionType === 'mcq' || question.questionType === 'true-false') {
    const isCorrect = normalizeText(studentDisplay) === normalizeText(question.correctAnswer);
    return {
      questionId: question.id,
      questionNumber: question.questionNumber,
      questionType: question.questionType,
      difficulty: question.difficulty,
      topic: question.topic,
      chapter: question.chapter,
      prompt: question.prompt,
      maxMarks: question.marks,
      marksAwarded: isCorrect ? question.marks : penalty,
      isCorrect,
      isAttempted: true,
      evaluationMethod: 'objective-auto',
      studentAnswerDisplay: studentDisplay,
      expectedAnswerDisplay: expectedDisplay,
      feedback: isCorrect
        ? `Full ${question.marks} mark${question.marks === 1 ? '' : 's'} awarded.`
        : `Incorrect selection.${penalty < 0 ? ` (${penalty} negative mark applied)` : ''}`,
      explanation: question.explanation,
      detectedErrorTag: isCorrect ? '' : question.errorTag || 'concept-confusion',
      misconceptionNote: isCorrect ? '' : question.commonMistake,
      markedForReview,
    };
  }

  if (question.questionType === 'multiple-select') {
    const expectedList =
      question.correctAnswers && question.correctAnswers.length > 0
        ? question.correctAnswers
        : question.correctAnswer
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    const expectedSet = new Set(expectedList.map(normalizeText));
    const chosenRaw = submission?.selectedOptions || [];
    const chosenSet = new Set(chosenRaw.map(normalizeText));

    let wrongChosenCount = 0;
    let correctChosenCount = 0;
    for (const item of chosenSet) {
      if (expectedSet.has(item)) {
        correctChosenCount += 1;
      } else {
        wrongChosenCount += 1;
      }
    }

    const exactMatch =
      wrongChosenCount === 0 &&
      correctChosenCount === expectedSet.size &&
      expectedSet.size > 0;

    let marksAwarded = 0;
    let feedback = '';
    if (exactMatch) {
      marksAwarded = question.marks;
      feedback = `All correct options selected (${marksAwarded}/${question.marks} marks).`;
    } else if (wrongChosenCount === 0 && correctChosenCount > 0) {
      // Partial credit when student selected only valid options (incomplete subset)
      marksAwarded = Number(
        ((correctChosenCount / expectedSet.size) * question.marks).toFixed(2)
      );
      feedback = `Partial credit (${marksAwarded}/${question.marks}): ${correctChosenCount} of ${expectedSet.size} correct options selected without wrong choices.`;
    } else {
      marksAwarded = penalty;
      feedback = `Incorrect option included.${penalty < 0 ? ` (${penalty} negative mark applied)` : ''}`;
    }

    return {
      questionId: question.id,
      questionNumber: question.questionNumber,
      questionType: question.questionType,
      difficulty: question.difficulty,
      topic: question.topic,
      chapter: question.chapter,
      prompt: question.prompt,
      maxMarks: question.marks,
      marksAwarded,
      isCorrect: exactMatch,
      isAttempted: true,
      evaluationMethod: 'objective-auto',
      studentAnswerDisplay: studentDisplay,
      expectedAnswerDisplay: expectedList.join(', '),
      feedback,
      explanation: question.explanation,
      detectedErrorTag: exactMatch ? '' : question.errorTag || 'incomplete-option-analysis',
      misconceptionNote: exactMatch ? '' : question.commonMistake,
      markedForReview,
    };
  }

  if (question.questionType === 'fill-blank') {
    const normalizedInput = normalizeText(studentDisplay);
    const candidates = [question.correctAnswer, ...(question.acceptableAnswers || [])].map(
      normalizeText
    );
    const isCorrect = candidates.includes(normalizedInput);
    return {
      questionId: question.id,
      questionNumber: question.questionNumber,
      questionType: question.questionType,
      difficulty: question.difficulty,
      topic: question.topic,
      chapter: question.chapter,
      prompt: question.prompt,
      maxMarks: question.marks,
      marksAwarded: isCorrect ? question.marks : penalty,
      isCorrect,
      isAttempted: true,
      evaluationMethod: 'objective-auto',
      studentAnswerDisplay: studentDisplay,
      expectedAnswerDisplay: expectedDisplay,
      feedback: isCorrect
        ? `Exact term matched (${question.marks}/${question.marks}).`
        : `Expected "${question.correctAnswer}".`,
      explanation: question.explanation,
      detectedErrorTag: isCorrect ? '' : question.errorTag || 'terminology-gap',
      misconceptionNote: isCorrect ? '' : question.commonMistake,
      markedForReview,
    };
  }

  // Numerical evaluation
  const parsedUser = extractNumericAndUnit(studentDisplay);
  const expectedParsed =
    typeof question.numericalValue === 'number' && Number.isFinite(question.numericalValue)
      ? {
          value: question.numericalValue,
          unit: (question.unit || '').trim().toLowerCase().replace(/\s+/g, ''),
        }
      : extractNumericAndUnit(question.correctAnswer);

  if (parsedUser.value === null || expectedParsed.value === null) {
    const exactFallback = normalizeText(studentDisplay) === normalizeText(question.correctAnswer);
    return {
      questionId: question.id,
      questionNumber: question.questionNumber,
      questionType: question.questionType,
      difficulty: question.difficulty,
      topic: question.topic,
      chapter: question.chapter,
      prompt: question.prompt,
      maxMarks: question.marks,
      marksAwarded: exactFallback ? question.marks : penalty,
      isCorrect: exactFallback,
      isAttempted: true,
      evaluationMethod: 'objective-auto',
      studentAnswerDisplay: studentDisplay,
      expectedAnswerDisplay: expectedDisplay,
      feedback: exactFallback
        ? `Correct numerical answer (${question.marks}/${question.marks}).`
        : 'Enter a valid numeric magnitude (e.g., 12.5 or -3/4).',
      explanation: question.explanation,
      detectedErrorTag: exactFallback ? '' : question.errorTag || 'format-or-calculation-error',
      misconceptionNote: exactFallback ? '' : question.commonMistake,
      markedForReview,
    };
  }

  const tolerance =
    typeof question.numericalTolerance === 'number' && question.numericalTolerance >= 0
      ? question.numericalTolerance
      : Math.max(0.01, Math.abs(expectedParsed.value) * 0.02);
  const diff = Math.abs(parsedUser.value - expectedParsed.value);
  const withinTolerance = diff <= tolerance;
  const signFlipped =
    expectedParsed.value !== 0 &&
    Math.abs(parsedUser.value + expectedParsed.value) <= tolerance;
  const unitMismatch =
    Boolean(expectedParsed.unit) &&
    Boolean(parsedUser.unit) &&
    parsedUser.unit !== expectedParsed.unit;

  if (withinTolerance && !unitMismatch) {
    return {
      questionId: question.id,
      questionNumber: question.questionNumber,
      questionType: question.questionType,
      difficulty: question.difficulty,
      topic: question.topic,
      chapter: question.chapter,
      prompt: question.prompt,
      maxMarks: question.marks,
      marksAwarded: question.marks,
      isCorrect: true,
      isAttempted: true,
      evaluationMethod: 'objective-auto',
      studentAnswerDisplay: studentDisplay,
      expectedAnswerDisplay: expectedDisplay,
      feedback: `Accurate numerical value (${question.marks}/${question.marks}).`,
      explanation: question.explanation,
      detectedErrorTag: '',
      misconceptionNote: '',
      markedForReview,
    };
  }

  if (withinTolerance && unitMismatch) {
    const partial = Number((question.marks * 0.5).toFixed(2));
    return {
      questionId: question.id,
      questionNumber: question.questionNumber,
      questionType: question.questionType,
      difficulty: question.difficulty,
      topic: question.topic,
      chapter: question.chapter,
      prompt: question.prompt,
      maxMarks: question.marks,
      marksAwarded: partial,
      isCorrect: false,
      isAttempted: true,
      evaluationMethod: 'objective-auto',
      studentAnswerDisplay: studentDisplay,
      expectedAnswerDisplay: expectedDisplay,
      feedback: `Magnitude matches, but expected unit "${expectedParsed.unit}". Awarded ${partial}/${question.marks}.`,
      explanation: question.explanation,
      detectedErrorTag: 'unit-conversion-error',
      misconceptionNote: `Correct numerical magnitude, mismatched unit "${parsedUser.unit}".`,
      markedForReview,
    };
  }

  return {
    questionId: question.id,
    questionNumber: question.questionNumber,
    questionType: question.questionType,
    difficulty: question.difficulty,
    topic: question.topic,
    chapter: question.chapter,
    prompt: question.prompt,
    maxMarks: question.marks,
    marksAwarded: penalty,
    isCorrect: false,
    isAttempted: true,
    evaluationMethod: 'objective-auto',
    studentAnswerDisplay: studentDisplay,
    expectedAnswerDisplay: expectedDisplay,
    feedback: signFlipped
      ? `Sign convention error: magnitude matches, but expected ${expectedParsed.value}.`
      : `Calculated ${parsedUser.value}; expected ${expectedParsed.value}${expectedParsed.unit ? ` ${expectedParsed.unit}` : ''}.`,
    explanation: question.explanation,
    detectedErrorTag: signFlipped
      ? 'sign-convention-error'
      : question.errorTag || 'calculation-error',
    misconceptionNote: signFlipped
      ? 'Verify positive vs. negative sign conventions.'
      : question.commonMistake,
    markedForReview,
  };
}

export function gradeSubjectiveKeywordFallback(
  question: ExamQuestion,
  studentAnswer: string,
  markedForReview = false
): ExamQuestionResult {
  const trimmed = studentAnswer.trim();
  if (!trimmed) {
    return {
      questionId: question.id,
      questionNumber: question.questionNumber,
      questionType: question.questionType,
      difficulty: question.difficulty,
      topic: question.topic,
      chapter: question.chapter,
      prompt: question.prompt,
      maxMarks: question.marks,
      marksAwarded: 0,
      isCorrect: false,
      isAttempted: false,
      evaluationMethod: 'unattempted',
      studentAnswerDisplay: 'Not attempted',
      expectedAnswerDisplay: question.correctAnswer,
      feedback: 'Question left unattempted (0 marks).',
      explanation: question.explanation,
      detectedErrorTag: '',
      misconceptionNote: '',
      markedForReview,
    };
  }

  const normalized = normalizeText(trimmed);
  const keywords = (question.expectedKeywords || []).map(normalizeText).filter(Boolean);
  let ratio = 0;
  if (keywords.length > 0) {
    const matched = keywords.filter((kw) => normalized.includes(kw)).length;
    ratio = matched / keywords.length;
  } else {
    ratio = trimmed.length >= 40 ? 0.75 : trimmed.length >= 15 ? 0.5 : 0.25;
  }

  const awarded = Number((Math.round(ratio * question.marks * 2) / 2).toFixed(2));
  const isCorrect = ratio >= 0.7;

  return {
    questionId: question.id,
    questionNumber: question.questionNumber,
    questionType: question.questionType,
    difficulty: question.difficulty,
    topic: question.topic,
    chapter: question.chapter,
    prompt: question.prompt,
    maxMarks: question.marks,
    marksAwarded: Math.min(question.marks, Math.max(0, awarded)),
    isCorrect,
    isAttempted: true,
    evaluationMethod: 'ai-subjective-rubric',
    studentAnswerDisplay: trimmed,
    expectedAnswerDisplay: question.correctAnswer,
    feedback: isCorrect
      ? `Key concepts covered clearly (${awarded}/${question.marks} marks).`
      : `Partial credit (${awarded}/${question.marks}): include key points from the marking scheme.`,
    explanation: question.explanation,
    detectedErrorTag: isCorrect ? '' : question.errorTag || 'incomplete-explanation',
    misconceptionNote: isCorrect ? '' : question.commonMistake,
    markedForReview,
  };
}

export function computeExamBreakdowns(results: ExamQuestionResult[]): {
  totalMarks: number;
  marksObtained: number;
  percentage: number;
  attemptedCount: number;
  correctCount: number;
  incorrectCount: number;
  topicBreakdown: ExamTopicBreakdown[];
  difficultyBreakdown: ExamDifficultyBreakdown[];
  mistakeSummary: ExamMistakeEntry[];
  recommendedRevisionTopics: string[];
} {
  let totalMarks = 0;
  let rawMarksObtained = 0;
  let attemptedCount = 0;
  let correctCount = 0;
  let incorrectCount = 0;

  const topicMap = new Map<
    string,
    {
      topic: string;
      chapter: string;
      totalQuestions: number;
      correctCount: number;
      maxMarks: number;
      marksAwarded: number;
    }
  >();

  const diffMap = new Map<
    DifficultyTier,
    {
      difficulty: DifficultyTier;
      totalQuestions: number;
      correctCount: number;
      maxMarks: number;
      marksAwarded: number;
    }
  >();

  const mistakeMap = new Map<string, ExamMistakeEntry>();

  for (const r of results) {
    totalMarks += r.maxMarks;
    rawMarksObtained += r.marksAwarded;
    if (r.isAttempted) attemptedCount += 1;
    if (r.isCorrect) correctCount += 1;
    else if (r.isAttempted) incorrectCount += 1;

    const topicKey = r.topic.trim().toLowerCase();
    const existingTopic = topicMap.get(topicKey) || {
      topic: r.topic,
      chapter: r.chapter,
      totalQuestions: 0,
      correctCount: 0,
      maxMarks: 0,
      marksAwarded: 0,
    };
    existingTopic.totalQuestions += 1;
    if (r.isCorrect) existingTopic.correctCount += 1;
    existingTopic.maxMarks += r.maxMarks;
    existingTopic.marksAwarded += Math.max(0, r.marksAwarded);
    topicMap.set(topicKey, existingTopic);

    const existingDiff = diffMap.get(r.difficulty) || {
      difficulty: r.difficulty,
      totalQuestions: 0,
      correctCount: 0,
      maxMarks: 0,
      marksAwarded: 0,
    };
    existingDiff.totalQuestions += 1;
    if (r.isCorrect) existingDiff.correctCount += 1;
    existingDiff.maxMarks += r.maxMarks;
    existingDiff.marksAwarded += Math.max(0, r.marksAwarded);
    diffMap.set(r.difficulty, existingDiff);

    if (!r.isCorrect && r.isAttempted && r.detectedErrorTag) {
      const mKey = `${r.detectedErrorTag}::${topicKey}`;
      const prevM = mistakeMap.get(mKey);
      if (prevM) {
        prevM.count += 1;
      } else {
        mistakeMap.set(mKey, {
          errorTag: r.detectedErrorTag,
          topic: r.topic,
          chapter: r.chapter,
          count: 1,
          sampleMisconception:
            r.misconceptionNote || r.feedback || 'Review conceptual steps.',
        });
      }
    }
  }

  const marksObtained = Math.max(0, Number(rawMarksObtained.toFixed(2)));
  const percentage =
    totalMarks > 0 ? Math.min(100, Math.max(0, Math.round((marksObtained / totalMarks) * 100))) : 0;

  const topicBreakdown: ExamTopicBreakdown[] = Array.from(topicMap.values()).map((t) => ({
    ...t,
    marksAwarded: Number(t.marksAwarded.toFixed(2)),
    accuracyPercent:
      t.maxMarks > 0 ? Math.min(100, Math.round((t.marksAwarded / t.maxMarks) * 100)) : 0,
  }));

  const tierOrder: DifficultyTier[] = ['foundation', 'intermediate', 'board-challenge'];
  const difficultyBreakdown: ExamDifficultyBreakdown[] = tierOrder
    .filter((d) => diffMap.has(d))
    .map((d) => {
      const item = diffMap.get(d)!;
      return {
        ...item,
        marksAwarded: Number(item.marksAwarded.toFixed(2)),
        accuracyPercent:
          item.maxMarks > 0
            ? Math.min(100, Math.round((item.marksAwarded / item.maxMarks) * 100))
            : 0,
      };
    });

  const mistakeSummary = Array.from(mistakeMap.values()).sort((a, b) => b.count - a.count);
  const recommendedRevisionTopics = topicBreakdown
    .filter((t) => t.accuracyPercent < 75)
    .sort((a, b) => a.accuracyPercent - b.accuracyPercent)
    .map((t) => t.topic);

  return {
    totalMarks,
    marksObtained,
    percentage,
    attemptedCount,
    correctCount,
    incorrectCount,
    topicBreakdown,
    difficultyBreakdown,
    mistakeSummary,
    recommendedRevisionTopics,
  };
}

export function getQuestionPaletteStatus(
  question: ExamQuestion,
  answers: Record<string, ExamAnswerSubmission>,
  visitedIds: Set<string>,
  markedIds: Set<string>
): ExamQuestionStatus {
  const sub = answers[question.id];
  const answered = hasStudentProvidedAnswer(question, sub);
  const marked = markedIds.has(question.id);
  const visited = visitedIds.has(question.id);

  if (answered && marked) return 'answered-and-marked';
  if (marked) return 'marked-for-review';
  if (answered) return 'answered';
  if (visited) return 'unanswered';
  return 'not-visited';
}

export function formatExamTimer(remainingSeconds: number): string {
  const safe = Math.max(0, Math.floor(remainingSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

export interface AttemptComparisonSummary {
  previousCount: number;
  lastAttemptPercentage: number | null;
  deltaFromLast: number | null;
  bestPreviousPercentage: number | null;
  averagePreviousPercentage: number | null;
  trendLabel: 'first-attempt' | 'improved' | 'steady' | 'needs-review';
}

export function compareWithPreviousAttempts(
  current: ExamAttemptRecord,
  history: ExamAttemptRecord[]
): AttemptComparisonSummary {
  const prior = history
    .filter(
      (h) =>
        h.id !== current.id &&
        h.subject.trim().toLowerCase() === current.subject.trim().toLowerCase()
    )
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  if (prior.length === 0) {
    return {
      previousCount: 0,
      lastAttemptPercentage: null,
      deltaFromLast: null,
      bestPreviousPercentage: null,
      averagePreviousPercentage: null,
      trendLabel: 'first-attempt',
    };
  }

  const lastPct = prior[0].percentage;
  const delta = current.percentage - lastPct;
  const bestPct = Math.max(...prior.map((p) => p.percentage));
  const avgPct = Math.round(
    prior.reduce((acc, p) => acc + p.percentage, 0) / prior.length
  );

  let trendLabel: AttemptComparisonSummary['trendLabel'] = 'steady';
  if (delta >= 5) trendLabel = 'improved';
  else if (delta <= -5) trendLabel = 'needs-review';

  return {
    previousCount: prior.length,
    lastAttemptPercentage: lastPct,
    deltaFromLast: delta,
    bestPreviousPercentage: bestPct,
    averagePreviousPercentage: avgPct,
    trendLabel,
  };
}

export function mapExamResultToPracticeAttempts(
  attempt: ExamAttemptRecord
): PracticeAttemptRecord[] {
  return attempt.questionResults.map((r, idx) => {
    let mappedType: QuestionType = 'mcq';
    if (r.questionType === 'true-false') mappedType = 'true-false';
    else if (r.questionType === 'fill-blank') mappedType = 'fill-blank';
    else if (r.questionType === 'numerical') mappedType = 'numerical';
    else if (r.questionType === 'short-answer' || r.questionType === 'long-answer') {
      mappedType = 'short-answer';
    }

    const scoreRatio =
      r.maxMarks > 0
        ? Math.min(1, Math.max(0, Number((r.marksAwarded / r.maxMarks).toFixed(2))))
        : 0;

    return {
      id: sanitizeDocumentId(`${attempt.id}_q${idx + 1}`, 'epa'),
      userId: attempt.userId,
      subject: attempt.subject,
      chapter: r.chapter || attempt.chapter || attempt.subject,
      topic: r.topic,
      board: attempt.board,
      classGrade: attempt.classGrade,
      questionId: r.questionId,
      questionType: mappedType,
      difficulty: r.difficulty,
      prompt: r.prompt.slice(0, 1200),
      userAnswer: r.studentAnswerDisplay.slice(0, 1000),
      correctAnswer: r.expectedAnswerDisplay.slice(0, 1000),
      isCorrect: r.isCorrect,
      scoreRatio,
      timeSpentSeconds: Math.max(
        5,
        Math.round(attempt.elapsedSeconds / Math.max(1, attempt.totalQuestions))
      ),
      errorTag: r.detectedErrorTag.slice(0, 80),
      misconceptionNote: r.misconceptionNote.slice(0, 600),
      createdAt: attempt.submittedAt,
    };
  });
}

export function sanitizeExamAttemptForStorage(
  record: ExamAttemptRecord
): ExamAttemptRecord {
  const validIdRe = /^[a-zA-Z0-9_\-]{1,128}$/;
  const id = validIdRe.test(record.id)
    ? record.id
    : sanitizeDocumentId(record.id || '', 'exam');
  return {
    id,
    submissionId: record.submissionId.slice(0, 128),
    sessionId: record.sessionId.slice(0, 128),
    userId: record.userId.slice(0, 128),
    examId: record.examId.slice(0, 128),
    paperTitle: record.paperTitle.slice(0, 200),
    board: record.board,
    classGrade: record.classGrade,
    subject: record.subject.slice(0, 80),
    chapter: (record.chapter || '').slice(0, 160),
    examMode: record.examMode,
    language: record.language,
    isOfficialBoardExam: false,
    durationMinutes: Math.max(5, Math.min(240, Math.round(record.durationMinutes))),
    elapsedSeconds: Math.max(1, Math.min(18000, Math.round(record.elapsedSeconds))),
    timingStatus: record.timingStatus,
    totalQuestions: Math.max(1, Math.min(50, Math.round(record.totalQuestions))),
    attemptedCount: Math.max(0, Math.min(50, Math.round(record.attemptedCount))),
    correctCount: Math.max(0, Math.min(50, Math.round(record.correctCount))),
    incorrectCount: Math.max(0, Math.min(50, Math.round(record.incorrectCount))),
    totalMarks: Math.max(1, Math.min(500, Number(record.totalMarks.toFixed(2)))),
    marksObtained: Math.max(0, Math.min(500, Number(record.marksObtained.toFixed(2)))),
    percentage: Math.max(0, Math.min(100, Math.round(record.percentage))),
    questionResults: (record.questionResults || []).slice(0, 50).map((q) => ({
      ...q,
      questionId: q.questionId.slice(0, 64),
      topic: q.topic.slice(0, 160),
      chapter: q.chapter.slice(0, 160),
      prompt: q.prompt.slice(0, 1000),
      studentAnswerDisplay: q.studentAnswerDisplay.slice(0, 1000),
      expectedAnswerDisplay: q.expectedAnswerDisplay.slice(0, 1000),
      feedback: q.feedback.slice(0, 600),
      explanation: q.explanation.slice(0, 1200),
      detectedErrorTag: q.detectedErrorTag.slice(0, 80),
      misconceptionNote: q.misconceptionNote.slice(0, 500),
    })),
    topicBreakdown: (record.topicBreakdown || []).slice(0, 30).map((t) => ({
      ...t,
      topic: t.topic.slice(0, 160),
      chapter: t.chapter.slice(0, 160),
    })),
    difficultyBreakdown: (record.difficultyBreakdown || []).slice(0, 5),
    mistakeSummary: (record.mistakeSummary || []).slice(0, 20).map((m) => ({
      ...m,
      errorTag: m.errorTag.slice(0, 80),
      topic: m.topic.slice(0, 160),
      chapter: m.chapter.slice(0, 160),
      sampleMisconception: m.sampleMisconception.slice(0, 500),
    })),
    recommendedRevisionTopics: (record.recommendedRevisionTopics || [])
      .slice(0, 15)
      .map((s) => s.slice(0, 160)),
    submittedAt: record.submittedAt || new Date().toISOString(),
  };
}

export function buildExamPaperDisclaimer(board: string, classGrade: string): string {
  return `AI-Generated Practice Paper (${board} · ${classGrade}) — Simulated practice exam for self-assessment. Not an official board examination paper.`;
}

export function validatePaperShape(paper: ExamPaper): boolean {
  return (
    Boolean(paper?.id) &&
    Array.isArray(paper?.questions) &&
    paper.questions.length > 0 &&
    paper.isOfficialBoardExam === false
  );
}
