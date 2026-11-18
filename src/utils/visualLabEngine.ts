import type { ClassGrade, IndianBoard } from '../types/auth.ts';
import type { ChapterNode } from '../types/curriculum.ts';
import type { ChapterProgressSummary } from '../types/learning.ts';
import type { TopicMasteryRecord } from '../types/phase4.ts';
import type {
  AnnotatedDiagramVisualConfig,
  BohrVisualConfig,
  CircuitVisualConfig,
  DiagramArrowSpec,
  DiagramHotspotSpec,
  DiagramShapeSpec,
  GeneratedVisualSpec,
  GeometryVisualConfig,
  IllustratedConceptVisualConfig,
  KinematicsVisualConfig,
  MathPlotVisualConfig,
  MolecularVisualConfig,
  OpticsRayVisualConfig,
  PersonalizedVisualSuggestion,
  VisualExplorationStep,
  VisualLanguage,
  VisualModalityCategory,
  VisualRendererType,
  WaveVisualConfig,
} from '../types/phase3.ts';
import { getCurriculumForStudent } from './curriculum.ts';

// ==========================================
// 1. KINEMATICS / PROJECTILE SOLVER
// ==========================================
export interface ProjectilePoint {
  t: number;
  x: number;
  y: number;
}

export interface ProjectileAnalysis {
  timeOfFlight: number;
  maxHeight: number;
  horizontalRange: number;
  vx: number;
  vy: number;
  speed: number;
  x: number;
  y: number;
  kineticEnergyShare: number;
  potentialEnergyShare: number;
  trajectory: ProjectilePoint[];
}

export function computeProjectileState(
  initialSpeed: number,
  angleDeg: number,
  gravity: number,
  elapsedTime: number
): ProjectileAnalysis {
  const v0 = clampNum(initialSpeed, 2, 60, 24);
  const angle = clampNum(angleDeg, 5, 85, 45);
  const g = clampNum(gravity, 1, 25, 9.8);
  const rad = (angle * Math.PI) / 180;
  const vx = v0 * Math.cos(rad);
  const vy0 = v0 * Math.sin(rad);

  const timeOfFlight = (2 * vy0) / g;
  const maxHeight = (vy0 * vy0) / (2 * g);
  const horizontalRange = vx * timeOfFlight;

  const t = clampNum(elapsedTime, 0, timeOfFlight, 0);
  const x = vx * t;
  const y = Math.max(0, vy0 * t - 0.5 * g * t * t);
  const vy = vy0 - g * t;
  const speed = Math.sqrt(vx * vx + vy * vy);

  const totalEnergy = 0.5 * v0 * v0;
  const ke = 0.5 * speed * speed;
  const pe = Math.max(0, totalEnergy - ke);

  const trajectory: ProjectilePoint[] = [];
  const samples = 48;
  for (let i = 0; i <= samples; i++) {
    const ti = (timeOfFlight * i) / samples;
    trajectory.push({
      t: ti,
      x: vx * ti,
      y: Math.max(0, vy0 * ti - 0.5 * g * ti * ti),
    });
  }

  return {
    timeOfFlight: Number(timeOfFlight.toFixed(2)),
    maxHeight: Number(maxHeight.toFixed(2)),
    horizontalRange: Number(horizontalRange.toFixed(2)),
    vx: Number(vx.toFixed(2)),
    vy: Number(vy.toFixed(2)),
    speed: Number(speed.toFixed(2)),
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    kineticEnergyShare: totalEnergy > 0 ? Math.round((ke / totalEnergy) * 100) : 100,
    potentialEnergyShare: totalEnergy > 0 ? Math.round((pe / totalEnergy) * 100) : 0,
    trajectory,
  };
}

// ==========================================
// 2. OPTICS LENS & MIRROR RAY SOLVER
// ==========================================
export interface OpticsRayAnalysis {
  opticalElement: OpticsRayVisualConfig['opticalElement'];
  isMirror: boolean;
  isConverging: boolean;
  focalLengthSigned: number;
  objectU: number;
  imageV: number | null;
  magnification: number | null;
  imageHeightCm: number | null;
  isAtInfinity: boolean;
  isRealImage: boolean;
  isInverted: boolean;
  natureLabel: string;
}

export function computeOpticsRayState(
  opticalElement: OpticsRayVisualConfig['opticalElement'],
  focalMagnitudeCm: number,
  objectDistanceMagnitudeCm: number,
  objectHeightCm: number
): OpticsRayAnalysis {
  const fMag = clampNum(focalMagnitudeCm, 5, 45, 15);
  const uMag = clampNum(objectDistanceMagnitudeCm, 6, 80, 30);
  const hObj = clampNum(objectHeightCm, 1, 10, 4);

  const isMirror = opticalElement === 'concave-mirror' || opticalElement === 'convex-mirror';
  const isConverging = opticalElement === 'convex-lens' || opticalElement === 'concave-mirror';

  // Cartesian sign convention: object always on left => u < 0
  const u = -uMag;
  const f =
    opticalElement === 'convex-lens' || opticalElement === 'convex-mirror' ? fMag : -fMag;

  let invV: number;
  if (isMirror) {
    // 1/f = 1/v + 1/u => 1/v = 1/f - 1/u
    invV = 1 / f - 1 / u;
  } else {
    // 1/f = 1/v - 1/u => 1/v = 1/f + 1/u
    invV = 1 / f + 1 / u;
  }

  if (Math.abs(invV) < 1e-4) {
    return {
      opticalElement,
      isMirror,
      isConverging,
      focalLengthSigned: f,
      objectU: u,
      imageV: null,
      magnification: null,
      imageHeightCm: null,
      isAtInfinity: true,
      isRealImage: true,
      isInverted: true,
      natureLabel: 'Image formed at Infinity (parallel emergent rays)',
    };
  }

  const v = 1 / invV;
  const m = isMirror ? -v / u : v / u;
  const hImg = m * hObj;

  // For mirror: real image is in front (v < 0). For lens: real image is behind (v > 0).
  const isRealImage = isMirror ? v < 0 : v > 0;
  const isInverted = m < 0;

  const sizeWord =
    Math.abs(Math.abs(m) - 1) < 0.05
      ? 'Same size'
      : Math.abs(m) > 1
        ? 'Magnified'
        : 'Diminished';

  const natureLabel = `${isRealImage ? 'Real' : 'Virtual'} · ${isInverted ? 'Inverted' : 'Erect'} · ${sizeWord}`;

  return {
    opticalElement,
    isMirror,
    isConverging,
    focalLengthSigned: Number(f.toFixed(2)),
    objectU: Number(u.toFixed(2)),
    imageV: Number(v.toFixed(2)),
    magnification: Number(m.toFixed(2)),
    imageHeightCm: Number(hImg.toFixed(2)),
    isAtInfinity: false,
    isRealImage,
    isInverted,
    natureLabel,
  };
}

// ==========================================
// 3. OHM'S LAW CIRCUIT SOLVER
// ==========================================
export interface CircuitAnalysis {
  topology: 'series' | 'parallel';
  equivalentResistance: number;
  totalCurrent: number;
  currentR1: number;
  currentR2: number;
  voltageDropR1: number;
  voltageDropR2: number;
  totalPowerWatts: number;
}

