import React, { Suspense, lazy, useEffect } from 'react';
import { LogOut, Sparkles } from 'lucide-react';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RouterProvider, useRouter } from './router/Router';
import { DashboardShell } from './components/layout/DashboardShell';
import { AuthPortal } from './components/auth/AuthPortal';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { Button } from './components/common/Button';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const AITeacherPage = lazy(() => import('./pages/AITeacherPage').then((m) => ({ default: m.AITeacherPage })));
const DoubtSolverPage = lazy(() => import('./pages/DoubtSolverPage').then((m) => ({ default: m.DoubtSolverPage })));
const VisualLabPage = lazy(() => import('./pages/VisualLabPage').then((m) => ({ default: m.VisualLabPage })));
const MindMapsPage = lazy(() => import('./pages/MindMapsPage').then((m) => ({ default: m.MindMapsPage })));
const PracticePage = lazy(() => import('./pages/PracticePage').then((m) => ({ default: m.PracticePage })));
const LearningIntelligencePage = lazy(() =>
  import('./pages/LearningIntelligencePage').then((m) => ({ default: m.LearningIntelligencePage }))
);
const MemoryBoosterPage = lazy(() =>
  import('./pages/MemoryBoosterPage').then((m) => ({ default: m.MemoryBoosterPage }))
);
const ExamSimulatorPage = lazy(() =>
  import('./pages/ExamSimulatorPage').then((m) => ({ default: m.ExamSimulatorPage }))
);
const VoiceLearningPage = lazy(() =>
  import('./pages/VoiceLearningPage').then((m) => ({ default: m.VoiceLearningPage }))
);
const StudyPodsPage = lazy(() => import('./pages/StudyPodsPage').then((m) => ({ default: m.StudyPodsPage })));
const BadgesPage = lazy(() => import('./pages/BadgesPage').then((m) => ({ default: m.BadgesPage })));
const GuardianPortalPage = lazy(() =>
  import('./pages/GuardianPortalPage').then((m) => ({ default: m.GuardianPortalPage }))
);

const RouteLoadingFallback: React.FC = () => (
  <div className="min-h-[50vh] w-full flex items-center justify-center p-8">
    <div className="flex items-center gap-3 text-xs font-medium text-slate-400">
      <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      <span>Loading workspace...</span>
    </div>
  </div>
);

function AppContent() {
  const { currentRoute, navigate } = useRouter();
  const { user, loading, signOut } = useAuth();

  const isAuthScreenRoute =
    currentRoute === '/' || currentRoute === '/login' || currentRoute === '/signup';
  const needsOnboarding = Boolean(user && (!user.onboardingCompleted || !user.username));

  useEffect(() => {
    if (!loading && user && !needsOnboarding && isAuthScreenRoute) {
      navigate('/dashboard');
    }
  }, [loading, user, needsOnboarding, isAuthScreenRoute, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 text-slate-200">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        <div className="flex items-center gap-2.5 text-xs font-medium text-slate-400">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <span>Verifying EDUVERSE AI session...</span>
        </div>
      </div>
    );
  }

  // Strictly block all private dashboards & routes until authenticated
  if (!user) {
    return <AuthPortal initialMode={currentRoute === '/signup' ? 'signup' : 'login'} />;
  }

  // First-time users must claim a unique username and set academic profile before entering dashboard
  if (needsOnboarding) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-500 to-purple-500 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="font-extrabold text-base tracking-tight text-white">EDUVERSE AI</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-xs text-slate-400 truncate max-w-[220px]">
                {user.email}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => signOut()}
                icon={<LogOut className="w-3.5 h-3.5" />}
              >
                Sign Out
              </Button>
            </div>
          </div>
        </header>
        <main className="flex-1">
          <OnboardingWizard />
        </main>
      </div>
    );
  }

  const effectiveRoute = isAuthScreenRoute ? '/dashboard' : currentRoute;

  return (
    <DashboardShell>
      <Suspense fallback={<RouteLoadingFallback />}>
        {effectiveRoute === '/dashboard' && <DashboardPage />}
        {effectiveRoute === '/ai-teacher' && <AITeacherPage />}
        {effectiveRoute === '/doubt-solver' && <DoubtSolverPage />}
        {effectiveRoute === '/visual-lab' && <VisualLabPage />}
        {effectiveRoute === '/mindmaps' && <MindMapsPage />}
        {effectiveRoute === '/practice' && <PracticePage />}
        {effectiveRoute === '/learning-intelligence' && <LearningIntelligencePage />}
        {effectiveRoute === '/memory-booster' && <MemoryBoosterPage />}
        {effectiveRoute === '/exam-simulator' && <ExamSimulatorPage />}
        {effectiveRoute === '/voice-learning' && <VoiceLearningPage />}
        {effectiveRoute === '/collaborative-learning' && <StudyPodsPage />}
        {effectiveRoute === '/achievements' && <BadgesPage />}
        {effectiveRoute === '/guardian' && <GuardianPortalPage />}
        {effectiveRoute === '/settings' && <SettingsPage />}
        {effectiveRoute === '/admin' && <AdminPage />}
      </Suspense>
    </DashboardShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider>
          <AppContent />
        </RouterProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
