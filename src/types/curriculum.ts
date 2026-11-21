import type { ClassGrade, IndianBoard } from './auth.ts';

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

export interface BoardInfo {
  id: IndianBoard;
  label: string;
  full: string;
  type: 'national' | 'state' | 'other';
}

export type ExamGrade = ClassGrade;
