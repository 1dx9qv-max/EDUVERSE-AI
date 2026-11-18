import React, { useEffect, useId, useState } from 'react';
import { Crosshair, Layers } from 'lucide-react';
import type { AnnotatedDiagramVisualConfig, VisualLanguage } from '../../types/phase3';

interface AnnotatedDiagramRendererProps {
  config: AnnotatedDiagramVisualConfig;
  language: VisualLanguage;
  showLabels: boolean;
  presetTrigger?: Record<string, number | string> | null;
}

const THEME_STYLES: Record<
  AnnotatedDiagramVisualConfig['backgroundTheme'],
  { gridStroke: string; bgTint: string }
> = {
  bio: { gridStroke: '#134e4a', bgTint: 'rgba(16, 185, 129, 0.05)' },
  geo: { gridStroke: '#3f2e18', bgTint: 'rgba(245, 158, 11, 0.05)' },
  chem: { gridStroke: '#1e1b4b', bgTint: 'rgba(99, 102, 241, 0.05)' },
  phys: { gridStroke: '#0c4a6e', bgTint: 'rgba(56, 189, 248, 0.05)' },
};

export const AnnotatedDiagramRenderer: React.FC<AnnotatedDiagramRendererProps> = ({
  config,
  language,
  showLabels,
  presetTrigger,
}) => {
  const isHi = language === 'Hindi';
  const markerUid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [selectedId, setSelectedId] = useState<string>(config.hotspots[0]?.id || '');

  useEffect(() => {
    setSelectedId(config.hotspots[0]?.id || '');
  }, [config]);

  useEffect(() => {
    const target = presetTrigger?.highlightTarget;
    if (typeof target === 'string' && target.trim()) {
      const match = config.hotspots.find(
        (h) =>
          h.id.toLowerCase() === target.toLowerCase() ||
          h.label.toLowerCase().includes(target.toLowerCase())
      );
      if (match) setSelectedId(match.id);
    }
  }, [presetTrigger, config.hotspots]);

  const activeHotspot =
    config.hotspots.find((h) => h.id === selectedId) || config.hotspots[0];
  const theme = THEME_STYLES[config.backgroundTheme] || THEME_STYLES.bio;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            {isHi ? 'क्लिक करने योग्य लेबल आरेख' : 'Interactive Annotated Diagram'} ·{' '}
            <span className="capitalize">{config.layoutKind.replace('-', ' ')}</span>
          </span>
          {config.legend.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {config.legend.map((item, idx) => (
                <span key={idx} className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                  <span
                    className="w-2.5 h-2.5 rounded-sm inline-block"
                    style={{ backgroundColor: item.color }}
                  />
                  {item.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <svg
          viewBox="0 0 600 360"
          className="w-full h-auto rounded-xl bg-slate-900/70 border border-slate-800/80"
          role="img"
          aria-label="Interactive Annotated Concept Diagram"
        >
          <defs>
            <marker
              id={`arrow-${markerUid}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
            </marker>
          </defs>

          <rect x={0} y={0} width={600} height={360} fill={theme.bgTint} />
          {[90, 180, 270].map((y) => (
            <line key={`hy_${y}`} x1={0} y1={y} x2={600} y2={y} stroke={theme.gridStroke} strokeOpacity={0.28} />
          ))}
          {[150, 300, 450].map((x) => (
            <line key={`vx_${x}`} x1={x} y1={0} x2={x} y2={360} stroke={theme.gridStroke} strokeOpacity={0.28} />
          ))}

          {/* Shapes */}
          {config.shapes.map((sh) => {
            const common = {
              fill: sh.fill || 'rgba(56, 189, 248, 0.16)',
              stroke: sh.stroke || '#38bdf8',
              strokeWidth: sh.strokeWidth ?? 2,
              strokeDasharray: sh.dashed ? '5 4' : undefined,
              opacity: sh.opacity ?? 0.9,
            };

            let node: React.ReactNode = null;
            if (sh.kind === 'circle') {
              node = <circle cx={sh.x ?? 300} cy={sh.y ?? 180} r={sh.r ?? 36} {...common} />;
            } else if (sh.kind === 'ellipse') {
              node = (
                <ellipse
                  cx={sh.x ?? 300}
                  cy={sh.y ?? 180}
                  rx={sh.rx ?? 60}
                  ry={sh.ry ?? 34}
                  {...common}
                />
              );
            } else if (sh.kind === 'rect') {
              node = (
                <rect
                  x={(sh.x ?? 300) - (sh.width ?? 120) / 2}
                  y={(sh.y ?? 180) - (sh.height ?? 60) / 2}
                  width={sh.width ?? 120}
                  height={sh.height ?? 60}
                  rx={10}
                  {...common}
                />
              );
            } else if (sh.kind === 'line') {
              node = (
                <line
                  x1={sh.x ?? 100}
                  y1={sh.y ?? 180}
                  x2={sh.x2 ?? 500}
                  y2={sh.y2 ?? 180}
                  {...common}
                />
              );
            } else if (sh.kind === 'polygon' && sh.points) {
              node = <polygon points={sh.points} {...common} />;
            } else if (sh.kind === 'path' && sh.d) {
              node = <path d={sh.d} {...common} />;
            }

            return (
              <g key={sh.id}>
                {node}
                {showLabels && sh.label && sh.x !== undefined && sh.y !== undefined && (
                  <text
                    x={sh.x}
                    y={sh.y + 4}
                    textAnchor="middle"
                    fill="#e2e8f0"
                    fontSize={11}
                    fontWeight="600"
                  >
                    {sh.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Flow Arrows */}
          {config.arrows.map((arr) => (
            <g key={arr.id}>
              <line
                x1={arr.fromX}
                y1={arr.fromY}
                x2={arr.toX}
                y2={arr.toY}
                stroke={arr.color || '#38bdf8'}
                strokeWidth={2.2}
                strokeDasharray={arr.dashed ? '5 4' : undefined}
                markerEnd={`url(#arrow-${markerUid})`}
              />
              {showLabels && arr.label && (
                <text
                  x={(arr.fromX + arr.toX) / 2}
                  y={(arr.fromY + arr.toY) / 2 - 7}
                  textAnchor="middle"
                  fill="#93c5fd"
                  fontSize={10}
                  fontWeight="600"
                >
                  {arr.label}
                </text>
              )}
            </g>
          ))}

          {/* Interactive Hotspots */}
          {config.hotspots.map((hs, idx) => {
            const active = activeHotspot?.id === hs.id;
            return (
              <g
                key={hs.id}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${hs.label}`}
                className="cursor-pointer focus:outline-none"
                onClick={() => setSelectedId(hs.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedId(hs.id);
                  }
                }}
              >
                <circle
                  cx={hs.x}
                  cy={hs.y}
                  r={active ? 15 : 12}
                  fill={active ? '#4f46e5' : '#0f172a'}
                  stroke={active ? '#c7d2fe' : '#38bdf8'}
                  strokeWidth={2}
                />
                <text
                  x={hs.x}
                  y={hs.y + 4}
                  textAnchor="middle"
                  fill="#fff"
                  fontSize={10}
                  fontWeight="800"
                >
                  {idx + 1}
                </text>
                {showLabels && (
                  <text
                    x={hs.x}
                    y={hs.y > 300 ? hs.y - 18 : hs.y + 24}
                    textAnchor="middle"
                    fill={active ? '#fff' : '#cbd5e1'}
                    fontSize={10}
                    fontWeight={active ? '700' : '600'}
                  >
                    {hs.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hotspot Quick Buttons */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {config.hotspots.map((hs, idx) => {
            const active = activeHotspot?.id === hs.id;
            return (
              <button
                key={hs.id}
                type="button"
                onClick={() => setSelectedId(hs.id)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                {idx + 1}. {hs.label}
              </button>
            );
          })}
        </div>

        {/* Selected Hotspot Inspector */}
        {activeHotspot && (
          <div className="mt-3 rounded-xl bg-slate-900 border border-slate-800 p-3.5 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-white inline-flex items-center gap-1.5">
                <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                {activeHotspot.label}
              </p>
              {activeHotspot.category && (
                <span className="text-[11px] font-semibold text-cyan-300">
                  {activeHotspot.category}
                </span>
              )}
            </div>
            <p className="text-xs font-medium text-indigo-200">{activeHotspot.summary}</p>
            <p className="text-xs text-slate-300 leading-relaxed">{activeHotspot.detail}</p>
          </div>
        )}
      </div>
    </div>
  );
};
