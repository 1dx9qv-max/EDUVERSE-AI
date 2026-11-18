import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareWithPreviousAttempts,
  computeExamBreakdowns,
  formatExamTimer,
  getQuestionPaletteStatus,
  gradeObjectiveExamQuestion,
  gradeSubjectiveKeywordFallback,
  mapExamResultToPracticeAttempts,
  sanitizeExamAttemptForStorage,
} from './examEngine';
import {
  ExamAnswerSubmission,
  ExamAttemptRecord,
  ExamQuestion,
} from '../types/phase5';

const baseQuestion = (overrides: Partial<ExamQuestion>): ExamQuestion => ({
  id: 'q1',
  questionNumber: 1,
  section: 'Section A',
  questionType: 'mcq',
  difficulty: 'intermediate',
  subject: 'Physics',
  chapter: 'Light - Reflection and Refraction',
  topic: 'Lens Formula',
  marks: 2,
  negativeMarks: 0.5,
  prompt: 'Sample question prompt',
  options: ['A', 'B', 'C', 'D'],
  correctAnswer: 'B',
  explanation: 'Explanation text',
  errorTag: 'formula-confusion',
  commonMistake: 'Common mistake text',
  ...overrides,
});

test('gradeObjectiveExamQuestion evaluates MCQ, MSQ (exact + partial), True/False, Fill-blank, and Numerical with sign-flip detection', () => {
  const mcq = baseQuestion({ questionType: 'mcq', marks: 1, negativeMarks: 0.25, correctAnswer: '20 cm' });
  assert.equal(
    gradeObjectiveExamQuestion(mcq, { questionId: 'q1', selectedOption: '20 cm' }, true).marksAwarded,
    1
  );
  assert.equal(
    gradeObjectiveExamQuestion(mcq, { questionId: 'q1', selectedOption: '10 cm' }, true).marksAwarded,
    -0.25
  );
  assert.equal(
    gradeObjectiveExamQuestion(mcq, { questionId: 'q1', selectedOption: '10 cm' }, false).marksAwarded,
    0
  );

  // Multiple Select
  const msq = baseQuestion({
    id: 'q2',
    questionType: 'multiple-select',
    marks: 2,
    negativeMarks: 0.5,
    correctAnswer: 'Real, Inverted',
    correctAnswers: ['Real', 'Inverted'],
  });
  const msqExact = gradeObjectiveExamQuestion(
    msq,
    { questionId: 'q2', selectedOptions: ['Inverted', 'Real'] },
    true
  );
  assert.equal(msqExact.isCorrect, true);
  assert.equal(msqExact.marksAwarded, 2);

  const msqPartial = gradeObjectiveExamQuestion(
    msq,
    { questionId: 'q2', selectedOptions: ['Real'] },
    true
  );
  assert.equal(msqPartial.isCorrect, false);
  assert.equal(msqPartial.marksAwarded, 1);

  const msqWrong = gradeObjectiveExamQuestion(
    msq,
    { questionId: 'q2', selectedOptions: ['Real', 'Virtual'] },
    true
  );
  assert.equal(msqWrong.marksAwarded, -0.5);

  // Numerical with sign-flip check
  const num = baseQuestion({
    id: 'q3',
    questionType: 'numerical',
    marks: 3,
    negativeMarks: 0,
    correctAnswer: '-15 cm',
    numericalValue: -15,
    numericalTolerance: 0.2,
    unit: 'cm',
  });
  assert.equal(
    gradeObjectiveExamQuestion(num, { questionId: 'q3', textAnswer: '-15 cm' }, false).isCorrect,
    true
  );
  const flipped = gradeObjectiveExamQuestion(
    num,
    { questionId: 'q3', textAnswer: '15 cm' },
    false
  );
  assert.equal(flipped.isCorrect, false);
  assert.equal(flipped.detectedErrorTag, 'sign-convention-error');

  // Fill in the blank
  const fib = baseQuestion({
    id: 'q4',
    questionType: 'fill-blank',
    marks: 1,
    negativeMarks: 0,
    correctAnswer: 'Snell',
    acceptableAnswers: ["Snell's Law", 'Snells Law'],
  });
  assert.equal(
    gradeObjectiveExamQuestion(fib, { questionId: 'q4', textAnswer: "Snell's Law." }, false).isCorrect,
    true
  );
});

test('gradeSubjectiveKeywordFallback awards rubric marks and handles unattempted gracefully', () => {
  const longQ = baseQuestion({
    id: 'q5',
    questionType: 'long-answer',
    marks: 5,
    expectedKeywords: ['incident ray', 'normal', 'refracted ray', 'sine'],
  });
  const unattempted = gradeSubjectiveKeywordFallback(longQ, '   ');
  assert.equal(unattempted.isAttempted, false);
  assert.equal(unattempted.marksAwarded, 0);

  const strong = gradeSubjectiveKeywordFallback(
    longQ,
    'The incident ray, the normal at the point of incidence, and the refracted ray all lie in the same plane, and the ratio of sine of incidence to refraction is constant.'
  );
  assert.equal(strong.isCorrect, true);
  assert.equal(strong.marksAwarded, 5);
});

