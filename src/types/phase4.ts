import type { ClassGrade, IndianBoard } from './auth.ts';

export type QuestionType =
  | 'mcq'
  | 'true-false'
  | 'fill-blank'
  | 'short-answer'
  | 'numerical';

export type DifficultyTier = 'foundation' | 'intermediate' | 'board-challenge';

export type MasteryStatus =
  | 'mastered'
  | 'developing'
  | 'needs-revision'
  | 'insufficient-data';

export type FlashcardSource =
  | 'ai-generated'
  | 'student-custom'
  | 'error-remediation';

export type Sm2Rating = 0 | 2 | 4 | 5; // 0=Again, 2=Hard, 4=Good, 5=Easy

export interface PracticeQuestion {
  id: string;
  questionType: QuestionType;
  difficulty: DifficultyTier;
  subject: string;
  chapter: string;
  topic: string;
  prompt: string;
  options?: string[];
  correctAnswer: string;
  acceptableAnswers?: string[];
  numericalValue?: number;
  numericalTolerance?: number;
  unit?: string;
  expectedKeywords?: string[];
  hint: string;
  explanation: string;
  errorTag: string;
  commonMistake: string;
}

export interface PracticeAttemptRecord {
  id: string;
  userId: string;
  subject: string;
  chapter?: string;
  topic: string;
  board?: string;
  classGrade?: string;
  questionId?: string;
  questionType: QuestionType;
  difficulty: DifficultyTier;
  prompt?: string;
  userAnswer?: string;
  correctAnswer?: string;
  isCorrect: boolean;
  scoreRatio?: number;
  timeSpentSeconds: number;
  errorTag?: string;
  misconceptionNote?: string;
  createdAt: string;
}

export interface RecurringErrorEntry {
  errorTag: string;
  count: number;
  lastSeenAt: string;
  sampleMisconception: string;
}

export interface ProgressSnapshot {
  date: string;
  masteryScore: number;
  accuracyRate: number;
  attemptsCount: number;
}

export interface TopicMasteryRecord {
  id: string;
  userId: string;
  subject: string;
  chapter?: string;
  topic: string;
  attemptsCount: number;
  correctCount: number;
  recentAccuracy: number;
  weightedMasteryScore: number;
  status: MasteryStatus;
  currentRecommendedDifficulty: DifficultyTier;
  totalTimeSpentSeconds: number;
  recurringErrors: RecurringErrorEntry[];
  revisionCount: number;
  lastPracticedAt?: string;
  lastRevisedAt?: string;
  historySnapshots: ProgressSnapshot[];
  updatedAt: string;
}

export interface FlashcardRecord {
  id: string;
  userId: string;
  subject: string;
  chapter: string;
  topic: string;
  board?: string;
  classGrade?: string;
  front: string;
  back: string;
  hint?: string;
  source: FlashcardSource;
  linkedErrorTag?: string;
  difficultyTag: 'normal' | 'difficult';
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  lapses: number;
  dueDate: string;
  lastReviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FlashcardReviewLog {
  id: string;
  userId: string;
  cardId: string;
  subject: string;
  topic: string;
  quality: number;
  wasCorrect: boolean;
  previousIntervalDays: number;
  nextIntervalDays: number;
  reviewedAt: string;
}

export interface PracticeGenerateRequest {
  board: IndianBoard;
  classGrade: ClassGrade;
  subject: string;
  chapter: string;
  topic: string;
  difficulty: DifficultyTier;
  questionTypes: QuestionType[];
  count: number;
  language: 'English' | 'Hindi' | 'Bilingual';
  focusErrorTag?: string;
  previousPerformanceSummary?: string;
  similarToQuestion?: {
    prompt: string;
    questionType: QuestionType;
    errorTag?: string;
  };
}

export interface PracticeGenerateResponse {
  questions: PracticeQuestion[];
  adaptiveReason: string;
  syllabusNote: string;
}

export interface ShortAnswerEvaluateRequest {
  board: IndianBoard;
  classGrade: ClassGrade;
  subject: string;
  topic: string;
  questionPrompt: string;
  expectedAnswer: string;
  expectedKeywords?: string[];
  studentAnswer: string;
  language: 'English' | 'Hindi' | 'Bilingual';
}

export interface ShortAnswerEvaluateResponse {
  isCorrect: boolean;
  scoreRatio: number;
  feedback: string;
  detectedErrorTag: string;
  misconceptionNote: string;
}

export interface RemediateRequest {
  board: IndianBoard;
  classGrade: ClassGrade;
  subject: string;
  topic: string;
  errorTag: string;
  sampleMisconception: string;
  language: 'English' | 'Hindi' | 'Bilingual';
}

export interface RemediateResponse {
  headline: string;
  coreExplanation: string;
  wrongVsRightComparison: {
    commonTrap: string;
    correctApproach: string;
  };
  quickCheckQuestion: {
    prompt: string;
    answer: string;
  };
  recommendedAction: string;
}

export interface FlashcardGenerateRequest {
  board: IndianBoard;
  classGrade: ClassGrade;
  subject: string;
  chapter: string;
  topic: string;
  count: number;
  language: 'English' | 'Hindi' | 'Bilingual';
  focusErrorTag?: string;
  misconceptionNote?: string;
}

export interface FlashcardGenerateResponse {
  cards: Array<{
    front: string;
    back: string;
    hint: string;
    topic: string;
    linkedErrorTag?: string;
  }>;
  syllabusNote: string;
}

export interface LessonRecommendation {
  id: string;
  subject: string;
  chapter: string;
  topic: string;
  reason: string;
  actionType: 'remediate' | 'practice' | 'flashcards' | 'ai-teacher';
  priority: 'high' | 'medium' | 'stretch';
  errorTag?: string;
  recommendedDifficulty: DifficultyTier;
}
