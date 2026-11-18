import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLearningRecommendations,
  calculateAdaptiveDifficulty,
  classifyMasteryStatus,
  gradePracticeAnswer,
  recomputeTopicMastery,
  sanitizeAttemptForStorage,
  sanitizeTopicMasteryForStorage,
} from './learningEngine';
import { PracticeAttemptRecord, PracticeQuestion } from '../types/phase4';

const sampleNumerical: PracticeQuestion = {
  id: 'q-num-1',
  questionType: 'numerical',
  difficulty: 'intermediate',
  subject: 'Physics',
  chapter: 'Light - Reflection and Refraction',
  topic: 'Lens Formula',
  prompt: 'An object is placed at 30 cm in front of a convex lens of focal length 15 cm. Find the image distance v (in cm).',
  correctAnswer: '30 cm',
  numericalValue: 30,
  numericalTolerance: 0.5,
  unit: 'cm',
  hint: 'Use 1/f = 1/v - 1/u with u = -30 cm and f = +15 cm.',
  explanation: '1/15 = 1/v - 1/(-30) => 1/v = 1/15 - 1/30 = 1/30 => v = +30 cm.',
  errorTag: 'sign-convention-error',
  commonMistake: 'Forgetting that u is negative on the left of the lens.',
};

test('gradePracticeAnswer handles MCQ, True/False, Fill-in-Blank, Numerical (tolerance + sign flip), and Short Answer', () => {
  const mcq: PracticeQuestion = {
    ...sampleNumerical,
    id: 'q-mcq-1',
    questionType: 'mcq',
    options: ['Convex lens', 'Concave lens', 'Plane mirror', 'Glass slab'],
    correctAnswer: 'Convex lens',
  };
  assert.equal(gradePracticeAnswer(mcq, 'convex lens').isCorrect, true);
  assert.equal(gradePracticeAnswer(mcq, 'Concave lens').isCorrect, false);

  const tf: PracticeQuestion = {
    ...sampleNumerical,
    id: 'q-tf-1',
    questionType: 'true-false',
    options: ['True', 'False'],
    correctAnswer: 'True',
  };
  assert.equal(gradePracticeAnswer(tf, 'true').isCorrect, true);
  assert.equal(gradePracticeAnswer(tf, 'False').isCorrect, false);

  const fib: PracticeQuestion = {
    ...sampleNumerical,
    id: 'q-fib-1',
    questionType: 'fill-blank',
    correctAnswer: 'Dioptre',
    acceptableAnswers: ['D', 'diopter'],
  };
  assert.equal(gradePracticeAnswer(fib, 'diopter.').isCorrect, true);
  assert.equal(gradePracticeAnswer(fib, 'Watt').isCorrect, false);

  // Numerical within tolerance + optional unit
  assert.equal(gradePracticeAnswer(sampleNumerical, '30.2 cm').isCorrect, true);
  assert.equal(gradePracticeAnswer(sampleNumerical, '30').isCorrect, true);
  // Numerical sign flip triggers specific sign-convention-error tag
  const signFlipRes = gradePracticeAnswer(sampleNumerical, '-30 cm');
  assert.equal(signFlipRes.isCorrect, false);
  assert.equal(signFlipRes.detectedErrorTag, 'sign-convention-error');

  // Short-answer keyword evaluation
  const sa: PracticeQuestion = {
    ...sampleNumerical,
    id: 'q-sa-1',
    questionType: 'short-answer',
    correctAnswer: 'Total internal reflection occurs when light travels from denser to rarer medium above critical angle.',
    expectedKeywords: ['denser', 'rarer', 'critical angle'],
  };
  assert.equal(
    gradePracticeAnswer(sa, 'Light travels from a denser medium to a rarer medium beyond the critical angle.').isCorrect,
    true
  );
  assert.equal(gradePracticeAnswer(sa, 'Light reflects from mirror').isCorrect, false);
});

test('non-punitive single-miss rule never marks a student needs-revision after 1 wrong answer', () => {
  const singleMissAttempt: PracticeAttemptRecord = {
    id: 'att_single_1',
    userId: 'stu_1',
    subject: 'Science',
    chapter: 'Light',
    topic: 'Snells Law',
    questionType: 'mcq',
    difficulty: 'intermediate',
    isCorrect: false,
    scoreRatio: 0,
    timeSpentSeconds: 24,
    errorTag: 'refractive-index-inversion',
    misconceptionNote: 'Inverted n2/n1 ratio.',
    createdAt: '2026-11-10T10:00:00.000Z',
  };

  const singleResult = recomputeTopicMastery({
    existing: null,
    userId: 'stu_1',
    subject: 'Science',
    chapter: 'Light',
    topic: 'Snells Law',
    allTopicAttempts: [singleMissAttempt],
    nowIso: '2026-11-10T10:00:00.000Z',
  });

  assert.notEqual(singleResult.status, 'needs-revision');
  assert.equal(singleResult.status, 'insufficient-data');

  // Even 2 attempts with 1 right and 1 wrong should be 'developing', not 'needs-revision'
  const secondCorrect: PracticeAttemptRecord = {
    ...singleMissAttempt,
    id: 'att_single_2',
    isCorrect: true,
    scoreRatio: 1,
    errorTag: undefined,
    misconceptionNote: undefined,
    createdAt: '2026-11-10T10:05:00.000Z',
  };

  const twoAttemptsResult = recomputeTopicMastery({
    existing: singleResult,
    userId: 'stu_1',
    subject: 'Science',
    chapter: 'Light',
    topic: 'Snells Law',
    allTopicAttempts: [singleMissAttempt, secondCorrect],
    nowIso: '2026-11-10T10:05:00.000Z',
  });

  assert.equal(twoAttemptsResult.status, 'developing');
});

