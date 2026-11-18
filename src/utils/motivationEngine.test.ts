import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAchievementStateRecord,
  computeMotivationDashboard,
  computeStreakFromDates,
  DAILY_HEALTHY_MINUTE_CAP,
  DAILY_HEALTHY_XP_CAP,
} from './motivationEngine';
import { PracticeAttemptRecord, TopicMasteryRecord } from '../types/phase4';

test('computeStreakFromDates counts real consecutive calendar days and 7-day strip', () => {
  const res = computeStreakFromDates(
    [
      '2026-11-15T10:00:00.000Z',
      '2026-11-14T15:00:00.000Z',
      '2026-11-13T09:00:00.000Z',
      '2026-11-10T09:00:00.000Z', // gap breaks older chain
    ],
    '2026-11-15'
  );
  assert.equal(res.streakDays, 3);
  assert.deepEqual(res.activeDaysLast7, [false, true, false, false, true, true, true]);
});

test('empty verified learning history produces zero badges, zero XP, and zero streak', () => {
  const dash = computeMotivationDashboard({
    userId: 'u_empty',
    practiceAttempts: [],
    topicMastery: [],
    flashcards: [],
    flashcardReviews: [],
    examAttempts: [],
    voiceSessions: [],
    doubts: [],
    mindMaps: [],
    teacherSessions: [],
    studyRooms: [],
    activities: [],
    nowIso: '2026-11-15T12:00:00.000Z',
  });

  assert.equal(dash.streakDays, 0);
  assert.equal(dash.totalVerifiedXp, 0);
  assert.equal(dash.unlockedCount, 0);
  assert.equal(dash.milestones.length, 0);
  assert.equal(dash.healthyCapReached, false);
});

test('healthy study guardrail caps daily XP and discourages marathon binge cramming', () => {
  // Simulate 45 attempts in a single day totaling ~675 raw XP and > 180 mins
  const bingeAttempts: PracticeAttemptRecord[] = Array.from({ length: 45 }, (_, i) => ({
    id: `att_${i}`,
    userId: 'u_binge',
    subject: 'Mathematics',
    chapter: 'Real Numbers',
    topic: 'Euclid Lemma',
    board: 'CBSE',
    classGrade: 'Class 10',
    questionId: `q_${i}`,
    questionType: 'mcq',
    difficulty: 'intermediate',
    prompt: 'Sample question',
    userAnswer: 'A',
    correctAnswer: 'A',
    isCorrect: true,
    scoreRatio: 1,
    timeSpentSeconds: 300, // 5 mins each -> 225 mins total
    createdAt: '2026-11-15T11:00:00.000Z',
  }));

  const dash = computeMotivationDashboard({
    userId: 'u_binge',
    practiceAttempts: bingeAttempts,
    topicMastery: [],
    flashcards: [],
    flashcardReviews: [],
    examAttempts: [],
    voiceSessions: [],
    doubts: [],
    mindMaps: [],
    teacherSessions: [],
    studyRooms: [],
    activities: [],
    nowIso: '2026-11-15T12:00:00.000Z',
  });

  assert.equal(dash.todayXpEarned, DAILY_HEALTHY_XP_CAP);
  assert.equal(dash.totalVerifiedXp, DAILY_HEALTHY_XP_CAP);
  assert.equal(dash.healthyCapReached, true);
  assert.ok(dash.wellnessNotice && dash.wellnessNotice.includes(`${DAILY_HEALTHY_MINUTE_CAP}`));
});

