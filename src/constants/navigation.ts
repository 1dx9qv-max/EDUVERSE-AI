import { AppRoute, ModuleMetadata } from '../types/modules';
import { FEATURE_FLAGS } from '../config/featureFlags';

export const MODULE_REGISTRY: Record<AppRoute, ModuleMetadata> = {
  '/': {
    path: '/',
    title: 'Eduverse AI Platform',
    hindiTitle: 'एड्युवर्स एआई',
    category: 'core',
    description: 'Intelligent learning ecosystem for Indian school students from Class 6 to 12 across CBSE, ICSE, and State Boards.',
    iconName: 'Sparkles',
    status: 'active',
    features: FEATURE_FLAGS.visualLearningEnabled
      ? ['Board Curriculum Sync', 'Bilingual AI Tutoring', 'Visual Experiments', 'Adaptive Testing']
      : ['Board Curriculum Sync', 'Bilingual AI Tutoring', 'Smart Doubt Solving', 'Adaptive Testing']
  },
  '/login': {
    path: '/login',
    title: 'Student Sign In',
    hindiTitle: 'लॉग इन',
    category: 'core',
    description: 'Access your personalized Eduverse learning command center.',
    iconName: 'LogIn',
    status: 'active',
    features: ['Google Authentication', 'Email OTP Verification', 'Secure Token Session']
  },
  '/signup': {
    path: '/signup',
    title: 'Join Eduverse',
    hindiTitle: 'साइन अप',
    category: 'core',
    description: 'Create student profile with board, grade, and language selection.',
    iconName: 'UserPlus',
    status: 'active',
    features: ['Board Customization (CBSE/ICSE/State)', 'Class 6-12 Curriculum Mapping', 'Language Preference']
  },
  '/dashboard': {
    path: '/dashboard',
    title: 'Learning Command Center',
    hindiTitle: 'डैशबोर्ड',
    category: 'core',
    description: 'Your central hub for streak tracking, syllabus completion, quick AI tools, and daily targets.',
    iconName: 'LayoutDashboard',
    badge: 'Core Hub',
    badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    status: 'active',
    features: ['Syllabus Progress Tracker', 'Active Streak & XP Multiplier', 'Quick AI Action Grid', 'Subject Breakdowns']
  },
  '/ai-teacher': {
    path: '/ai-teacher',
    title: 'AI Personal Teacher',
    hindiTitle: 'एआई शिक्षक (24/7)',
    category: 'ai-tutor',
    description: 'Personalized 1-on-1 AI teacher tailored to your class and board in English, Hindi, or Bilingual mode.',
    iconName: 'Bot',
    badge: '6 Modes',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    status: 'active',
    features: ['6 Interactive Teaching Modes', 'Beginner / Intermediate / Advanced', 'Bilingual (Hindi/English) Lessons', 'Conceptual Checks & Follow-up Exercises']
  },
  '/doubt-solver': {
    path: '/doubt-solver',
    title: 'Smart Doubt Solver',
    hindiTitle: 'तुरंत संदेह निवारण',
    category: 'ai-tutor',
    description: 'Solve typed doubts, uploaded images, handwritten notes, PDF study sheets, and multi-question worksheets step by step.',
    iconName: 'HelpCircle',
    badge: 'Multimodal',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    status: 'active',
    features: ['Image, Handwritten & PDF Support', 'Worksheet Multi-Question Extraction', 'Common Misconceptions & Similar Practice', 'One-Click Simpler Explanation']
  },
  '/visual-lab': FEATURE_FLAGS.visualLearningEnabled
    ? {
        path: '/visual-lab',
        title: 'Visual Learning Lab',
        hindiTitle: 'विजुअल साइंस लैब',
        category: 'ai-tutor',
        description: 'Interactive simulations, animated explanations, and diagrams across Physics, Chemistry, Math, Biology, and Geography.',
        iconName: 'Atom',
        badge: '5 Subjects',
        badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
        status: 'active',
        features: ['Computed STEM Simulations', 'Timeline Animations', 'Clickable Diagrams (EN/HI)', 'Step-by-Step Visual Lessons']
      }
    : {
        path: '/visual-lab',
        title: 'Visual Learning',
        hindiTitle: 'विजुअल लर्निंग',
        category: 'ai-tutor',
        description: 'Visual Learning is currently under development and temporarily disabled.',
        iconName: 'Atom',
        badge: 'Coming Soon',
        badgeColor: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        status: 'coming-soon',
        features: ['Coming Soon', 'Under Development']
      },
  '/practice': {
    path: '/practice',
    title: 'Adaptive Question Bank',
    hindiTitle: 'अभ्यास और प्रश्नोत्तरी',
    category: 'exam-prep',
    description: 'Topic-wise adaptive practice across MCQ, True/False, Fill-in-Blank, Short Answer, and Numerical formats calibrated to your mastery.',
    iconName: 'Target',
    badge: '5 Formats',
    badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    status: 'active',
    features: ['5 Interactive Question Formats', 'Auto-Adaptive Difficulty', 'Instant Explanations & Error Tagging', 'Similar Follow-up Generation']
  },
  '/learning-intelligence': {
    path: '/learning-intelligence',
    title: 'Learning Intelligence AI',
    hindiTitle: 'अधिगम विश्लेषण',
    category: 'cognitive',
    description: 'Transparent topic mastery diagnostics, non-punitive error tracking, recurring mistake remediation, and improvement timelines.',
    iconName: 'BrainCircuit',
    badge: 'Analytics',
    badgeColor: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    status: 'active',
    features: ['Transparent Topic Mastery Model', 'Single-Miss Protection', 'Recurring Error Remediation', 'Improvement Over Time']
  },
  '/memory-booster': {
    path: '/memory-booster',
    title: 'Spaced Repetition Booster',
    hindiTitle: 'स्मृति वर्धक',
    category: 'cognitive',
    description: 'Active-recall flashcards with SM-2 spaced repetition, daily revision queue, difficult-card tracking, and AI deck generation.',
    iconName: 'Zap',
    badge: 'SM-2 Active Recall',
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    status: 'active',
    features: ['SuperMemo SM-2 Interval Scheduling', 'Daily Revision Queue', 'Difficult & Remediation Cards', 'Custom & AI Chapter Decks']
  },
  '/mindmaps': {
    path: '/mindmaps',
    title: 'AI Mind Map Generator',
    hindiTitle: 'माइंड मैप्स',
    category: 'cognitive',
    description: 'Generate, edit, link, collapse, and export hierarchical concept mind maps to PNG or PDF.',
    iconName: 'GitFork',
    badge: 'PNG / PDF',
    badgeColor: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30',
    status: 'active',
    features: ['Gemini Structured Mind Maps', 'Parent & Child Node Editor', 'Cross-Concept Relationship Links', 'Export to PNG / PDF']
  },
  '/exam-simulator': {
    path: '/exam-simulator',
    title: 'Exam Simulator',
    hindiTitle: 'परीक्षा सिम्युलेटर',
    category: 'exam-prep',
    description: 'Timed board-pattern AI practice exams across 7 question types with server timing validation, AI subjective evaluation, and Learning Intelligence analytics.',
    iconName: 'Clock',
    badge: '7 Formats',
    badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    status: 'active',
    features: ['Chapter, Full-Syllabus & Custom Mocks', '7 Objective & Subjective Formats', 'Server Timer & Duplicate Guard', 'Mistake Analysis & Attempt History']
  },
  '/voice-learning': {
    path: '/voice-learning',
    title: 'Voice Learning Classroom',
    hindiTitle: 'मौखिक शिक्षण कक्ष',
    category: 'ai-tutor',
    description: 'Interactive spoken AI classroom with Gemini Live Audio, STT + TTS fallback, Hindi/English/Bilingual voice support, and live transcripts.',
    iconName: 'Mic',
    badge: 'Live & Voice AI',
    badgeColor: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
    status: 'active',
    features: ['Gemini Live & STT/TTS Classroom', 'Hindi, English & Bilingual Voice', 'Stop, Resume & Mute Controls', 'Text-Only Privacy Transcripts']
  },
  '/collaborative-learning': {
    path: '/collaborative-learning',
    title: 'Peer Study Pods',
    hindiTitle: 'सहयोगी अध्ययन',
    category: 'collaboration',
    description: 'Private invitation-only study spaces with real-time shared notes, collaborative goals, group quizzes, shared mind maps, and moderation safeguards.',
    iconName: 'Users',
    badge: 'Live Pods',
    badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    status: 'active',
    features: ['Invite-Only Private Pods', 'Real-Time Shared Notes & Goals', 'Group Quizzes & Mind Maps', 'Reporting & Safety Moderation']
  },
  '/achievements': {
    path: '/achievements',
    title: 'Badges & Trophy Hall',
    hindiTitle: 'उपलब्धियां और पुरस्कार',
    category: 'core',
    description: 'Meaningful rewards tied strictly to verified study activities, topic mastery, spaced recall, and healthy daily habit bounds.',
    iconName: 'Award',
    badge: 'Healthy Habits',
    badgeColor: 'bg-amber-400/20 text-amber-300 border-amber-400/30',
    status: 'active',
    features: ['Verified Activity Streaks', 'Healthy Daily XP Cap', 'Topic Mastery & Recall Badges', 'Personal Progress Timeline']
  },
  '/guardian': {
    path: '/guardian',
    title: 'Guardian & Privacy Portal',
    hindiTitle: 'अभिभावक पोर्टल',
    category: 'system',
    description: 'Verified student-approved guardian linking, learning progress & goals summaries, and granular privacy permission controls.',
    iconName: 'ShieldCheck',
    badge: 'Privacy First',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    status: 'active',
    allowedRoles: ['guardian', 'student', 'admin'],
    features: ['Code-Verified Account Linking', 'Progress & Goals Overview', 'Student Permission Toggles', 'Private Chat & Note Isolation']
  },
  '/settings': {
    path: '/settings',
    title: 'Profile & Curriculum Settings',
    hindiTitle: 'सेटिंग्स',
    category: 'system',
    description: 'Configure your board (CBSE, ICSE, State), grade (Class 6-12), language, accessibility, and theme.',
    iconName: 'Settings',
    status: 'active',
    features: ['Board & Class Grade Switching', 'Theme Selector (Dark/Light)', 'Language Preference (EN/HI)', 'Guardian Notification Link']
  },
  '/admin': {
    path: '/admin',
    title: 'Admin Platform Console',
    hindiTitle: 'प्रशासक कंसोल',
    category: 'system',
    description: 'System telemetry, user role governance, curriculum management, and security audit log.',
    iconName: 'ShieldAlert',
    badge: 'Staff Only',
    badgeColor: 'bg-red-500/20 text-red-300 border-red-500/30',
    status: 'active',
    allowedRoles: ['admin'],
    features: ['Role-Based Governance (RBAC)', 'Curriculum Version Control', 'Firestore Hardening Status', 'API Latency Telemetry']
  }
};

export const NAV_SECTIONS = [
  {
    title: 'Main Hub',
    routes: ['/dashboard', '/achievements'] as AppRoute[],
  },
  {
    title: 'AI Tutoring & STEM',
    routes: (FEATURE_FLAGS.visualLearningEnabled
      ? ['/ai-teacher', '/doubt-solver', '/visual-lab', '/voice-learning']
      : ['/ai-teacher', '/doubt-solver', '/voice-learning']) as AppRoute[],
  },
  {
    title: 'Cognitive & Recall',
    routes: ['/learning-intelligence', '/memory-booster', '/mindmaps'] as AppRoute[],
  },
  {
    title: 'Exams & Practice',
    routes: ['/practice', '/exam-simulator', '/collaborative-learning'] as AppRoute[],
  },
  {
    title: 'System & Governance',
    routes: ['/guardian', '/settings', '/admin'] as AppRoute[],
  }
];
