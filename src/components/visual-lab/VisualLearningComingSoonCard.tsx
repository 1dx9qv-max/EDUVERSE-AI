import React from 'react';
import { Atom, ArrowLeft, Clock } from 'lucide-react';
import { Button } from '../common/Button';

interface VisualLearningComingSoonCardProps {
  variant?: 'grid' | 'page';
  onBackToDashboard?: () => void;
}

export const VisualLearningComingSoonCard: React.FC<VisualLearningComingSoonCardProps> = ({
  variant = 'grid',
  onBackToDashboard,
}) => {
  if (variant === 'page') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center py-8 px-2">
        <div
          role="region"
          aria-label="Visual Learning Coming Soon"
          data-testid="visual-learning-coming-soon-page"
          className="w-full max-w-lg rounded-2xl bg-slate-900/90 border border-slate-800 p-6 sm:p-8 shadow-2xl space-y-5 text-center relative overflow-hidden"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-20 w-48 h-48 rounded-full bg-indigo-500/10 blur-3xl"
          />

          <div className="flex items-center justify-center">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/25 text-[11px] font-semibold text-amber-300">
              <Clock className="w-3.5 h-3.5" />
              Under Development
            </span>
          </div>

          <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-800/80 border border-indigo-500/25 flex items-center justify-center text-indigo-300 shadow-lg shadow-indigo-500/10">
            <Atom className="w-7 h-7" />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-wider text-white uppercase">
              VISUAL LEARNING
            </h1>
            <p className="text-sm sm:text-base font-bold tracking-widest text-indigo-300 uppercase">
              COMING SOON
            </p>
          </div>

          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md mx-auto">
            We are upgrading our visual learning studio to bring higher accuracy and richer concept
            clarity across Science, Mathematics, and Geography.
          </p>

          {onBackToDashboard && (
            <div className="pt-2 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onBackToDashboard}
                icon={<ArrowLeft className="w-3.5 h-3.5" />}
              >
                Back to Dashboard
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Visual Learning Coming Soon"
      aria-disabled="true"
      data-testid="visual-learning-coming-soon-card"
      className="text-left rounded-2xl bg-slate-900/75 border border-slate-800/90 flex flex-col justify-between p-4 shadow-sm select-none relative overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-12 -right-12 w-28 h-28 rounded-full bg-indigo-500/10 blur-2xl"
      />

      <div className="w-full relative">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl bg-slate-800/70 border border-slate-700/60 text-indigo-300/80 flex items-center justify-center shrink-0">
            <Atom className="w-4 h-4 text-indigo-300" />
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/25 text-[10px] font-semibold text-amber-300 whitespace-nowrap">
            Under Development
          </span>
        </div>

        <h3 className="text-xs font-extrabold tracking-wider text-white uppercase">
          VISUAL LEARNING
        </h3>
        <p className="text-[11px] font-bold tracking-widest text-indigo-300 uppercase mt-0.5">
          COMING SOON
        </p>
        <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
          Temporarily paused while we build an upgraded visual generation experience.
        </p>
      </div>

      <div className="w-full mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-medium text-slate-500">
        <span>Under Development</span>
        <Clock className="w-3.5 h-3.5 text-slate-500" />
      </div>
    </div>
  );
};
