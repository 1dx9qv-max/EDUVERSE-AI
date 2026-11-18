import type {
  DifficultyTier,
  LessonRecommendation,
  MasteryStatus,
  PracticeAttemptRecord,
  PracticeGenerateRequest,
  PracticeQuestion,
  ProgressSnapshot,
  QuestionType,
  RecurringErrorEntry,
  TopicMasteryRecord,
} from '../types/phase4.ts';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeDocumentId(raw: string, prefix = 'rec'): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  const candidate = cleaned ? `${prefix}_${cleaned}` : `${prefix}_${Date.now()}`;
  return VALID_ID_REGEX.test(candidate) ? candidate.slice(0, 128) : `${prefix}_item`;
}

export function buildTopicMasteryId(userId: string, subject: string, topic: string): string {
  const uidPart = userId.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 24) || 'user';
  const subPart = subject.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'sub';
  const topPart = topic.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 56) || 'topic';
  return `tm_${uidPart}_${subPart}_${topPart}`.slice(0, 128);
}

export interface GradeResult {
  isCorrect: boolean;
  scoreRatio: number;
  feedback: string;
  detectedErrorTag: string;
  misconceptionNote: string;
}

function normalizeAnswerText(val: string): string {
  return val
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;!?]+$/g, '');
}

function extractNumericAndUnit(input: string): { value: number | null; unit: string } {
  const trimmed = input.trim();
  if (!trimmed) return { value: null, unit: '' };
  // Support fractions like 3/4 or standard decimals/scientific notation
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

export function gradePracticeAnswer(question: PracticeQuestion, userAnswerRaw: string): GradeResult {
  const userAnswer = userAnswerRaw.trim();
  if (!userAnswer) {
    return {
      isCorrect: false,
      scoreRatio: 0,
      feedback: 'No answer submitted yet. Try applying the core concept first.',
      detectedErrorTag: question.errorTag || 'unanswered-concept',
      misconceptionNote: question.commonMistake || 'Skipped response.',
    };
  }

  if (question.questionType === 'mcq' || question.questionType === 'true-false') {
    const isCorrect = normalizeAnswerText(userAnswer) === normalizeAnswerText(question.correctAnswer);
    return {
      isCorrect,
      scoreRatio: isCorrect ? 1 : 0,
      feedback: isCorrect
        ? 'Correct! Clean conceptual reasoning.'
        : `Not quite — the expected answer is "${question.correctAnswer}".`,
      detectedErrorTag: isCorrect ? '' : question.errorTag || 'concept-confusion',
      misconceptionNote: isCorrect ? '' : question.commonMistake,
    };
  }

  if (question.questionType === 'fill-blank') {
    const normalizedInput = normalizeAnswerText(userAnswer);
    const candidates = [question.correctAnswer, ...(question.acceptableAnswers || [])].map(normalizeAnswerText);
    const isCorrect = candidates.includes(normalizedInput);
    return {
      isCorrect,
      scoreRatio: isCorrect ? 1 : 0,
      feedback: isCorrect
        ? 'Exact match! Key terminology recalled accurately.'
        : `Expected "${question.correctAnswer}". Review the exact term or sign.`,
      detectedErrorTag: isCorrect ? '' : question.errorTag || 'terminology-gap',
      misconceptionNote: isCorrect ? '' : question.commonMistake,
    };
  }

  if (question.questionType === 'numerical') {
    const parsedUser = extractNumericAndUnit(userAnswer);
    const expectedParsed =
      typeof question.numericalValue === 'number' && Number.isFinite(question.numericalValue)
        ? { value: question.numericalValue, unit: (question.unit || '').trim().toLowerCase().replace(/\s+/g, '') }
        : extractNumericAndUnit(question.correctAnswer);

    if (parsedUser.value === null || expectedParsed.value === null) {
      return {
        isCorrect: false,
        scoreRatio: 0,
        feedback: `Enter a numerical value${question.unit ? ` (e.g., with ${question.unit})` : ''}. Expected: ${question.correctAnswer}.`,
        detectedErrorTag: question.errorTag || 'calculation-format-error',
        misconceptionNote: question.commonMistake,
      };
    }

    const baseTolerance =
      typeof question.numericalTolerance === 'number' && question.numericalTolerance >= 0
        ? question.numericalTolerance
        : Math.max(0.05, Math.abs(expectedParsed.value) * 0.02);

    const diff = Math.abs(parsedUser.value - expectedParsed.value);
    const withinTolerance = diff <= baseTolerance;

    if (!withinTolerance) {
      const signFlipOnly =
        expectedParsed.value !== 0 &&
        Math.abs(parsedUser.value + expectedParsed.value) <= baseTolerance;

      return {
        isCorrect: false,
        scoreRatio: 0,
        feedback: signFlipOnly
          ? `Check your sign convention! Magnitude matches, but sign should give ${question.correctAnswer}.`
          : `Calculated ${parsedUser.value}, while expected answer is ${question.correctAnswer}.`,
        detectedErrorTag: signFlipOnly ? 'sign-convention-error' : question.errorTag || 'numerical-calculation-error',
        misconceptionNote: signFlipOnly
          ? 'Sign convention flip during substitution or formula rearrangement.'
          : question.commonMistake,
      };
    }

    // Check unit consistency if user explicitly provided a conflicting unit
    if (
      expectedParsed.unit &&
      parsedUser.unit &&
      parsedUser.unit !== expectedParsed.unit &&
      !expectedParsed.unit.includes(parsedUser.unit) &&
      !parsedUser.unit.includes(expectedParsed.unit)
    ) {
      return {
        isCorrect: false,
        scoreRatio: 0.5,
        feedback: `Numeric value is right, but check the SI unit (expected ${question.unit || expectedParsed.unit}).`,
        detectedErrorTag: 'unit-conversion-error',
        misconceptionNote: `Provided unit "${parsedUser.unit}" instead of "${expectedParsed.unit}".`,
      };
    }

    return {
      isCorrect: true,
      scoreRatio: 1,
      feedback: 'Spot-on numerical calculation!',
      detectedErrorTag: '',
      misconceptionNote: '',
    };
  }

  // Short-answer deterministic fallback evaluator (can be enhanced by AI short-answer endpoint)
  const normalized = normalizeAnswerText(userAnswer);
  const keywords = (question.expectedKeywords && question.expectedKeywords.length > 0
    ? question.expectedKeywords
    : question.correctAnswer
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .slice(0, 4)
  ).map((k) => normalizeAnswerText(k));

  if (keywords.length === 0) {
    const isCorrect = normalized.length >= 12;
    return {
      isCorrect,
      scoreRatio: isCorrect ? 0.85 : 0.3,
      feedback: isCorrect
        ? 'Good explanation covering the main idea.'
        : 'Try elaborating with the core principle and cause-effect link.',
      detectedErrorTag: isCorrect ? '' : question.errorTag || 'incomplete-reasoning',
      misconceptionNote: isCorrect ? '' : question.commonMistake,
    };
  }

  const matchedCount = keywords.filter((kw) => kw && normalized.includes(kw)).length;
  const ratio = matchedCount / keywords.length;
  const isCorrect = ratio >= 0.55;
  return {
    isCorrect,
    scoreRatio: Number(Math.min(1, Math.max(0.2, ratio)).toFixed(2)),
    feedback: isCorrect
      ? `Solid explanation (${matchedCount}/${keywords.length} key ideas covered).`
      : `Partial answer — try including key points like ${keywords.slice(0, 3).join(', ')}.`,
    detectedErrorTag: isCorrect ? '' : question.errorTag || 'incomplete-concept-explanation',
    misconceptionNote: isCorrect ? '' : question.commonMistake,
  };
}

export function getDifficultyWeight(difficulty: DifficultyTier): number {
  if (difficulty === 'board-challenge') return 1.15;
  if (difficulty === 'intermediate') return 1.0;
  return 0.85;
}

/**
 * Transparent topic mastery classification.
 * CRITICAL RULE: A single incorrect answer MUST NEVER label a student weak ('needs-revision').
 */
export function classifyMasteryStatus(
  attemptsCount: number,
  weightedMasteryScore: number,
  recurringErrors: RecurringErrorEntry[]
): MasteryStatus {
  if (attemptsCount < 2) {
    return 'insufficient-data';
  }

  const maxErrorRepeat = recurringErrors.reduce((max, item) => Math.max(max, item.count), 0);

  if (attemptsCount >= 3 && weightedMasteryScore >= 80 && maxErrorRepeat < 2) {
    return 'mastered';
  }

  // Require multiple attempts (>= 3) OR repeated same error (>= 2) before flagging needs-revision
  if ((attemptsCount >= 3 && weightedMasteryScore < 60) || (attemptsCount >= 2 && maxErrorRepeat >= 2)) {
    return 'needs-revision';
  }

  return 'developing';
}

export function calculateAdaptiveDifficulty(
  mastery: TopicMasteryRecord | null | undefined,
  recentAttempts: PracticeAttemptRecord[] = []
): { difficulty: DifficultyTier; reason: string; focusErrorTag?: string } {
  const sortedRecent = [...recentAttempts]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const recurringTop = mastery?.recurringErrors
    ?.slice()
    .sort((a, b) => b.count - a.count)[0];

  if (!mastery || mastery.attemptsCount === 0) {
    return {
      difficulty: 'intermediate',
      reason: 'Starting at standard board level while building your first evidence points.',
    };
  }

  if (mastery.attemptsCount < 3) {
    const misses = sortedRecent.filter((a) => !a.isCorrect).length;
    if (misses >= 2) {
      return {
        difficulty: 'foundation',
        reason: 'Stepping gently to Foundation questions to strengthen core intuition before advancing.',
        focusErrorTag: recurringTop?.errorTag,
      };
    }
    return {
      difficulty: mastery.currentRecommendedDifficulty || 'intermediate',
      reason: 'Early signal recorded — keeping balanced pacing without jumping to conclusions.',
    };
  }

  const last3 = sortedRecent.slice(0, 3);
  const last3Correct = last3.filter((a) => a.isCorrect).length;

  if (mastery.weightedMasteryScore >= 82 && last3Correct >= 2) {
    return {
      difficulty: 'board-challenge',
      reason: `High mastery (${Math.round(mastery.weightedMasteryScore)}%) unlocked Board Challenge questions.`,
    };
  }

  if (mastery.status === 'needs-revision' || (last3.length >= 2 && last3Correct === 0)) {
    return {
      difficulty: 'foundation',
      reason: recurringTop
        ? `Focusing on Foundation clarity to resolve "${recurringTop.errorTag.replace(/-/g, ' ')}".`
        : 'Focusing on Foundation questions to rebuild accuracy step by step.',
      focusErrorTag: recurringTop?.errorTag,
    };
  }

  return {
    difficulty: 'intermediate',
    reason: 'Calibrated to Intermediate board standard based on steady progress.',
    focusErrorTag: recurringTop && recurringTop.count >= 2 ? recurringTop.errorTag : undefined,
  };
}

export function recomputeTopicMastery(params: {
  existing: TopicMasteryRecord | null | undefined;
  userId: string;
  subject: string;
  chapter: string;
  topic: string;
  allTopicAttempts: PracticeAttemptRecord[];
  revisionIncrement?: number;
  nowIso?: string;
}): TopicMasteryRecord {
  const nowIso = params.nowIso || new Date().toISOString();
  const sortedAttempts = [...params.allTopicAttempts].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );

  const attemptsCount = sortedAttempts.length;
  const correctCount = sortedAttempts.filter((a) => a.isCorrect).length;
  const totalTimeSpentSeconds = sortedAttempts.reduce((sum, a) => sum + Math.max(0, a.timeSpentSeconds || 0), 0);

  // Recent accuracy looks at last 6 attempts
  const recentWindow = sortedAttempts.slice(-6);
  const recentAccuracy =
    recentWindow.length > 0
      ? Number(
          (
            (recentWindow.reduce((sum, a) => sum + (typeof a.scoreRatio === 'number' ? a.scoreRatio : a.isCorrect ? 1 : 0), 0) /
              recentWindow.length) *
            100
          ).toFixed(1)
        )
      : params.existing?.recentAccuracy ?? 0;

  // Exponentially recency-weighted + difficulty-weighted mastery score (0..100)
  let weightedSum = 0;
  let weightTotal = 0;
  sortedAttempts.forEach((attempt, idx) => {
    const recencyWeight = 0.65 + (idx / Math.max(1, sortedAttempts.length)) * 0.7;
    const diffWeight = getDifficultyWeight(attempt.difficulty);
    const w = recencyWeight * diffWeight;
    const outcome = typeof attempt.scoreRatio === 'number' ? attempt.scoreRatio : attempt.isCorrect ? 1 : 0;
    weightedSum += outcome * 100 * w;
    weightTotal += w;
  });

  const revisionCount = (params.existing?.revisionCount || 0) + (params.revisionIncrement || 0);
  const revisionBonus = Math.min(8, revisionCount * 2);

  const rawWeightedScore =
    weightTotal > 0
      ? Math.min(100, Math.max(0, weightedSum / weightTotal + revisionBonus))
      : params.existing?.weightedMasteryScore || 0;
  const weightedMasteryScore = Number(rawWeightedScore.toFixed(1));

  // Aggregate recurring error tags from incorrect attempts
  const errorMap = new Map<string, RecurringErrorEntry>();
  for (const att of sortedAttempts) {
    if (!att.isCorrect && att.errorTag && att.errorTag.trim()) {
      const key = att.errorTag.trim().slice(0, 80);
      const prev = errorMap.get(key);
      errorMap.set(key, {
        errorTag: key,
        count: (prev?.count || 0) + 1,
        lastSeenAt: att.createdAt,
        sampleMisconception:
          (att.misconceptionNote || prev?.sampleMisconception || 'Review conceptual reasoning for this step.').slice(0, 260),
      });
    }
  }

  const recurringErrors = Array.from(errorMap.values())
    .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, 10);

  const status = classifyMasteryStatus(attemptsCount, weightedMasteryScore, recurringErrors);

  const provisionalRecord: TopicMasteryRecord = {
    id: params.existing?.id || buildTopicMasteryId(params.userId, params.subject, params.topic),
    userId: params.userId,
    subject: params.subject,
    chapter: params.chapter || params.existing?.chapter || params.topic,
    topic: params.topic,
    attemptsCount,
    correctCount,
    recentAccuracy,
    weightedMasteryScore,
    status,
    currentRecommendedDifficulty: 'intermediate',
    totalTimeSpentSeconds,
    recurringErrors,
    revisionCount,
    lastPracticedAt: sortedAttempts[sortedAttempts.length - 1]?.createdAt || params.existing?.lastPracticedAt,
    lastRevisedAt: params.revisionIncrement ? nowIso : params.existing?.lastRevisedAt,
    historySnapshots: params.existing?.historySnapshots ? [...params.existing.historySnapshots] : [],
    updatedAt: nowIso,
  };

  const nextAdaptive = calculateAdaptiveDifficulty(provisionalRecord, sortedAttempts);
  provisionalRecord.currentRecommendedDifficulty = nextAdaptive.difficulty;

  // Append snapshot if attempt or revision happened
  if (sortedAttempts.length > 0 || params.revisionIncrement) {
    const newSnapshot: ProgressSnapshot = {
      date: nowIso.slice(0, 10),
      masteryScore: weightedMasteryScore,
      accuracyRate: recentAccuracy,
      attemptsCount,
    };
    const snapshots = [...provisionalRecord.historySnapshots];
    const lastSnap = snapshots[snapshots.length - 1];
    if (lastSnap && lastSnap.date === newSnapshot.date && lastSnap.attemptsCount === newSnapshot.attemptsCount) {
      snapshots[snapshots.length - 1] = newSnapshot;
    } else {
      snapshots.push(newSnapshot);
    }
    provisionalRecord.historySnapshots = snapshots.slice(-20);
  }

  return provisionalRecord;
}

