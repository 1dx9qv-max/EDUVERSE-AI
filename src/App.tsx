import React, { Suspense, lazy, useEffect } from 'react';
import { CalendarDays, LogOut } from 'lucide-react';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RouterProvider, useRouter } from './router/Router';
import { DashboardShell } from './components/layout/DashboardShell';
import { AuthPortal } from './components/auth/AuthPortal';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { Button } from './components/common/Button';

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const DatesheetAnalyzerPage = lazy(() =>
  import('./pages/DatesheetAnalyzerPage').then((m) => ({ default: m.DatesheetAnalyzerPage }))
);
const ComingSoonModulePage = lazy(() =>
  import('./pages/ComingSoonModulePage').then((m) => ({ default: m.ComingSoonModulePage }))
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);

const RouteLoadingFallback: React.FC = () => (
  <div className="min-h-[50vh] w-full flex items-center justify-center p-8">
    <div className="flex items-center gap-3 text-xs font-medium text-slate-500 dark:text-slate-400">
      <div className="w-4 h-4 rounded-full border-2 border-indigo-600 dark:border-indigo-400 border-t-transparent animate-spin" />
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
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center gap-4 text-slate-700 dark:text-slate-200">
        <div className="w-11 h-11 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/20">
          <CalendarDays className="w-5 h-5 text-white" />
        </div>
        <div className="flex items-center gap-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-600 dark:border-indigo-400 border-t-transparent animate-spin" />
          <span>Verifying EDUVERSE AI session...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPortal initialMode={currentRoute === '/signup' ? 'signup' : 'login'} />;
  }

  if (needsOnboarding) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shadow-xs">
                <CalendarDays className="w-4 h-4 text-white" />
              </div>
              <span className="font-extrabold text-base tracking-tight text-slate-900 dark:text-white">
                EDUVERSE AI
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 truncate max-w-[220px]">
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

  const renderPage = () => {
    switch (effectiveRoute) {
      case '/dashboard':
        return <DashboardPage />;
      case '/datesheet-analyzer':
        return <DatesheetAnalyzerPage />;
      case '/study-planner':
        return <ComingSoonModulePage route="/study-planner" />;
      case '/sample-papers':
        return <ComingSoonModulePage route="/sample-papers" />;
      case '/exam-mode':
        return <ComingSoonModulePage route="/exam-mode" />;
      case '/personal-advisor':
        return <ComingSoonModulePage route="/personal-advisor" />;
      case '/settings':
        return <SettingsPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <DashboardShell>
      <Suspense fallback={<RouteLoadingFallback />}>{renderPage()}</Suspense>
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
