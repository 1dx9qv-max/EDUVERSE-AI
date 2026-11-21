import React from 'react';
import {
  CalendarDays,
  ClipboardList,
  Clock,
  Compass,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Settings,
} from 'lucide-react';
import { MODULE_REGISTRY, NAV_SECTIONS } from '../../constants/navigation';
import { useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import { AppRoute } from '../../types/modules';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  LayoutDashboard: <LayoutDashboard className="w-4 h-4" />,
  CalendarDays: <CalendarDays className="w-4 h-4" />,
  ClipboardList: <ClipboardList className="w-4 h-4" />,
  FileText: <FileText className="w-4 h-4" />,
  Clock: <Clock className="w-4 h-4" />,
  Compass: <Compass className="w-4 h-4" />,
  Settings: <Settings className="w-4 h-4" />,
};

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { currentRoute, navigate } = useRouter();
  const { user } = useAuth();

  const handleNavClick = (route: AppRoute) => {
    navigate(route);
    onClose();
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-xs lg:hidden transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-16 bottom-0 left-0 z-40 w-64 bg-white dark:bg-slate-950/95 border-r border-slate-200 dark:border-slate-800/80 p-4 overflow-y-auto transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full justify-between gap-5">
          <nav className="space-y-6" aria-label="Main navigation">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title} className="space-y-1.5">
                <h3 className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  {section.title}
                </h3>
                <div className="space-y-0.5">
                  {section.routes.map((routeKey) => {
                    const item = MODULE_REGISTRY[routeKey];
                    if (!item) return null;
                    const isActive = currentRoute === item.path;
                    const isComingSoon = item.status === 'coming-soon';

                    return (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => handleNavClick(item.path)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all group cursor-pointer ${
                          isActive
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-600/15 dark:text-indigo-300 dark:border-indigo-500/30 font-semibold'
                            : isComingSoon
                              ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/80 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-900'
                              : 'text-slate-700 hover:text-slate-950 hover:bg-slate-100 dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`shrink-0 ${
                              isActive
                                ? 'text-indigo-600 dark:text-indigo-400'
                                : isComingSoon
                                  ? 'text-slate-400 dark:text-slate-500'
                                  : 'text-slate-500 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200'
                            }`}
                          >
                            {ICON_MAP[item.iconName] || <CalendarDays className="w-4 h-4" />}
                          </span>
                          <span className="truncate">{item.shortTitle || item.title}</span>
                        </div>

                        {isComingSoon && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0">
                            Soon
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {user && (
            <div className="rounded-2xl p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 shrink-0">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {user.displayName}
                  </p>
                  <p className="text-[10px] text-indigo-600 dark:text-indigo-300 font-medium truncate">
                    {user.board} • {user.classGrade}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-800">
                <span>
                  Medium:{' '}
                  <strong className="text-slate-800 dark:text-slate-200">{user.language}</strong>
                </span>
                {user.username && (
                  <span className="text-indigo-600 dark:text-indigo-400 font-medium truncate max-w-[100px]">
                    @{user.username}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
