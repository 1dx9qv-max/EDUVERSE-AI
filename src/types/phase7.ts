export type StudyRoomRole = 'host' | 'moderator' | 'member';
export type StudyRoomMemberStatus = 'active' | 'muted' | 'removed';
export type StudyRoomNoteStatus = 'visible' | 'flagged' | 'hidden';
export type StudyRoomReportTargetType = 'note' | 'goal' | 'quiz' | 'member';
export type StudyRoomReportReason =
  | 'spam-or-offtopic'
  | 'inappropriate-language'
  | 'personal-info-shared'
  | 'external-link'
  | 'harassment';
export type StudyRoomReportStatus = 'open' | 'action-taken' | 'dismissed';

export interface StudyRoomMember {
  uid: string;
  roomId: string;
  alias: string;
  avatarInitial: string;
  role: StudyRoomRole;
  board: string;
  classGrade: string;
  status: StudyRoomMemberStatus;
  contributionsCount: number;
  quizPoints: number;
  joinedAt: string;
  lastActiveAt: string;
}

export interface StudyRoomMembershipIndex {
  roomId: string;
  roomTitle: string;
  subject: string;
  role: StudyRoomRole;
  joinedAt: string;
}

export interface StudyRoomInvite {
  code: string;
  roomId: string;
  roomTitle: string;
  subject: string;
  board: string;
  classGrade: string;
  createdByUid: string;
  expiresAt: string;
  maxUses: number;
  usesCount: number;
  revoked: boolean;
}

export interface StudyRoomNote {
  id: string;
  roomId: string;
  authorUid: string;
  authorAlias: string;
  subject: string;
  topic: string;
  title: string;
  body: string;
  pinned: boolean;
  status: StudyRoomNoteStatus;
  reportCount: number;
  reportedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StudyRoomGoal {
  id: string;
  roomId: string;
  title: string;
  targetCount: number;
  currentCount: number;
  unit: string;
  contributorUids: string[];
  completed: boolean;
  createdByUid: string;
  createdByAlias: string;
  updatedAt: string;
}

export interface StudyRoomQuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface StudyRoomQuizSubmission {
  uid: string;
  alias: string;
  answers: number[];
  score: number;
  total: number;
  submittedAt: string;
}

export interface StudyRoomQuiz {
  id: string;
  roomId: string;
  title: string;
  subject: string;
  topic: string;
  createdByUid: string;
  createdByAlias: string;
  questions: StudyRoomQuizQuestion[];
  submissions: StudyRoomQuizSubmission[];
  status: 'active' | 'closed';
  createdAt: string;
}

export interface StudyRoomMindMapNode {
  id: string;
  label: string;
  parentId: string | null;
  summary?: string;
}

export interface StudyRoomMindMap {
  id: string;
  roomId: string;
  sourceMindMapId?: string;
  title: string;
  subject: string;
  topic: string;
  sharedByUid: string;
  sharedByAlias: string;
  nodes: StudyRoomMindMapNode[];
  endorsements: string[];
  createdAt: string;
}

export interface StudyRoomReport {
  id: string;
  roomId: string;
  targetType: StudyRoomReportTargetType;
  targetId: string;
  targetPreview: string;
  reporterUid: string;
  reporterAlias: string;
  reason: StudyRoomReportReason;
  details: string;
  status: StudyRoomReportStatus;
  createdAt: string;
  resolvedByUid?: string;
  resolvedAt?: string;
}

export interface StudyRoom {
  id: string;
  title: string;
  subject: string;
  topic: string;
  board: string;
  classGrade: string;
  hostUid: string;
  hostAlias: string;
  inviteCode: string;
  isPrivate: true;
  directMessagesDisabled: true;
  isLocked: boolean;
  maxMembers: number;
  members: StudyRoomMember[];
  notes: StudyRoomNote[];
  goals: StudyRoomGoal[];
  quizzes: StudyRoomQuiz[];
  mindMaps: StudyRoomMindMap[];
  reports: StudyRoomReport[];
  createdAt: string;
  updatedAt: string;
}

export interface StudyRoomMeta {
  id: string;
  title: string;
  subject: string;
  topic: string;
  board: string;
  classGrade: string;
  hostUid: string;
  hostAlias: string;
  inviteCode: string;
  isPrivate: true;
  directMessagesDisabled: true;
  isLocked: boolean;
  maxMembers: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupProgressSummary {
  totalNotesVisible: number;
  totalGoals: number;
  completedGoals: number;
  goalCompletionPercent: number;
  totalQuizzes: number;
  totalQuizSubmissions: number;
  averageQuizAccuracy: number;
  sharedMindMapsCount: number;
  activeContributorsCount: number;
  openReportsCount: number;
}

export type AchievementCategory =
  | 'streak'
  | 'mastery'
  | 'revision'
  | 'assessment'
  | 'voice'
  | 'collaboration';

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'diamond';

export interface DailyGoalItem {
  id: string;
  title: string;
  category: 'practice' | 'revision' | 'concept' | 'assessment' | 'collaboration';
  current: number;
  target: number;
  completed: boolean;
  xpReward: number;
  route: string;
}

export interface AchievementBadge {
  id: string;
  title: string;
  hindiTitle: string;
  description: string;
  category: AchievementCategory;
  tier: BadgeTier;
  unlocked: boolean;
  unlockedAt?: string;
  progressCurrent: number;
  progressTarget: number;
  progressPercent: number;
  metricUnit: string;
  evidenceLabel: string;
}

export interface ProgressMilestone {
  id: string;
  title: string;
  subtitle: string;
  category: AchievementCategory;
  timestamp: string;
  verifiedSource: string;
  xpCredited: number;
}

export interface AchievementStateRecord {
  userId: string;
  streakDays: number;
  totalVerifiedXp: number;
  todayXpEarned: number;
  todayEstimatedMinutes: number;
  unlockedBadgeMap: Record<string, string>;
  lastComputedAt: string;
}

export interface DailyMotivationDayPoint {
  dateKey: string;
  xp: number;
  minutes: number;
  capped: boolean;
}

export interface MotivationDashboardState {
  streakDays: number;
  activeDaysLast7: boolean[];
  dailyBreakdownLast7: DailyMotivationDayPoint[];
  totalVerifiedXp: number;
  todayXpEarned: number;
  todayXpCap: number;
  todayEstimatedMinutes: number;
  healthyMinuteCap: number;
  healthyCapReached: boolean;
  wellnessNotice: string | null;
  dailyGoals: DailyGoalItem[];
  badges: AchievementBadge[];
  unlockedCount: number;
  totalBadgesCount: number;
  milestones: ProgressMilestone[];
  masteryProgress: {
    masteredTopics: number;
    developingTopics: number;
    totalTopics: number;
    totalRevisions: number;
    examsCompleted: number;
    voiceLessons: number;
    studyRoomsJoined: number;
    doubtsResolved: number;
    mindMapsCreated: number;
  };
  lastComputedAt: string;
}
