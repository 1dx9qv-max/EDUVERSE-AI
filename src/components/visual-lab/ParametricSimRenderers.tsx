import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, StepForward, ArrowRight } from 'lucide-react';
import type {
  BohrVisualConfig,
  CircuitVisualConfig,
  KinematicsVisualConfig,
  MolecularVisualConfig,
  OpticsRayVisualConfig,
  VisualLanguage,
  WaveVisualConfig,
} from '../../types/phase3';
import {
  computeBohrAtom,
  computeCircuitState,
  computeOpticsRayState,
  computeProjectileState,
  computeWaveState,
} from '../../utils/visualLabEngine';

interface RendererCommonProps {
  language: VisualLanguage;
  showLabels: boolean;
  presetTrigger?: Record<string, number | string> | null;
}

// ==========================================
// 1. KINEMATICS PROJECTILE SIMULATION
// ==========================================
export const KinematicsProjectileRenderer: React.FC<
  RendererCommonProps & { config: KinematicsVisualConfig }
> = ({ config, language, showLabels, presetTrigger }) => {
  const isHi = language === 'Hindi';
  const uid = useId();
  const [speed, setSpeed] = useState(config.speed);
  const [angle, setAngle] = useState(config.angle);
  const [gravity, setGravity] = useState(config.gravity);
  const [showVectors, setShowVectors] = useState(config.showVectors);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setSpeed(config.speed);
    setAngle(config.angle);
    setGravity(config.gravity);
    setShowVectors(config.showVectors);
    setElapsed(0);
    setPlaying(false);
  }, [config]);

  useEffect(() => {
    if (!presetTrigger) return;
    if (typeof presetTrigger.speed === 'number') setSpeed(presetTrigger.speed);
    if (typeof presetTrigger.angle === 'number') setAngle(presetTrigger.angle);
    if (typeof presetTrigger.gravity === 'number') setGravity(presetTrigger.gravity);
    setElapsed(0);
  }, [presetTrigger]);

  const metrics = useMemo(
    () => computeProjectileState(speed, angle, gravity, elapsed),
    [speed, angle, gravity, elapsed]
  );

  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null;
      return;
    }
    const tick = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;
      setElapsed((prev) => {
        const next = prev + dt;
        if (next >= metrics.timeOfFlight) {
          setPlaying(false);
          return metrics.timeOfFlight;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, metrics.timeOfFlight]);

  const svgW = 600;
  const svgH = 330;
  const padL = 52;
  const padB = 42;
  const padT = 26;
  const padR = 28;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const maxXDomain = Math.max(40, metrics.horizontalRange * 1.12);
  const maxYDomain = Math.max(15, metrics.maxHeight * 1.28);
  const toSvgX = (xVal: number) => padL + (xVal / maxXDomain) * plotW;
  const toSvgY = (yVal: number) => svgH - padB - (yVal / maxYDomain) * plotH;

  const pathD = metrics.trajectory
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${toSvgX(pt.x).toFixed(1)} ${toSvgY(pt.y).toFixed(1)}`)
    .join(' ');
  const ballX = toSvgX(metrics.x);
  const ballY = toSvgY(metrics.y);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (elapsed >= metrics.timeOfFlight - 0.02) setElapsed(0);
                setPlaying((p) => !p);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer whitespace-nowrap"
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {playing ? (isHi ? 'रोकें' : 'Pause') : isHi ? 'चलाएँ' : 'Launch'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setElapsed((e) => Math.min(metrics.timeOfFlight, e + metrics.timeOfFlight / 8));
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-xs font-semibold text-slate-200 cursor-pointer whitespace-nowrap"
            >
              <StepForward className="w-3.5 h-3.5" />
              {isHi ? 'चरण' : 'Step'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setElapsed(0);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-xs font-semibold text-slate-300 cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {isHi ? 'रीसेट' : 'Reset'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowVectors((v) => !v)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer whitespace-nowrap ${
              showVectors
                ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            {isHi ? 'वेग सदिश' : 'Velocity Vectors'}: {showVectors ? 'ON' : 'OFF'}
          </button>
        </div>

        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto rounded-xl bg-slate-900/60 border border-slate-800/80"
          role="img"
          aria-label="Projectile Motion Simulation Canvas"
        >
          {/* Reference grid lines */}
          {[0.25, 0.5, 0.75, 1].map((frac) => {
            const y = svgH - padB - frac * plotH;
            return (
              <line
                key={frac}
                x1={padL}
                y1={y}
                x2={svgW - padR}
                y2={y}
                stroke="#1e293b"
                strokeDasharray="4 4"
              />
            );
          })}

          {/* Ground */}
          <line x1={padL} y1={svgH - padB} x2={svgW - padR} y2={svgH - padB} stroke="#475569" strokeWidth={2} />
          <line x1={padL} y1={padT} x2={padL} y2={svgH - padB} stroke="#475569" strokeWidth={2} />

          {/* Trajectory Curve */}
          <path d={pathD} fill="none" stroke="#38bdf8" strokeWidth={2.5} strokeDasharray="6 4" />

          {/* Apex marker */}
          {showLabels && (
            <g>
              <circle
                cx={toSvgX(metrics.horizontalRange / 2)}
                cy={toSvgY(metrics.maxHeight)}
                r={4}
                fill="#10b981"
              />
              <text
                x={toSvgX(metrics.horizontalRange / 2)}
                y={Math.max(18, toSvgY(metrics.maxHeight) - 10)}
                textAnchor="middle"
                fill="#6ee7b7"
                fontSize={11}
                fontWeight="600"
              >
                Hmax = {metrics.maxHeight} m
              </text>
            </g>
          )}

          {/* Velocity Vectors */}
          {showVectors && (
            <g>
              <line
                x1={ballX}
                y1={ballY}
                x2={ballX + metrics.vx * 1.4}
                y2={ballY}
                stroke="#34d399"
                strokeWidth={2.2}
              />
              <line
                x1={ballX}
                y1={ballY}
                x2={ballX}
                y2={ballY - metrics.vy * 1.4}
                stroke="#fbbf24"
                strokeWidth={2.2}
              />
              {showLabels && (
                <>
                  <text x={ballX + metrics.vx * 1.4 + 4} y={ballY + 4} fill="#34d399" fontSize={10}>
                    vx
                  </text>
                  <text x={ballX + 5} y={ballY - metrics.vy * 1.4} fill="#fbbf24" fontSize={10}>
                    vy
                  </text>
                </>
              )}
            </g>
          )}

          {/* Projectile */}
          <circle cx={ballX} cy={ballY} r={8} fill="#6366f1" stroke="#e0e7ff" strokeWidth={2} />

          {showLabels && (
            <>
              <text x={svgW - padR} y={svgH - 14} textAnchor="end" fill="#94a3b8" fontSize={11}>
                Range R = {metrics.horizontalRange} m · {config.environmentLabel}
              </text>
              <text x={padL + 8} y={padT + 14} fill="#cbd5e1" fontSize={11} fontWeight="600">
                {config.projectileLabel}
              </text>
            </>
          )}
        </svg>

        {/* Live Telemetry Readouts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'क्षैतिज परास (R)' : 'Range (R)'}</p>
            <p className="text-sm font-bold text-white tabular-nums">{metrics.horizontalRange} m</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'अधिकतम ऊँचाई' : 'Max Height'}</p>
            <p className="text-sm font-bold text-emerald-300 tabular-nums">{metrics.maxHeight} m</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'उड़ान काल (T)' : 'Flight Time (T)'}</p>
            <p className="text-sm font-bold text-cyan-300 tabular-nums">{metrics.timeOfFlight} s</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'ऊर्जा (KE / PE)' : 'Energy (KE / PE)'}</p>
            <p className="text-sm font-bold text-amber-300 tabular-nums">
              {metrics.kineticEnergyShare}% / {metrics.potentialEnergyShare}%
            </p>
          </div>
        </div>
      </div>

      {/* Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-speed`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{isHi ? 'प्रारंभिक वेग (u)' : 'Initial Speed (u)'}</span>
            <span className="tabular-nums text-indigo-300">{speed} m/s</span>
          </label>
          <input
            id={`${uid}-speed`}
            type="range"
            min={6}
            max={50}
            step={1}
            value={speed}
            onChange={(e) => {
              setSpeed(Number(e.target.value));
              setElapsed(0);
            }}
            className="w-full accent-indigo-500"
          />
        </div>

        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-angle`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{isHi ? 'प्रक्षेपण कोण (θ)' : 'Launch Angle (θ)'}</span>
            <span className="tabular-nums text-cyan-300">{angle}°</span>
          </label>
          <input
            id={`${uid}-angle`}
            type="range"
            min={10}
            max={80}
            step={1}
            value={angle}
            onChange={(e) => {
              setAngle(Number(e.target.value));
              setElapsed(0);
            }}
            className="w-full accent-cyan-400"
          />
        </div>

        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-gravity`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{isHi ? 'गुरुत्व (g)' : 'Gravity (g)'}</span>
            <span className="tabular-nums text-amber-300">{gravity} m/s²</span>
          </label>
          <input
            id={`${uid}-gravity`}
            type="range"
            min={1.6}
            max={20}
            step={0.2}
            value={gravity}
            onChange={(e) => {
              setGravity(Number(e.target.value));
              setElapsed(0);
            }}
            className="w-full accent-amber-400"
          />
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 2. OPTICS LENS & MIRROR RAY SIMULATOR
// ==========================================
export const OpticsRayRenderer: React.FC<
  RendererCommonProps & { config: OpticsRayVisualConfig }
> = ({ config, language, showLabels, presetTrigger }) => {
  const isHi = language === 'Hindi';
  const uid = useId();
  const [element, setElement] = useState(config.opticalElement);
  const [focalCm, setFocalCm] = useState(config.focalLengthCm);
  const [objDistCm, setObjDistCm] = useState(config.objectDistanceCm);

  useEffect(() => {
    setElement(config.opticalElement);
    setFocalCm(config.focalLengthCm);
    setObjDistCm(config.objectDistanceCm);
  }, [config]);

  useEffect(() => {
    if (!presetTrigger) return;
    if (typeof presetTrigger.objectDistanceCm === 'number') {
      setObjDistCm(presetTrigger.objectDistanceCm);
    }
    if (typeof presetTrigger.focalLengthCm === 'number') {
      setFocalCm(presetTrigger.focalLengthCm);
    }
    if (
      typeof presetTrigger.opticalElement === 'string' &&
      ['convex-lens', 'concave-lens', 'concave-mirror', 'convex-mirror'].includes(
        presetTrigger.opticalElement
      )
    ) {
      setElement(presetTrigger.opticalElement as OpticsRayVisualConfig['opticalElement']);
    }
  }, [presetTrigger]);

  const optics = useMemo(
    () => computeOpticsRayState(element, focalCm, objDistCm, config.objectHeightCm),
    [element, focalCm, objDistCm, config.objectHeightCm]
  );

  const svgW = 600;
  const svgH = 330;
  const cx = 300;
  const cy = 165;
  const scale = 4.2; // px per cm

  const objX = Math.max(24, cx - objDistCm * scale);
  const objTopY = cy - config.objectHeightCm * 10;
  const fPx = focalCm * scale;

  const imgX = optics.imageV !== null ? Math.max(20, Math.min(580, cx + optics.imageV * scale)) : null;
  const imgTopY =
    optics.imageHeightCm !== null
      ? Math.max(24, Math.min(svgH - 24, cy - optics.imageHeightCm * 10))
      : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-3 sm:p-4">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(
            [
              { id: 'convex-lens', label: isHi ? 'उत्तल लेंस' : 'Convex Lens' },
              { id: 'concave-lens', label: isHi ? 'अवतल लेंस' : 'Concave Lens' },
              { id: 'concave-mirror', label: isHi ? 'अवतल दर्पण' : 'Concave Mirror' },
              { id: 'convex-mirror', label: isHi ? 'उत्तल दर्पण' : 'Convex Mirror' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setElement(item.id)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer whitespace-nowrap ${
                element === item.id
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto rounded-xl bg-slate-900/60 border border-slate-800/80"
          role="img"
          aria-label="Optics Ray Diagram Simulator"
        >
          {/* Principal Axis */}
          <line x1={16} y1={cy} x2={svgW - 16} y2={cy} stroke="#475569" strokeWidth={1.5} strokeDasharray="5 4" />

          {/* Optical Element */}
          {optics.isMirror ? (
            <path
              d={
                element === 'concave-mirror'
                  ? `M ${cx - 10} 45 Q ${cx + 16} ${cy} ${cx - 10} ${svgH - 45}`
                  : `M ${cx + 10} 45 Q ${cx - 16} ${cy} ${cx + 10} ${svgH - 45}`
              }
              fill="none"
              stroke="#38bdf8"
              strokeWidth={4}
            />
          ) : (
            <path
              d={
                element === 'convex-lens'
                  ? `M ${cx} 40 Q ${cx + 22} ${cy} ${cx} ${svgH - 40} Q ${cx - 22} ${cy} ${cx} 40 Z`
                  : `M ${cx - 14} 40 Q ${cx - 2} ${cy} ${cx - 14} ${svgH - 40} L ${cx + 14} ${svgH - 40} Q ${cx + 2} ${cy} ${cx + 14} 40 Z`
              }
              fill="rgba(56, 189, 248, 0.16)"
              stroke="#38bdf8"
              strokeWidth={2}
            />
          )}

          {/* Focal markers */}
          {[-2, -1, 1, 2].map((mult) => {
            const xPos = cx + mult * fPx;
            if (xPos < 20 || xPos > svgW - 20) return null;
            return (
              <g key={mult}>
                <circle cx={xPos} cy={cy} r={3.5} fill="#fbbf24" />
                {showLabels && (
                  <text x={xPos} y={cy + 16} textAnchor="middle" fill="#fbbf24" fontSize={10}>
                    {Math.abs(mult) === 2 ? (optics.isMirror ? 'C' : '2F') : 'F'}
                  </text>
                )}
              </g>
            );
          })}

          {/* Object Arrow */}
          <line x1={objX} y1={cy} x2={objX} y2={objTopY} stroke="#10b981" strokeWidth={3} />
          <polygon points={`${objX},${objTopY - 7} ${objX - 5},${objTopY + 3} ${objX + 5},${objTopY + 3}`} fill="#10b981" />
          {showLabels && (
            <text x={objX} y={objTopY - 12} textAnchor="middle" fill="#6ee7b7" fontSize={11} fontWeight="600">
              Object
            </text>
          )}

          {/* Principal Rays */}
          {/* Ray 1: Parallel to axis, then through focal point */}
          <line x1={objX} y1={objTopY} x2={cx} y2={objTopY} stroke="#38bdf8" strokeWidth={1.8} />
          {!optics.isAtInfinity && imgX !== null && imgTopY !== null && (
            <>
              <line
                x1={cx}
                y1={objTopY}
                x2={imgX}
                y2={imgTopY}
                stroke="#38bdf8"
                strokeWidth={1.8}
                strokeDasharray={optics.isRealImage ? undefined : '5 4'}
              />
              {/* Ray 2: Through center/pole */}
              <line
                x1={objX}
                y1={objTopY}
                x2={imgX}
                y2={imgTopY}
                stroke="#c084fc"
                strokeWidth={1.8}
                strokeDasharray={optics.isRealImage ? undefined : '5 4'}
              />
              {/* Image Arrow */}
              <line
                x1={imgX}
                y1={cy}
                x2={imgX}
                y2={imgTopY}
                stroke={optics.isRealImage ? '#f59e0b' : '#f472b6'}
                strokeWidth={3}
                strokeDasharray={optics.isRealImage ? undefined : '4 3'}
              />
              {showLabels && (
                <text
                  x={imgX}
                  y={imgTopY > cy ? imgTopY + 15 : imgTopY - 10}
                  textAnchor="middle"
                  fill={optics.isRealImage ? '#fcd34d' : '#f9a8d4'}
                  fontSize={11}
                  fontWeight="600"
                >
                  Image
                </text>
              )}
            </>
          )}
        </svg>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'वस्तु दूरी (u)' : 'Object (u)'}</p>
            <p className="text-sm font-bold text-emerald-300 tabular-nums">{optics.objectU} cm</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'प्रतिबिंब दूरी (v)' : 'Image (v)'}</p>
            <p className="text-sm font-bold text-amber-300 tabular-nums">
              {optics.isAtInfinity ? '∞' : `${optics.imageV} cm`}
            </p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'आवर्धन (m)' : 'Magnification (m)'}</p>
            <p className="text-sm font-bold text-cyan-300 tabular-nums">
              {optics.magnification === null ? '∞' : `${optics.magnification}×`}
            </p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'प्रकृति' : 'Image Nature'}</p>
            <p className="text-xs font-bold text-white leading-snug">{optics.natureLabel}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-focal`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{isHi ? 'फोकस दूरी (|f|)' : 'Focal Length (|f|)'}</span>
            <span className="tabular-nums text-amber-300">{focalCm} cm</span>
          </label>
          <input
            id={`${uid}-focal`}
            type="range"
            min={8}
            max={30}
            step={1}
            value={focalCm}
            onChange={(e) => setFocalCm(Number(e.target.value))}
            className="w-full accent-amber-400"
          />
        </div>
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-objd`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{isHi ? 'वस्तु की दूरी (|u|)' : 'Object Distance (|u|)'}</span>
            <span className="tabular-nums text-emerald-300">{objDistCm} cm</span>
          </label>
          <input
            id={`${uid}-objd`}
            type="range"
            min={8}
            max={65}
            step={1}
            value={objDistCm}
            onChange={(e) => setObjDistCm(Number(e.target.value))}
            className="w-full accent-emerald-400"
          />
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 3. CIRCUIT NETWORK SOLVER
// ==========================================
export const CircuitNetworkRenderer: React.FC<
  RendererCommonProps & { config: CircuitVisualConfig }
> = ({ config, language, showLabels, presetTrigger }) => {
  const isHi = language === 'Hindi';
  const uid = useId();
  const [topology, setTopology] = useState<'series' | 'parallel'>(config.topology);
  const [voltage, setVoltage] = useState(config.voltage);
  const [r1, setR1] = useState(config.r1);
  const [r2, setR2] = useState(config.r2);

  useEffect(() => {
    setTopology(config.topology);
    setVoltage(config.voltage);
    setR1(config.r1);
    setR2(config.r2);
  }, [config]);

  useEffect(() => {
    if (!presetTrigger) return;
    if (presetTrigger.topology === 'series' || presetTrigger.topology === 'parallel') {
      setTopology(presetTrigger.topology);
    }
    if (typeof presetTrigger.voltage === 'number') setVoltage(presetTrigger.voltage);
    if (typeof presetTrigger.r1 === 'number') setR1(presetTrigger.r1);
    if (typeof presetTrigger.r2 === 'number') setR2(presetTrigger.r2);
  }, [presetTrigger]);

  const metrics = useMemo(
    () => computeCircuitState(voltage, r1, r2, topology),
    [voltage, r1, r2, topology]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTopology('series')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer whitespace-nowrap ${
                topology === 'series'
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              {isHi ? 'श्रेणी क्रम (Series)' : 'Series Circuit'}
            </button>
            <button
              type="button"
              onClick={() => setTopology('parallel')}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer whitespace-nowrap ${
                topology === 'parallel'
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}
            >
              {isHi ? 'समानांतर क्रम (Parallel)' : 'Parallel Circuit'}
            </button>
          </div>
          <span className="text-xs font-mono text-cyan-300 tabular-nums">
            Req = {metrics.equivalentResistance} Ω
          </span>
        </div>

        <svg
          viewBox="0 0 600 280"
          className="w-full h-auto rounded-xl bg-slate-900/60 border border-slate-800/80"
          role="img"
          aria-label="Electric Circuit Schematic"
        >
          {/* Outer Wire Loop */}
          <rect x={90} y={55} width={420} height={170} rx={12} fill="none" stroke="#38bdf8" strokeWidth={2.5} />

          {/* DC Source on Left */}
          <rect x={55} y={108} width={70} height={64} rx={10} fill="#0f172a" stroke="#f59e0b" strokeWidth={2} />
          <text x={90} y={136} textAnchor="middle" fill="#fcd34d" fontSize={13} fontWeight="700">
            {voltage} V
          </text>
          {showLabels && (
            <text x={90} y={154} textAnchor="middle" fill="#94a3b8" fontSize={10}>
              {config.sourceLabel || 'Battery'}
            </text>
          )}

          {topology === 'series' ? (
            <>
              {/* R1 top left-center */}
              <rect x={185} y={35} width={105} height={40} rx={8} fill="#0f172a" stroke="#10b981" strokeWidth={2} />
              <text x={237} y={54} textAnchor="middle" fill="#6ee7b7" fontSize={12} fontWeight="700">
                {config.r1Label || 'R1'}: {r1} Ω
              </text>
              <text x={237} y={68} textAnchor="middle" fill="#94a3b8" fontSize={10}>
                V1 = {metrics.voltageDropR1} V
              </text>

              {/* R2 top right-center */}
              <rect x={335} y={35} width={105} height={40} rx={8} fill="#0f172a" stroke="#a855f7" strokeWidth={2} />
              <text x={387} y={54} textAnchor="middle" fill="#d8b4fe" fontSize={12} fontWeight="700">
                {config.r2Label || 'R2'}: {r2} Ω
              </text>
              <text x={387} y={68} textAnchor="middle" fill="#94a3b8" fontSize={10}>
                V2 = {metrics.voltageDropR2} V
              </text>
            </>
          ) : (
            <>
              {/* Branch 2 middle */}
              <line x1={180} y1={140} x2={440} y2={140} stroke="#38bdf8" strokeWidth={2.5} />
              <line x1={180} y1={55} x2={180} y2={140} stroke="#38bdf8" strokeWidth={2.5} />
              <line x1={440} y1={55} x2={440} y2={140} stroke="#38bdf8" strokeWidth={2.5} />

              <rect x={250} y={35} width={120} height={40} rx={8} fill="#0f172a" stroke="#10b981" strokeWidth={2} />
              <text x={310} y={54} textAnchor="middle" fill="#6ee7b7" fontSize={12} fontWeight="700">
                {config.r1Label || 'R1'}: {r1} Ω
              </text>
              <text x={310} y={68} textAnchor="middle" fill="#94a3b8" fontSize={10}>
                I1 = {metrics.currentR1} A
              </text>

              <rect x={250} y={120} width={120} height={40} rx={8} fill="#0f172a" stroke="#a855f7" strokeWidth={2} />
              <text x={310} y={139} textAnchor="middle" fill="#d8b4fe" fontSize={12} fontWeight="700">
                {config.r2Label || 'R2'}: {r2} Ω
              </text>
              <text x={310} y={153} textAnchor="middle" fill="#94a3b8" fontSize={10}>
                I2 = {metrics.currentR2} A
              </text>
            </>
          )}

          {/* Total Current Tag */}
          {showLabels && (
            <text x={300} y={248} textAnchor="middle" fill="#38bdf8" fontSize={12} fontWeight="600">
              Total Current I = {metrics.totalCurrent} A · Power P = {metrics.totalPowerWatts} W
            </text>
          )}
        </svg>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'तुल्य प्रतिरोध' : 'Equivalent Req'}</p>
            <p className="text-sm font-bold text-white tabular-nums">{metrics.equivalentResistance} Ω</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'कुल धारा (I)' : 'Total Current (I)'}</p>
            <p className="text-sm font-bold text-cyan-300 tabular-nums">{metrics.totalCurrent} A</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'शाखा धारा (I1 / I2)' : 'Currents (I1 / I2)'}</p>
            <p className="text-sm font-bold text-emerald-300 tabular-nums">
              {metrics.currentR1}A / {metrics.currentR2}A
            </p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'विद्युत शक्ति (P)' : 'Total Power (P)'}</p>
            <p className="text-sm font-bold text-amber-300 tabular-nums">{metrics.totalPowerWatts} W</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-volt`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{isHi ? 'विभवांतर (V)' : 'Voltage (V)'}</span>
            <span className="tabular-nums text-amber-300">{voltage} V</span>
          </label>
          <input
            id={`${uid}-volt`}
            type="range"
            min={2}
            max={24}
            step={1}
            value={voltage}
            onChange={(e) => setVoltage(Number(e.target.value))}
            className="w-full accent-amber-400"
          />
        </div>
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-r1`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{config.r1Label || 'R1'}</span>
            <span className="tabular-nums text-emerald-300">{r1} Ω</span>
          </label>
          <input
            id={`${uid}-r1`}
            type="range"
            min={2}
            max={40}
            step={1}
            value={r1}
            onChange={(e) => setR1(Number(e.target.value))}
            className="w-full accent-emerald-400"
          />
        </div>
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-r2`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{config.r2Label || 'R2'}</span>
            <span className="tabular-nums text-purple-300">{r2} Ω</span>
          </label>
          <input
            id={`${uid}-r2`}
            type="range"
            min={2}
            max={40}
            step={1}
            value={r2}
            onChange={(e) => setR2(Number(e.target.value))}
            className="w-full accent-purple-400"
          />
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 4. WAVE & OSCILLATION SIMULATOR (TRANSVERSE + SOUND PRESSURE)
// ==========================================
export const WaveOscillationRenderer: React.FC<
  RendererCommonProps & { config: WaveVisualConfig }
> = ({ config, language, showLabels, presetTrigger }) => {
  const isHi = language === 'Hindi';
  const uid = useId();
  const [amplitude, setAmplitude] = useState(config.amplitude);
  const [frequency, setFrequency] = useState(config.frequency);
  const [wavelength, setWavelength] = useState(config.wavelength);
  const [waveKind, setWaveKind] = useState(config.waveKind);
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    setAmplitude(config.amplitude);
    setFrequency(config.frequency);
    setWavelength(config.wavelength);
    setWaveKind(config.waveKind);
    setPhase(0);
    setPlaying(true);
  }, [config]);

  useEffect(() => {
    if (!presetTrigger) return;
    if (typeof presetTrigger.amplitude === 'number') setAmplitude(presetTrigger.amplitude);
    if (typeof presetTrigger.frequency === 'number') setFrequency(presetTrigger.frequency);
    if (typeof presetTrigger.wavelength === 'number') setWavelength(presetTrigger.wavelength);
  }, [presetTrigger]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setPhase((p) => (p + dt * frequency * Math.PI * 1.4) % (Math.PI * 20));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, frequency]);

  const metrics = useMemo(
    () => computeWaveState(amplitude, frequency, wavelength, phase),
    [amplitude, frequency, wavelength, phase]
  );

  const midY = 140;
  const pathD = metrics.points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${(midY - pt.y).toFixed(1)}`)
    .join(' ');

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer whitespace-nowrap"
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {playing ? (isHi ? 'रोकें' : 'Pause') : isHi ? 'चलाएँ' : 'Animate'}
            </button>
            <button
              type="button"
              onClick={() => setWaveKind((k) => (k === 'transverse' ? 'sound-pressure' : 'transverse'))}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-200 cursor-pointer whitespace-nowrap"
            >
              {waveKind === 'transverse'
                ? isHi
                  ? 'मोड: अनुप्रस्थ तरंग'
                  : 'Mode: Transverse Wave'
                : isHi
                  ? 'मोड: अनुदैर्ध्य / ध्वनि'
                  : 'Mode: Longitudinal Compression'}
            </button>
          </div>
          <span className="text-xs font-mono text-cyan-300 tabular-nums">
            v = fλ = {metrics.waveSpeedMetersPerSec} m/s
          </span>
        </div>

        <svg
          viewBox="0 0 620 270"
          className="w-full h-auto rounded-xl bg-slate-900/60 border border-slate-800/80"
          role="img"
          aria-label="Wave Simulation Canvas"
        >
          <line x1={0} y1={midY} x2={620} y2={midY} stroke="#334155" strokeDasharray="4 4" />
          {waveKind === 'transverse' ? (
            <>
              <path d={pathD} fill="none" stroke="#38bdf8" strokeWidth={3} />
              {metrics.points
                .filter((_, idx) => idx % 5 === 0)
                .map((pt, idx) => (
                  <circle key={idx} cx={pt.x} cy={midY - pt.y} r={3.5} fill="#818cf8" />
                ))}
            </>
          ) : (
            <>
              {metrics.points
                .filter((_, idx) => idx % 2 === 0)
                .map((pt, idx) => {
                  const shiftedX = pt.x + pt.y * 0.28;
                  return (
                    <g key={idx}>
                      <circle cx={shiftedX} cy={midY - 22} r={3} fill="#38bdf8" opacity={0.85} />
                      <circle cx={shiftedX} cy={midY} r={3.5} fill="#818cf8" />
                      <circle cx={shiftedX} cy={midY + 22} r={3} fill="#38bdf8" opacity={0.85} />
                    </g>
                  );
                })}
            </>
          )}
          {showLabels && (
            <text x={16} y={24} fill="#cbd5e1" fontSize={12} fontWeight="600">
              {config.waveLabel || (waveKind === 'transverse' ? 'Transverse Displacement y(x,t)' : 'Compressions & Rarefactions')}
            </text>
          )}
        </svg>

        <div className="grid grid-cols-3 gap-2.5 mt-3">
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'तरंग चाल (v)' : 'Wave Speed (v)'}</p>
            <p className="text-sm font-bold text-cyan-300 tabular-nums">{metrics.waveSpeedMetersPerSec} m/s</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'आवर्तकाल (T)' : 'Period (T = 1/f)'}</p>
            <p className="text-sm font-bold text-emerald-300 tabular-nums">{metrics.timePeriodSeconds} s</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'आयाम (A)' : 'Amplitude (A)'}</p>
            <p className="text-sm font-bold text-amber-300 tabular-nums">{amplitude} units</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-amp`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{isHi ? 'आयाम (A)' : 'Amplitude (A)'}</span>
            <span className="tabular-nums text-amber-300">{amplitude}</span>
          </label>
          <input
            id={`${uid}-amp`}
            type="range"
            min={10}
            max={75}
            step={1}
            value={amplitude}
            onChange={(e) => setAmplitude(Number(e.target.value))}
            className="w-full accent-amber-400"
          />
        </div>
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-freq`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{isHi ? 'आवृत्ति (f)' : 'Frequency (f)'}</span>
            <span className="tabular-nums text-emerald-300">{frequency} Hz</span>
          </label>
          <input
            id={`${uid}-freq`}
            type="range"
            min={0.5}
            max={4.5}
            step={0.1}
            value={frequency}
            onChange={(e) => setFrequency(Number(e.target.value))}
            className="w-full accent-emerald-400"
          />
        </div>
        <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
          <label htmlFor={`${uid}-lam`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
            <span>{isHi ? 'तरंगदैर्घ्य (λ)' : 'Wavelength (λ)'}</span>
            <span className="tabular-nums text-cyan-300">{wavelength} m</span>
          </label>
          <input
            id={`${uid}-lam`}
            type="range"
            min={1.5}
            max={8}
            step={0.5}
            value={wavelength}
            onChange={(e) => setWavelength(Number(e.target.value))}
            className="w-full accent-cyan-400"
          />
        </div>
      </div>
    </div>
  );
};

