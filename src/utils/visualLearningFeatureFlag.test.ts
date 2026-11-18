import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FEATURE_FLAGS } from '../config/featureFlags.ts';
import { MODULE_REGISTRY, NAV_SECTIONS } from '../constants/navigation.ts';
import { VisualLearningComingSoonCard } from '../components/visual-lab/VisualLearningComingSoonCard.tsx';
import { getCurriculumForStudent } from './curriculum.ts';
import {
  buildDeepLinkRoute,
  buildDynamicDailyGoals,
  computeChapterProgressList,
} from './recommendationEngine.ts';

test('FEATURE_FLAGS disables Visual Learning cleanly for temporary Coming Soon state', () => {
  assert.equal(FEATURE_FLAGS.visualLearningEnabled, false);
});

test('Navigation and active feature listings exclude active Visual Learning routes and claims', () => {
  const allNavRoutes = NAV_SECTIONS.flatMap((section) => section.routes);
  assert.ok(!allNavRoutes.includes('/visual-lab'));
  assert.equal(MODULE_REGISTRY['/visual-lab'].status, 'coming-soon');
  assert.equal(MODULE_REGISTRY['/visual-lab'].badge, 'Coming Soon');
  assert.ok(!MODULE_REGISTRY['/'].features.includes('Visual Experiments'));
});

test('Recommendation deep links and non-board daily goals never point to /visual-lab while disabled', () => {
  const route = buildDeepLinkRoute({
    module: 'visual-lab',
    subject: 'Science',
    topic: 'Optics',
  });
  assert.ok(route.startsWith('/ai-teacher'));
  assert.ok(!route.includes('/visual-lab'));

  const curriculum = getCurriculumForStudent('CBSE', 'Class 8', ['Mathematics', 'Science']);
  const chapterProgress = computeChapterProgressList({
    curriculum,
    lessonProgress: [],
    verifiedEvents: [],
    topicMastery: [],
  });

  const goals = buildDynamicDailyGoals({
    uid: 'test-flag-user',
    board: 'CBSE',
    classGrade: 'Class 8',
    subjects: ['Mathematics', 'Science'],
    learningGoals: ['Explore STEM concepts'],
    curriculum,
    chapterProgress,
    topicMastery: [],
    dueFlashcards: [],
    todayEvents: [],
    localDateKey: '2026-11-18',
  });

  assert.ok(goals.length >= 3);
  assert.ok(goals.every((g) => !g.actionRoute.includes('/visual-lab')));
  assert.ok(goals.every((g) => g.goalKey !== 'daily_visual_lab'));
  assert.ok(goals.every((g) => !/Visual Lab/i.test(g.title) && !/Visual Lab/i.test(g.description)));
});

test('VisualLearningComingSoonCard renders exact VISUAL LEARNING / COMING SOON copy and is non-triggering', () => {
  const gridHtml = renderToStaticMarkup(
    React.createElement(VisualLearningComingSoonCard, { variant: 'grid' })
  );
  assert.ok(gridHtml.includes('VISUAL LEARNING'));
  assert.ok(gridHtml.includes('COMING SOON'));
  assert.ok(gridHtml.includes('Under Development'));
  assert.ok(gridHtml.includes('aria-disabled="true"'));
  assert.ok(!gridHtml.includes('<a '));
  assert.ok(!gridHtml.includes('<button'));

  const pageHtml = renderToStaticMarkup(
    React.createElement(VisualLearningComingSoonCard, {
      variant: 'page',
      onBackToDashboard: () => {},
    })
  );
  assert.ok(pageHtml.includes('VISUAL LEARNING'));
  assert.ok(pageHtml.includes('COMING SOON'));
  assert.ok(pageHtml.includes('Under Development'));
  assert.ok(pageHtml.includes('Back to Dashboard'));
});
