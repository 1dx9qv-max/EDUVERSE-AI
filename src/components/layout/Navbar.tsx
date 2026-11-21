import React, { useEffect, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  Layers,
  LogOut,
  Menu,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Link, useRouter } from '../../router/Router';
import { fetchExamDatesheets } from '../../lib/firestoreService';
import { buildDashboardExamSummary } from '../../utils/datesheetEngine';
import { getAvatarPreset } from '../../utils/usernameValidation';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface NavbarProps {
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar, isSidebarOpen }) => {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { currentRoute, navigate } = useRouter();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [nextExamSummary, setNextExamSummary] = useState<{
    subject: string;
    daysRemaining: number;
  } | null>(null);

  const isPublicPage =
    currentRoute === '/' || currentRoute === '/login' || currentRoute === '/signup';

  useEffect(() => {
    if (!user?.uid || isPublicPage) {
      setNextExamSummary(null);
      return;
    }

    let active = true;
    const refreshHeaderDatesheet = () => {
      fetchExamDatesheets(user.uid)
        .then((datesheets) => {
          if (!active) return;
          const summary = buildDashboardExamSummary(datesheets);
          if (summary.nextExam) {
            setNextExamSummary({
              subject: summary.nextExam.subject,
              daysRemaining: summary.nextExam.daysRemaining,
            });
          } else {
            setNextExamSummary(null);
          }
        })
        .catch(() => {
          if (active) setNextExamSummary(null);
        });
    };

    refreshHeaderDatesheet();
    window.addEventListener('eduverse:datesheet-dirty', refreshHeaderDatesheet);
    return () => {
      active = false;
      window.removeEventListener('eduverse:datesheet-dirty', refreshHeaderDatesheet);
    };
  }, [user?.uid, isPublicPage]);

  const avatarPreset = getAvatarPreset(user?.avatarId);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2 h-16 min-w-0">
          {/* Left: Hamburger + Brand */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {!isPublicPage && onToggleSidebar && (
              <button
                type="button"
                onClick={onToggleSidebar}
                className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-indigo-500 lg:hidden shrink-0 cursor-pointer"
                aria-label="Toggle navigation drawer"
              >
                {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}

            <Link to="/dashboard" className="flex items-center gap-2.5 group min-w-0">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-sm shadow-indigo-600/20 group-hover:scale-105 transition-transform duration-150 shrink-0">
                <CalendarDays className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-base sm:text-lg tracking-tight text-slate-900 dark:text-white truncate">
                    EDUVERSE
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30 tracking-wider shrink-0">
                    AI
                  </span>
                </div>
                <span className="hidden sm:block text-[10px] text-slate-500 dark:text-slate-400 -mt-0.5 tracking-wider uppercase font-semibold truncate">
                  Exam Preparation &amp; Practice
                </span>
              </div>
            </Link>
          </div>

          {/* Center: Authenticated Student Academic Context + Confirmed Next Exam */}
          {user && !isPublicPage && (
            <div className="hidden md:flex items-center gap-3 px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                {user.board} • {user.classGrade}
              </span>
              {nextExamSummary && (
                <>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <button
                    type="button"
                    onClick={() => navigate('/datesheet-analyzer')}
                    className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:underline cursor-pointer"
                  >
                    <span className="truncate max-w-[140px]">{nextExamSummary.subject}</span>
                    <span className="font-mono-num text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-800 dark:text-indigo-200">
                      {nextExamSummary.daysRemaining === 0
                        ? 'Today'
                        : `${nextExamSummary.daysRemaining}d left`}
                    </span>
                  </button>
                </>
              )}
            </div>
          )}

          {/* Right: Theme Switcher + Profile Menu */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors cursor-pointer"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-600" />
              )}
            </button>

            {user ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowProfileMenu((prev) => !prev)}
                  className="flex items-center gap-2 p-1 pl-1.5 pr-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors cursor-pointer"
                  aria-expanded={showProfileMenu}
                  aria-haspopup="menu"
                >
                  <div
                    className={`w-7 h-7 rounded-lg bg-gradient-to-tr ${avatarPreset.gradient} flex items-center justify-center text-xs font-bold text-white overflow-hidden shrink-0`}
                  >
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      user.displayName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="hidden sm:flex flex-col items-start leading-tight text-left max-w-[120px]">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate w-full">
                      {user.displayName.split(' ')[0]}
                    </span>
                    {user.username && (
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 truncate w-full">
                        @{user.username}
                      </span>
                    )}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                </button>

                {showProfileMenu && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-60 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-2 z-50"
                    onClick={() => setShowProfileMenu(false)}
                  >
                    <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 mb-1 space-y-0.5">
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {user.displayName}
                      </p>
                      {user.username && (
                        <p className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 truncate">
                          @{user.username}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {user.email}
                      </p>
                      <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                        <Badge size="sm" variant="purple">
                          {user.board}
                        </Badge>
                        <Badge size="sm" variant="default">
                          {user.classGrade}
                        </Badge>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => navigate('/dashboard')}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Dashboard
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => navigate('/datesheet-analyzer')}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Exam Datesheet Analyzer
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => navigate('/settings')}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Profile &amp; Account Settings
                    </button>

                    <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => signOut()}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
                  Sign In
                </Button>
                <Button variant="primary" size="sm" onClick={() => navigate('/signup')}>
                  Get Started
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