export function computeCircuitState(
  voltage: number,
  r1: number,
  r2: number,
  topology: 'series' | 'parallel'
): CircuitAnalysis {
  const V = clampNum(voltage, 1, 36, 12);
  const res1 = clampNum(r1, 1, 100, 6);
  const res2 = clampNum(r2, 1, 100, 12);

  if (topology === 'series') {
    const req = res1 + res2;
    const totalCurrent = V / req;
    return {
      topology,
      equivalentResistance: Number(req.toFixed(2)),
      totalCurrent: Number(totalCurrent.toFixed(3)),
      currentR1: Number(totalCurrent.toFixed(3)),
      currentR2: Number(totalCurrent.toFixed(3)),
      voltageDropR1: Number((totalCurrent * res1).toFixed(2)),
      voltageDropR2: Number((totalCurrent * res2).toFixed(2)),
      totalPowerWatts: Number((V * totalCurrent).toFixed(2)),
    };
  }

  const req = (res1 * res2) / (res1 + res2);
  const currentR1 = V / res1;
  const currentR2 = V / res2;
  const totalCurrent = currentR1 + currentR2;
  return {
    topology,
    equivalentResistance: Number(req.toFixed(2)),
    totalCurrent: Number(totalCurrent.toFixed(3)),
    currentR1: Number(currentR1.toFixed(3)),
    currentR2: Number(currentR2.toFixed(3)),
    voltageDropR1: Number(V.toFixed(2)),
    voltageDropR2: Number(V.toFixed(2)),
    totalPowerWatts: Number((V * totalCurrent).toFixed(2)),
  };
}

// ==========================================
// 4. WAVE & SHM OSCILLATION SOLVER
// ==========================================
export interface WaveMetrics {
  waveSpeedMetersPerSec: number;
  timePeriodSeconds: number;
  points: Array<{ x: number; y: number }>;
}

export function computeWaveState(
  amplitude: number,
  frequencyHz: number,
  wavelengthMeters: number,
  phaseRadians: number
): WaveMetrics {
  const amp = clampNum(amplitude, 5, 80, 44);
  const freq = clampNum(frequencyHz, 0.4, 6, 1.5);
  const lambda = clampNum(wavelengthMeters, 1, 10, 4);
  const points: Array<{ x: number; y: number }> = [];
  const width = 620;
  const k = (2 * Math.PI) / (lambda * 38);

  for (let px = 0; px <= width; px += 8) {
    const y = amp * Math.sin(k * px - phaseRadians);
    points.push({ x: px, y: Number(y.toFixed(2)) });
  }

  return {
    waveSpeedMetersPerSec: Number((freq * lambda).toFixed(2)),
    timePeriodSeconds: Number((1 / freq).toFixed(3)),
    points,
  };
}

// ==========================================
// 5. BOHR ATOMIC STRUCTURE (Z = 1..36)
// ==========================================
export interface ElementRecord {
  atomicNumber: number;
  symbol: string;
  nameEn: string;
  nameHi: string;
  neutrons: number;
  category: string;
}

const ELEMENTS_1_TO_36: ElementRecord[] = [
  { atomicNumber: 1, symbol: 'H', nameEn: 'Hydrogen', nameHi: 'हाइड्रोजन', neutrons: 0, category: 'Non-metal' },
  { atomicNumber: 2, symbol: 'He', nameEn: 'Helium', nameHi: 'हीलियम', neutrons: 2, category: 'Noble Gas' },
  { atomicNumber: 3, symbol: 'Li', nameEn: 'Lithium', nameHi: 'लिथियम', neutrons: 4, category: 'Alkali Metal' },
  { atomicNumber: 4, symbol: 'Be', nameEn: 'Beryllium', nameHi: 'बेरिलियम', neutrons: 5, category: 'Alkaline Earth' },
  { atomicNumber: 5, symbol: 'B', nameEn: 'Boron', nameHi: 'बोरॉन', neutrons: 6, category: 'Metalloid' },
  { atomicNumber: 6, symbol: 'C', nameEn: 'Carbon', nameHi: 'कार्बन', neutrons: 6, category: 'Non-metal' },
  { atomicNumber: 7, symbol: 'N', nameEn: 'Nitrogen', nameHi: 'नाइट्रोजन', neutrons: 7, category: 'Non-metal' },
  { atomicNumber: 8, symbol: 'O', nameEn: 'Oxygen', nameHi: 'ऑक्सीजन', neutrons: 8, category: 'Non-metal' },
  { atomicNumber: 9, symbol: 'F', nameEn: 'Fluorine', nameHi: 'फ्लोरीन', neutrons: 10, category: 'Halogen' },
  { atomicNumber: 10, symbol: 'Ne', nameEn: 'Neon', nameHi: 'नियॉन', neutrons: 10, category: 'Noble Gas' },
  { atomicNumber: 11, symbol: 'Na', nameEn: 'Sodium', nameHi: 'सोडियम', neutrons: 12, category: 'Alkali Metal' },
  { atomicNumber: 12, symbol: 'Mg', nameEn: 'Magnesium', nameHi: 'मैग्नीशियम', neutrons: 12, category: 'Alkaline Earth' },
  { atomicNumber: 13, symbol: 'Al', nameEn: 'Aluminium', nameHi: 'एल्युमीनियम', neutrons: 14, category: 'Post-transition Metal' },
  { atomicNumber: 14, symbol: 'Si', nameEn: 'Silicon', nameHi: 'सिलिकॉन', neutrons: 14, category: 'Metalloid' },
  { atomicNumber: 15, symbol: 'P', nameEn: 'Phosphorus', nameHi: 'फॉस्फोरस', neutrons: 16, category: 'Non-metal' },
  { atomicNumber: 16, symbol: 'S', nameEn: 'Sulfur', nameHi: 'सल्फर', neutrons: 16, category: 'Non-metal' },
  { atomicNumber: 17, symbol: 'Cl', nameEn: 'Chlorine', nameHi: 'क्लोरीन', neutrons: 18, category: 'Halogen' },
  { atomicNumber: 18, symbol: 'Ar', nameEn: 'Argon', nameHi: 'आर्गन', neutrons: 22, category: 'Noble Gas' },
  { atomicNumber: 19, symbol: 'K', nameEn: 'Potassium', nameHi: 'पोटैशियम', neutrons: 20, category: 'Alkali Metal' },
  { atomicNumber: 20, symbol: 'Ca', nameEn: 'Calcium', nameHi: 'कैल्शियम', neutrons: 20, category: 'Alkaline Earth' },
  { atomicNumber: 21, symbol: 'Sc', nameEn: 'Scandium', nameHi: 'स्कैंडियम', neutrons: 24, category: 'Transition Metal' },
  { atomicNumber: 22, symbol: 'Ti', nameEn: 'Titanium', nameHi: 'टाइटेनियम', neutrons: 26, category: 'Transition Metal' },
  { atomicNumber: 23, symbol: 'V', nameEn: 'Vanadium', nameHi: 'वैनेडियम', neutrons: 28, category: 'Transition Metal' },
  { atomicNumber: 24, symbol: 'Cr', nameEn: 'Chromium', nameHi: 'क्रोमियम', neutrons: 28, category: 'Transition Metal' },
  { atomicNumber: 25, symbol: 'Mn', nameEn: 'Manganese', nameHi: 'मैंगनीज', neutrons: 30, category: 'Transition Metal' },
  { atomicNumber: 26, symbol: 'Fe', nameEn: 'Iron', nameHi: 'लोहा (आयरन)', neutrons: 30, category: 'Transition Metal' },
  { atomicNumber: 27, symbol: 'Co', nameEn: 'Cobalt', nameHi: 'कोबाल्ट', neutrons: 32, category: 'Transition Metal' },
  { atomicNumber: 28, symbol: 'Ni', nameEn: 'Nickel', nameHi: 'निकल', neutrons: 31, category: 'Transition Metal' },
  { atomicNumber: 29, symbol: 'Cu', nameEn: 'Copper', nameHi: 'ताँबा (कॉपर)', neutrons: 35, category: 'Transition Metal' },
  { atomicNumber: 30, symbol: 'Zn', nameEn: 'Zinc', nameHi: 'जस्ता (जिंक)', neutrons: 35, category: 'Transition Metal' },
  { atomicNumber: 31, symbol: 'Ga', nameEn: 'Gallium', nameHi: 'गैलियम', neutrons: 39, category: 'Post-transition Metal' },
  { atomicNumber: 32, symbol: 'Ge', nameEn: 'Germanium', nameHi: 'जर्मेनियम', neutrons: 41, category: 'Metalloid' },
  { atomicNumber: 33, symbol: 'As', nameEn: 'Arsenic', nameHi: 'आर्सेनिक', neutrons: 42, category: 'Metalloid' },
  { atomicNumber: 34, symbol: 'Se', nameEn: 'Selenium', nameHi: 'सेलेनियम', neutrons: 45, category: 'Non-metal' },
  { atomicNumber: 35, symbol: 'Br', nameEn: 'Bromine', nameHi: 'ब्रोमीन', neutrons: 45, category: 'Halogen' },
  { atomicNumber: 36, symbol: 'Kr', nameEn: 'Krypton', nameHi: 'क्रिप्टॉन', neutrons: 48, category: 'Noble Gas' },
];