// ==========================================
// 5. BOHR ATOMIC SHELL EXPLORER (Z=1..36)
// ==========================================
export const BohrAtomRenderer: React.FC<
  RendererCommonProps & { config: BohrVisualConfig }
> = ({ config, language, showLabels, presetTrigger }) => {
  const isHi = language === 'Hindi';
  const uid = useId();
  const [atomicNumber, setAtomicNumber] = useState(config.atomicNumber);
  const [spinning, setSpinning] = useState(true);
  const [angleOffset, setAngleOffset] = useState(0);

  useEffect(() => {
    setAtomicNumber(config.atomicNumber);
  }, [config]);

  useEffect(() => {
    if (!presetTrigger) return;
    if (typeof presetTrigger.atomicNumber === 'number') {
      setAtomicNumber(presetTrigger.atomicNumber);
    }
  }, [presetTrigger]);

  useEffect(() => {
    if (!spinning) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setAngleOffset((a) => (a + dt * 0.65) % (Math.PI * 2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning]);

  const atom = useMemo(() => computeBohrAtom(atomicNumber), [atomicNumber]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-extrabold text-white">
              {atom.element.symbol} · {isHi ? atom.element.nameHi : atom.element.nameEn}
            </span>
            <span className="text-xs text-slate-400">
              (Z = {atom.element.atomicNumber} · {atom.element.category})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSpinning((s) => !s)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-200 cursor-pointer whitespace-nowrap"
          >
            {spinning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {spinning ? (isHi ? 'कक्षा रोकें' : 'Pause Orbits') : isHi ? 'कक्षा चलाएँ' : 'Orbit'}
          </button>
        </div>

        <svg
          viewBox="0 0 560 320"
          className="w-full h-auto rounded-xl bg-slate-900/60 border border-slate-800/80"
          role="img"
          aria-label={`Bohr model of ${atom.element.nameEn}`}
        >
          {/* Shells */}
          {atom.shellLabels.map((sh, idx) => {
            const radius = 44 + idx * 32;
            const isHighlighted = config.highlightShell === sh.shell || idx === atom.shellLabels.length - 1;
            const electrons: React.ReactNode[] = [];
            for (let e = 0; e < sh.count; e++) {
              const theta = (e / sh.count) * Math.PI * 2 + angleOffset * (idx % 2 === 0 ? 1 : -0.7);
              const ex = 280 + radius * Math.cos(theta);
              const ey = 160 + radius * Math.sin(theta);
              electrons.push(
                <circle
                  key={`${sh.shell}_${e}`}
                  cx={ex}
                  cy={ey}
                  r={4.2}
                  fill={isHighlighted ? '#38bdf8' : '#818cf8'}
                />
              );
            }
            return (
              <g key={sh.shell}>
                <circle
                  cx={280}
                  cy={160}
                  r={radius}
                  fill="none"
                  stroke={isHighlighted ? '#38bdf8' : '#334155'}
                  strokeWidth={isHighlighted ? 2 : 1.4}
                  strokeDasharray={isHighlighted ? undefined : '4 4'}
                />
                {showLabels && (
                  <text x={280 + radius + 6} y={164} fill="#94a3b8" fontSize={10} fontWeight="600">
                    {sh.shell}:{sh.count}
                  </text>
                )}
                {electrons}
              </g>
            );
          })}

          {/* Nucleus */}
          <circle cx={280} cy={160} r={20} fill="#4f46e5" stroke="#a5b4fc" strokeWidth={2} />
          <text x={280} y={158} textAnchor="middle" fill="#fff" fontSize={11} fontWeight="700">
            {atom.element.atomicNumber}p⁺
          </text>
          <text x={280} y={170} textAnchor="middle" fill="#c7d2fe" fontSize={10}>
            {atom.element.neutrons}n⁰
          </text>
        </svg>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-3">
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'कोश विन्यास' : 'Shells (K·L·M·N)'}</p>
            <p className="text-sm font-bold text-white tabular-nums">{atom.shells.join(' · ')}</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'संयोजक इलेक्ट्रॉन' : 'Valence e⁻'}</p>
            <p className="text-sm font-bold text-cyan-300 tabular-nums">{atom.valenceElectrons}</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'संयोजकता' : 'Valency'}</p>
            <p className="text-sm font-bold text-emerald-300 tabular-nums">{atom.valency}</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 px-3 py-2">
            <p className="text-[11px] text-slate-400">{isHi ? 'द्रव्यमान संख्या' : 'Mass Number (A)'}</p>
            <p className="text-sm font-bold text-amber-300 tabular-nums">{atom.massNumber} u</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-slate-950 border border-slate-800 p-3">
        <label htmlFor={`${uid}-z`} className="flex justify-between text-xs font-semibold text-slate-200 mb-1.5">
          <span>{isHi ? 'परमाणु क्रमांक (Z = 1..36)' : 'Atomic Number (Z = 1..36)'}</span>
          <span className="tabular-nums text-indigo-300">
            Z = {atomicNumber} ({atom.element.symbol})
          </span>
        </label>
        <input
          id={`${uid}-z`}
          type="range"
          min={1}
          max={36}
          step={1}
          value={atomicNumber}
          onChange={(e) => setAtomicNumber(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </div>
    </div>
  );
};

// ==========================================
// 6. DYNAMIC MOLECULAR VSEPR & BONDING EXPLORER
// ==========================================
export const MolecularGeometryRenderer: React.FC<
  RendererCommonProps & { config: MolecularVisualConfig }
> = ({ config, language, showLabels }) => {
  const isHi = language === 'Hindi';
  const [selectedBondId, setSelectedBondId] = useState<string>(config.bonds[0]?.id || '');

  useEffect(() => {
    setSelectedBondId(config.bonds[0]?.id || '');
  }, [config]);

  const cx = 300;
  const cy = 165;
  const baseRadius = 105;

  const selectedBond = config.bonds.find((b) => b.id === selectedBondId) || config.bonds[0];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-950 border border-slate-800 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <p className="text-base font-extrabold text-white">
              {config.formula} — {config.shapeName}
            </p>
            <p className="text-xs text-slate-400">
              {config.hybridization ? `${config.hybridization} · ` : ''}
              {isHi ? 'बंध कोण' : 'Bond Angle'}: {config.bondAngleDeg}° ·{' '}
              {isHi ? 'एकाकी युग्म' : 'Lone Pairs'}: {config.lonePairs}
            </p>
          </div>
        </div>

        <svg
          viewBox="0 0 600 320"
          className="w-full h-auto rounded-xl bg-slate-900/60 border border-slate-800/80"
          role="img"
          aria-label={`Molecular geometry of ${config.formula}`}
        >
          {/* Lone pairs rendered symmetrically above if lonePairs > 0 */}
          {Array.from({ length: config.lonePairs }).map((_, lpIdx) => {
            const spreadAngle = (-90 + (lpIdx - (config.lonePairs - 1) / 2) * 38) * (Math.PI / 180);
            const lx = cx + 62 * Math.cos(spreadAngle);
            const ly = cy + 62 * Math.sin(spreadAngle);
            return (
              <g key={`lp_${lpIdx}`}>
                <ellipse
                  cx={lx}
                  cy={ly}
                  rx={20}
                  ry={13}
                  transform={`rotate(${(-90 + (lpIdx - (config.lonePairs - 1) / 2) * 38)} ${lx} ${ly})`}
                  fill="rgba(245, 158, 11, 0.18)"
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                />
                <circle cx={lx - 4} cy={ly} r={2.8} fill="#fcd34d" />
                <circle cx={lx + 4} cy={ly} r={2.8} fill="#fcd34d" />
              </g>
            );
          })}

          {/* Bonds + Terminal Atoms */}
          {config.bonds.map((bond) => {
            const rad = (bond.angleDeg * Math.PI) / 180;
            const len = baseRadius * (bond.lengthRatio ?? 1);
            const ax = cx + len * Math.cos(rad);
            const ay = cy + len * Math.sin(rad);
            const perpX = -Math.sin(rad);
            const perpY = Math.cos(rad);
            const active = selectedBond?.id === bond.id;
            const offsets = bond.bondOrder === 3 ? [-5, 0, 5] : bond.bondOrder === 2 ? [-3.5, 3.5] : [0];

            return (
              <g
                key={bond.id}
                className="cursor-pointer"
                onClick={() => setSelectedBondId(bond.id)}
              >
                {offsets.map((off, i) => (
                  <line
                    key={i}
                    x1={cx + perpX * off}
                    y1={cy + perpY * off}
                    x2={ax + perpX * off}
                    y2={ay + perpY * off}
                    stroke={active ? '#38bdf8' : '#94a3b8'}
                    strokeWidth={active ? 3 : 2.2}
                  />
                ))}
                <circle
                  cx={ax}
                  cy={ay}
                  r={22}
                  fill={active ? '#0284c7' : '#1e293b'}
                  stroke={active ? '#bae6fd' : '#64748b'}
                  strokeWidth={2}
                />
                <text x={ax} y={ay + 4} textAnchor="middle" fill="#fff" fontSize={13} fontWeight="700">
                  {bond.atomLabel}
                </text>
              </g>
            );
          })}

          {/* Central Atom */}
          <circle cx={cx} cy={cy} r={26} fill="#4f46e5" stroke="#c7d2fe" strokeWidth={2.5} />
          <text x={cx} y={cy + 5} textAnchor="middle" fill="#fff" fontSize={15} fontWeight="800">
            {config.centralAtom}
          </text>
          {showLabels && config.centralLabel && (
            <text x={cx} y={cy + 42} textAnchor="middle" fill="#cbd5e1" fontSize={11}>
              {config.centralLabel}
            </text>
          )}
        </svg>

        {selectedBond && (
          <div className="mt-3 rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-slate-200 font-semibold inline-flex items-center gap-1.5">
              <span>{config.centralAtom}</span>
              <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
              <span>{selectedBond.atomLabel}</span>
              <span className="text-slate-400">
                ({selectedBond.bondOrder === 3 ? 'Triple Bond' : selectedBond.bondOrder === 2 ? 'Double Bond' : 'Single Covalent Bond'})
              </span>
            </span>
            <span className="text-cyan-300 font-semibold tabular-nums">
              {isHi ? 'प्रक्षेपण कोण' : 'Orientation'}: {Math.round(selectedBond.angleDeg)}°
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
