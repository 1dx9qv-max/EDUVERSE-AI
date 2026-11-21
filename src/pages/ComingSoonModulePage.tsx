import React from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Compass,
  FileText,
  LayoutDashboard,
} from 'lucide-react';
import { MODULE_REGISTRY } from '../constants/navigation';
import { useRouter } from '../router/Router';
import type { AppRoute } from '../types/modules';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';

interface ComingSoonModulePageProps {
  route: Extract<
    AppRoute,
    '/study-planner' | '/sample-papers' | '/exam-mode' | '/personal-advisor'
  >;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ClipboardList,
  FileText,
  Clock,
  Compass,
};

export const ComingSoonModulePage: React.FC<ComingSoonModulePageProps> = ({ route }) => {
  const { navigate } = useRouter();
  const meta = MODULE_REGISTRY[route];
  const Icon = ICONS[meta.iconName] || ClipboardList;

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-4">
      <Card className="p-6 sm:p-8 space-y-6 border-indigo-200 dark:border-indigo-500/25">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
              <Icon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider">
                <span className="text-indigo-600 dark:text-indigo-400">
                  Module 0{meta.moduleNumber}
                </span>
                <span className="text-slate-300 dark:text-slate-700">•</span>
                <span className="text-amber-700 dark:text-amber-400">Coming Soon</span>
              </div>
              <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
                {meta.title}
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
                {meta.description}
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Planned Integration with Your Verified Datesheet
          </p>
          <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
            {meta.features.map((feat, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                <span>{feat}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-4 rounded-xl bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25 text-xs text-slate-700 dark:text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p>
            Prepare your schedule now in <strong>Module 01: Exam Datesheet Analyzer</strong> so this
            module can read your confirmed exam dates as soon as it launches.
          </p>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate('/dashboard')}
              icon={<LayoutDashboard className="w-3.5 h-3.5" />}
            >
              Dashboard
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => navigate('/datesheet-analyzer')}
              icon={<CalendarDays className="w-3.5 h-3.5" />}
            >
              Open Module 1
              <ArrowRight className="w-3.5 h-3.5 ml-1 inline" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