export interface AggregatedErrorPattern {
  errorTag: string;
  subject: string;
  topic: string;
  chapter: string;
  count: number;
  lastSeenAt: string;
  sampleMisconception: string;
}

export function aggregateErrorPatterns(masteryList: TopicMasteryRecord[]): AggregatedErrorPattern[] {
  const results: AggregatedErrorPattern[] = [];
  for (const tm of masteryList) {
    for (const err of tm.recurringErrors || []) {
      results.push({
        errorTag: err.errorTag,
        subject: tm.subject,
        topic: tm.topic,
        chapter: tm.chapter || tm.topic,
        count: err.count,
        lastSeenAt: err.lastSeenAt,
        sampleMisconception: err.sampleMisconception,
      });
    }
  }
  return results.sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function buildLearningRecommendations(
  masteryList: TopicMasteryRecord[],
  dueFlashcardsCount: number
): LessonRecommendation[] {
  const recommendations: LessonRecommendation[] = [];

  const needsRevision = masteryList
    .filter((m) => m.status === 'needs-revision')
    .sort((a, b) => a.weightedMasteryScore - b.weightedMasteryScore);

  for (const tm of needsRevision.slice(0, 3)) {
    const topErr = tm.recurringErrors?.[0];
    recommendations.push({
      id: `rec_rev_${tm.id}`,
      subject: tm.subject,
      chapter: tm.chapter || tm.topic,
      topic: tm.topic,
      reason: topErr
        ? `Repeated "${topErr.errorTag.replace(/-/g, ' ')}" pattern (${topErr.count}x). Targeted explanation + foundation practice recommended.`
        : `Mastery at ${Math.round(tm.weightedMasteryScore)}% across ${tm.attemptsCount} attempts. Focus on fundamentals next.`,
      actionType: topErr ? 'remediate' : 'practice',
      priority: 'high',
      errorTag: topErr?.errorTag,
      recommendedDifficulty: tm.currentRecommendedDifficulty,
    });
  }

  const developing = masteryList
    .filter((m) => m.status === 'developing' || m.status === 'insufficient-data')
    .sort((a, b) => a.attemptsCount - b.attemptsCount);

  for (const tm of developing.slice(0, 2)) {
    recommendations.push({
      id: `rec_dev_${tm.id}`,
      subject: tm.subject,
      chapter: tm.chapter || tm.topic,
      topic: tm.topic,
      reason:
        tm.status === 'insufficient-data'
          ? `Only ${tm.attemptsCount} attempt logged so far — complete 2–3 more questions for a confident mastery reading.`
          : `Steadily progressing (${Math.round(tm.weightedMasteryScore)}%). Keep building consistency.`,
      actionType: 'practice',
      priority: 'medium',
      recommendedDifficulty: tm.currentRecommendedDifficulty,
    });
  }

  if (dueFlashcardsCount > 0) {
    recommendations.push({
      id: 'rec_due_cards',
      subject: 'All Subjects',
      chapter: 'Spaced Repetition Queue',
      topic: `${dueFlashcardsCount} due recall card${dueFlashcardsCount === 1 ? '' : 's'}`,
      reason: 'Active recall right before forgetting strengthens long-term exam memory.',
      actionType: 'flashcards',
      priority: dueFlashcardsCount >= 5 ? 'high' : 'medium',
      recommendedDifficulty: 'intermediate',
    });
  }

  const mastered = masteryList
    .filter((m) => m.status === 'mastered')
    .sort((a, b) => a.weightedMasteryScore - b.weightedMasteryScore)[0];

  if (mastered) {
    recommendations.push({
      id: `rec_stretch_${mastered.id}`,
      subject: mastered.subject,
      chapter: mastered.chapter || mastered.topic,
      topic: mastered.topic,
      reason: `Strong mastery (${Math.round(mastered.weightedMasteryScore)}%). Ready for Board Challenge extension questions.`,
      actionType: 'practice',
      priority: 'stretch',
      recommendedDifficulty: 'board-challenge',
    });
  }

  return recommendations;
}

export function validatePracticeGenerateRequest(
  raw: Partial<PracticeGenerateRequest>
): { valid: boolean; error?: string; sanitized?: PracticeGenerateRequest } {
  const subject = (raw.subject || '').trim();
  const topic = (raw.topic || '').trim();
  if (!subject || !topic) {
    return { valid: false, error: 'Subject and topic are required to generate practice questions.' };
  }

  const validTypes: QuestionType[] = ['mcq', 'true-false', 'fill-blank', 'short-answer', 'numerical'];
  const requestedTypes = Array.isArray(raw.questionTypes)
    ? raw.questionTypes.filter((t): t is QuestionType => validTypes.includes(t))
    : [];

  const questionTypes: QuestionType[] =
    requestedTypes.length > 0 ? requestedTypes : ['mcq', 'true-false', 'fill-blank', 'short-answer'];

  const difficulty: DifficultyTier =
    raw.difficulty === 'foundation' || raw.difficulty === 'board-challenge'
      ? raw.difficulty
      : 'intermediate';

  const count = Math.min(8, Math.max(1, Number(raw.count) || 5));

  return {
    valid: true,
    sanitized: {
      board: raw.board || 'CBSE',
      classGrade: raw.classGrade || 'Class 10',
      subject: subject.slice(0, 80),
      chapter: (raw.chapter || topic).trim().slice(0, 160),
      topic: topic.slice(0, 160),
      difficulty,
      questionTypes,
      count,
      language:
        raw.language === 'Hindi'
          ? 'Hindi'
          : raw.language === 'Bilingual' || (raw.language as string) === 'Hinglish'
          ? 'Bilingual'
          : 'English',
      focusErrorTag: raw.focusErrorTag?.trim().slice(0, 80),
      previousPerformanceSummary: raw.previousPerformanceSummary?.trim().slice(0, 400),
      similarToQuestion: raw.similarToQuestion,
    },
  };
}

export function sanitizeAttemptForStorage(attempt: PracticeAttemptRecord): PracticeAttemptRecord {
  const sanitized: PracticeAttemptRecord = {
    id: sanitizeDocumentId(attempt.id.replace(/^att_/, ''), 'att'),
    userId: attempt.userId.slice(0, 128),
    subject: (attempt.subject || 'General').trim().slice(0, 80),
    topic: (attempt.topic || 'Core Concept').trim().slice(0, 160),
    questionType: attempt.questionType,
    difficulty: attempt.difficulty,
    isCorrect: Boolean(attempt.isCorrect),
    scoreRatio: typeof attempt.scoreRatio === 'number' ? Number(Math.min(1, Math.max(0, attempt.scoreRatio)).toFixed(2)) : attempt.isCorrect ? 1 : 0,
    timeSpentSeconds: Math.min(7200, Math.max(0, Math.round(attempt.timeSpentSeconds || 0))),
    createdAt: attempt.createdAt || new Date().toISOString(),
  };

  if (attempt.chapter?.trim()) sanitized.chapter = attempt.chapter.trim().slice(0, 160);
  if (attempt.board?.trim()) sanitized.board = attempt.board.trim().slice(0, 32);
  if (attempt.classGrade?.trim()) sanitized.classGrade = attempt.classGrade.trim().slice(0, 30);
  if (attempt.questionId?.trim()) sanitized.questionId = attempt.questionId.trim().slice(0, 128);
  if (attempt.prompt?.trim()) sanitized.prompt = attempt.prompt.trim().slice(0, 1200);
  if (attempt.userAnswer !== undefined) sanitized.userAnswer = String(attempt.userAnswer).slice(0, 1000);
  if (attempt.correctAnswer !== undefined) sanitized.correctAnswer = String(attempt.correctAnswer).slice(0, 1000);
  if (attempt.errorTag?.trim()) sanitized.errorTag = attempt.errorTag.trim().slice(0, 80);
  if (attempt.misconceptionNote?.trim()) sanitized.misconceptionNote = attempt.misconceptionNote.trim().slice(0, 600);

  return sanitized;
}

export function sanitizeTopicMasteryForStorage(mastery: TopicMasteryRecord): TopicMasteryRecord {
  const safeId = buildTopicMasteryId(mastery.userId, mastery.subject, mastery.topic);
  const sanitized: TopicMasteryRecord = {
    id: safeId,
    userId: mastery.userId.slice(0, 128),
    subject: (mastery.subject || 'General').trim().slice(0, 80),
    chapter: (mastery.chapter || mastery.topic || 'Chapter').trim().slice(0, 160),
    topic: (mastery.topic || 'Topic').trim().slice(0, 160),
    attemptsCount: Math.max(0, Math.round(mastery.attemptsCount || 0)),
    correctCount: Math.max(0, Math.round(mastery.correctCount || 0)),
    recentAccuracy: Number(Math.min(100, Math.max(0, mastery.recentAccuracy || 0)).toFixed(1)),
    weightedMasteryScore: Number(Math.min(100, Math.max(0, mastery.weightedMasteryScore || 0)).toFixed(1)),
    status: mastery.status,
    currentRecommendedDifficulty: mastery.currentRecommendedDifficulty,
    totalTimeSpentSeconds: Math.max(0, Math.round(mastery.totalTimeSpentSeconds || 0)),
    recurringErrors: (mastery.recurringErrors || []).slice(0, 10).map((e) => ({
      errorTag: String(e.errorTag).slice(0, 80),
      count: Math.max(1, Math.round(e.count || 1)),
      lastSeenAt: e.lastSeenAt || new Date().toISOString(),
      sampleMisconception: String(e.sampleMisconception || '').slice(0, 260),
    })),
    revisionCount: Math.max(0, Math.round(mastery.revisionCount || 0)),
    historySnapshots: (mastery.historySnapshots || []).slice(-20),
    updatedAt: mastery.updatedAt || new Date().toISOString(),
  };

  if (mastery.lastPracticedAt) sanitized.lastPracticedAt = mastery.lastPracticedAt;
  if (mastery.lastRevisedAt) sanitized.lastRevisedAt = mastery.lastRevisedAt;

  return sanitized;
}
