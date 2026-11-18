import type { TutorLanguage } from './ai.ts';

export type VisualLanguage = 'English' | 'Hindi';

export type VisualModalityCategory =
  | 'physics-simulation'
  | 'math-graph'
  | 'geometry-construction'
  | 'chemistry-model'
  | 'annotated-diagram'
  | 'process-cycle'
  | 'illustrated-concept';

export type VisualRendererType =
  | 'kinematics-projectile'
  | 'optics-ray'
  | 'circuit-network'
  | 'wave-oscillation'
  | 'bohr-atom'
  | 'molecular-geometry'
  | 'math-function-plot'
  | 'coordinate-geometry'
  | 'annotated-diagram'
  | 'illustrated-concept';

export interface VisualExplorationStep {
  step: number;
  title: string;
  explanation: string;
  highlightTarget?: string;
  presetParams?: Record<string, number | string>;
}

export interface KinematicsVisualConfig {
  speed: number;
  angle: number;
  gravity: number;
  environmentLabel: string;
  projectileLabel: string;
  showVectors: boolean;
}

export interface OpticsRayVisualConfig {
  opticalElement: 'convex-lens' | 'concave-lens' | 'concave-mirror' | 'convex-mirror';
  focalLengthCm: number;
  objectDistanceCm: number;
  objectHeightCm: number;
  mediumLabel?: string;
}

export interface CircuitVisualConfig {
  topology: 'series' | 'parallel';
  voltage: number;
  r1: number;
  r2: number;
  r1Label?: string;
  r2Label?: string;
  sourceLabel?: string;
}

export interface WaveVisualConfig {
  amplitude: number;
  frequency: number;
  wavelength: number;
  waveKind: 'transverse' | 'sound-pressure';
  waveLabel?: string;
}

export interface BohrVisualConfig {
  atomicNumber: number;
  highlightShell?: 'K' | 'L' | 'M' | 'N';
}

export interface MoleculeBondSpec {
  id: string;
  atomLabel: string;
  bondOrder: 1 | 2 | 3;
  angleDeg: number;
  lengthRatio?: number;
}

export interface MolecularVisualConfig {
  formula: string;
  centralAtom: string;
  centralLabel?: string;
  shapeName: string;
  hybridization?: string;
  bondAngleDeg: number;
  lonePairs: number;
  bonds: MoleculeBondSpec[];
  explanation?: string;
}

export interface MathCurveSpec {
  id: string;
  label: string;
  expression: string;
  color: string;
}