test('achievements unlock only from real verified mastery, reviews, exams, voice, and collaboration', () => {
  const mastery: TopicMasteryRecord[] = [
    {
      id: 'tm_1',
      userId: 'u_real',
      subject: 'Science',
      chapter: 'Light',
      topic: 'Lens Formula',
      attemptsCount: 5,
      correctCount: 4,
      recentAccuracy: 80,
      weightedMasteryScore: 84,
      status: 'mastered',
      currentRecommendedDifficulty: 'board-challenge',
      totalTimeSpentSeconds: 300,
      recurringErrors: [],
      revisionCount: 4,
      lastPracticedAt: '2026-11-15T10:00:00.000Z',
      lastRevisedAt: '2026-11-15T10:05:00.000Z',
      historySnapshots: [],
      updatedAt: '2026-11-15T10:05:00.000Z',
    },
  ];

  const dash = computeMotivationDashboard({
    userId: 'u_real',
    practiceAttempts: [],
    topicMastery: mastery,
    flashcards: [],
    flashcardReviews: Array.from({ length: 10 }, (_, idx) => ({
      id: `rev_${idx}`,
      userId: 'u_real',
      cardId: `card_${idx}`,
      subject: 'Science',
      topic: 'Lens Formula',
      quality: 4,
      wasCorrect: true,
      previousIntervalDays: 1,
      nextIntervalDays: 6,
      reviewedAt: idx < 4 ? '2026-11-15T09:00:00.000Z' : idx < 7 ? '2026-11-14T09:00:00.000Z' : '2026-11-13T09:00:00.000Z',
    })),
    examAttempts: [
      {
        id: 'ex_1',
        submissionId: 'sub_1',
        sessionId: 'sess_1',
        userId: 'u_real',
        examId: 'exam_1',
        paperTitle: 'CBSE Class 10 Optics Mock',
        board: 'CBSE',
        classGrade: 'Class 10',
        subject: 'Science',
        examMode: 'chapter-test',
        language: 'English',
        isOfficialBoardExam: false,
        durationMinutes: 30,
        elapsedSeconds: 900,
        timingStatus: 'on-time',
        totalQuestions: 10,
        attemptedCount: 10,
        correctCount: 9,
        incorrectCount: 1,
        totalMarks: 20,
        marksObtained: 18,
        percentage: 90,
        questionResults: [],
        topicBreakdown: [],
        difficultyBreakdown: [],
        mistakeSummary: [],
        recommendedRevisionTopics: [],
        submittedAt: '2026-11-15T08:00:00.000Z',
      },
    ],
    voiceSessions: [
      {
        id: 'vs_1',
        userId: 'u_real',
        title: 'Refraction doubt',
        subject: 'Science',
        topic: 'Snell Law',
        classGrade: 'Class 10',
        board: 'CBSE',
        language: 'Hindi',
        voiceName: 'Kore',
        transportUsed: 'stt-tts-pipeline',
        turns: [
          { id: 't1', role: 'student', text: 'Snell ka niyam kya hai?', inputSource: 'stt-voice', language: 'Hindi', timestamp: '2026-11-15T07:00:00.000Z' },
          { id: 't2', role: 'student', text: 'Example bataiye', inputSource: 'stt-voice', language: 'Hindi', timestamp: '2026-11-15T07:01:00.000Z' },
          { id: 't3', role: 'student', text: 'Dhanyavaad', inputSource: 'stt-voice', language: 'Hindi', timestamp: '2026-11-15T07:02:00.000Z' },
        ],
        createdAt: '2026-11-15T07:00:00.000Z',
        updatedAt: '2026-11-15T07:02:00.000Z',
      },
    ],
    doubts: [],
    mindMaps: [],
    teacherSessions: [],
    studyRooms: [],
    activities: [],
    nowIso: '2026-11-15T12:00:00.000Z',
  });

  const unlockedIds = new Set(dash.badges.filter((b) => b.unlocked).map((b) => b.id));
  assert.equal(dash.streakDays, 3);
  assert.equal(unlockedIds.has('streak-3'), true);
  assert.equal(unlockedIds.has('mastery-first'), true);
  assert.equal(unlockedIds.has('revision-10'), true);
  assert.equal(unlockedIds.has('exam-first'), true);
  assert.equal(unlockedIds.has('exam-80'), true);
  assert.equal(unlockedIds.has('voice-dialogue'), true);
  assert.equal(unlockedIds.has('collab-join'), false);

  assert.equal(dash.dailyBreakdownLast7.length, 7);
  assert.ok(dash.dailyBreakdownLast7[6].xp > 0);

  const persisted = buildAchievementStateRecord('u_real', dash);
  assert.ok(persisted.todayXpEarned <= DAILY_HEALTHY_XP_CAP);
  assert.equal(Object.keys(persisted.unlockedBadgeMap).length, unlockedIds.size);
});