export interface BohrAtomAnalysis {
  element: ElementRecord;
  shells: number[];
  shellLabels: Array<{ shell: 'K' | 'L' | 'M' | 'N'; count: number; capacity: number }>;
  valenceElectrons: number;
  valency: number;
  massNumber: number;
}

export function computeBohrAtom(atomicNumber: number): BohrAtomAnalysis {
  const z = Math.max(1, Math.min(36, Math.round(atomicNumber)));
  const element = ELEMENTS_1_TO_36[z - 1];

  let shells: number[];
  if (z <= 2) {
    shells = [z];
  } else if (z <= 10) {
    shells = [2, z - 2];
  } else if (z <= 18) {
    shells = [2, 8, z - 10];
  } else if (z <= 20) {
    shells = [2, 8, 8, z - 18];
  } else if (z === 24) {
    shells = [2, 8, 13, 1]; // Chromium 3d5 4s1
  } else if (z === 29) {
    shells = [2, 8, 18, 1]; // Copper 3d10 4s1
  } else if (z <= 30) {
    shells = [2, 8, z - 12, 2];
  } else {
    shells = [2, 8, 18, z - 28];
  }

  const names: Array<'K' | 'L' | 'M' | 'N'> = ['K', 'L', 'M', 'N'];
  const caps = [2, 8, 18, 32];
  const shellLabels = shells.map((count, idx) => ({
    shell: names[idx],
    count,
    capacity: caps[idx],
  }));

  const valenceElectrons = shells[shells.length - 1] || 0;
  let valency = valenceElectrons;
  if (z === 2 || z === 10 || z === 18 || z === 36) {
    valency = 0;
  } else if (z > 20 && z <= 30) {
    valency = valenceElectrons === 1 ? 1 : 2;
  } else if (valenceElectrons > 4) {
    valency = 8 - valenceElectrons;
  }

  return {
    element,
    shells,
    shellLabels,
    valenceElectrons,
    valency,
    massNumber: element.atomicNumber + element.neutrons,
  };
}

// ==========================================
// 6. SAFE DETERMINISTIC MATH PARSER & PLOTTER (NO EVAL)
// ==========================================
type MathToken =
  | { type: 'num'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenizeMathExpression(raw: string): MathToken[] | null {
  const input = (raw || '').trim().replace(/²/g, '^2').replace(/³/g, '^3');
  if (!input || input.length > 160) return null;

  const rawTokens: MathToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let numStr = '';
      let dots = 0;
      while (i < input.length && ((input[i] >= '0' && input[i] <= '9') || input[i] === '.')) {
        if (input[i] === '.') dots += 1;
        if (dots > 1) return null;
        numStr += input[i];
        i += 1;
      }
      const val = Number(numStr);
      if (!Number.isFinite(val)) return null;
      rawTokens.push({ type: 'num', value: val });
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      let ident = '';
      while (i < input.length && ((input[i] >= 'a' && input[i] <= 'z') || (input[i] >= 'A' && input[i] <= 'Z'))) {
        ident += input[i].toLowerCase();
        i += 1;
      }
      rawTokens.push({ type: 'ident', value: ident });
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
      rawTokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    if (ch === '(') {
      rawTokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      rawTokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }
    // Reject unknown characters / punctuation
    return null;
  }

  // Insert implicit multiplication (e.g. 2x, 3(x+1), x(x+1), (x+1)(x-1))
  const expanded: MathToken[] = [];
  const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'abs', 'sqrt', 'ln', 'log', 'exp', 'floor', 'ceil']);
  for (let idx = 0; idx < rawTokens.length; idx++) {
    const curr = rawTokens[idx];
    const prev = expanded[expanded.length - 1];
    if (prev) {
      const prevIsVal =
        prev.type === 'num' ||
        prev.type === 'rparen' ||
        (prev.type === 'ident' && !FUNCTIONS.has(prev.value));
      const currStartsVal =
        curr.type === 'num' ||
        curr.type === 'ident' ||
        curr.type === 'lparen';
      if (prevIsVal && currStartsVal) {
        expanded.push({ type: 'op', value: '*' });
      }
    }
    expanded.push(curr);
  }

  return expanded;
}

