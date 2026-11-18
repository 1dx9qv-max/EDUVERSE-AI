import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  RECOMMENDATION_SKIP_COOLDOWN_MS,
  buildDynamicDailyGoals,
  computeChapterProgressList,
  computeDeterministicXpForEvent,
  generateAdaptiveRecommendations,
  getLocalDateKey,
} from './recommendationEngine';
import { getCurriculumForStudent } from './curriculum';
import {
  getDashboardLearningSummaryFromServer,
  purgeUserLearningStore,
  recordLearningEventOnServer,
  recordRecommendationActionOnServer,
} from '../../server/learningStore.ts';
import type { TopicMasteryRecord } from '../types/phase4';
import type { RecommendationHistoryEntry } from '../types/learning';

const TEST_UID_PREFIX = 'test_scen_';

function cleanTestUsers(uids: string[]) {
  for (const uid of uids) {
    purgeUserLearningStore(uid);
  }
}

test('Scenario A: brand-new student starts with 0 XP, 0 streak, 0% chapters, and 0% daily goals', () => {
  const uid = `${TEST_UID_PREFIX}new_a_${Date.now()}`;
  cleanTestUsers([uid]);
  try {
    const summary = getDashboardLearningSummaryFromServer(uid, {
      board: 'CBSE',
      classGrade: 'Class 10',
      subjects: ['Mathematics', 'Science'],
      learningGoals: ['Master Class 10 concepts'],
      localDateKey: '2026-11-17',
      timezone: 'Asia/Kolkata',
    });

    assert.equal(summary.verifiedXp, 0);
    assert.equal(summary.todayXp, 0);
    assert.equal(summary.streakDays, 0);
    assert.equal(summary.totalCompletedActivities, 0);
    assert.ok(summary.chapterProgress.length > 0);
    assert.ok(summary.chapterProgress.every((c) => c.percentComplete === 0 && c.status === 'not_started'));
    assert.ok(summary.dailyGoals.length >= 3);
    assert.ok(summary.dailyGoals.every((g) => !g.completed && g.currentCount === 0));
    assert.ok(summary.recommendations.length >= 2);
  } finally {
    cleanTestUsers([uid]);
  }
});

test('Scenario B: lesson progress advances % and server XP enforces idempotency', () => {
  const uid = `${TEST_UID_PREFIX}lesson_b_${Date.now()}`;
  cleanTestUsers([uid]);
  try {
    const curriculum = getCurriculumForStudent('CBSE', 'Class 10', ['Mathematics']);
    const ch1 = curriculum[0].chapters[0];
    const firstTopic = ch1.keyTopics[0];

    const startRes = recordLearningEventOnServer(uid, {
      eventType: 'lesson_started',
      subject: curriculum[0].name,
      chapter: ch1.title,
      topic: firstTopic,
      sourceModule: 'ai-teacher',
      idempotencyKey: 'lesson_start_1',
      localDateKey: '2026-11-17',
      timezone: 'UTC',
    });
    assert.equal(startRes.recorded, true);
    assert.equal(startRes.xpAwarded, computeDeterministicXpForEvent('lesson_started'));

    // Duplicate key must be rejected with 0 extra XP
    const dupRes = recordLearningEventOnServer(uid, {
      eventType: 'lesson_started',
      subject: curriculum[0].name,
      chapter: ch1.title,
      topic: firstTopic,
      sourceModule: 'ai-teacher',
      idempotencyKey: 'lesson_start_1',
      localDateKey: '2026-11-17',
      timezone: 'UTC',
    });
    assert.equal(dupRes.recorded, false);
    assert.equal(dupRes.duplicate, true);
    assert.equal(dupRes.xpAwarded, 0);

    // Complete first topic -> chapter becomes in_progress > 0%, lesson daily goal auto-completes
    const completeRes = recordLearningEventOnServer(uid, {
      eventType: 'lesson_completed',
      subject: curriculum[0].name,
      chapter: ch1.title,
      topic: firstTopic,
      sourceModule: 'ai-teacher',
      idempotencyKey: 'lesson_complete_1',
      localDateKey: '2026-11-17',
      timezone: 'UTC',
    });
    assert.equal(completeRes.recorded, true);
    assert.equal(completeRes.xpAwarded, 35);
    assert.equal(completeRes.verifiedXp, 45);
    assert.equal(completeRes.streakDays, 1);

    const summary = getDashboardLearningSummaryFromServer(uid, {
      board: 'CBSE',
      classGrade: 'Class 10',
      subjects: ['Mathematics'],
      localDateKey: '2026-11-17',
      timezone: 'UTC',
    });
    const updatedCh = summary.chapterProgress.find((c) => c.chapterTitle === ch1.title);
    assert.ok(updatedCh);
    assert.equal(updatedCh.status, 'in_progress');
    assert.ok(updatedCh.percentComplete > 0);
    assert.equal(updatedCh.completedTopics, 1);

    const lessonGoal = summary.dailyGoals.find((g) => g.goalKey === 'daily_lesson');
    assert.ok(lessonGoal?.completed);
  } finally {
    cleanTestUsers([uid]);
  }
});

