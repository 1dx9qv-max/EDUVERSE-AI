import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Flame,
  Moon,
  Sun,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useRouter, Link } from '../../router/Router';
import { loadVerifiedMotivationDashboard } from '../../lib/firestoreService';
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
  const [verifiedStats, setVerifiedStats] = useState<{ streakDays: number; totalVerifiedXp: number } | null>(null);

  const isPublicPage = currentRoute === '/' || currentRoute === '/login' || currentRoute === '/signup';

  useEffect(() => {
    if (!user?.uid || isPublicPage) {
      setVerifiedStats(null);
      return;
    }
    let active = true;
    const refreshStats = () => {
      loadVerifiedMotivationDashboard(user.uid)
        .then((summary) => {
          if (!active) return;
          setVerifiedStats({
            streakDays: summary.streakDays,
            totalVerifiedXp: summary.totalVerifiedXp,
          });
        })
        .catch(() => {});
    };

    refreshStats();
    window.addEventListener('eduverse:stats-dirty', refreshStats);
    return () => {
      active = false;
      window.removeEventListener('eduverse:stats-dirty', refreshStats);
    };
  }, [user?.uid, isPublicPage]);

  const displayedStreak = verifiedStats ? verifiedStats.streakDays : 0;
  const displayedXp = verifiedStats ? verifiedStats.totalVerifiedXp : 0;
  const avatarPreset = getAvatarPreset(user?.avatarId);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2 h-16 min-w-0">
          {/* Left section: Logo and Sidebar trigger */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {!isPublicPage && onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-indigo-500 lg:hidden shrink-0 cursor-pointer"
                aria-label="Toggle navigation drawer"
              >
                {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}

            <Link to="/dashboard" className="flex items-center gap-2 sm:gap-2.5 group min-w-0">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-blue-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/25 group-hover:scale-105 transition-transform duration-200 shrink-0">
                <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-base sm:text-lg tracking-tight bg-gradient-to-r from-white via-indigo-100 to-indigo-300 bg-clip-text text-transparent truncate">
                    EDUVERSE
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 tracking-wider shrink-0">
                    AI
                  </span>
                </div>
                <span className="hidden sm:block text-[10px] text-slate-400 -mt-1 tracking-wider uppercase font-medium">
                  Class 6 - 12 • CBSE • ICSE • State
                </span>
              </div>
            </Link>
          </div>

          {/* Center: Authenticated Student Status */}
          {user && !isPublicPage && (
            <div className="hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 shrink-0">
              <span className="flex items-center gap-1 text-xs font-semibold text-indigo-300">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                {user.board} • {user.classGrade}
              </span>
              <span className="text-slate-600">•</span>
              <span className="flex items-center gap-1 text-xs font-medium text-amber-400 tabular-nums">
                <Flame className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                {displayedStreak} Day Streak
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs font-semibold text-emerald-400 tabular-nums">
                {displayedXp.toLocaleString()} XP
              </span>
            </div>
          )}

          {/* Right section: Theme & Real Profile Menu */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors cursor-pointer"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-indigo-400" />
              )}
            </button>

            {user ? (
              <div className="relative">
                <button
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex items-center gap-2 p-1 pl-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
                >
                  <div
                    className={`w-7 h-7 rounded-lg bg-gradient-to-tr ${avatarPreset.gradient} flex items-center justify-center text-xs font-bold text-white overflow-hidden shrink-0`}
                  >
                    {user.photoURL ? (
                      <img src={user.photoURL} alt={user.displayName} className="w-full h-full object-cover" />
                    ) : (
                      user.displayName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="hidden sm:flex flex-col items-start leading-tight text-left max-w-[120px]">
                    <span className="text-xs font-semibold text-slate-200 truncate w-full">
                      {user.displayName.split(' ')[0]}
                    </span>
                    {user.username && (
                      <span className="text-[10px] text-indigo-400 truncate w-full">
                        @{user.username}
                      </span>
                    )}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 mr-1" />
                </button>

                {showProfileMenu && (
                  <div
                    className="absolute right-0 mt-2 w-60 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                    onClick={() => setShowProfileMenu(false)}
                  >
                    <div className="px-3 py-2 border-b border-slate-800 mb-1 space-y-0.5">
                      <p className="text-xs font-bold text-slate-100 truncate">{user.displayName}</p>
                      {user.username && (
                        <p className="text-[11px] font-semibold text-indigo-400 truncate">
                          @{user.username}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
                      <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                        <Badge size="sm" variant="purple">{user.board}</Badge>
                        <Badge size="sm" variant="default">{user.classGrade}</Badge>
                      </div>
                    </div>

                    <button
                      onClick={() => navigate('/dashboard')}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Dashboard
                    </button>
                    <button
                      onClick={() => navigate('/settings')}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Profile &amp; Account Settings
                    </button>
                    <button
                      onClick={() => navigate('/guardian')}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs text-emerald-300 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                    >
                      Guardian &amp; Privacy Portal
                    </button>
                    {user.role === 'admin' && (
                      <button
                        onClick={() => navigate('/admin')}
                        className="w-full text-left px-3 py-2 rounded-xl text-xs text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      >
                        Admin Console
                      </button>
                    )}
                    <div className="my-1 border-t border-slate-800" />
                    <button
                      onClick={() => signOut()}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 transition-colors cursor-pointer"
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