export function evaluateSafeMathExpression(
  expression: string,
  x: number,
  a = 1,
  b = 0
): number | null {
  const cleanedExpr = expression.replace(/^\s*y\s*=\s*/i, '').replace(/^\s*f\s*\(\s*x\s*\)\s*=\s*/i, '');
  const tokens = tokenizeMathExpression(cleanedExpr);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    while (peek()?.type === 'op' && (peek() as any).value !== '*' && (peek() as any).value !== '/' && (peek() as any).value !== '^') {
      const op = (consume() as { type: 'op'; value: '+' | '-' }).value;
      const right = parseTerm();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return Number.isFinite(left) ? left : null;
  };

  const parseTerm = (): number | null => {
    let left = parseUnary();
    if (left === null) return null;
    while (peek()?.type === 'op' && ((peek() as any).value === '*' || (peek() as any).value === '/')) {
      const op = (consume() as { type: 'op'; value: '*' | '/' }).value;
      const right = parseUnary();
      if (right === null) return null;
      if (op === '/') {
        if (Math.abs(right) < 1e-9) return null;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return Number.isFinite(left) ? left : null;
  };

  const parseUnary = (): number | null => {
    const t = peek();
    if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
      consume();
      const val = parseUnary();
      if (val === null) return null;
      return t.value === '-' ? -val : val;
    }
    return parsePower();
  };

  const parsePower = (): number | null => {
    const base = parsePrimary();
    if (base === null) return null;
    const t = peek();
    if (t?.type === 'op' && t.value === '^') {
      consume();
      const exp = parseUnary();
      if (exp === null) return null;
      const res = Math.pow(base, exp);
      return Number.isFinite(res) ? res : null;
    }
    return base;
  };

  const parsePrimary = (): number | null => {
    const t = peek();
    if (!t) return null;
    if (t.type === 'num') {
      consume();
      return t.value;
    }
    if (t.type === 'lparen') {
      consume();
      const inner = parseExpr();
      if (inner === null || peek()?.type !== 'rparen') return null;
      consume();
      return inner;
    }
    if (t.type === 'ident') {
      consume();
      if (t.value === 'x') return x;
      if (t.value === 'a' || t.value === 'k') return a;
      if (t.value === 'b') return b;
      if (t.value === 'pi') return Math.PI;
      if (t.value === 'e') return Math.E;

      // Function call
      if (peek()?.type !== 'lparen') return null;
      consume();
      const arg = parseExpr();
      if (arg === null || peek()?.type !== 'rparen') return null;
      consume();

      let out: number;
      switch (t.value) {
        case 'sin':
          out = Math.sin(arg);
          break;
        case 'cos':
          out = Math.cos(arg);
          break;
        case 'tan':
          if (Math.abs(Math.cos(arg)) < 1e-4) return null;
          out = Math.tan(arg);
          break;
        case 'abs':
          out = Math.abs(arg);
          break;
        case 'sqrt':
          if (arg < 0) return null;
          out = Math.sqrt(arg);
          break;
        case 'ln':
          if (arg <= 0) return null;
          out = Math.log(arg);
          break;
        case 'log':
          if (arg <= 0) return null;
          out = Math.log10(arg);
          break;
        case 'exp':
          out = Math.exp(clampNum(arg, -20, 20, 0));
          break;
        case 'floor':
          out = Math.floor(arg);
          break;
        case 'ceil':
          out = Math.ceil(arg);
          break;
        default:
          return null;
      }
      return Number.isFinite(out) ? out : null;
    }
    return null;
  };

  const result = parseExpr();
  if (result === null || pos !== tokens.length || !Number.isFinite(result)) {
    return null;
  }
  return result;
}

export interface SampledCurveResult {
  points: Array<{ x: number; y: number | null }>;
  roots: number[];
  minPoint: { x: number; y: number } | null;
  maxPoint: { x: number; y: number } | null;
}

export function sampleMathPlotCurve(
  expression: string,
  xMin: number,
  xMax: number,
  a = 1,
  b = 0,
  steps = 120
): SampledCurveResult {
  const safeMin = Math.min(xMin, xMax - 1);
  const safeMax = Math.max(xMax, safeMin + 1);
  const points: Array<{ x: number; y: number | null }> = [];
  const roots: number[] = [];
  let minPoint: { x: number; y: number } | null = null;
  let maxPoint: { x: number; y: number } | null = null;

  let prevX = safeMin;
  let prevY: number | null = null;

  for (let i = 0; i <= steps; i++) {
    const x = safeMin + ((safeMax - safeMin) * i) / steps;
    const y = evaluateSafeMathExpression(expression, x, a, b);
    points.push({ x: Number(x.toFixed(3)), y: y !== null ? Number(y.toFixed(3)) : null });

    if (y !== null) {
      if (!minPoint || y < minPoint.y) minPoint = { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
      if (!maxPoint || y > maxPoint.y) maxPoint = { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };

      if (Math.abs(y) < 1e-3 && (roots.length === 0 || Math.abs(roots[roots.length - 1] - x) > 0.2)) {
        roots.push(Number(x.toFixed(2)));
      } else if (prevY !== null && prevY * y < 0 && Math.abs(prevY - y) < 25) {
        const approxRoot = prevX - (prevY * (x - prevX)) / (y - prevY);
        if (roots.length === 0 || Math.abs(roots[roots.length - 1] - approxRoot) > 0.2) {
          roots.push(Number(approxRoot.toFixed(2)));
        }
      }
    }

    prevX = x;
    prevY = y;
  }

  return {
    points,
    roots: roots.slice(0, 6),
    minPoint,
    maxPoint,
  };
}

export function computeNumericDerivative(
  expression: string,
  x0: number,
  a = 1,
  b = 0
): number | null {
  const h = 0.005;
  const y1 = evaluateSafeMathExpression(expression, x0 - h, a, b);
  const y2 = evaluateSafeMathExpression(expression, x0 + h, a, b);
  if (y1 === null || y2 === null) return null;
  const slope = (y2 - y1) / (2 * h);
  return Number.isFinite(slope) ? Number(slope.toFixed(3)) : null;
}

export function computeQuadraticAnalysis(aRaw: number, bRaw: number, cRaw: number) {
  const a = Math.abs(aRaw) < 0.1 ? (aRaw < 0 ? -0.5 : 0.5) : Number(aRaw.toFixed(2));
  const b = Number(bRaw.toFixed(2));
  const c = Number(cRaw.toFixed(2));
  const discriminant = Number((b * b - 4 * a * c).toFixed(2));
  const roots: number[] = [];
  if (discriminant > 0.001) {
    const s = Math.sqrt(discriminant);
    roots.push(Number(((-b - s) / (2 * a)).toFixed(2)), Number(((-b + s) / (2 * a)).toFixed(2)));
    roots.sort((x1, x2) => x1 - x2);
  } else if (Math.abs(discriminant) <= 0.001) {
    roots.push(Number((-b / (2 * a)).toFixed(2)));
  }
  const vertexX = Number((-b / (2 * a)).toFixed(2));
  const vertexY = Number((a * vertexX * vertexX + b * vertexX + c).toFixed(2));
  return { a, b, c, discriminant, roots, vertexX, vertexY };
}

// ==========================================
// 7. COORDINATE GEOMETRY METRICS
// ==========================================
export function computeSegmentMetrics(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): { length: number; midpoint: { x: number; y: number }; slope: number | null } {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Number(Math.sqrt(dx * dx + dy * dy).toFixed(2));
  const midpoint = {
    x: Number(((p1.x + p2.x) / 2).toFixed(2)),
    y: Number(((p1.y + p2.y) / 2).toFixed(2)),
  };
  const slope = Math.abs(dx) < 1e-6 ? null : Number((dy / dx).toFixed(2));
  return { length, midpoint, slope };
}

// ==========================================
// 8. CACHE KEY & VALIDATION / SANITIZATION
// ==========================================
function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanStr(val: unknown, fallback: string, maxLen = 280): string {
  const s = typeof val === 'string' ? val.trim() : '';
  return (s || fallback).slice(0, maxLen);
}

export function buildVisualCacheKey(params: {
  board: string;
  classGrade: string;
  subject: string;
  chapter: string;
  topic: string;
  customPrompt?: string;
  language: VisualLanguage;
}): string {
  const norm = (v: string | undefined) =>
    (v || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u0900-\u097f]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const parts = [
    norm(params.board),
    norm(params.classGrade),
    norm(params.subject),
    norm(params.chapter).slice(0, 48),
    norm(params.topic).slice(0, 64),
    norm(params.customPrompt).slice(0, 64),
    norm(params.language),
  ];
  return parts.join('__').slice(0, 240);
}

const SAFE_SVG_PATH_RE = /^[0-9eE.,+\-\sMLHVCSQTAZmlhvcsqtaz]+$/;
const SAFE_HEX_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\))$/;

