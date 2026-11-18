export type AppRoute =
  | '/'
  | '/login'
  | '/signup'
  | '/dashboard'
  | '/ai-teacher'
  | '/doubt-solver'
  | '/visual-lab'
  | '/practice'
  | '/learning-intelligence'
  | '/memory-booster'
  | '/mindmaps'
  | '/exam-simulator'
  | '/voice-learning'
  | '/collaborative-learning'
  | '/achievements'
  | '/guardian'
  | '/settings'
  | '/admin';

export type ModuleCategory = 'core' | 'ai-tutor' | 'exam-prep' | 'cognitive' | 'collaboration' | 'system';

export interface ModuleMetadata {
  path: AppRoute;
  title: string;
  hindiTitle: string;
  category: ModuleCategory;
  description: string;
  iconName: string;
  badge?: string;
  badgeColor?: string;
  status: 'active' | 'coming-soon' | 'foundation-ready' | 'planned';
  allowedRoles?: ('student' | 'guardian' | 'teacher' | 'admin')[];
  features: string[];
}