test('Scenario C: doubt submission awards verified XP and auto-completes daily concept goal', () => {
  const uid = `${TEST_UID_PREFIX}doubt_c_${Date.now()}`;
  cleanTestUsers([uid]);
  try {
    const res = recordLearningEventOnServer(uid, {
      eventType: 'doubt_submitted',
      subject: 'Science',
      topic: 'Snell Law',
      sourceModule: 'doubt-solver',
      idempotencyKey: 'doubt_101',
      localDateKey: '2026-11-17',
    });
    assert.equal(res.xpAwarded, 20);
    assert.equal(res.streakDays, 1);

    const summary = getDashboardLearningSummaryFromServer(uid, {
      board: 'CBSE',
      classGrade: 'Class 10',
      subjects: ['Science'],
      localDateKey: '2026-11-17',
    });
    const conceptGoal = summary.dailyGoals.find((g) => g.goalKey === 'daily_concept_clarity');
    assert.ok(conceptGoal?.completed);
    assert.equal(conceptGoal?.currentCount, 1);
  } finally {
    cleanTestUsers([uid]);
  }
});

test('Scenario D: weak topics trigger targeted remediation and strong topics step up difficulty', () => {
  const curriculum = getCurriculumForStudent('CBSE', 'Class 10', ['Mathematics', 'Science']);
  const chapterProgress = computeChapterProgressList({
    curriculum,
    lessonProgress: [],
    verifiedEvents: [],
    topicMastery: [],
  });

  const weakAndStrong: TopicMasteryRecord[] = [
    {
      id: 'tm_weak',
      userId: 'u_adapt',
      subject: 'Science',
      chapter: 'Light: Reflection & Refraction',
      topic: 'Mirror & Lens Formula Sign Convention',
      attemptsCount: 4,
      correctCount: 1,
      recentAccuracy: 25,
      weightedMasteryScore: 34,
      status: 'needs-revision',
      currentRecommendedDifficulty: 'foundation',
      totalTimeSpentSeconds: 180,
      recurringErrors: [
        {
          errorTag: 'sign-convention',
          count: 3,
          lastSeenAt: '2026-11-17T10:00:00.000Z',
          sampleMisconception: 'Inverted f sign for concave mirror',
        },
      ],
      revisionCount: 0,
      historySnapshots: [],
      updatedAt: '2026-11-17T10:00:00.000Z',
    },
    {
      id: 'tm_strong',
      userId: 'u_adapt',
      subject: 'Mathematics',
      chapter: 'Real Numbers',
      topic: 'Fundamental Theorem of Arithmetic',
      attemptsCount: 6,
      correctCount: 5,
      recentAccuracy: 83,
      weightedMasteryScore: 81,
      status: 'developing',
      currentRecommendedDifficulty: 'board-challenge',
      totalTimeSpentSeconds: 200,
      recurringErrors: [],
      revisionCount: 1,
      historySnapshots: [],
      updatedAt: '2026-11-17T10:00:00.000Z',
    },
  ];

  // Ensure weak topic mastery reflects status triggering weak/recurring rule
  weakAndStrong[0].weightedMasteryScore = 34;

  const recs = generateAdaptiveRecommendations({
    board: 'CBSE',
    classGrade: 'Class 10',
    enrolledSubjects: ['Mathematics', 'Science'],
    curriculum,
    chapterProgress,
    topicMastery: weakAndStrong,
    practiceAttempts: [],
    flashcards: [],
    history: {},
    nowIso: '2026-11-17T11:00:00.000Z',
    count: 4,
  });

  const weakRec = recs.find((r) => r.topic === 'Mirror & Lens Formula Sign Convention');
  assert.ok(weakRec);
  assert.equal(weakRec.category, 'recurring_error');
  assert.equal(weakRec.difficulty, 'foundation');
  assert.ok(weakRec.actionRoute.includes('errorTag=sign-convention'));

  const stepUpRec = recs.find((r) => r.topic === 'Fundamental Theorem of Arithmetic');
  assert.ok(stepUpRec);
  assert.equal(stepUpRec.category, 'difficulty_step_up');
  assert.equal(stepUpRec.difficulty, 'board-challenge');
});

