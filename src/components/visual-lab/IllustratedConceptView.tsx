import React from 'react';
import { BookOpenCheck, Scale } from 'lucide-react';
import type { IllustratedConceptVisualConfig, VisualLanguage } from '../../types/phase3';

interface IllustratedConceptViewProps {
  config: IllustratedConceptVisualConfig;
  language: VisualLanguage;
  activeStepIndex: number;
  onSelectCardStep?: (index: number) => void;
}

const ACCENT_MAP = {
  indigo: 'border-indigo-500/40 bg-indigo-950/25 text-indigo-200',
  cyan: 'border-cyan-500/40 bg-cyan-950/25 text-cyan-200',
  emerald: 'border-emerald-500/40 bg-emerald-950/25 text-emerald-200',
  amber: 'border-amber-500/40 bg-amber-950/25 text-amber-200',
};

export const IllustratedConceptView: React.FC<IllustratedConceptViewProps> = ({
  config,
  language,
  activeStepIndex,
  onSelectCardStep,
}) => {
  const isHi = language === 'Hindi';

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
            <BookOpenCheck className="w-4 h-4 text-indigo-400" />
            {isHi ? 'संरचित विजुअल अवधारणा मानचित्र' : 'Structured Visual Concept Breakdown'}
          </span>
          <span>
            {config.cards.length} {isHi ? 'चरण' : 'Visual Stages'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {config.cards.map((card, idx) => {
            const active = idx === activeStepIndex;
            const style = ACCENT_MAP[card.accent] || ACCENT_MAP.indigo;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onSelectCardStep?.(idx)}
                className={`text-left rounded-2xl border p-4 transition-all cursor-pointer space-y-2 ${
                  active
                    ? `${style} ring-1 ring-indigo-400`
                    : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">
                    {card.stepBadge}
                  </span>
                  {card.metricOrFormula && (
                    <span className="text-xs font-mono font-semibold text-cyan-300">
                      {card.metricOrFormula}
                    </span>
                  )}
                </div>
                <h4 className="text-sm font-bold text-white leading-snug">{card.title}</h4>
                <p className="text-xs text-slate-300 leading-relaxed">{card.summary}</p>
                <p className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-2">
                  {card.keyPoint}
                </p>
              </button>
            );
          })}
        </div>

        {config.comparisonRows && config.comparisonRows.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center gap-2 text-xs font-bold text-white">
              <Scale className="w-3.5 h-3.5 text-amber-400" />
              <span>{isHi ? 'प्रमुख तुलना' : 'Structured Comparison'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/70 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{isHi ? 'आधार' : 'Dimension'}</th>
                    <th className="px-3 py-2 font-semibold text-cyan-300">
                      {config.leftHeader || (isHi ? 'पक्ष A' : 'Concept A')}
                    </th>
                    <th className="px-3 py-2 font-semibold text-indigo-300">
                      {config.rightHeader || (isHi ? 'पक्ष B' : 'Concept B')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-slate-300">
                  {config.comparisonRows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      <td className="px-3 py-2 font-semibold text-white">{row.aspect}</td>
                      <td className="px-3 py-2">{row.leftLabel}</td>
                      <td className="px-3 py-2">{row.rightLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