test('recurring conceptual error escalates to needs-revision and lowers recommended difficulty', () => {
  const baseAttempt = (idx: number, isCorrect: boolean, errorTag?: string): PracticeAttemptRecord => ({
    id: `att_${idx}`,
    userId: 'stu_1',
    subject: 'Science',
    chapter: 'Light',
    topic: 'Mirror Formula',
    questionType: 'numerical',
    difficulty: 'intermediate',
    isCorrect,
    scoreRatio: isCorrect ? 1 : 0,
    timeSpentSeconds: 30,
    errorTag,
    misconceptionNote: errorTag ? 'Confused concave vs convex focal length sign.' : undefined,
    createdAt: `2026-11-10T10:0${idx}:00.000Z`,
  });

  const attempts = [
    baseAttempt(1, false, 'sign-convention-error'),
    baseAttempt(2, false, 'sign-convention-error'),
    baseAttempt(3, false, 'sign-convention-error'),
  ];

  const mastery = recomputeTopicMastery({
    existing: null,
    userId: 'stu_1',
    subject: 'Science',
    chapter: 'Light',
    topic: 'Mirror Formula',
    allTopicAttempts: attempts,
    nowIso: '2026-11-10T10:10:00.000Z',
  });

  assert.equal(mastery.status, 'needs-revision');
  assert.equal(mastery.currentRecommendedDifficulty, 'foundation');
  assert.equal(mastery.recurringErrors[0].errorTag, 'sign-convention-error');
  assert.equal(mastery.recurringErrors[0].count, 3);

  const recs = buildLearningRecommendations([mastery], 2);
  assert.equal(recs[0].actionType, 'remediate');
  assert.equal(recs[0].errorTag, 'sign-convention-error');
});

test('high sustained performance unlocks mastered status and board-challenge difficulty', () => {
  const makeGood = (idx: number): PracticeAttemptRecord => ({
    id: `att_good_${idx}`,
    userId: 'stu_1',
    subject: 'Mathematics',
    chapter: 'Real Numbers',
    topic: 'HCF & LCM',
    questionType: 'mcq',
    difficulty: 'intermediate',
    isCorrect: true,
    scoreRatio: 1,
    timeSpentSeconds: 20,
    createdAt: `2026-11-10T11:0${idx}:00.000Z`,
  });

  const attempts = [makeGood(1), makeGood(2), makeGood(3), makeGood(4)];
  const mastery = recomputeTopicMastery({
    existing: null,
    userId: 'stu_1',
    subject: 'Mathematics',
    chapter: 'Real Numbers',
    topic: 'HCF & LCM',
    allTopicAttempts: attempts,
    nowIso: '2026-11-10T11:05:00.000Z',
  });

  assert.equal(mastery.status, 'mastered');
  assert.equal(mastery.currentRecommendedDifficulty, 'board-challenge');
  assert.equal(classifyMasteryStatus(4, 95, []), 'mastered');
  assert.equal(calculateAdaptiveDifficulty(mastery, attempts).difficulty, 'board-challenge');
});

test('storage sanitizers enforce strict Firestore rules bounds and ID patterns', () => {
  const dirtyAttempt = sanitizeAttemptForStorage({
    id: 'bad id with spaces / special chars!',
    userId: 'user_123',
    subject: 'Physics',
    topic: 'Electrostatics',
    questionType: 'numerical',
    difficulty: 'intermediate',
    isCorrect: false,
    timeSpentSeconds: 99999,
    prompt: 'x'.repeat(2000),
    createdAt: '2026-11-10T12:00:00.000Z',
  });
  assert.match(dirtyAttempt.id, /^[a-zA-Z0-9_\-]+$/);
  assert.equal(dirtyAttempt.timeSpentSeconds, 7200);
  assert.equal((dirtyAttempt.prompt || '').length, 1200);

  const dirtyMastery = sanitizeTopicMasteryForStorage({
    id: 'ignored',
    userId: 'user_123',
    subject: 'Physics',
    topic: 'Gauss Law!',
    attemptsCount: 5,
    correctCount: 4,
    recentAccuracy: 120,
    weightedMasteryScore: 105,
    status: 'mastered',
    currentRecommendedDifficulty: 'board-challenge',
    totalTimeSpentSeconds: 100,
    recurringErrors: Array.from({ length: 15 }, (_, i) => ({
      errorTag: `err_${i}`,
      count: 1,
      lastSeenAt: '2026-11-10T12:00:00.000Z',
      sampleMisconception: 'note',
    })),
    revisionCount: 1,
    historySnapshots: Array.from({ length: 25 }, (_, i) => ({
      date: `2026-11-${String(i + 1).padStart(2, '0')}`,
      masteryScore: 80,
      accuracyRate: 80,
      attemptsCount: i + 1,
    })),
    updatedAt: '2026-11-10T12:00:00.000Z',
  });
  assert.match(dirtyMastery.id, /^[a-zA-Z0-9_\-]+$/);
  assert.equal(dirtyMastery.weightedMasteryScore, 100);
  assert.equal(dirtyMastery.recurringErrors.length, 10);
  assert.equal(dirtyMastery.historySnapshots.length, 20);
});
