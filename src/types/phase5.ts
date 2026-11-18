import type { ClassGrade, IndianBoard } from './auth.ts';
import type { DifficultyTier } from './phase4.ts';

export type ExamQuestionType =
  | 'mcq'
  | 'multiple-select'
  | 'true-false'
  | 'fill-blank'
  | 'short-answer'
  | 'long-answer'
  | 'numerical';

export type ExamMode = 'chapter-test' | 'full-syllabus' | 'custom-test';

export type ExamTimingStatus =
  | 'on-time'
  | 'auto-submitted-timeout'
  | 'grace-accepted'
  | 'overtime-clamped';

export type ExamQuestionStatus =
  | 'not-visited'
  | 'unanswered'
  | 'answered'
  | 'marked-for-review'
  | 'answered-and-marked';

export interface ExamQuestion {
  id: string;
  questionNumber: number;
  section: string;
  questionType: ExamQuestionType;
  difficulty: DifficultyTier;
  subject: string;
  chapter: string;
  topic: string;
  marks: number;
  negativeMarks: number;
  prompt: string;
  options?: string[];
  correctAnswer: string;
  correctAnswers?: string[];
  acceptableAnswers?: string[];
  numericalValue?: number;
  numericalTolerance?: number;
  unit?: string;
  expectedKeywords?: string[];
  markingRubric?: string[];
  explanation: string;
  errorTag: string;
  commonMistake: string;
}

export interface ExamPaper {
  id: string;
  title: string;
  board: IndianBoard;
  classGrade: ClassGrade;
  subject: string;
  chapter?: string;
  examMode: ExamMode;
  language: 'English' | 'Hindi' | 'Bilingual';
  durationMinutes: number;
  totalMarks: number;
  negativeMarkingEnabled: boolean;
  isOfficialBoardExam: false;
  paperDisclaimer: string;
  syllabusNote: string;
  questions: ExamQuestion[];
  createdAt: string;
}

export interface ExamGenerateRequest {
  board: IndianBoard;
  classGrade: ClassGrade;
  subject: string;
  chapter?: string;
  topics?: string[];
  examMode: ExamMode;
  durationMinutes: number;
  questionCount: number;
  questionTypes: ExamQuestionType[];
  difficultyMix: 'balanced' | 'foundation-focus' | 'board-challenge';
  negativeMarkingEnabled: boolean;
  language: 'English' | 'Hindi' | 'Bilingual';
}

export interface ExamStartRequest {
  examId: string;
  durationMinutes: number;
  totalMarks: number;
  questionCount: number;
}

export interface ExamStartResponse {
  sessionId: string;
  examId: string;
  startedAt: number;
  expiresAt: number;
  durationMinutes: number;
  examToken: string;
}

export interface ExamAnswerSubmission {
  questionId: string;
  selectedOption?: string;
  selectedOptions?: string[];
  textAnswer?: string;
  markedForReview?: boolean;
  timeSpentSeconds?: number;
}

export interface ExamSubmitRequest {
  submissionId: string;
  sessionId: string;
  examToken: string;
  paper: ExamPaper;
  answers: ExamAnswerSubmission[];
  autoSubmittedOnTimeout?: boolean;
}

export interface ExamQuestionResult {
  questionId: string;
  questionNumber: number;
  questionType: ExamQuestionType;
  difficulty: DifficultyTier;
  topic: string;
  chapter: string;
  prompt: string;
  maxMarks: number;
  marksAwarded: number;
  isCorrect: boolean;
  isAttempted: boolean;
  evaluationMethod: 'objective-auto' | 'ai-subjective-rubric' | 'unattempted';
  studentAnswerDisplay: string;
  expectedAnswerDisplay: string;
  feedback: string;
  explanation: string;
  detectedErrorTag: string;
  misconceptionNote: string;
  markedForReview: boolean;
}

export interface ExamTopicBreakdown {
  topic: string;
  chapter: string;
  totalQuestions: number;
  correctCount: number;
  maxMarks: number;
  marksAwarded: number;
  accuracyPercent: number;
}

export interface ExamDifficultyBreakdown {
  difficulty: DifficultyTier;
  totalQuestions: number;
  correctCount: number;
  maxMarks: number;
  marksAwarded: number;
  accuracyPercent: number;
}

export interface ExamMistakeEntry {
  errorTag: string;
  topic: string;
  chapter: string;
  count: number;
  sampleMisconception: string;
}

export interface ExamAttemptRecord {
  id: string;
  submissionId: string;
  sessionId: string;
  userId: string;
  examId: string;
  paperTitle: string;
  board: IndianBoard;
  classGrade: ClassGrade;
  subject: string;
  chapter?: string;
  examMode: ExamMode;
  language: 'English' | 'Hindi' | 'Bilingual';
  isOfficialBoardExam: false;
  durationMinutes: number;
  elapsedSeconds: number;
  timingStatus: ExamTimingStatus;
  totalQuestions: number;
  attemptedCount: number;
  correctCount: number;
  incorrectCount: number;
  totalMarks: number;
  marksObtained: number;
  percentage: number;
  questionResults: ExamQuestionResult[];
  topicBreakdown: ExamTopicBreakdown[];
  difficultyBreakdown: ExamDifficultyBreakdown[];
  mistakeSummary: ExamMistakeEntry[];
  recommendedRevisionTopics: string[];
  submittedAt: string;
}

export interface ExamSubmitResponse {
  attempt: ExamAttemptRecord;
  isDuplicateReplay: boolean;
  timingValidated: boolean;
  serverTimingMessage: string;
}
