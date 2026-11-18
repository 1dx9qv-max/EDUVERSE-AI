import type { ClassGrade, IndianBoard } from './auth.ts';

export type BoardType = 'national' | 'state' | 'international';

export interface BoardRecord {
  id: string;
  code: string;
  name: string;
  fullName: string;
  type: BoardType;
  state?: string;
  officialWebsite?: string;
  isVerified: boolean;
  notes?: string;
}

export interface BoardConfig {
  id: string;
  name: string;
  fullName: string;
  supportedClasses: ClassGrade[];
  isVerified: boolean;
  updatedAt?: string;
}

export interface ClassGradeRecord {
  id: string;
  boardId: string;
  grade: ClassGrade;
  stream?: string;
  academicYear?: string;
  isVerified: boolean;
}

export interface SubjectRecord {
  id: string;
  boardId: string;
  classGrade: ClassGrade;
  name: string;
  hindiName?: string;
  code: string;
  icon: string;
  color: string;
  category: 'STEM' | 'Language' | 'SocialSciences' | 'Commerce' | 'Humanities' | 'Vocational';
  isVerified: boolean;
}

export interface LearningObjective {
  id: string;
  code: string;
  description: string;
  bloomLevel?: 'Remember' | 'Understand' | 'Apply' | 'Analyze' | 'Evaluate';
}

export interface TopicLearningObjective {
  id: string;
  description: string;
  bloomLevel?: 'Remember' | 'Understand' | 'Apply' | 'Analyze' | 'Evaluate' | string;
  isHighYield?: boolean;
}

export interface TopicNode {
  id: string;
  title: string;
  titleHindi?: string;
  order?: number;
  learningObjectives: (string | TopicLearningObjective)[];
  estimatedMinutes?: number;
}

export interface ChapterNode {
  id: string;
  boardId: string;
  classGrade: ClassGrade;
  subjectId: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterTitleHindi?: string;
  topics: TopicNode[];
  version?: string;
  isVerified: boolean;
  verifiedBy?: string;
  verifiedAt?: string;
  sourceDoc?: string;
  updatedAt?: string;
}

export type SyllabusNode = ChapterNode;

// Backward compatibility interfaces for components using earlier types
export interface Chapter {
  id: string;
  number: number;
  title: string;
  titleHindi?: string;
  conceptCount: number;
  keyTopics: string[];
  estimatedHours: number;
}

export interface SubjectCurriculum {
  id: string;
  name: string;
  hindiName: string;
  icon: string;
  color: string;
  chapters: Chapter[];
}

export interface BoardCurriculum {
  board: IndianBoard;
  grades: {
    [key in ClassGrade]?: SubjectCurriculum[];
  };
}

export interface LearningProfile {
  id: string;
  userId: string;
  preferredPace: 'steady' | 'accelerated' | 'revision-focus';
  strengths: string[];
  weaknesses: string[];
  dailyGoalMinutes: number;
  dailyQuestionsTarget: number;
  lastActiveDate: string;
  updatedAt: string;
}

export interface StudyPlanTask {
  id: string;
  title: string;
  completed: boolean;
  durationMinutes: number;
  xpReward: number;
  subjectId?: string;
  category?: 'study' | 'practice' | 'revision' | 'doubt';
}

export interface StudyPlan {
  id: string;
  userId: string;
  title: string;
  targetDate?: string;
  subjectId?: string;
  tasks: StudyPlanTask[];
  status: 'active' | 'completed' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRecord {
  id: string;
  userId: string;
  type: 'doubt_asked' | 'practice_completed' | 'topic_studied' | 'goal_achieved' | 'revision_due';
  title: string;
  description: string;
  subjectId?: string;
  xpEarned: number;
  timestamp: string;
}

export interface GuardianLink {
  id: string;
  guardianUid: string;
  studentUid: string;
  studentDisplayName?: string;
  relationship: 'parent' | 'guardian' | 'mentor';
  status: 'pending' | 'verified' | 'revoked' | 'rejected';
  permissions: string[] | {
    canViewProgress?: boolean;
    canViewAttendance?: boolean;
    canReceiveAlerts?: boolean;
    [key: string]: boolean | undefined;
  };
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}