function cleanSvgColor(color: unknown, fallback: string): string {
  const s = typeof color === 'string' ? color.trim() : '';
  return SAFE_HEX_COLOR_RE.test(s) ? s : fallback;
}

function sanitizeDiagramConfig(raw?: Partial<AnnotatedDiagramVisualConfig>): AnnotatedDiagramVisualConfig | null {
  if (!raw) return null;
  const shapes: DiagramShapeSpec[] = Array.isArray(raw.shapes)
    ? raw.shapes
        .slice(0, 22)
        .map((s, idx): DiagramShapeSpec | null => {
          if (!s || typeof s !== 'object') return null;
          const kind = s.kind;
          if (!['circle', 'ellipse', 'rect', 'polygon', 'line', 'path'].includes(String(kind))) {
            return null;
          }
          if (kind === 'path' && (typeof s.d !== 'string' || !SAFE_SVG_PATH_RE.test(s.d) || s.d.length > 500)) {
            return null;
          }
          return {
            id: cleanStr(s.id, `shape_${idx + 1}`, 48),
            kind: kind as DiagramShapeSpec['kind'],
            label: s.label ? cleanStr(s.label, '', 60) : undefined,
            x: s.x !== undefined ? clampNum(s.x, 10, 590, 300) : undefined,
            y: s.y !== undefined ? clampNum(s.y, 10, 350, 180) : undefined,
            x2: s.x2 !== undefined ? clampNum(s.x2, 10, 590, 360) : undefined,
            y2: s.y2 !== undefined ? clampNum(s.y2, 10, 350, 180) : undefined,
            width: s.width !== undefined ? clampNum(s.width, 8, 560, 120) : undefined,
            height: s.height !== undefined ? clampNum(s.height, 8, 320, 60) : undefined,
            rx: s.rx !== undefined ? clampNum(s.rx, 4, 260, 40) : undefined,
            ry: s.ry !== undefined ? clampNum(s.ry, 4, 160, 28) : undefined,
            r: s.r !== undefined ? clampNum(s.r, 4, 150, 36) : undefined,
            points:
              typeof s.points === 'string' && /^[0-9.,\s\-]+$/.test(s.points.trim())
                ? s.points.trim().slice(0, 220)
                : undefined,
            d: typeof s.d === 'string' ? s.d.trim() : undefined,
            fill: cleanSvgColor(s.fill, 'rgba(56, 189, 248, 0.16)'),
            stroke: cleanSvgColor(s.stroke, '#38bdf8'),
            strokeWidth: clampNum(s.strokeWidth, 1, 8, 2),
            dashed: Boolean(s.dashed),
            opacity: clampNum(s.opacity, 0.1, 1, 0.9),
          };
        })
        .filter((x): x is DiagramShapeSpec => Boolean(x))
    : [];

  const arrows: DiagramArrowSpec[] = Array.isArray(raw.arrows)
    ? raw.arrows
        .slice(0, 12)
        .filter((a) => a && Number.isFinite(Number(a.fromX)) && Number.isFinite(Number(a.toX)))
        .map((a, idx) => ({
          id: cleanStr(a.id, `arr_${idx + 1}`, 48),
          fromX: clampNum(a.fromX, 15, 585, 140),
          fromY: clampNum(a.fromY, 15, 345, 180),
          toX: clampNum(a.toX, 15, 585, 420),
          toY: clampNum(a.toY, 15, 345, 180),
          label: a.label ? cleanStr(a.label, '', 48) : undefined,
          dashed: Boolean(a.dashed),
          color: cleanSvgColor(a.color, '#38bdf8'),
        }))
    : [];

  const hotspots: DiagramHotspotSpec[] = Array.isArray(raw.hotspots)
    ? raw.hotspots
        .slice(0, 10)
        .filter((h) => h && typeof h.label === 'string' && h.label.trim().length > 0)
        .map((h, idx) => ({
          id: cleanStr(h.id, `hs_${idx + 1}`, 48),
          x: clampNum(h.x, 32, 568, 120 + (idx % 4) * 110),
          y: clampNum(h.y, 32, 328, 90 + Math.floor(idx / 4) * 120),
          label: cleanStr(h.label, `Part ${idx + 1}`, 60),
          summary: cleanStr(h.summary, cleanStr(h.detail, 'Interactive concept region', 140), 140),
          detail: cleanStr(h.detail, 'Inspect this highlighted component in the diagram.', 360),
          category: h.category ? cleanStr(h.category, 'Structure', 32) : undefined,
        }))
    : [];

  if (shapes.length === 0 || hotspots.length === 0) {
    return null;
  }

  const legend = Array.isArray(raw.legend)
    ? raw.legend.slice(0, 6).map((item, idx) => ({
        color: cleanSvgColor(item?.color, ['#38bdf8', '#10b981', '#f59e0b', '#a855f7'][idx % 4]),
        label: cleanStr(item?.label, `Layer ${idx + 1}`, 48),
      }))
    : [];

  const layoutKind = ['layered', 'cycle', 'cross-section', 'comparison'].includes(String(raw.layoutKind))
    ? (raw.layoutKind as AnnotatedDiagramVisualConfig['layoutKind'])
    : 'layered';
  const backgroundTheme = ['bio', 'geo', 'chem', 'phys'].includes(String(raw.backgroundTheme))
    ? (raw.backgroundTheme as AnnotatedDiagramVisualConfig['backgroundTheme'])
    : 'bio';

  return { layoutKind, backgroundTheme, shapes, arrows, hotspots, legend };
}

function buildFallbackIllustrated(spec: Partial<GeneratedVisualSpec>): IllustratedConceptVisualConfig {
  const takeaways = Array.isArray(spec.keyTakeaways) && spec.keyTakeaways.length > 0
    ? spec.keyTakeaways
    : [
        cleanStr(spec.conceptExplanation, 'Core concept breakdown', 160),
        cleanStr(spec.whatYouAreObserving, 'Key relationship and principle', 160),
      ];
  const accents: Array<'indigo' | 'cyan' | 'emerald' | 'amber'> = ['indigo', 'cyan', 'emerald', 'amber'];
  const cards = takeaways.slice(0, 4).map((text, idx) => ({
    id: `card_${idx + 1}`,
    stepBadge: `0${idx + 1}`,
    title: spec.steps?.[idx]?.title || `Key Principle ${idx + 1}`,
    summary: cleanStr(text, 'Structured conceptual step', 220),
    keyPoint: cleanStr(spec.observationsChecklist?.[idx] || spec.steps?.[idx]?.explanation || text, text, 180),
    metricOrFormula: idx === 0 ? spec.formulaOrLaw : undefined,
    accent: accents[idx % accents.length],
  }));
  return { cards };
}