export interface MathParameterSliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface MathPlotVisualConfig {
  curves: MathCurveSpec[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  parameterA?: MathParameterSliderSpec;
  parameterB?: MathParameterSliderSpec;
  highlightRoots?: boolean;
  showTangentAtX?: number | null;
}

export interface GeometryPointSpec {
  id: string;
  label: string;
  x: number;
  y: number;
  adjustable?: boolean;
}

export interface GeometrySegmentSpec {
  fromId: string;
  toId: string;
  label?: string;
  dashed?: boolean;
  color?: string;
}

export interface GeometryCircleSpec {
  centerId: string;
  radius: number;
  label?: string;
}

export interface GeometryPolygonSpec {
  pointIds: string[];
  fill?: string;
  label?: string;
}

export interface GeometryVisualConfig {
  coordinateBounds: number;
  gridStep: number;
  points: GeometryPointSpec[];
  segments: GeometrySegmentSpec[];
  circles?: GeometryCircleSpec[];
  polygons?: GeometryPolygonSpec[];
  theoremNote: string;
}

export interface DiagramShapeSpec {
  id: string;
  kind: 'circle' | 'ellipse' | 'rect' | 'polygon' | 'line' | 'path';
  label?: string;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  width?: number;
  height?: number;
  rx?: number;
  ry?: number;
  r?: number;
  points?: string;
  d?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  opacity?: number;
}

export interface DiagramArrowSpec {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  label?: string;
  dashed?: boolean;
  color?: string;
}

export interface DiagramHotspotSpec {
  id: string;
  x: number;
  y: number;
  label: string;
  summary: string;
  detail: string;
  category?: string;
}

export interface DiagramLegendItem {
  color: string;
  label: string;
}

export interface AnnotatedDiagramVisualConfig {
  layoutKind: 'layered' | 'cycle' | 'cross-section' | 'comparison';
  backgroundTheme: 'bio' | 'geo' | 'chem' | 'phys';
  shapes: DiagramShapeSpec[];
  arrows: DiagramArrowSpec[];
  hotspots: DiagramHotspotSpec[];
  legend: DiagramLegendItem[];
}

export interface IllustratedCardSpec {
  id: string;
  stepBadge: string;
  title: string;
  summary: string;
  keyPoint: string;
  metricOrFormula?: string;
  accent: 'indigo' | 'cyan' | 'emerald' | 'amber';
}

export interface IllustratedComparisonRow {
  aspect: string;
  leftLabel: string;
  rightLabel: string;
}

export interface IllustratedConceptVisualConfig {
  cards: IllustratedCardSpec[];
  leftHeader?: string;
  rightHeader?: string;
  comparisonRows?: IllustratedComparisonRow[];
}

export interface VisualEngineConfig {
  kinematics?: KinematicsVisualConfig;
  optics?: OpticsRayVisualConfig;
  circuit?: CircuitVisualConfig;
  wave?: WaveVisualConfig;
  bohr?: BohrVisualConfig;
  molecule?: MolecularVisualConfig;
  mathPlot?: MathPlotVisualConfig;
  geometry?: GeometryVisualConfig;
  diagram?: AnnotatedDiagramVisualConfig;
  illustrated?: IllustratedConceptVisualConfig;
}

export interface GeneratedVisualSpec {
  id: string;
  cacheKey: string;
  userId: string;
  board: string;
  classGrade: string;
  subject: string;
  chapter: string;
  topic: string;
  customPrompt?: string;
  language: VisualLanguage;
  title: string;
  subtitle: string;
  visualCategory: VisualModalityCategory;
  rendererType: VisualRendererType;
  modalityHonestyLabel: string;
  conceptExplanation: string;
  whatYouAreObserving: string;
  interactionInstructions: string;
  formulaOrLaw?: string;
  keyTakeaways: string[];
  observationsChecklist: string[];
  steps: VisualExplorationStep[];
  engineConfig: VisualEngineConfig;
  saved: boolean;
  cached?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VisualGenerateRequest {
  board: string;
  classGrade: string;
  subject: string;
  chapter: string;
  topic: string;
  customPrompt?: string;
  language: VisualLanguage;
  forceRegenerate?: boolean;
}

export interface PersonalizedVisualSuggestion {
  id: string;
  subject: string;
  chapter: string;
  topic: string;
  prompt: string;
  reasonTag: string;
}

// Mind Map Types (Preserved)
export type MindMapNodeCategory = 'root' | 'pillar' | 'concept' | 'formula' | 'example';

export interface MindMapNode {
  id: string;
  parentId: string | null;
  label: string;
  hindiLabel?: string;
  relationshipLabel?: string;
  note: string;
  category: MindMapNodeCategory;
  collapsed?: boolean;
}

export interface MindMapCrossLink {
  id: string;
  fromId: string;
  toId: string;
  label: string;
}

export interface MindMapDocument {
  id: string;
  userId: string;
  title: string;
  topic: string;
  subject: string;
  classGrade: string;
  board: string;
  language: TutorLanguage;
  syllabusStatus: 'verified' | 'sample' | 'custom';
  summary: string;
  syllabusNote: string;
  nodes: MindMapNode[];
  crossLinks: MindMapCrossLink[];
  createdAt: string;
  updatedAt: string;
}

export interface MindMapGenerateRequest {
  topic: string;
  subject: string;
  classGrade: string;
  board: string;
  language: TutorLanguage;
  chapterContext?: string;
}

export interface MindMapGenerateResponse {
  title: string;
  summary: string;
  syllabusNote: string;
  nodes: MindMapNode[];
  crossLinks: MindMapCrossLink[];
}
