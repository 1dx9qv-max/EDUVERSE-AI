import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVisualCacheKey,
  computeBohrAtom,
  computeCircuitState,
  computeNumericDerivative,
  computeOpticsRayState,
  computePersonalizedVisualSuggestions,
  computeProjectileState,
  computeQuadraticAnalysis,
  computeSegmentMetrics,
  computeWaveState,
  evaluateSafeMathExpression,
  sampleMathPlotCurve,
  validateAndSanitizeGeneratedVisual,
} from './visualLabEngine';

describe('Dynamic AI Visual Learning Engine (Pure Solvers & Validators)', () => {
  it('computes projectile motion kinematics and conservation of energy accurately', () => {
    const start = computeProjectileState(20, 45, 10, 0);
    assert.equal(start.x, 0);
    assert.equal(start.y, 0);
    assert.equal(start.horizontalRange, 40);
    assert.equal(start.maxHeight, 10);
    assert.equal(start.kineticEnergyShare + start.potentialEnergyShare, 100);

    const apex = computeProjectileState(20, 45, 10, start.timeOfFlight / 2);
    assert.ok(Math.abs(apex.vy) < 0.1);
    assert.ok(apex.potentialEnergyShare > 40);
  });

  it('solves lens and mirror equations with Cartesian sign convention', () => {
    const convexReal = computeOpticsRayState('convex-lens', 15, 30, 4);
    assert.equal(convexReal.isAtInfinity, false);
    assert.equal(convexReal.imageV, 30);
    assert.equal(convexReal.magnification, -1);
    assert.equal(convexReal.isRealImage, true);
    assert.equal(convexReal.isInverted, true);

    const convexVirtual = computeOpticsRayState('convex-lens', 20, 10, 4);
    assert.equal(convexVirtual.isRealImage, false);
    assert.equal(convexVirtual.isInverted, false);
    assert.equal(convexVirtual.imageV, -20);

    const atFocus = computeOpticsRayState('convex-lens', 15, 15, 4);
    assert.equal(atFocus.isAtInfinity, true);

    const concaveMirror = computeOpticsRayState('concave-mirror', 10, 20, 3);
    assert.equal(concaveMirror.imageV, -20);
    assert.equal(concaveMirror.isRealImage, true);
    assert.equal(concaveMirror.isInverted, true);

    const convexMirror = computeOpticsRayState('convex-mirror', 15, 30, 4);
    assert.equal(convexMirror.isRealImage, false);
    assert.equal(convexMirror.isInverted, false);
  });

  it('calculates Ohm’s law differences between series and parallel topologies', () => {
    const series = computeCircuitState(12, 4, 8, 'series');
    assert.equal(series.equivalentResistance, 12);
    assert.equal(series.totalCurrent, 1);
    assert.equal(series.voltageDropR1, 4);
    assert.equal(series.voltageDropR2, 8);

    const parallel = computeCircuitState(12, 4, 4, 'parallel');
    assert.equal(parallel.equivalentResistance, 2);
    assert.equal(parallel.totalCurrent, 6);
    assert.equal(parallel.currentR1, 3);
    assert.equal(parallel.currentR2, 3);
  });

  it('computes wave speed and sinusoidal particle displacement points', () => {
    const wave = computeWaveState(40, 2, 5, 0);
    assert.equal(wave.waveSpeedMetersPerSec, 10);
    assert.equal(wave.timePeriodSeconds, 0.5);
    assert.ok(wave.points.length > 50);
    assert.equal(wave.points[0].y, 0);
  });

  it('computes Bohr shell configurations and valency across Z=1..36', () => {
    const carbon = computeBohrAtom(6);
    assert.equal(carbon.element.symbol, 'C');
    assert.deepEqual(carbon.shells, [2, 4]);
    assert.equal(carbon.valency, 4);

    const chlorine = computeBohrAtom(17);
    assert.equal(chlorine.element.symbol, 'Cl');
    assert.deepEqual(chlorine.shells, [2, 8, 7]);
    assert.equal(chlorine.valency, 1);

    const calcium = computeBohrAtom(20);
    assert.deepEqual(calcium.shells, [2, 8, 8, 2]);
    assert.equal(calcium.valency, 2);

    const copper = computeBohrAtom(29);
    assert.equal(copper.element.symbol, 'Cu');
    assert.deepEqual(copper.shells, [2, 8, 18, 1]);

    const krypton = computeBohrAtom(36);
    assert.equal(krypton.element.symbol, 'Kr');
    assert.deepEqual(krypton.shells, [2, 8, 18, 8]);
    assert.equal(krypton.valency, 0);
  });

  it('evaluates safe math expressions without eval, plots curves, and detects roots/derivatives', () => {
    assert.equal(evaluateSafeMathExpression('2x^2 - 3x + 1', 2), 3);
    assert.equal(evaluateSafeMathExpression('y = a*x + b', 4, 3, -2), 10);
    assert.ok(Math.abs((evaluateSafeMathExpression('sin(x)', Math.PI / 2) ?? 0) - 1) < 1e-6);

    // Rejects division by zero & unsafe strings
    assert.equal(evaluateSafeMathExpression('1 / x', 0), null);
    assert.equal(evaluateSafeMathExpression('process.exit(1)', 1), null);
    assert.equal(evaluateSafeMathExpression('window.alert(1)', 1), null);

    const sampled = sampleMathPlotCurve('x^2 - 4', -5, 5, 1, 0, 100);
    assert.ok(sampled.roots.some((r) => Math.abs(r - -2) < 0.15));
    assert.ok(sampled.roots.some((r) => Math.abs(r - 2) < 0.15));
    assert.ok(sampled.minPoint && Math.abs(sampled.minPoint.y - -4) < 0.1);

    const slope = computeNumericDerivative('x^2', 3);
    assert.ok(slope !== null && Math.abs(slope - 6) < 0.05);

    const twoRoots = computeQuadraticAnalysis(1, -5, 6);
    assert.equal(twoRoots.discriminant, 1);
    assert.deepEqual(twoRoots.roots, [2, 3]);
    assert.equal(twoRoots.vertexX, 2.5);
  });

  it('computes coordinate geometry segment length, midpoint, and slope', () => {
    const diag = computeSegmentMetrics({ x: 0, y: 0 }, { x: 3, y: 4 });
    assert.equal(diag.length, 5);
    assert.deepEqual(diag.midpoint, { x: 1.5, y: 2 });
    assert.ok(diag.slope !== null && Math.abs(diag.slope - 1.33) < 0.02);

    const vertical = computeSegmentMetrics({ x: 2, y: -1 }, { x: 2, y: 5 });
    assert.equal(vertical.length, 6);
    assert.equal(vertical.slope, null);
  });

  it('sanitizes AI specs and falls back honestly to illustrated-concept when diagram or plot data is malformed', () => {
    const cacheKey = buildVisualCacheKey({
      board: 'CBSE',
      classGrade: 'Class 10',
      subject: 'Science',
      chapter: 'Life Processes',
      topic: 'Photosynthesis',
      language: 'English',
    });
    assert.ok(cacheKey.includes('cbse__class-10__science'));

    // Malformed diagram (missing hotspots/shapes + unsafe path chars) degrades cleanly to illustrated-concept
    const degraded = validateAndSanitizeGeneratedVisual(
      {
        title: 'Photosynthesis Overview',
        rendererType: 'annotated-diagram',
        visualCategory: 'annotated-diagram',
        conceptExplanation: 'Chloroplasts convert light energy into chemical energy.',
        keyTakeaways: ['Light reaction produces ATP', 'Calvin cycle fixes CO2'],
        engineConfig: {
          diagram: {
            layoutKind: 'cycle',
            backgroundTheme: 'bio',
            shapes: [{ id: 'bad', kind: 'path', d: 'alert(1)' }],
            arrows: [],
            hotspots: [],
            legend: [],
          },
        },
      },
      {
        cacheKey,
        userId: 'u_1',
        board: 'CBSE',
        classGrade: 'Class 10',
        subject: 'Science',
        chapter: 'Life Processes',
        topic: 'Photosynthesis',
        language: 'English',
      }
    );
    assert.equal(degraded.rendererType, 'illustrated-concept');
    assert.equal(degraded.visualCategory, 'illustrated-concept');
    assert.ok(degraded.engineConfig.illustrated && degraded.engineConfig.illustrated.cards.length >= 1);

    // Valid annotated diagram preserves hotspots and clamps coordinates
    const validDiagram = validateAndSanitizeGeneratedVisual(
      {
        title: 'Stomata & Guard Cells',
        rendererType: 'annotated-diagram',
        visualCategory: 'annotated-diagram',
        engineConfig: {
          diagram: {
            layoutKind: 'cross-section',
            backgroundTheme: 'bio',
            shapes: [{ id: 's1', kind: 'ellipse', x: 300, y: 180, rx: 90, ry: 55 }],
            arrows: [{ id: 'a1', fromX: 100, fromY: 180, toX: 250, toY: 180, label: 'CO2' }],
            hotspots: [
              { id: 'h1', x: 9999, y: 180, label: 'Guard Cell', summary: 'Regulates opening', detail: 'Controls transpiration.' },
            ],
            legend: [{ color: '#10b981', label: 'Chloroplast' }],
          },
        },
      },
      {
        cacheKey,
        userId: 'u_1',
        board: 'CBSE',
        classGrade: 'Class 10',
        subject: 'Science',
        chapter: 'Life Processes',
        topic: 'Stomata',
        language: 'English',
      }
    );
    assert.equal(validDiagram.rendererType, 'annotated-diagram');
    assert.equal(validDiagram.engineConfig.diagram?.hotspots[0].x, 568);
  });

  it('produces personalized visual suggestions dynamically from student mastery and board/grade profile', () => {
    const studentA = computePersonalizedVisualSuggestions({
      board: 'CBSE',
      classGrade: 'Class 10',
      subjects: ['Science', 'Mathematics'],
      topicMastery: [
        {
          id: 'tm_1',
          userId: 'u1',
          subject: 'Science',
          chapter: 'Electricity',
          topic: 'Equivalent Resistance in Parallel Circuits',
          attemptsCount: 5,
          correctCount: 2,
          recentAccuracy: 40,
          weightedMasteryScore: 42,
          status: 'needs-revision',
          currentRecommendedDifficulty: 'foundation',
          totalTimeSpentSeconds: 200,
          recurringErrors: [
            {
              errorTag: 'formula-confusion',
              count: 2,
              lastSeenAt: new Date().toISOString(),
              sampleMisconception: 'Added parallel resistances directly instead of reciprocals.',
            },
          ],
          revisionCount: 0,
          lastPracticedAt: new Date().toISOString(),
          historySnapshots: [],
          updatedAt: new Date().toISOString(),
        },
      ],
      language: 'English',
    });

    const studentB = computePersonalizedVisualSuggestions({
      board: 'ISC',
      classGrade: 'Class 12',
      subjects: ['Physics', 'Chemistry'],
      learningGoals: ['JEE foundation'],
      language: 'English',
    });

    assert.ok(studentA.length >= 2);
    assert.ok(studentB.length >= 2);
    assert.equal(studentA[0].topic, 'Equivalent Resistance in Parallel Circuits');
    assert.notEqual(studentA[0].topic, studentB[0].topic);
  });
});