export function validateAndSanitizeGeneratedVisual(
  raw: Partial<GeneratedVisualSpec>,
  context: {
    id?: string;
    cacheKey: string;
    userId: string;
    board: string;
    classGrade: string;
    subject: string;
    chapter: string;
    topic: string;
    customPrompt?: string;
    language: VisualLanguage;
  }
): GeneratedVisualSpec {
  const now = new Date().toISOString();
  const validRenderers: VisualRendererType[] = [
    'kinematics-projectile',
    'optics-ray',
    'circuit-network',
    'wave-oscillation',
    'bohr-atom',
    'molecular-geometry',
    'math-function-plot',
    'coordinate-geometry',
    'annotated-diagram',
    'illustrated-concept',
  ];

  let rendererType: VisualRendererType = validRenderers.includes(raw.rendererType as VisualRendererType)
    ? (raw.rendererType as VisualRendererType)
    : 'illustrated-concept';

  const validCategories: VisualModalityCategory[] = [
    'physics-simulation',
    'math-graph',
    'geometry-construction',
    'chemistry-model',
    'annotated-diagram',
    'process-cycle',
    'illustrated-concept',
  ];

  let visualCategory: VisualModalityCategory = validCategories.includes(
    raw.visualCategory as VisualModalityCategory
  )
    ? (raw.visualCategory as VisualModalityCategory)
    : 'illustrated-concept';

  const engineConfig: GeneratedVisualSpec['engineConfig'] = {};
  const rawCfg = raw.engineConfig || {};

  if (rendererType === 'kinematics-projectile' && rawCfg.kinematics) {
    const k = rawCfg.kinematics as Partial<KinematicsVisualConfig>;
    engineConfig.kinematics = {
      speed: clampNum(k.speed, 6, 50, 24),
      angle: clampNum(k.angle, 10, 80, 45),
      gravity: clampNum(k.gravity, 1.6, 20, 9.8),
      environmentLabel: cleanStr(k.environmentLabel, 'Earth (9.8 m/s²)', 48),
      projectileLabel: cleanStr(k.projectileLabel, context.topic || 'Projectile', 48),
      showVectors: k.showVectors !== false,
    };
    visualCategory = 'physics-simulation';
  } else if (rendererType === 'optics-ray' && rawCfg.optics) {
    const o = rawCfg.optics as Partial<OpticsRayVisualConfig>;
    const validEls = ['convex-lens', 'concave-lens', 'concave-mirror', 'convex-mirror'];
    engineConfig.optics = {
      opticalElement: validEls.includes(String(o.opticalElement))
        ? (o.opticalElement as OpticsRayVisualConfig['opticalElement'])
        : 'convex-lens',
      focalLengthCm: clampNum(o.focalLengthCm, 6, 35, 15),
      objectDistanceCm: clampNum(o.objectDistanceCm, 8, 70, 30),
      objectHeightCm: clampNum(o.objectHeightCm, 2, 8, 4),
      mediumLabel: o.mediumLabel ? cleanStr(o.mediumLabel, 'Air → Glass', 48) : undefined,
    };
    visualCategory = 'physics-simulation';
  } else if (rendererType === 'circuit-network' && rawCfg.circuit) {
    const c = rawCfg.circuit as Partial<CircuitVisualConfig>;
    engineConfig.circuit = {
      topology: c.topology === 'parallel' ? 'parallel' : 'series',
      voltage: clampNum(c.voltage, 2, 24, 12),
      r1: clampNum(c.r1, 2, 50, 6),
      r2: clampNum(c.r2, 2, 50, 12),
      r1Label: c.r1Label ? cleanStr(c.r1Label, 'R1', 28) : undefined,
      r2Label: c.r2Label ? cleanStr(c.r2Label, 'R2', 28) : undefined,
      sourceLabel: c.sourceLabel ? cleanStr(c.sourceLabel, 'DC Source', 32) : undefined,
    };
    visualCategory = 'physics-simulation';
  } else if (rendererType === 'wave-oscillation' && rawCfg.wave) {
    const w = rawCfg.wave as Partial<WaveVisualConfig>;
    engineConfig.wave = {
      amplitude: clampNum(w.amplitude, 10, 75, 44),
      frequency: clampNum(w.frequency, 0.5, 4.5, 1.5),
      wavelength: clampNum(w.wavelength, 1.5, 8, 4),
      waveKind: w.waveKind === 'sound-pressure' ? 'sound-pressure' : 'transverse',
      waveLabel: w.waveLabel ? cleanStr(w.waveLabel, context.topic, 48) : undefined,
    };
    visualCategory = 'physics-simulation';
  } else if (rendererType === 'bohr-atom' && rawCfg.bohr) {
    const b = rawCfg.bohr as Partial<BohrVisualConfig>;
    engineConfig.bohr = {
      atomicNumber: clampNum(b.atomicNumber, 1, 36, 6),
      highlightShell: ['K', 'L', 'M', 'N'].includes(String(b.highlightShell))
        ? (b.highlightShell as 'K' | 'L' | 'M' | 'N')
        : undefined,
    };
    visualCategory = 'chemistry-model';
  } else if (rendererType === 'molecular-geometry' && rawCfg.molecule) {
    const m = rawCfg.molecule as Partial<MolecularVisualConfig>;
    const bonds = Array.isArray(m.bonds)
      ? m.bonds.slice(0, 6).map((bd, idx) => ({
          id: cleanStr(bd?.id, `bond_${idx + 1}`, 32),
          atomLabel: cleanStr(bd?.atomLabel, 'H', 10),
          bondOrder: ([1, 2, 3].includes(Number(bd?.bondOrder)) ? Number(bd?.bondOrder) : 1) as 1 | 2 | 3,
          angleDeg: clampNum(bd?.angleDeg, -360, 360, idx * (360 / Math.max(1, m.bonds!.length))),
          lengthRatio: clampNum(bd?.lengthRatio, 0.7, 1.3, 1),
        }))
      : [];
    if (bonds.length >= 1) {
      engineConfig.molecule = {
        formula: cleanStr(m.formula, context.topic, 40),
        centralAtom: cleanStr(m.centralAtom, 'C', 10),
        centralLabel: m.centralLabel ? cleanStr(m.centralLabel, '', 36) : undefined,
        shapeName: cleanStr(m.shapeName, 'Molecular Shape', 60),
        hybridization: m.hybridization ? cleanStr(m.hybridization, 'sp³', 20) : undefined,
        bondAngleDeg: clampNum(m.bondAngleDeg, 30, 180, 109.5),
        lonePairs: Math.round(clampNum(m.lonePairs, 0, 4, 0)),
        bonds,
        explanation: m.explanation ? cleanStr(m.explanation, '', 260) : undefined,
      };
      visualCategory = 'chemistry-model';
    } else {
      rendererType = 'illustrated-concept';
    }
  } else if (rendererType === 'math-function-plot' && rawCfg.mathPlot) {
    const mp = rawCfg.mathPlot as Partial<MathPlotVisualConfig>;
    const palette = ['#38bdf8', '#a855f7', '#10b981'];
    const validCurves = Array.isArray(mp.curves)
      ? mp.curves
          .slice(0, 3)
          .filter((c) => {
            if (!c || typeof c.expression !== 'string') return false;
            const probe = evaluateSafeMathExpression(c.expression, 1, mp.parameterA?.defaultValue ?? 1, mp.parameterB?.defaultValue ?? 0);
            const probe2 = evaluateSafeMathExpression(c.expression, -1.5, mp.parameterA?.defaultValue ?? 1, mp.parameterB?.defaultValue ?? 0);
            return probe !== null || probe2 !== null;
          })
          .map((c, idx) => ({
            id: cleanStr(c.id, `curve_${idx + 1}`, 32),
            label: cleanStr(c.label, `y = ${c.expression}`, 60),
            expression: cleanStr(c.expression, 'a*x^2 + b', 120),
            color: cleanSvgColor(c.color, palette[idx % palette.length]),
          }))
      : [];
    if (validCurves.length >= 1) {
      const xMin = clampNum(mp.xMin, -25, -1, -6);
      const xMax = clampNum(mp.xMax, 1, 25, 6);
      const yMin = clampNum(mp.yMin, -40, -1, -8);
      const yMax = clampNum(mp.yMax, 1, 40, 8);
      engineConfig.mathPlot = {
        curves: validCurves,
        xMin,
        xMax: Math.max(xMin + 2, xMax),
        yMin,
        yMax: Math.max(yMin + 2, yMax),
        parameterA: mp.parameterA
          ? {
              label: cleanStr(mp.parameterA.label, 'Parameter a', 40),
              min: clampNum(mp.parameterA.min, -10, 10, -3),
              max: clampNum(mp.parameterA.max, -9, 15, 3),
              step: clampNum(mp.parameterA.step, 0.1, 2, 0.5),
              defaultValue: clampNum(mp.parameterA.defaultValue, -10, 10, 1),
            }
          : undefined,
        parameterB: mp.parameterB
          ? {
              label: cleanStr(mp.parameterB.label, 'Parameter b', 40),
              min: clampNum(mp.parameterB.min, -10, 10, -4),
              max: clampNum(mp.parameterB.max, -9, 15, 4),
              step: clampNum(mp.parameterB.step, 0.1, 2, 0.5),
              defaultValue: clampNum(mp.parameterB.defaultValue, -10, 10, 0),
            }
          : undefined,
        highlightRoots: mp.highlightRoots !== false,
        showTangentAtX:
          typeof mp.showTangentAtX === 'number' && Number.isFinite(mp.showTangentAtX)
            ? clampNum(mp.showTangentAtX, xMin, xMax, 0)
            : null,
      };
      visualCategory = 'math-graph';
    } else {
      rendererType = 'illustrated-concept';
    }
  } else if (rendererType === 'coordinate-geometry' && rawCfg.geometry) {
    const g = rawCfg.geometry as Partial<GeometryVisualConfig>;
    const bounds = Math.round(clampNum(g.coordinateBounds, 4, 15, 8));
    const points = Array.isArray(g.points)
      ? g.points.slice(0, 8).map((p, idx) => ({
          id: cleanStr(p?.id, `P${idx + 1}`, 24),
          label: cleanStr(p?.label, String.fromCharCode(65 + idx), 24),
          x: Number(clampNum(p?.x, -bounds + 0.5, bounds - 0.5, (idx - 1) * 2).toFixed(2)),
          y: Number(clampNum(p?.y, -bounds + 0.5, bounds - 0.5, idx % 2 === 0 ? 2 : -1).toFixed(2)),
          adjustable: Boolean(p?.adjustable ?? idx < 2),
        }))
      : [];
    const pointIds = new Set(points.map((p) => p.id));
    const segments = Array.isArray(g.segments)
      ? g.segments
          .filter((s) => s && pointIds.has(s.fromId) && pointIds.has(s.toId) && s.fromId !== s.toId)
          .slice(0, 12)
          .map((s) => ({
            fromId: s.fromId,
            toId: s.toId,
            label: s.label ? cleanStr(s.label, '', 32) : undefined,
            dashed: Boolean(s.dashed),
            color: cleanSvgColor(s.color, '#38bdf8'),
          }))
      : [];
    if (points.length >= 2) {
      engineConfig.geometry = {
        coordinateBounds: bounds,
        gridStep: clampNum(g.gridStep, 1, 5, 2),
        points,
        segments,
        circles: Array.isArray(g.circles)
          ? g.circles
              .filter((c) => c && pointIds.has(c.centerId))
              .slice(0, 4)
              .map((c) => ({
                centerId: c.centerId,
                radius: clampNum(c.radius, 0.5, bounds, 3),
                label: c.label ? cleanStr(c.label, '', 32) : undefined,
              }))
          : [],
        polygons: Array.isArray(g.polygons)
          ? g.polygons
              .filter((pg) => pg && Array.isArray(pg.pointIds) && pg.pointIds.every((id) => pointIds.has(id)))
              .slice(0, 3)
              .map((pg) => ({
                pointIds: pg.pointIds.slice(0, 6),
                fill: cleanSvgColor(pg.fill, 'rgba(99, 102, 241, 0.16)'),
                label: pg.label ? cleanStr(pg.label, '', 32) : undefined,
              }))
          : [],
        theoremNote: cleanStr(g.theoremNote, 'Drag sliders or points to observe real geometric invariants.', 220),
      };
      visualCategory = 'geometry-construction';
    } else {
      rendererType = 'illustrated-concept';
    }
  } else if (rendererType === 'annotated-diagram') {
    const cleanDiagram = sanitizeDiagramConfig(rawCfg.diagram);
    if (cleanDiagram) {
      engineConfig.diagram = cleanDiagram;
      if (visualCategory !== 'process-cycle') {
        visualCategory = 'annotated-diagram';
      }
    } else {
      rendererType = 'illustrated-concept';
    }
  }

  if (rendererType === 'illustrated-concept') {
    visualCategory = 'illustrated-concept';
    const rawIll = rawCfg.illustrated;
    if (rawIll && Array.isArray(rawIll.cards) && rawIll.cards.length > 0) {
      engineConfig.illustrated = {
        cards: rawIll.cards.slice(0, 6).map((c, idx) => ({
          id: cleanStr(c?.id, `card_${idx + 1}`, 32),
          stepBadge: cleanStr(c?.stepBadge, `0${idx + 1}`, 16),
          title: cleanStr(c?.title, `Stage ${idx + 1}`, 80),
          summary: cleanStr(c?.summary, 'Key conceptual idea.', 240),
          keyPoint: cleanStr(c?.keyPoint, 'Connect theory with real observation.', 180),
          metricOrFormula: c?.metricOrFormula ? cleanStr(c.metricOrFormula, '', 90) : undefined,
          accent: (['indigo', 'cyan', 'emerald', 'amber'].includes(String(c?.accent))
            ? c?.accent
            : ['indigo', 'cyan', 'emerald', 'amber'][idx % 4]) as 'indigo' | 'cyan' | 'emerald' | 'amber',
        })),
        leftHeader: rawIll.leftHeader ? cleanStr(rawIll.leftHeader, '', 48) : undefined,
        rightHeader: rawIll.rightHeader ? cleanStr(rawIll.rightHeader, '', 48) : undefined,
        comparisonRows: Array.isArray(rawIll.comparisonRows)
          ? rawIll.comparisonRows.slice(0, 6).map((r) => ({
              aspect: cleanStr(r?.aspect, 'Aspect', 60),
              leftLabel: cleanStr(r?.leftLabel, '', 110),
              rightLabel: cleanStr(r?.rightLabel, '', 110),
            }))
          : undefined,
      };
    } else {
      engineConfig.illustrated = buildFallbackIllustrated(raw);
    }
  }

  const steps: VisualExplorationStep[] =
    Array.isArray(raw.steps) && raw.steps.length > 0
      ? raw.steps.slice(0, 6).map((st, idx) => ({
          step: idx + 1,
          title: cleanStr(st?.title, `Step ${idx + 1}`, 100),
          explanation: cleanStr(st?.explanation, 'Observe how the concept evolves at this stage.', 360),
          highlightTarget: st?.highlightTarget ? cleanStr(st.highlightTarget, '', 60) : undefined,
          presetParams:
            st?.presetParams && typeof st.presetParams === 'object' ? st.presetParams : undefined,
        }))
      : [
          {
            step: 1,
            title: context.language === 'Hindi' ? 'मुख्य सिद्धांत का अवलोकन' : 'Observe the Core Principle',
            explanation: cleanStr(
              raw.conceptExplanation,
              `Explore how ${context.topic} works step by step.`,
              300
            ),
          },
        ];

  const keyTakeaways =
    Array.isArray(raw.keyTakeaways) && raw.keyTakeaways.length > 0
      ? raw.keyTakeaways.slice(0, 6).map((t) => cleanStr(t, '', 220)).filter(Boolean)
      : [cleanStr(raw.conceptExplanation, `Understand the governing idea behind ${context.topic}.`, 220)];

  const observationsChecklist =
    Array.isArray(raw.observationsChecklist) && raw.observationsChecklist.length > 0
      ? raw.observationsChecklist.slice(0, 5).map((t) => cleanStr(t, '', 200)).filter(Boolean)
      : [cleanStr(raw.whatYouAreObserving, 'Observe the relationship between inputs and outcomes.', 200)];

  return {
    id: context.id || `vis_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    cacheKey: context.cacheKey,
    userId: context.userId,
    board: context.board,
    classGrade: context.classGrade,
    subject: context.subject,
    chapter: context.chapter,
    topic: context.topic,
    customPrompt: context.customPrompt || '',
    language: context.language,
    title: cleanStr(raw.title, `${context.topic} — Visual Explorer`, 140),
    subtitle: cleanStr(raw.subtitle, `${context.subject} · ${context.chapter}`, 180),
    visualCategory,
    rendererType,
    modalityHonestyLabel: cleanStr(
      raw.modalityHonestyLabel,
      rendererType === 'illustrated-concept'
        ? 'Structured Illustrated Explanation: clear step-by-step visual cards rather than a physics engine.'
        : rendererType === 'annotated-diagram'
          ? 'Interactive Annotated Diagram: click highlighted regions to inspect function and flow.'
          : 'Live Computed Visual Model: adjusts calculations directly from your sliders and parameters.',
      220
    ),
    conceptExplanation: cleanStr(
      raw.conceptExplanation,
      `Visual breakdown of ${context.topic} aligned with ${context.classGrade} (${context.board}).`,
      900
    ),
    whatYouAreObserving: cleanStr(
      raw.whatYouAreObserving,
      `Inspect the structure and behavior of ${context.topic}.`,
      500
    ),
    interactionInstructions: cleanStr(
      raw.interactionInstructions,
      'Adjust controls or step through each guided stage below.',
      320
    ),
    formulaOrLaw: raw.formulaOrLaw ? cleanStr(raw.formulaOrLaw, '', 140) : undefined,
    keyTakeaways,
    observationsChecklist,
    steps,
    engineConfig,
    saved: Boolean(raw.saved),
    cached: Boolean(raw.cached),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
  };
}

// ==========================================
// 9. DYNAMIC PERSONALIZED PROMPT SUGGESTIONS (ZERO STATIC DEFAULTS)
// ==========================================
export function computePersonalizedVisualSuggestions(params: {
  board: IndianBoard;
  classGrade: ClassGrade;
  subjects: string[];
  learningGoals?: string[];
  topicMastery?: TopicMasteryRecord[];
  chapterProgress?: ChapterProgressSummary[];
  verifiedNodes?: ChapterNode[];
  previousVisuals?: GeneratedVisualSpec[];
  language: VisualLanguage;
}): PersonalizedVisualSuggestion[] {
  const isHi = params.language === 'Hindi';
  const suggestions: PersonalizedVisualSuggestion[] = [];
  const seenTopics = new Set<string>();

  const existingVisualTopics = new Set(
    (params.previousVisuals || []).map((v) => `${v.subject}::${v.topic}`.toLowerCase())
  );

  const pushSuggestion = (item: PersonalizedVisualSuggestion) => {
    const key = `${item.subject}::${item.topic}`.toLowerCase();
    if (seenTopics.has(key)) return;
    seenTopics.add(key);
    suggestions.push(item);
  };

  // Priority 1: Weak or needs-revision topics from real Learning Intelligence mastery records
  const weakTopics = [...(params.topicMastery || [])]
    .filter((tm) => tm.status === 'needs-revision' || tm.weightedMasteryScore < 68)
    .sort((a, b) => a.weightedMasteryScore - b.weightedMasteryScore);

  for (const tm of weakTopics.slice(0, 2)) {
    pushSuggestion({
      id: `sug_weak_${tm.id}`,
      subject: tm.subject,
      chapter: tm.chapter || tm.subject,
      topic: tm.topic,
      prompt: isHi
        ? `${tm.topic} को इंटरैक्टिव मॉडल से सरल रूप में दिखाएँ (${Math.round(tm.weightedMasteryScore)}% दक्षता सुधार हेतु)`
        : `Visualize ${tm.topic} interactively to clear tricky steps and boost ${Math.round(tm.weightedMasteryScore)}% mastery`,
      reasonTag: isHi ? 'कठिन विषय सुधार' : `Focus Topic (${Math.round(tm.weightedMasteryScore)}%)`,
    });
  }

  // Priority 2: Active in-progress chapters from verified progress
  const activeChapters = (params.chapterProgress || []).filter(
    (cp) => cp.status === 'in_progress'
  );
  for (const ch of activeChapters.slice(0, 2)) {
    const nextTopic =
      ch.topics.find((t) => !ch.completedTopicTitles.includes(t)) ||
      ch.topics[0] ||
      ch.chapterTitle;
    pushSuggestion({
      id: `sug_prog_${ch.chapterId}`,
      subject: ch.subject,
      chapter: ch.chapterTitle,
      topic: nextTopic,
      prompt: isHi
        ? `${ch.chapterTitle} के अंतर्गत ${nextTopic} का चरणबद्ध विजुअल मॉडल बनाएँ`
        : `Generate a step-by-step visual explorer for ${nextTopic} in ${ch.chapterTitle}`,
      reasonTag: isHi ? 'जारी अध्याय' : `In Progress (${ch.percentComplete}%)`,
    });
  }

  // Priority 3: Build from student's own board, class, enrolled subjects, verified syllabus & goals
  const curriculum = getCurriculumForStudent(
    params.board,
    params.classGrade,
    params.subjects,
    params.verifiedNodes
  );

  const hasCompetitiveGoal = (params.learningGoals || []).some((g) =>
    /jee|neet|challenge|competitive|advanced/i.test(g)
  );

  for (const subj of curriculum) {
    if (suggestions.length >= 4) break;
    for (const ch of subj.chapters) {
      if (suggestions.length >= 4) break;
      const candidateTopic =
        ch.keyTopics.find(
          (t) => !existingVisualTopics.has(`${subj.name}::${t}`.toLowerCase())
        ) ||
        ch.keyTopics[0] ||
        ch.title;

      pushSuggestion({
        id: `sug_curr_${subj.id}_${ch.id}`,
        subject: subj.name,
        chapter: ch.title,
        topic: candidateTopic,
        prompt: isHi
          ? `${params.classGrade} ${params.board} (${subj.name}) के लिए ${candidateTopic} का इंटरैक्टिव दृश्य तैयार करें`
          : hasCompetitiveGoal
            ? `Build an analytical visual model for ${candidateTopic} (${params.classGrade} ${params.board} foundation)`
            : `Visualize ${candidateTopic} from ${ch.title} for ${params.classGrade} (${params.board})`,
        reasonTag: `${params.classGrade} · ${subj.name}`,
      });
    }
  }

  return suggestions.slice(0, 4);
}
