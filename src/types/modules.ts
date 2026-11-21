export type AppRoute =
  | '/'
  | '/login'
  | '/signup'
  | '/dashboard'
  | '/datesheet-analyzer'
  | '/study-planner'
  | '/sample-papers'
  | '/exam-mode'
  | '/personal-advisor'
  | '/settings';

export type ModuleCategory = 'overview' | 'core' | 'system';

export interface ModuleMetadata {
  path: AppRoute;
  title: string;
  shortTitle?: string;
  category: ModuleCategory;
  description: string;
  iconName: string;
  status: 'active' | 'coming-soon';
  badge?: string;
  features: string[];
  moduleNumber?: number;
}
