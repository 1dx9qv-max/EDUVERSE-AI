import React, { useEffect, useId, useMemo, useState } from 'react';
import type {
  GeometryVisualConfig,
  MathPlotVisualConfig,
  VisualLanguage,
} from '../../types/phase3';
import {
  computeNumericDerivative,
  computeSegmentMetrics,
  evaluateSafeMathExpression,
  sampleMathPlotCurve,
} from '../../utils/visualLabEngine';

interface RendererCommonProps {
  language: VisualLanguage;
  showLabels: boolean;
  presetTrigger?: Record<string, number | string> | null;
}

// ==========================================
// 1. SAFE MATH FUNCTION PLOTTER & CALCULUS PROBE
// ==========================================
export const MathFunctionPlotRenderer: React.FC<
  RendererCommonProps & { config: MathPlotVisualConfig }
> = ({ config, language, showLabels, presetTrigger }) => {
  const isHi = language === 'Hindi';
  const uid = useId();
  const [paramA, setParamA] = useState(config.parameterA?.defaultValue ?? 1);
  const [paramB, setParamB] = useState(config.parameterB?.defaultValue ?? 0);
  const [probeX, setProbeX] = useState(
    typeof config.showTangentAtX === 'number' ? config.showTangentAtX : 1
  );

  useEffect(() => {
    setParamA(config.parameterA?.defaultValue ?? 1);
    setParamB(config.parameterB?.defaultValue ?? 0);
    setProbeX(typeof config.showTangentAtX === 'number' ? config.showTangentAtX : 1);
  }, [config]);

  useEffect(() => {
    if (!presetTrigger) return;
    if (typeof presetTrigger.a === 'number') setParamA(presetTrigger.a);
    if (typeof presetTrigger.b === 'number') setParamB(presetTrigger.b);
    if (typeof presetTrigger.x === 'number') setProbeX(presetTrigger.x);
  }, [presetTrigger]);

  const svgW = 600;
  const svgH = 340;
  const pad = 38;
  const plotW = svgW - pad * 2;
  const plotH = svgH - pad * 2;

  const toSvgX = (x: number) =>
    pad + ((x - config.xMin) / (config.xMax - config.xMin)) * plotW;
  const toSvgY = (y: number) =>
    svgH - pad - ((y - config.yMin) / (config.yMax - config.yMin)) * plotH;

  const primaryCurve = config.curves[0];
  const sampledCurves = useMemo(
    () =>
      config.curves.map((curve) => ({
        curve,
        sampled: sampleMathPlotCurve(curve.expression, config.xMin, config.xMax, paramA, paramB, 140),
      })),
    [config.curves, config.xMin, config.xMax, paramA, paramB]
  );

  const probeY = primaryCurve
    ? evaluateSafeMathExpression(primaryCurve.expression, probeX, paramA, paramB)
    : null;
  const probeSlope = primaryCurve
    ? computeNumericDerivative(primaryCurve.expression, probeX, paramA, paramB)
    : null;

  const zeroX = toSvgX(0);
  const zeroY = toSvgY(0);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {sampledCurves.map(({ curve }) => (
              <span key={curve.id} className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ backgroundColor: curve.color }}
                />
                {curve.label}
              </span>
            ))}
          </div>
          {sampledCurves[0]?.sampled.roots.length > 0 && config.highlightRoots !== false && (
            <span className="text-xs text-emerald-300 font-mono tabular-nums">
              {isHi ? 'मूल (Roots)' : 'Roots'}: {sampledCurves[0].sampled.roots.join(', ')}
            </span>
          )}
        </div>

        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto rounded-xl bg-slate-900/60 border border-slate-800/80"
          role="img"
          aria-label="Interactive Function Plot Canvas"
        >
          {/* Axes */}
          {zeroY >= pad && zeroY <= svgH - pad && (
            <line x1={pad} y1={zeroY} x2={svgW - pad} y2={zeroY} stroke="#475569" strokeWidth={1.5} />
          )}
          {zeroX >= pad && zeroX <= svgW - pad && (
            <line x1={zeroX} y1={pad} x2={zeroX} y2={svgH - pad} stroke="#475569" strokeWidth={1.5} />
          )}

          {/* Plot Curves */}
          {sampledCurves.map(({ curve, sampled }) => {
            let d = '';
            let penDown = false;
            for (const pt of sampled.points) {
              if (pt.y === null || pt.y < config.yMin - 20 || pt.y > config.yMax + 20) {
                penDown = false;
                continue;
              }
              const sx = toSvgX(pt.x);
              const sy = toSvgY(pt.y);
              d += `${penDown ? 'L' : 'M'} ${sx.toFixed(1)} ${sy.toFixed(1)} `;
              penDown = true;
            }
            return (
              <g key={curve.id}>
                <path d={d} fill="none" stroke={curve.color} strokeWidth={2.5} />
                {config.highlightRoots !== false &&
                  sampled.roots.map((rootX, idx) => (
                    <circle
                      key={idx}
                      cx={toSvgX(rootX)}
                      cy={zeroY}
                      r={4.5}
                      fill="#10b981"
                      stroke="#ecfdf5"
                      strokeWidth={1.5}
                    />
                  ))}
              </g>
            );
          })}

          {/* Tangent Line & Probe Marker */}
          {probeY !== null &&
            probeY >= config.yMin &&
            probeY <= config.yMax && (
              <g>
                {probeSlope !== null && (
                  <line
                    x1={toSvgX(probeX - 1.4)}
                    y1={toSvgY(probeY - probeSlope * 1.4)}
                    x2={toSvgX(probeX + 1.4)}
                    y2={toSvgY(probeY + probeSlope * 1.4)}
                    stroke="#fbbf24"
                    strokeWidth={1.8}
                    strokeDasharray="4 3"
                  />
                )}
                <circle
                  cx={toSvgX(probeX)}
                  cy={toSvgY(probeY)}
                  r={5.5}
                  fill="#f59e0b"
                  stroke="#fff"
                  strokeWidth={1.5}
                />
                {showLabels && (
                  <text
                    x={Math.min(svgW - 110, toSvgX(probeX) + 10)}
                    y={Math.max(20, toSvgY(probeY) - 10)}
                    fill="#fcd34d"
                    fontSize={11}
                    fontWeight="600"
                  >
                    ({probeX.toFixed(1)}, {probeY.toFixed(2)})
                  </text>
                )}
              </g>
            )}
        </svg>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-3">
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'जाँच बिंदु f(x)' : 'Probe Value f(x)'}</p>
            <p className="text-sm font-bold text-amber-300 tabular-nums">
              {probeY === null ? 'Undefined' : `f(${probeX.toFixed(1)}) = ${probeY.toFixed(2)}`}
            </p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'स्पर्श रेखा ढलान f′(x)' : 'Tangent Slope f′(x)'}</p>
            <p className="text-sm font-bold text-cyan-300 tabular-nums">
              {probeSlope === null ? '—' : probeSlope.toFixed(2)}
            </p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'न्यूनतम / अधिकतम' : 'Min / Max on Window'}</p>
            <p className="text-xs font-bold text-emerald-300 tabular-nums">
              {sampledCurves[0]?.sampled.minPoint?.y ?? '—'} / {sampledCurves[0]?.sampled.maxPoint?.y ?? '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Parameter Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {config.parameterA && (
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
            <label htmlFor={`${uid}-pa`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
              <span>{config.parameterA.label}</span>
              <span className="tabular-nums text-indigo-300">{paramA}</span>
            </label>
            <input
              id={`${uid}-pa`}
              type="range"
              min={config.parameterA.min}
              max={config.parameterA.max}
              step={config.parameterA.step}
              value={paramA}
              onChange={(e) => setParamA(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>
        )}
        {config.parameterB && (
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
            <label htmlFor={`${uid}-pb`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
              <span>{config.parameterB.label}</span>
              <span className="tabular-nums text-cyan-300">{paramB}</span>
            </label>
            <input
              id={`${uid}-pb`}
              type="range"
              min={config.parameterB.min}
              max={config.parameterB.max}
              step={config.parameterB.step}
              value={paramB}
              onChange={(e) => setParamB(Number(e.target.value))}
              className="w-full accent-cyan-400"
            />
          </div>
        )}
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-px`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{isHi ? 'x-जाँच स्थिति' : 'Inspect x'}</span>
            <span className="tabular-nums text-amber-300">{probeX.toFixed(1)}</span>
          </label>
          <input
            id={`${uid}-px`}
            type="range"
            min={config.xMin}
            max={config.xMax}
            step={0.2}
            value={probeX}
            onChange={(e) => setProbeX(Number(e.target.value))}
            className="w-full accent-amber-400"
          />
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 2. COORDINATE GEOMETRY EXPLORER
// ==========================================
export const CoordinateGeometryRenderer: React.FC<
  RendererCommonProps & { config: GeometryVisualConfig }
> = ({ config, language, showLabels }) => {
  const isHi = language === 'Hindi';
  const uid = useId();
  const [points, setPoints] = useState(config.points);

  useEffect(() => {
    setPoints(config.points);
  }, [config]);

  const b = config.coordinateBounds;
  const svgW = 560;
  const svgH = 340;
  const pad = 34;
  const span = Math.min(svgW - pad * 2, svgH - pad * 2);
  const ox = svgW / 2;
  const oy = svgH / 2;
  const scale = span / (2 * b);
  const toSvgX = (x: number) => ox + x * scale;
  const toSvgY = (y: number) => oy - y * scale;

  const ptMap = new Map(points.map((p) => [p.id, p]));
  const primarySegment = config.segments[0];
  const primaryMetrics =
    primarySegment && ptMap.get(primarySegment.fromId) && ptMap.get(primarySegment.toId)
      ? computeSegmentMetrics(ptMap.get(primarySegment.fromId)!, ptMap.get(primarySegment.toId)!)
      : null;

  const adjustablePoints = points.filter((p) => p.adjustable).slice(0, 2);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-3 sm:p-4">
        <p className="text-xs text-slate-300 mb-2.5">{config.theoremNote}</p>
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto rounded-xl bg-slate-900/60 border border-slate-800/80"
          role="img"
          aria-label="Coordinate Geometry Canvas"
        >
          {/* Axes */}
          <line x1={ox - b * scale} y1={oy} x2={ox + b * scale} y2={oy} stroke="#475569" strokeWidth={1.5} />
          <line x1={ox} y1={oy - b * scale} x2={ox} y2={oy + b * scale} stroke="#475569" strokeWidth={1.5} />

          {/* Polygons */}
          {(config.polygons || []).map((pg, idx) => {
            const ptsStr = pg.pointIds
              .map((id) => ptMap.get(id))
              .filter(Boolean)
              .map((p) => `${toSvgX(p!.x)},${toSvgY(p!.y)}`)
              .join(' ');
            return <polygon key={idx} points={ptsStr} fill={pg.fill || 'rgba(99, 102, 241, 0.16)'} stroke="#818cf8" strokeWidth={1} />;
          })}

          {/* Circles */}
          {(config.circles || []).map((c, idx) => {
            const center = ptMap.get(c.centerId);
            if (!center) return null;
            return (
              <circle
                key={idx}
                cx={toSvgX(center.x)}
                cy={toSvgY(center.y)}
                r={c.radius * scale}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={2}
              />
            );
          })}

          {/* Segments */}
          {config.segments.map((seg, idx) => {
            const p1 = ptMap.get(seg.fromId);
            const p2 = ptMap.get(seg.toId);
            if (!p1 || !p2) return null;
            const m = computeSegmentMetrics(p1, p2);
            return (
              <g key={idx}>
                <line
                  x1={toSvgX(p1.x)}
                  y1={toSvgY(p1.y)}
                  x2={toSvgX(p2.x)}
                  y2={toSvgY(p2.y)}
                  stroke={seg.color || '#38bdf8'}
                  strokeWidth={2.4}
                  strokeDasharray={seg.dashed ? '5 4' : undefined}
                />
                {showLabels && (
                  <text
                    x={toSvgX(m.midpoint.x) + 6}
                    y={toSvgY(m.midpoint.y) - 6}
                    fill="#cbd5e1"
                    fontSize={10}
                  >
                    {seg.label || `d=${m.length}`}
                  </text>
                )}
              </g>
            );
          })}

          {/* Points */}
          {points.map((pt) => (
            <g key={pt.id}>
              <circle
                cx={toSvgX(pt.x)}
                cy={toSvgY(pt.y)}
                r={5.5}
                fill={pt.adjustable ? '#f59e0b' : '#38bdf8'}
                stroke="#fff"
                strokeWidth={1.5}
              />
              {showLabels && (
                <text
                  x={toSvgX(pt.x) + 8}
                  y={toSvgY(pt.y) - 8}
                  fill="#e2e8f0"
                  fontSize={11}
                  fontWeight="600"
                >
                  {pt.label} ({pt.x}, {pt.y})
                </text>
              )}
            </g>
          ))}
        </svg>

        {primaryMetrics && (
          <div className="grid grid-cols-3 gap-2.5 mt-3">
            <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
              <p className="text-[11px] text-slate-400">{isHi ? 'दूरी (d)' : 'Segment Length'}</p>
              <p className="text-sm font-bold text-cyan-300 tabular-nums">{primaryMetrics.length} units</p>
            </div>
            <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
              <p className="text-[11px] text-slate-400">{isHi ? 'मध्य-बिंदु' : 'Midpoint'}</p>
              <p className="text-sm font-bold text-emerald-300 tabular-nums">
                ({primaryMetrics.midpoint.x}, {primaryMetrics.midpoint.y})
              </p>
            </div>
            <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
              <p className="text-[11px] text-slate-400">{isHi ? 'ढलान (m)' : 'Slope (m)'}</p>
              <p className="text-sm font-bold text-amber-300 tabular-nums">
                {primaryMetrics.slope === null ? 'Vertical (∞)' : primaryMetrics.slope}
              </p>
            </div>
          </div>
        )}
      </div>

      {adjustablePoints.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {adjustablePoints.map((pt) => (
            <div key={pt.id} className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2">
              <p className="text-xs font-bold text-amber-300">
                {isHi ? `बिंदु ${pt.label} समायोजित करें` : `Adjust Point ${pt.label}`} ({pt.x}, {pt.y})
              </p>
              <label htmlFor={`${uid}-${pt.id}-x`} className="flex justify-between text-[11px] text-slate-300">
                <span>x</span>
                <span className="tabular-nums">{pt.x}</span>
              </label>
              <input
                id={`${uid}-${pt.id}-x`}
                type="range"
                min={-b + 1}
                max={b - 1}
                step={0.5}
                value={pt.x}
                onChange={(e) => {
                  const nx = Number(e.target.value);
                  setPoints((prev) => prev.map((item) => (item.id === pt.id ? { ...item, x: nx } : item)));
                }}
                className="w-full accent-amber-400"
              />
              <label htmlFor={`${uid}-${pt.id}-y`} className="flex justify-between text-[11px] text-slate-300">
                <span>y</span>
                <span className="tabular-nums">{pt.y}</span>
              </label>
              <input
                id={`${uid}-${pt.id}-y`}
                type="range"
                min={-b + 1}
                max={b - 1}
                step={0.5}
                value={pt.y}
                onChange={(e) => {
                  const ny = Number(e.target.value);
                  setPoints((prev) => prev.map((item) => (item.id === pt.id ? { ...item, y: ny } : item)));
                }}
                className="w-full accent-cyan-400"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