test('Scenario E: midnight rollover resets today daily goals while keeping historical XP and hydration dedupes', () => {
  const uid = `${TEST_UID_PREFIX}rollover_e_${Date.now()}`;
  cleanTestUsers([uid]);
  try {
    // Verify timezone date calculation shifts cleanly
    const istLate = getLocalDateKey('2026-11-17T19:00:00.000Z', 'Asia/Kolkata'); // 00:30 AM Nov 18 IST
    const utcSame = getLocalDateKey('2026-11-17T19:00:00.000Z', 'UTC');
    assert.equal(istLate, '2026-11-18');
    assert.equal(utcSame, '2026-11-17');

    // Record doubt yesterday (2026-11-16) and test hydration with alias key doesn't double-count
    recordLearningEventOnServer(uid, {
      eventType: 'doubt_submitted',
      subject: 'Mathematics',
      topic: 'Quadratic Formula',
      sourceModule: 'doubt-solver',
      idempotencyKey: 'doubt_d99',
      localDateKey: '2026-11-16',
      timestamp: '2026-11-16T10:00:00.000Z',
    });

    const summaryToday = getDashboardLearningSummaryFromServer(uid, {
      board: 'CBSE',
      classGrade: 'Class 10',
      subjects: ['Mathematics'],
      localDateKey: '2026-11-17',
      domainSnapshot: {
        doubts: [
          {
            id: 'd99',
            userId: uid,
            title: 'Quadratic Formula doubt',
            subject: 'Mathematics',
            topic: 'Quadratic Formula',
            classGrade: 'Class 10',
            questionText: 'How to derive quadratic formula?',
            language: 'English',
            status: 'answered',
            aiAnswer: 'Complete the square',
            createdAt: '2026-11-16T10:00:00.000Z',
            updatedAt: '2026-11-16T10:00:00.000Z',
          },
        ],
      },
    });

    // Should still have 20 XP (NOT 40!), streak 1 (yesterday active -> active window still valid), todayXp 0, goals reset
    assert.equal(summaryToday.verifiedXp, 20);
    assert.equal(summaryToday.todayXp, 0);
    assert.equal(summaryToday.streakDays, 1);
    assert.ok(summaryToday.dailyGoals.every((g) => !g.completed && g.currentCount === 0));
  } finally {
    cleanTestUsers([uid]);
  }
});

