import { AppRoute, ModuleMetadata } from '../types/modules';

export const CORE_EXAM_MODULES: ModuleMetadata[] = [
  {
    path: '/datesheet-analyzer',
    title: 'Exam Datesheet Analyzer',
    shortTitle: 'Datesheet Analyzer',
    category: 'core',
    moduleNumber: 1,
    status: 'active',
    description:
      'Upload PDF or multi-page image exam datesheets to extract, verify, and structure your chronological board or school exam timeline with preparation gap insights.',
    iconName: 'CalendarDays',
    features: [
      'Upload PDF or JPG/PNG datesheet pages',
      'AI extraction of subjects, dates, timings & rules',
      'Weekday, clash & missing-field validation checks',
      'Editable schedule with Timeline, Calendar & Subject views',
    ],
  },
  {
    path: '/study-planner',
    title: 'Personal Study Planner',
    shortTitle: 'Study Planner',
    category: 'core',
    moduleNumber: 2,
    status: 'coming-soon',
    description:
      'Upcoming adaptive study schedule builder that allocates revision blocks across your verified datesheet gaps and subject priorities.',
    iconName: 'ClipboardList',
    features: [
      'Exam-gap aware revision distribution',
      'Priority weighting for back-to-back papers',
      'Daily study checklists synced with upcoming exam countdowns',
    ],
  },
  {
    path: '/sample-papers',
    title: 'Sample Papers',
    shortTitle: 'Sample Papers',
    category: 'core',
    moduleNumber: 3,
    status: 'coming-soon',
    description:
      'Curated board-pattern sample question papers tailored to your board, class, and upcoming exam subjects.',
    iconName: 'FileText',
    features: [
      'CBSE, ICSE, CISCE & State Board blueprint alignment',
      'Marking scheme breakdowns and section weights',
      'Printable and digital practice sets',
    ],
  },
  {
    path: '/exam-mode',
    title: 'Exam Mode',
    shortTitle: 'Exam Mode',
    category: 'core',
    moduleNumber: 4,
    status: 'coming-soon',
    description:
      'Timed full-length exam simulation environment matching your real datesheet timings and paper structure.',
    iconName: 'Clock',
    features: [
      'Strict exam-hall countdown & submission flow',
      'Section navigation and mark-for-review controls',
      'Post-exam timing and accuracy breakdown',
    ],
  },
  {
    path: '/personal-advisor',
    title: 'Personal Advisor',
    shortTitle: 'Personal Advisor',
    category: 'core',
    moduleNumber: 5,
    status: 'coming-soon',
    description:
      'Dedicated Doubt Solver & Exam Preparation Advisor to resolve subject doubts and refine last-mile exam strategy.',
    iconName: 'Compass',
    features: [
      'Subject Doubt Solver for board questions',
      'High-impact revision guidance before each exam',
      'Exam strategy tips aligned with your upcoming datesheet',
    ],
  },
];

export const MODULE_REGISTRY: Record<AppRoute, ModuleMetadata> = {
  '/': {
    path: '/',
    title: 'EDUVERSE AI — Exam Preparation & Practice Platform',
    category: 'overview',
    description:
      'Focused exam preparation workspace for Class 6–12 students across CBSE, ICSE, CISCE, and State Boards.',
    iconName: 'CalendarDays',
    status: 'active',
    features: ['Exam Datesheet Analyzer', 'Confirmed Exam Countdowns', 'Upcoming Prep Roadmap'],
  },
  '/login': {
    path: '/login',
    title: 'Student Sign In',
    category: 'system',
    description: 'Sign in with Google or your verified email account.',
    iconName: 'Settings',
    status: 'active',
    features: ['Google Sign-In', 'Verified Email Login'],
  },
  '/signup': {
    path: '/signup',
    title: 'Create Student Account',
    category: 'system',
    description: 'Register your verified Class 6–12 student account.',
    iconName: 'Settings',
    status: 'active',
    features: ['Board & Grade Selection', 'Unique @username Handle'],
  },
  '/dashboard': {
    path: '/dashboard',
    title: 'Dashboard',
    category: 'overview',
    description:
      'Your exam preparation overview with active datesheet countdowns, upcoming exams, preparation alerts, and quick module access.',
    iconName: 'LayoutDashboard',
    status: 'active',
    features: [
      'Active Exam Datesheet Overview',
      'Next Exam Countdown & Upcoming Schedule',
      'Preparation Gap Alerts',
      '5-Module Platform Navigation',
    ],
  },
  '/datesheet-analyzer': CORE_EXAM_MODULES[0],
  '/study-planner': CORE_EXAM_MODULES[1],
  '/sample-papers': CORE_EXAM_MODULES[2],
  '/exam-mode': CORE_EXAM_MODULES[3],
  '/personal-advisor': CORE_EXAM_MODULES[4],
  '/settings': {
    path: '/settings',
    title: 'Settings',
    category: 'system',
    description: 'Manage your @username, academic board, class grade, medium, theme, and account lifecycle.',
    iconName: 'Settings',
    status: 'active',
    features: ['Academic Board & Grade', 'Theme Switching', 'Account Management'],
  },
};

export const NAV_SECTIONS = [
  {
    title: 'Overview',
    routes: ['/dashboard'] as AppRoute[],
  },
  {
    title: 'Exam Modules',
    routes: [
      '/datesheet-analyzer',
      '/study-planner',
      '/sample-papers',
      '/exam-mode',
      '/personal-advisor',
    ] as AppRoute[],
  },
  {
    title: 'Account',
    routes: ['/settings'] as AppRoute[],
  },
];