test('collaborative study pod goals, notes, quizzes, and mind maps unlock peer badges and timeline milestones', () => {
  const dash = computeMotivationDashboard({
    userId: 'u_collab',
    practiceAttempts: [],
    topicMastery: [],
    flashcards: [],
    flashcardReviews: [],
    examAttempts: [],
    voiceSessions: [],
    doubts: [],
    mindMaps: [],
    teacherSessions: [],
    studyRooms: [
      {
        id: 'pod_1',
        title: 'Class 10 Optics Pod',
        subject: 'Science',
        topic: 'Refraction',
        board: 'CBSE',
        classGrade: 'Class 10',
        hostUid: 'u_collab',
        hostAlias: 'Aarav S.',
        inviteCode: 'OPTICS22',
        isPrivate: true,
        directMessagesDisabled: true,
        isLocked: false,
        maxMembers: 8,
        members: [
          {
            uid: 'u_collab',
            roomId: 'pod_1',
            alias: 'Aarav S.',
            avatarInitial: 'A',
            role: 'host',
            board: 'CBSE',
            classGrade: 'Class 10',
            status: 'active',
            contributionsCount: 3,
            quizPoints: 20,
            joinedAt: '2026-11-15T08:00:00.000Z',
            lastActiveAt: '2026-11-15T09:00:00.000Z',
          },
        ],
        notes: [
          {
            id: 'n1',
            roomId: 'pod_1',
            authorUid: 'u_collab',
            authorAlias: 'Aarav S.',
            subject: 'Science',
            topic: 'Refraction',
            title: 'Snell Law Note',
            body: 'n1 sin i = n2 sin r',
            pinned: false,
            status: 'visible',
            reportCount: 0,
            reportedBy: [],
            createdAt: '2026-11-15T08:10:00.000Z',
            updatedAt: '2026-11-15T08:10:00.000Z',
          },
        ],
        goals: [
          {
            id: 'g1',
            roomId: 'pod_1',
            title: 'Solve 5 numericals',
            targetCount: 5,
            currentCount: 5,
            unit: 'problems',
            contributorUids: ['u_collab'],
            completed: true,
            createdByUid: 'u_collab',
            createdByAlias: 'Aarav S.',
            updatedAt: '2026-11-15T08:20:00.000Z',
          },
        ],
        quizzes: [],
        mindMaps: [
          {
            id: 'mm1',
            roomId: 'pod_1',
            title: 'Refraction Tree',
            subject: 'Science',
            topic: 'Refraction',
            sharedByUid: 'u_collab',
            sharedByAlias: 'Aarav S.',
            nodes: [{ id: 'r', label: 'Refraction', parentId: null }],
            endorsements: ['u_collab'],
            createdAt: '2026-11-15T08:30:00.000Z',
          },
        ],
        reports: [],
        createdAt: '2026-11-15T08:00:00.000Z',
        updatedAt: '2026-11-15T08:30:00.000Z',
      },
    ],
    activities: [],
    nowIso: '2026-11-15T12:00:00.000Z',
  });

  const unlocked = new Set(dash.badges.filter((b) => b.unlocked).map((b) => b.id));
  assert.equal(unlocked.has('collab-join'), true);
  assert.equal(unlocked.has('collab-contrib'), true);
  assert.equal(dash.dailyGoals.find((g) => g.id === 'goal-assess-collab')?.completed, true);
  assert.ok(dash.milestones.some((m) => m.id === 'ms_pod_goal_g1'));
  assert.ok(dash.milestones.some((m) => m.id === 'ms_pod_map_mm1'));
  assert.ok(dash.todayXpEarned > 0 && dash.todayXpEarned <= DAILY_HEALTHY_XP_CAP);
});

test('fake onboarding activities grant zero XP/streak while verifiedEvents track lessons cleanly', () => {
  const dash = computeMotivationDashboard({
    userId: 'u_no_fake',
    practiceAttempts: [],
    topicMastery: [],
    flashcards: [],
    flashcardReviews: [],
    examAttempts: [],
    voiceSessions: [],
    doubts: [],
    mindMaps: [],
    teacherSessions: [],
    studyRooms: [],
    activities: [
      {
        id: 'act_onboard',
        userId: 'u_no_fake',
        type: 'goal_achieved',
        title: 'Student Profile Configured',
        description: 'Onboarded Class 10 CBSE profile',
        xpEarned: 50,
        timestamp: '2026-11-17T09:00:00.000Z',
      },
    ],
    verifiedEvents: [],
    nowIso: '2026-11-17T10:00:00.000Z',
  });

  assert.equal(dash.totalVerifiedXp, 0);
  assert.equal(dash.streakDays, 0);

  const dashWithVerified = computeMotivationDashboard({
    userId: 'u_no_fake',
    practiceAttempts: [],
    topicMastery: [],
    flashcards: [],
    flashcardReviews: [],
    examAttempts: [],
    voiceSessions: [],
    doubts: [],
    mindMaps: [],
    teacherSessions: [],
    studyRooms: [],
    activities: [],
    verifiedEvents: [
      {
        id: 'ev_1',
        uid: 'u_no_fake',
        eventType: 'lesson_completed',
        subject: 'Mathematics',
        chapter: 'Real Numbers',
        topic: 'Euclid Division Lemma',
        sourceModule: 'ai-teacher',
        idempotencyKey: 'lesson_done_1',
        xpAwarded: 35,
        localDateKey: '2026-11-17',
        title: 'Completed Euclid Division Lemma',
        timestamp: '2026-11-17T09:30:00.000Z',
      },
    ],
    nowIso: '2026-11-17T10:00:00.000Z',
  });

  assert.equal(dashWithVerified.totalVerifiedXp, 35);
  assert.equal(dashWithVerified.streakDays, 1);
  assert.equal(dashWithVerified.dailyGoals.find((g) => g.id === 'goal-concept')?.completed, true);
});
