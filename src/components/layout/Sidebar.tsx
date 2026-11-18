import React from 'react';
import { 
  LayoutDashboard, 
  Bot, 
  HelpCircle, 
  Atom, 
  Target, 
  BrainCircuit, 
  Zap, 
  GitFork, 
  Clock, 
  Mic, 
  Users, 
  Award, 
  Settings, 
  ShieldAlert, 
  ShieldCheck,
  Sparkles,
  ChevronRight,
  GraduationCap
} from 'lucide-react';
import { MODULE_REGISTRY, NAV_SECTIONS } from '../../constants/navigation';
import { useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import { AppRoute } from '../../types/modules';
import { hasRoleAccess } from '../../utils/curriculum';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  Sparkles: <Sparkles className="w-4 h-4" />,
  LayoutDashboard: <LayoutDashboard className="w-4 h-4" />,
  Bot: <Bot className="w-4 h-4" />,
  HelpCircle: <HelpCircle className="w-4 h-4" />,
  Atom: <Atom className="w-4 h-4" />,
  Target: <Target className="w-4 h-4" />,
  BrainCircuit: <BrainCircuit className="w-4 h-4" />,
  Zap: <Zap className="w-4 h-4" />,
  GitFork: <GitFork className="w-4 h-4" />,
  Clock: <Clock className="w-4 h-4" />,
  Mic: <Mic className="w-4 h-4" />,
  Users: <Users className="w-4 h-4" />,
  Award: <Award className="w-4 h-4" />,
  Settings: <Settings className="w-4 h-4" />,
  ShieldAlert: <ShieldAlert className="w-4 h-4" />,
  ShieldCheck: <ShieldCheck className="w-4 h-4" />
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
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm lg:hidden transition-opacity" 
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-16 bottom-0 left-0 z-40 w-64 bg-slate-950/95 border-r border-slate-800/80 p-4 overflow-y-auto transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full justify-between gap-4">
          <nav className="space-y-6">
            {NAV_SECTIONS.map((section, sIdx) => {
              // Filter routes based on user role
              const accessibleRoutes = section.routes.filter((routeKey) => {
                const meta = MODULE_REGISTRY[routeKey];
                return hasRoleAccess(user?.role || 'student', meta?.allowedRoles);
              });

              if (accessibleRoutes.length === 0) return null;

              return (
                <div key={sIdx} className="space-y-1">
                  <h3 className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {section.title}
                  </h3>
                  <div className="space-y-0.5">
                    {accessibleRoutes.map((routeKey) => {
                      const item = MODULE_REGISTRY[routeKey];
                      if (!item) return null;
                      const isActive = currentRoute === item.path;

                      return (
                        <button
                          key={item.path}
                          onClick={() => handleNavClick(item.path)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all group cursor-pointer ${
                            isActive
                              ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 font-semibold shadow-sm shadow-indigo-500/5'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <span className={isActive ? 'text-indigo-400' : 'text-slate-400 group-hover:text-slate-300'}>
                              {ICON_MAP[item.iconName] || <Sparkles className="w-4 h-4" />}
                            </span>
                            <span className="truncate">{item.title}</span>
                          </div>

                          {item.badge && (
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold tracking-tight border uppercase ${
                                item.badgeColor || 'bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Bottom Card: Student Context Badge */}
          {user && (
            <div className="rounded-2xl p-3.5 bg-gradient-to-b from-slate-900 to-indigo-950/40 border border-indigo-500/20">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-1 rounded-lg bg-indigo-500/20 text-indigo-300">
                  <GraduationCap className="w-4 h-4" />
                </div>
                <div className="truncate">
                  <p className="text-xs font-bold text-white truncate">{user.displayName}</p>
                  <p className="text-[10px] text-indigo-300">{user.board} • {user.classGrade}</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
                <span>Language: <strong className="text-slate-200">{user.language}</strong></span>
                <span className="text-emerald-400 font-semibold">Active</span>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
