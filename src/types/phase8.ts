import type { ClassGrade, IndianBoard, UserRole } from './auth.ts';

export type AccountStatus = 'active' | 'suspended';

export interface ManagedUserAccount {
  uid: string;
  email: string;
  emailVerified?: boolean;
  authProvider?: string;
  username?: string;
  displayName: string;
  avatarId?: string;
  role: UserRole;
  board: IndianBoard;
  classGrade: ClassGrade;
  state?: string;
  language?: string;
  status: AccountStatus;
  onboardingCompleted: boolean;
  verifiedXp: number;
  streakDays: number;
  createdAt: string;
  updatedAt: string;
}

export type AdminQuestionFormat =
  | 'mcq'
  | 'multiple-select'
  | 'true-false'
  | 'fill-blank'
  | 'short-answer'
  | 'long-answer'
  | 'numerical';

export type AdminQuestionDifficulty = 'foundation' | 'intermediate' | 'board-challenge';

export interface ManagedQuestionItem {
  id: string;
  boardId: string;
  classGrade: ClassGrade;
  subjectId: string;
  chapterTitle: string;
  topic: string;
  questionType: AdminQuestionFormat;
  difficulty: AdminQuestionDifficulty;
  prompt: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  marks: number;
  isVerified: boolean;
  createdBy: string;
  updatedAt: string;
}

export type LearningContentType =
  | 'concept-guide'
  | 'formula-sheet'
  | 'solved-example'
  | 'revision-note';

export type LearningContentStatus = 'published' | 'draft' | 'archived';

export interface LearningContentItem {
  id: string;
  boardId: string;
  classGrade: ClassGrade;
  subjectId: string;
  chapterTitle: string;
  contentType: LearningContentType;
  title: string;
  summary: string;
  body: string;
  isVerified: boolean;
  status: LearningContentStatus;
  authorName: string;
  updatedAt: string;
}

export interface PlatformModerationItem {
  id: string;
  source: 'study-room' | 'ai-safety' | 'platform';
  roomId?: string;
  roomTitle?: string;
  targetType: 'note' | 'goal' | 'quiz' | 'member' | 'ai-prompt';
  targetId: string;
  targetPreview: string;
  reporterAlias: string;
  reason: string;
  details?: string;
  status: 'open' | 'action-taken' | 'dismissed';
  createdAt: string;
  resolvedByUid?: string;
  resolvedAt?: string;
}

export interface AdminAuditLogEntry {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: UserRole;
  action: string;
  targetType:
    | 'user'
    | 'board'
    | 'class'
    | 'subject'
    | 'syllabus'
    | 'question'
    | 'content'
    | 'moderation'
    | 'guardian'
    | 'security';
  targetId: string;
  summary: string;
  createdAt: string;
}

export interface SystemHealthSnapshot {
  status: 'healthy' | 'degraded';
  uptimeSeconds: number;
  memoryRssMb: number;
  memoryHeapUsedMb: number;
  geminiConfigured: boolean;
  firebaseProjectId: string;
  authVerificationMode: 'firebase-x509-jwt';
  rateLimiterActive: boolean;
  wsStudyRoomsPath: string;
  wsVoiceLivePath: string;
  activeStudyRoomsCount: number;
  timestamp: string;
}

export interface PlatformUsageAnalytics {
  totalUsers: number;
  activeUsersByRole: Record<UserRole, number>;
  suspendedUsersCount: number;
  verifiedBoardsCount: number;
  classesCount: number;
  subjectsCount: number;
  verifiedSyllabusCount: number;
  pendingSyllabusCount: number;
  questionBankCount: number;
  publishedContentCount: number;
  openModerationReports: number;
  activeStudyRooms: number;
  verifiedGuardianLinks: number;
  aiRequestsTotal: number;
  aiRateLimitBlocks: number;
  aiSafetyBlocks: number;
  recentAiEndpoints: Array<{ endpoint: string; count: number; lastCalledAt: string }>;
}

export interface SecurityPostureCheck {
  id: string;
  control: string;
  status: 'enforced' | 'partial' | 'advisory';
  detail: string;
}

export interface GuardianPermissions {
  canViewProgress: boolean;
  canViewGoals: boolean;
  canViewAssessments: boolean;
  canReceiveAlerts: boolean;
}

export interface GuardianLinkRecord {
  id: string;
  guardianUid: string;
  guardianName: string;
  guardianEmailMasked: string;
  studentUid: string;
  studentDisplayName: string;
  studentBoard: IndianBoard;
  studentClassGrade: ClassGrade;
  relationship: 'parent' | 'guardian' | 'mentor';
  status: 'pending' | 'verified' | 'revoked';
  permissions: GuardianPermissions;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GuardianInviteCodeRecord {
  code: string;
  studentUid: string;
  studentDisplayName: string;
  studentBoard: IndianBoard;
  studentClassGrade: ClassGrade;
  createdAt: string;
  expiresAt: string;
  used: boolean;
}

export interface GuardianStudentSummary {
  link: GuardianLinkRecord;
  studentDisplayName: string;
  board: IndianBoard;
  classGrade: ClassGrade;
  language: string;
  restrictedSections: string[];
  progressSummary?: {
    streakDays: number;
    totalVerifiedXp: number;
    todayXpEarned: number;
    todayXpCap: number;
    todayEstimatedMinutes: number;
    masteredTopicsCount: number;
    developingTopicsCount: number;
    needsRevisionTopics: string[];
    strongTopics: string[];
  };
  goalsOverview?: {
    learningGoals: string[];
    dailyGoalsCompleted: number;
    dailyGoalsTotal: number;
    dailyGoals: Array<{ title: string; current: number; target: number; completed: boolean }>;
  };
  assessmentsSummary?: {
    recentExamsCount: number;
    averagePercentage: number;
    recentExams: Array<{ title: string; subject: string; percentage: number; submittedAt: string }>;
  };
  safetyNotice: string;
}