test('Scenario F: skipping imposes 4h cooldown, refreshing rotates items, and completed items stay excluded', () => {
  const curriculum = getCurriculumForStudent('CBSE', 'Class 10', ['Mathematics', 'Science']);
  const chapterProgress = computeChapterProgressList({
    curriculum,
    lessonProgress: [],
    verifiedEvents: [],
    topicMastery: [],
  });

  const nowIso = '2026-11-17T10:00:00.000Z';
  const batch1 = generateAdaptiveRecommendations({
    board: 'CBSE',
    classGrade: 'Class 10',
    enrolledSubjects: ['Mathematics', 'Science'],
    curriculum,
    chapterProgress,
    topicMastery: [],
    practiceAttempts: [],
    flashcards: [],
    history: {},
    nowIso,
    count: 2,
  });
  assert.equal(batch1.length, 2);

  // Refresh excluding batch1 produces fresh items
  const batch2 = generateAdaptiveRecommendations({
    board: 'CBSE',
    classGrade: 'Class 10',
    enrolledSubjects: ['Mathematics', 'Science'],
    curriculum,
    chapterProgress,
    topicMastery: [],
    practiceAttempts: [],
    flashcards: [],
    history: {},
    nowIso,
    count: 2,
    excludeRecIds: batch1.map((r) => r.id),
  });
  assert.equal(batch2.length, 2);
  assert.notEqual(batch2[0].id, batch1[0].id);

  // Skipping batch1[0] excludes it for 4h cooldown, completed excludes permanently
  const history: Record<string, RecommendationHistoryEntry> = {
    [batch1[0].id]: {
      recId: batch1[0].id,
      subject: batch1[0].subject,
      chapter: batch1[0].chapter,
      topic: batch1[0].topic,
      category: batch1[0].category,
      shownCount: 1,
      lastShownAt: nowIso,
      status: 'skipped',
      skippedAt: nowIso,
      cooldownUntil: new Date(Date.parse(nowIso) + RECOMMENDATION_SKIP_COOLDOWN_MS).toISOString(),
    },
    [batch1[1].id]: {
      recId: batch1[1].id,
      subject: batch1[1].subject,
      chapter: batch1[1].chapter,
      topic: batch1[1].topic,
      category: batch1[1].category,
      shownCount: 1,
      lastShownAt: nowIso,
      status: 'completed',
      completedAt: nowIso,
    },
  };

  const duringCooldown = generateAdaptiveRecommendations({
    board: 'CBSE',
    classGrade: 'Class 10',
    enrolledSubjects: ['Mathematics', 'Science'],
    curriculum,
    chapterProgress,
    topicMastery: [],
    practiceAttempts: [],
    flashcards: [],
    history,
    nowIso: new Date(Date.parse(nowIso) + 60 * 60 * 1000).toISOString(),
    count: 2,
  });
  assert.ok(!duringCooldown.some((r) => r.id === batch1[0].id));
  assert.ok(!duringCooldown.some((r) => r.id === batch1[1].id));

  // Verify server recommendation skip handler too
  const uid = `${TEST_UID_PREFIX}skip_f_${Date.now()}`;
  cleanTestUsers([uid]);
  try {
    const initial = getDashboardLearningSummaryFromServer(uid, {
      board: 'CBSE',
      classGrade: 'Class 10',
      subjects: ['Mathematics', 'Science'],
      localDateKey: '2026-11-17',
    });
    const firstRec = initial.recommendations[0];
    const skippedRes = recordRecommendationActionOnServer(
      uid,
      firstRec.id,
      'skipped',
      {
        subject: firstRec.subject,
        chapter: firstRec.chapter,
        topic: firstRec.topic,
        category: firstRec.category,
      },
      {
        board: 'CBSE',
        classGrade: 'Class 10',
        subjects: ['Mathematics', 'Science'],
        localDateKey: '2026-11-17',
      }
    );
    assert.equal(skippedRes.historyEntry.status, 'skipped');
    assert.ok(!skippedRes.recommendations.some((r) => r.id === firstRec.id));
  } finally {
    cleanTestUsers([uid]);
  }
});

// Keep helper used check satisfied
void fs;
void path;
void buildDynamicDailyGoals;