test('computeExamBreakdowns aggregates topic, difficulty, mistakes, and revision recommendations cleanly', () => {
  const q1 = baseQuestion({ id: 'q1', topic: 'Lens Formula', difficulty: 'foundation', marks: 2 });
  const q2 = baseQuestion({ id: 'q2', topic: 'Refractive Index', difficulty: 'board-challenge', marks: 4, correctAnswer: '1.5' });

  const r1 = gradeObjectiveExamQuestion(q1, { questionId: 'q1', selectedOption: 'B' }, false);
  const r2 = gradeObjectiveExamQuestion(q2, { questionId: 'q2', selectedOption: 'A' }, false);

  const summary = computeExamBreakdowns([r1, r2]);
  assert.equal(summary.totalMarks, 6);
  assert.equal(summary.marksObtained, 2);
  assert.equal(summary.percentage, 33);
  assert.equal(summary.correctCount, 1);
  assert.equal(summary.incorrectCount, 1);
  assert.equal(summary.topicBreakdown.length, 2);
  assert.equal(summary.difficultyBreakdown.length, 2);
  assert.equal(summary.mistakeSummary[0]?.topic, 'Refractive Index');
  assert.deepEqual(summary.recommendedRevisionTopics, ['Refractive Index']);
});

test('question palette status, timer formatting, previous attempt comparison, and storage sanitization work accurately', () => {
  const q = baseQuestion({ id: 'q10' });
  const answers: Record<string, ExamAnswerSubmission> = {};
  const visited = new Set<string>();
  const marked = new Set<string>();

  assert.equal(getQuestionPaletteStatus(q, answers, visited, marked), 'not-visited');
  visited.add('q10');
  assert.equal(getQuestionPaletteStatus(q, answers, visited, marked), 'unanswered');
  marked.add('q10');
  assert.equal(getQuestionPaletteStatus(q, answers, visited, marked), 'marked-for-review');
  answers['q10'] = { questionId: 'q10', selectedOption: 'B' };
  assert.equal(getQuestionPaletteStatus(q, answers, visited, marked), 'answered-and-marked');
  marked.delete('q10');
  assert.equal(getQuestionPaletteStatus(q, answers, visited, marked), 'answered');

  assert.equal(formatExamTimer(3665), '01:01:05');
  assert.equal(formatExamTimer(125), '02:05');

  const baseAttempt: ExamAttemptRecord = {
    id: 'exam 1/2!',
    submissionId: 'sub_1',
    sessionId: 'sess_1',
    userId: 'u1',
    examId: 'ex1',
    paperTitle: 'Physics Mock',
    board: 'CBSE',
    classGrade: 'Class 10',
    subject: 'Physics',
    chapter: 'Light',
    examMode: 'chapter-test',
    language: 'English',
    isOfficialBoardExam: false,
    durationMinutes: 45,
    elapsedSeconds: 1800,
    timingStatus: 'on-time',
    totalQuestions: 2,
    attemptedCount: 2,
    correctCount: 2,
    incorrectCount: 0,
    totalMarks: 10,
    marksObtained: 9,
    percentage: 90,
    questionResults: [],
    topicBreakdown: [],
    difficultyBreakdown: [],
    mistakeSummary: [],
    recommendedRevisionTopics: [],
    submittedAt: '2026-11-14T10:00:00.000Z',
  };

  const prevAttempt: ExamAttemptRecord = {
    ...baseAttempt,
    id: 'exam_prev',
    percentage: 72,
    marksObtained: 7.2,
    submittedAt: '2026-11-12T10:00:00.000Z',
  };

  const cmp = compareWithPreviousAttempts(baseAttempt, [prevAttempt]);
  assert.equal(cmp.previousCount, 1);
  assert.equal(cmp.deltaFromLast, 18);
  assert.equal(cmp.trendLabel, 'improved');

  const sanitized = sanitizeExamAttemptForStorage(baseAttempt);
  assert.match(sanitized.id, /^[a-zA-Z0-9_\-]+$/);
  assert.equal(sanitized.isOfficialBoardExam, false);

  const mapped = mapExamResultToPracticeAttempts({
    ...baseAttempt,
    questionResults: [
      gradeObjectiveExamQuestion(baseQuestion({ id: 'q1', questionType: 'multiple-select', correctAnswers: ['A', 'B'] }), { questionId: 'q1', selectedOptions: ['A', 'B'] }, false),
    ],
  });
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].questionType, 'mcq');
});
