import type { DifficultyTier } from './phase4.ts';

export type LearningEventType =
  | 'lesson_started'
  | 'lesson_completed'
  | 'topic_completed'
  | 'doubt_submitted'
  | 'practice_attempted'
  | 'flashcard_reviewed'
  | 'revision_completed'
  | 'exam_attempted'
  | 'study_goal_completed'
  | 'mindmap_created'
  | 'voice_turn';

export type LearningSourceModule =
  | 'ai-teacher'
  | 'visual-lab'
  | 'doubt-solver'
  | 'practice'
  | 'memory-booster'
  | 'exam-simulator'
  | 'mind-maps'
  | 'voice-learning'
  | 'dashboard';

export interface LearningActivityEvent {
  id: string;
  uid: string;
  eventType: LearningEventType;
  subject: string;
  chapter?: string;
  topic?: string;
  objectiveId?: string;
  sourceModule: LearningSourceModule;
  idempotencyKey: string;
  xpAwarded: number;
  scoreRatio?: number;
  isCorrect?: boolean;
  errorTag?: string;
  difficulty?: DifficultyTier | string;
  localDateKey: string;
  timezone?: string;
  title: string;
  description?: string;
  timestamp: string;
}

export interface ChapterProgressSummary {
  chapterId: string;
  subject: string;
  chapterNumber: number;
  chapterTitle: string;
  totalTopics: number;
  completedTopics: number;
  completedTopicTitles: string[];
  startedTopicsCount: number;
  percentComplete: number;
  status: 'not_started' | 'in_progress' | 'completed';
  estimatedMinutesRemaining: number;
  lastStudiedAt?: string;
  topics: string[];
}

export interface DynamicDailyGoal {
  id: string;
  goalKey: string;
  localDateKey: string;
  title: string;
  description: string;
  category: 'lesson' | 'practice' | 'revision' | 'doubt' | 'exam';
  subject?: string;
  chapter?: string;
  topic?: string;
  targetCount: number;
  currentCount: number;
  completed: boolean;
  completedAt?: string;
  xpReward: number;
  actionRoute: string;
}

export type RecommendationReasonCode =
  | 'weak_topic'
  | 'recurring_error'
  | 'due_revision'
  | 'unfinished_chapter'
  | 'unstudied_syllabus'
  | 'difficulty_step_up';

export type RecommendationActionModule =
  | 'practice'
  | 'memory-booster'
  | 'ai-teacher'
  | 'visual-lab'
  | 'exam-simulator';

export interface AdaptivePracticeRecommendation {
  id: string;
  subject: string;
  chapter: string;
  topic: string;
  title: string;
  difficulty: DifficultyTier;
  category: RecommendationReasonCode;
  reason: string;
  estimatedMinutes: number;
  xpReward: number;
  actionModule: RecommendationActionModule;
  actionRoute: string;
  priorityScore: number;
  errorTag?: string;
  masteryScore?: number;
}

export type RecommendationHistoryStatus = 'shown' | 'started' | 'completed' | 'skipped';

export interface RecommendationHistoryEntry {
  recId: string;
  subject: string;
  chapter: string;
  topic: string;
  category: RecommendationReasonCode;
  shownCount: number;
  lastShownAt: string;
  status: RecommendationHistoryStatus;
  startedAt?: string;
  completedAt?: string;
  skippedAt?: string;
  cooldownUntil?: string;
}

export interface LessonProgressRecord {
  id: string;
  uid: string;
  subject: string;
  chapter: string;
  topic: string;
  status: 'started' | 'completed';
  startedAt: string;
  completedAt?: string;
  lastSourceModule: string;
}

export interface DashboardLearningSummary {
  uid: string;
  localDateKey: string;
  timezone: string;
  verifiedXp: number;
  todayXp: number;
  streakDays: number;
  longestStreakDays: number;
  totalCompletedActivities: number;
  todayCompletedActivities: number;
  chapterProgress: ChapterProgressSummary[];
  dailyGoals: DynamicDailyGoal[];
  recommendations: AdaptivePracticeRecommendation[];
  recommendationRefreshCount: number;
  lastUpdatedAt: string;
}
