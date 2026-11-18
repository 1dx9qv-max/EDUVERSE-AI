import type { DoubtTicket, TeacherSession } from '../types/ai.ts';
import type { ActivityRecord } from '../types/curriculum.ts';
import type { MindMapDocument } from '../types/phase3.ts';
import type {
  FlashcardRecord,
  FlashcardReviewLog,
  PracticeAttemptRecord,
  TopicMasteryRecord,
} from '../types/phase4.ts';
import type { ExamAttemptRecord } from '../types/phase5.ts';
import type { VoiceSessionRecord } from '../types/phase6.ts';
import type {
  LearningActivityEvent,
  LessonProgressRecord,
} from '../types/learning.ts';
import type {
  AchievementBadge,
  AchievementStateRecord,
  DailyGoalItem,
  MotivationDashboardState,
  ProgressMilestone,
  StudyRoom,
} from '../types/phase7.ts';

export const DAILY_HEALTHY_MINUTE_CAP = 120;
export const DAILY_HEALTHY_XP_CAP = 300;
export const SESSION_BREAK_NUDGE_MINUTES = 60;

export interface MotivationSignalsInput {
  userId: string;
  practiceAttempts: PracticeAttemptRecord[];
  topicMastery: TopicMasteryRecord[];
  flashcards: FlashcardRecord[];
  flashcardReviews: FlashcardReviewLog[];
  examAttempts: ExamAttemptRecord[];
  voiceSessions: VoiceSessionRecord[];
  doubts: DoubtTicket[];
  mindMaps: MindMapDocument[];
  teacherSessions: TeacherSession[];
  studyRooms: StudyRoom[];
  activities: ActivityRecord[];
  verifiedEvents?: LearningActivityEvent[];
  lessonProgress?: LessonProgressRecord[];
  persistedState?: AchievementStateRecord | null;
  nowIso?: string;
}

export function toDateKey(isoOrDate: string | Date): string | null {
  try {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return null;
  }
}

export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + deltaDays);
  return toDateKey(dt) || dateKey;
}

export function computeStreakFromDates(
  timestamps: string[],
  todayKey: string
): { streakDays: number; activeDaysLast7: boolean[] } {
  const activeDates = new Set<string>();
  for (const ts of timestamps) {
    const key = toDateKey(ts);
    if (key) activeDates.add(key);
  }

  const activeDaysLast7: boolean[] = [];
  for (let offset = -6; offset <= 0; offset++) {
    activeDaysLast7.push(activeDates.has(shiftDateKey(todayKey, offset)));
  }

  let cursor = todayKey;
  if (!activeDates.has(cursor)) {
    const yesterday = shiftDateKey(todayKey, -1);
    if (!activeDates.has(yesterday)) {
      return { streakDays: 0, activeDaysLast7 };
    }
    cursor = yesterday;
  }

  let streakDays = 0;
  while (activeDates.has(cursor)) {
    streakDays += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  return { streakDays, activeDaysLast7 };
}

interface VerifiedDailyEvent {
  dateKey: string;
  xp: number;
  minutes: number;
}

function clampDailyHealthyRewards(events: VerifiedDailyEvent[]): {
  totalVerifiedXp: number;
  byDay: Map<string, { xp: number; minutes: number }>;
} {
  const byDay = new Map<string, { xp: number; minutes: number }>();
  for (const ev of events) {
    const prev = byDay.get(ev.dateKey) || { xp: 0, minutes: 0 };
    prev.xp += Math.max(0, ev.xp);
    prev.minutes += Math.max(0, ev.minutes);
    byDay.set(ev.dateKey, prev);
  }

  let totalVerifiedXp = 0;
  for (const [, bucket] of byDay.entries()) {
    // Healthy study guardrail: never reward marathon cramming above daily XP cap
    totalVerifiedXp += Math.min(DAILY_HEALTHY_XP_CAP, bucket.xp);
  }

  return {
    totalVerifiedXp: Math.round(totalVerifiedXp),
    byDay,
  };
}

export function computeMotivationDashboard(
  input: MotivationSignalsInput
): MotivationDashboardState {
  const now = input.nowIso ? new Date(input.nowIso) : new Date();
  const todayKey = toDateKey(now) || new Date().toISOString().slice(0, 10);

  const allTimestamps: string[] = [];
  const dailyEvents: VerifiedDailyEvent[] = [];

  // 1. Practice attempts
  for (const att of input.practiceAttempts) {
    allTimestamps.push(att.createdAt);
    const key = toDateKey(att.createdAt);
    if (key) {
      const mins = Math.max(1, Math.min(10, Math.round((att.timeSpentSeconds || 45) / 60)));
      const xp = att.isCorrect ? 15 : 8; // Reward effort cleanly without punishing mistakes
      dailyEvents.push({ dateKey: key, xp, minutes: mins });
    }
  }

  // 2. Spaced repetition reviews
  for (const rev of input.flashcardReviews) {
    allTimestamps.push(rev.reviewedAt);
    const key = toDateKey(rev.reviewedAt);
    if (key) {
      dailyEvents.push({ dateKey: key, xp: rev.wasCorrect ? 12 : 8, minutes: 2 });
    }
  }

  // 3. Exam attempts
  for (const exam of input.examAttempts) {
    allTimestamps.push(exam.submittedAt);
    const key = toDateKey(exam.submittedAt);
    if (key) {
      const mins = Math.max(5, Math.min(90, Math.round((exam.elapsedSeconds || 600) / 60)));
      const xp = Math.min(120, Math.max(25, Math.round(exam.percentage * 0.8 + exam.correctCount * 6)));
      dailyEvents.push({ dateKey: key, xp, minutes: mins });
    }
  }

  // 4. Voice sessions
  const totalVoiceTurns = input.voiceSessions.reduce(
    (sum, s) => sum + (s.turns?.filter((t) => t.role === 'student').length || 0),
    0
  );
  for (const vs of input.voiceSessions) {
    const ts = vs.updatedAt || vs.createdAt;
    allTimestamps.push(ts);
    const key = toDateKey(ts);
    if (key) {
      const studentTurns = Math.max(1, vs.turns?.filter((t) => t.role === 'student').length || 1);
      dailyEvents.push({
        dateKey: key,
        xp: Math.min(60, studentTurns * 15),
        minutes: Math.min(30, studentTurns * 4),
      });
    }
  }

  // 5. Doubts resolved, Mind Maps, AI Teacher turns
  for (const d of input.doubts) {
    const ts = d.updatedAt || d.createdAt;
    allTimestamps.push(ts);
    const key = toDateKey(ts);
    if (key) dailyEvents.push({ dateKey: key, xp: 20, minutes: 5 });
  }
  for (const m of input.mindMaps) {
    const ts = m.updatedAt || m.createdAt;
    allTimestamps.push(ts);
    const key = toDateKey(ts);
    if (key) dailyEvents.push({ dateKey: key, xp: 25, minutes: 8 });
  }
  for (const t of input.teacherSessions) {
    const ts = t.updatedAt || t.createdAt;
    allTimestamps.push(ts);
    const key = toDateKey(ts);
    if (key) dailyEvents.push({ dateKey: key, xp: 20, minutes: 8 });
  }

  // 6. Collaborative study room verified contributions (authored by user)
  let roomContributionsByUser = 0;
  for (const room of input.studyRooms) {
    for (const note of room.notes) {
      if (note.authorUid === input.userId && note.status !== 'hidden') {
        roomContributionsByUser += 1;
        allTimestamps.push(note.createdAt);
        const key = toDateKey(note.createdAt);
        if (key) dailyEvents.push({ dateKey: key, xp: 20, minutes: 5 });
      }
    }
    for (const goal of room.goals) {
      if (goal.contributorUids.includes(input.userId) || goal.createdByUid === input.userId) {
        roomContributionsByUser += 1;
        allTimestamps.push(goal.updatedAt);
        const key = toDateKey(goal.updatedAt);
        if (key) dailyEvents.push({ dateKey: key, xp: goal.completed ? 20 : 12, minutes: 5 });
      }
    }
    for (const quiz of room.quizzes) {
      for (const sub of quiz.submissions) {
        if (sub.uid === input.userId) {
          roomContributionsByUser += 1;
          allTimestamps.push(sub.submittedAt);
          const key = toDateKey(sub.submittedAt);
          if (key) dailyEvents.push({ dateKey: key, xp: 25, minutes: 6 });
        }
      }
    }
    for (const map of room.mindMaps) {
      if (map.sharedByUid === input.userId) {
        roomContributionsByUser += 1;
        allTimestamps.push(map.createdAt);
        const key = toDateKey(map.createdAt);
        if (key) dailyEvents.push({ dateKey: key, xp: 20, minutes: 6 });
      }
    }
  }

  // 7. Verified Learning Events (lesson_started, lesson_completed, topic_completed, study_goal_completed)
  // Avoid double-counting events that already have canonical domain collections above.
  const countedIdempotencyKeys = new Set<string>();
  const verifiedEvents = input.verifiedEvents || [];
  for (const ev of verifiedEvents) {
    if (countedIdempotencyKeys.has(ev.idempotencyKey)) continue;
    countedIdempotencyKeys.add(ev.idempotencyKey);

    const isLessonOrGoalEvent = [
      'lesson_started',
      'lesson_completed',
      'topic_completed',
      'revision_completed',
      'study_goal_completed',
    ].includes(ev.eventType);

    if (!isLessonOrGoalEvent) continue;
    allTimestamps.push(ev.timestamp);
    const key = ev.localDateKey || toDateKey(ev.timestamp);
    if (key) {
      dailyEvents.push({
        dateKey: key,
        xp: Math.max(0, Math.min(60, ev.xpAwarded || 0)),
        minutes: ev.eventType === 'lesson_completed' ? 12 : 5,
      });
    }
  }

  // 8. Legacy genuine activities (NEVER award XP or streaks for synthetic onboarding/goal_achieved records)
  for (const act of input.activities) {
    if (act.type === 'goal_achieved') continue;
    if ((act.title || '').toLowerCase().includes('profile setup')) continue;
    const isDirectLesson =
      act.type === 'topic_studied' &&
      (act.title || '').toLowerCase().includes('completed');
    if (isDirectLesson || dailyEvents.length === 0) {
      const key = toDateKey(act.timestamp);
      if (key && act.xpEarned > 0) {
        allTimestamps.push(act.timestamp);
        dailyEvents.push({
          dateKey: key,
          xp: Math.min(60, Math.max(0, act.xpEarned)),
          minutes: 10,
        });
      }
    }
  }

  const { streakDays, activeDaysLast7 } = computeStreakFromDates(allTimestamps, todayKey);

  // Sum daily totals and apply healthy cap
  const baseTotals = clampDailyHealthyRewards(dailyEvents);
  const todayEvents = dailyEvents.filter((e) => e.dateKey === todayKey);
  const todayRawXp = todayEvents.reduce((sum, e) => sum + e.xp, 0);
  const todayRawMinutes = todayEvents.reduce((sum, e) => sum + e.minutes, 0);
  const todayXpEarned = Math.min(DAILY_HEALTHY_XP_CAP, Math.round(todayRawXp));
  const todayEstimatedMinutes = Math.min(720, Math.round(todayRawMinutes));
  const healthyCapReached =
    todayRawXp > DAILY_HEALTHY_XP_CAP || todayRawMinutes > DAILY_HEALTHY_MINUTE_CAP;

  let wellnessNotice: string | null = null;
  if (healthyCapReached) {
    wellnessNotice = `Healthy daily cap reached (${DAILY_HEALTHY_XP_CAP} XP / ${DAILY_HEALTHY_MINUTE_CAP} min). Extra marathon screen time earns 0 bonus XP — take a break, hydrate, and let sleep consolidate your memory!`;
  } else if (todayEstimatedMinutes >= SESSION_BREAK_NUDGE_MINUTES) {
    wellnessNotice = `You have studied ~${todayEstimatedMinutes} focused minutes today. Consider a 10-minute screen break before your next revision block.`;
  }

  const dailyBreakdownLast7 = [];
  for (let offset = -6; offset <= 0; offset++) {
    const dk = shiftDateKey(todayKey, offset);
    const bucket = baseTotals.byDay.get(dk);
    const rawXp = bucket?.xp || 0;
    const rawMins = bucket?.minutes || 0;
    dailyBreakdownLast7.push({
      dateKey: dk,
      xp: Math.min(DAILY_HEALTHY_XP_CAP, Math.round(rawXp)),
      minutes: Math.min(720, Math.round(rawMins)),
      capped: rawXp > DAILY_HEALTHY_XP_CAP || rawMins > DAILY_HEALTHY_MINUTE_CAP,
    });
  }

  // Today's verified counts for Daily Goals
  const todayPracticeCount = input.practiceAttempts.filter(
    (a) => toDateKey(a.createdAt) === todayKey
  ).length;
  const todayReviewsCount = input.flashcardReviews.filter(
    (r) => toDateKey(r.reviewedAt) === todayKey
  ).length;
  const todayLessonEventsCount = (input.verifiedEvents || []).filter(
    (ev) =>
      (ev.eventType === 'lesson_completed' || ev.eventType === 'topic_completed') &&
      (ev.localDateKey === todayKey || toDateKey(ev.timestamp) === todayKey)
  ).length;
  const todayConceptInquiryCount =
    todayLessonEventsCount +
    input.doubts.filter((d) => toDateKey(d.createdAt) === todayKey).length +
    input.teacherSessions.filter((t) => toDateKey(t.updatedAt || t.createdAt) === todayKey).length +
    input.voiceSessions.filter((v) => toDateKey(v.updatedAt || v.createdAt) === todayKey).length +
    input.mindMaps.filter((m) => toDateKey(m.createdAt) === todayKey).length;
  const todayAssessmentOrPodCount =
    input.examAttempts.filter((e) => toDateKey(e.submittedAt) === todayKey).length +
    input.studyRooms.reduce(
      (sum, r) =>
        sum +
        r.notes.filter((n) => n.authorUid === input.userId && toDateKey(n.createdAt) === todayKey).length +
        r.goals.filter((g) => (g.contributorUids.includes(input.userId) || g.createdByUid === input.userId) && toDateKey(g.updatedAt) === todayKey).length +
        r.mindMaps.filter((m) => m.sharedByUid === input.userId && toDateKey(m.createdAt) === todayKey).length +
        r.quizzes.filter((q) => q.submissions.some((s) => s.uid === input.userId && toDateKey(s.submittedAt) === todayKey)).length,
      0
    );

  const dailyGoals: DailyGoalItem[] = [
    {
      id: 'goal-practice',
      title: 'Solve 5 Adaptive Practice Questions',
      category: 'practice',
      current: Math.min(5, todayPracticeCount),
      target: 5,
      completed: todayPracticeCount >= 5,
      xpReward: 75,
      route: '/practice',
    },
    {
      id: 'goal-revision',
      title: 'Complete 3 Active Recall Flashcard Reviews',
      category: 'revision',
      current: Math.min(3, todayReviewsCount),
      target: 3,
      completed: todayReviewsCount >= 3,
      xpReward: 50,
      route: '/memory-booster',
    },
    {
      id: 'goal-concept',
      title: '1 Concept Deep-Dive (AI Teacher, Doubt, Voice or Mind Map)',
      category: 'concept',
      current: Math.min(1, todayConceptInquiryCount),
      target: 1,
      completed: todayConceptInquiryCount >= 1,
      xpReward: 40,
      route: '/ai-teacher',
    },
    {
      id: 'goal-assess-collab',
      title: '1 Exam Mock or Collaborative Study Pod Contribution',
      category: 'collaboration',
      current: Math.min(1, todayAssessmentOrPodCount),
      target: 1,
      completed: todayAssessmentOrPodCount >= 1,
      xpReward: 60,
      route: '/collaborative-learning',
    },
  ];

  // Mastery / Revision / Assessment counts from real records
  const masteredTopics = input.topicMastery.filter((t) => t.status === 'mastered').length;
  const developingTopics = input.topicMastery.filter((t) => t.status === 'developing').length;
  const totalRevisions =
    input.flashcardReviews.length +
    input.topicMastery.reduce((s, t) => s + (t.revisionCount || 0), 0);
  const difficultCardsReviewed = input.flashcards.filter(
    (c) => c.lapses > 0 && c.repetitions >= 2
  ).length;
  const highScoringExams = input.examAttempts.filter((e) => e.percentage >= 80).length;
  const studyRoomsJoined = input.studyRooms.filter((r) =>
    r.members.some((m) => m.uid === input.userId && m.status !== 'removed')
  ).length;

  const badgeSpecs: Array<Omit<AchievementBadge, 'unlocked' | 'unlockedAt' | 'progressPercent'>> = [
    {
      id: 'streak-3',
      title: 'Steady Rhythm',
      hindiTitle: 'नियमित अभ्यास',
      description: 'Maintain verified learning activity across 3 consecutive calendar days.',
      category: 'streak',
      tier: 'bronze',
      progressCurrent: Math.min(3, streakDays),
      progressTarget: 3,
      metricUnit: 'days',
      evidenceLabel: `${streakDays}/3 consecutive active days`,
    },
    {
      id: 'streak-7',
      title: 'Weekly Discipline',
      hindiTitle: 'साप्ताहिक संकल्प',
      description: 'Keep a healthy 7-day learning streak without cramming.',
      category: 'streak',
      tier: 'silver',
      progressCurrent: Math.min(7, streakDays),
      progressTarget: 7,
      metricUnit: 'days',
      evidenceLabel: `${streakDays}/7 consecutive active days`,
    },
    {
      id: 'streak-14',
      title: 'Fortnight Scholar',
      hindiTitle: 'पाक्षिक साधना',
      description: '14 consecutive days of balanced board preparation.',
      category: 'streak',
      tier: 'gold',
      progressCurrent: Math.min(14, streakDays),
      progressTarget: 14,
      metricUnit: 'days',
      evidenceLabel: `${streakDays}/14 consecutive active days`,
    },
    {
      id: 'mastery-first',
      title: 'Concept Clarity',
      hindiTitle: 'अवधारणा सिद्धि',
      description: 'Reach Mastered status (>=75% weighted mastery across 3+ attempts) on a topic.',
      category: 'mastery',
      tier: 'bronze',
      progressCurrent: Math.min(1, masteredTopics),
      progressTarget: 1,
      metricUnit: 'topics',
      evidenceLabel: `${masteredTopics}/1 topic mastered`,
    },
    {
      id: 'mastery-3',
      title: 'Board Anchor',
      hindiTitle: 'विषय निपुणता',
      description: 'Master 3 distinct curriculum topics through Adaptive Practice & Exams.',
      category: 'mastery',
      tier: 'gold',
      progressCurrent: Math.min(3, masteredTopics),
      progressTarget: 3,
      metricUnit: 'topics',
      evidenceLabel: `${masteredTopics}/3 topics mastered`,
    },
    {
      id: 'practice-25',
      title: 'Adaptive Challenger',
      hindiTitle: 'सक्रिय अभ्यासक',
      description: 'Complete 25 verified Adaptive Practice questions across difficulty tiers.',
      category: 'mastery',
      tier: 'silver',
      progressCurrent: Math.min(25, input.practiceAttempts.length),
      progressTarget: 25,
      metricUnit: 'questions',
      evidenceLabel: `${input.practiceAttempts.length}/25 verified attempts`,
    },
    {
      id: 'revision-10',
      title: 'Active Recall Starter',
      hindiTitle: 'स्मृति जागृति',
      description: 'Complete 10 spaced-repetition flashcard reviews in Memory Booster.',
      category: 'revision',
      tier: 'bronze',
      progressCurrent: Math.min(10, totalRevisions),
      progressTarget: 10,
      metricUnit: 'reviews',
      evidenceLabel: `${totalRevisions}/10 recall reviews`,
    },
    {
      id: 'revision-resilience',
      title: 'Error Overcomer',
      hindiTitle: 'त्रुटि विजेता',
      description: 'Re-review and stabilize a previously difficult flashcard (2+ successful repetitions).',
      category: 'revision',
      tier: 'silver',
      progressCurrent: Math.min(1, difficultCardsReviewed),
      progressTarget: 1,
      metricUnit: 'cards',
      evidenceLabel: `${difficultCardsReviewed}/1 difficult card stabilized`,
    },
    {
      id: 'exam-first',
      title: 'Mock Readiness',
      hindiTitle: 'परीक्षा तत्परता',
      description: 'Complete a timed Exam Simulator practice paper end-to-end.',
      category: 'assessment',
      tier: 'bronze',
      progressCurrent: Math.min(1, input.examAttempts.length),
      progressTarget: 1,
      metricUnit: 'exams',
      evidenceLabel: `${input.examAttempts.length}/1 timed simulation`,
    },
    {
      id: 'exam-80',
      title: 'Distinction Benchmark',
      hindiTitle: 'उत्कृष्ट प्रदर्शन',
      description: 'Score 80% or higher on a server-validated Exam Simulator paper.',
      category: 'assessment',
      tier: 'gold',
      progressCurrent: Math.min(1, highScoringExams),
      progressTarget: 1,
      metricUnit: 'exams',
      evidenceLabel: `${highScoringExams}/1 distinction mock (>=80%)`,
    },
    {
      id: 'voice-dialogue',
      title: 'Socratic Speaker',
      hindiTitle: 'संवाद कौशल',
      description: 'Ask 3 spoken or classroom questions in the Voice Learning Classroom.',
      category: 'voice',
      tier: 'bronze',
      progressCurrent: Math.min(3, totalVoiceTurns),
      progressTarget: 3,
      metricUnit: 'turns',
      evidenceLabel: `${totalVoiceTurns}/3 voice classroom turns`,
    },
    {
      id: 'mindmap-architect',
      title: 'Concept Architect',
      hindiTitle: 'विचार मानचित्रकार',
      description: 'Create and save 2 structured Mind Maps to synthesize chapters.',
      category: 'mastery',
      tier: 'silver',
      progressCurrent: Math.min(2, input.mindMaps.length),
      progressTarget: 2,
      metricUnit: 'maps',
      evidenceLabel: `${input.mindMaps.length}/2 saved mind maps`,
    },
    {
      id: 'collab-join',
      title: 'Peer Circle',
      hindiTitle: 'सहयोगी मंडल',
      description: 'Join or host an invite-only Study Pod with safe moderated collaboration.',
      category: 'collaboration',
      tier: 'bronze',
      progressCurrent: Math.min(1, studyRoomsJoined),
      progressTarget: 1,
      metricUnit: 'pods',
      evidenceLabel: `${studyRoomsJoined}/1 private study pod`,
    },
    {
      id: 'collab-contrib',
      title: 'Helpful Peer Mentor',
      hindiTitle: 'सहपाठी मार्गदर्शक',
      description: 'Share 3 helpful notes, goals, mind maps, or group quiz answers in Study Pods.',
      category: 'collaboration',
      tier: 'gold',
      progressCurrent: Math.min(3, roomContributionsByUser),
      progressTarget: 3,
      metricUnit: 'contributions',
      evidenceLabel: `${roomContributionsByUser}/3 verified pod contributions`,
    },
  ];

  const existingMap = input.persistedState?.unlockedBadgeMap || {};
  const badges: AchievementBadge[] = badgeSpecs.map((spec) => {
    const unlocked = spec.progressCurrent >= spec.progressTarget;
    const unlockedAt = unlocked
      ? existingMap[spec.id] || now.toISOString()
      : undefined;
    return {
      ...spec,
      unlocked,
      unlockedAt,
      progressPercent:
        spec.progressTarget > 0
          ? Math.min(100, Math.round((spec.progressCurrent / spec.progressTarget) * 100))
          : 0,
    };
  });

  // Personal Progress Timeline built strictly from real verified activities
  const milestones: ProgressMilestone[] = [];

  for (const tm of input.topicMastery) {
    if (tm.status === 'mastered') {
      milestones.push({
        id: `ms_mastery_${tm.id}`,
        title: `Mastered ${tm.topic}`,
        subtitle: `${tm.subject} • ${Math.round(tm.weightedMasteryScore)}% mastery over ${tm.attemptsCount} attempts`,
        category: 'mastery',
        timestamp: tm.updatedAt || tm.lastPracticedAt || now.toISOString(),
        verifiedSource: 'Learning Intelligence',
        xpCredited: 50,
      });
    }
  }

  for (const ex of input.examAttempts.slice(0, 8)) {
    milestones.push({
      id: `ms_exam_${ex.id}`,
      title: `Exam Mock: ${ex.paperTitle}`,
      subtitle: `${ex.subject} • Scored ${ex.marksObtained}/${ex.totalMarks} (${ex.percentage}%)`,
      category: 'assessment',
      timestamp: ex.submittedAt,
      verifiedSource: 'Exam Simulator',
      xpCredited: Math.min(120, Math.max(25, Math.round(ex.percentage * 0.8))),
    });
  }

  for (const vs of input.voiceSessions.slice(0, 6)) {
    milestones.push({
      id: `ms_voice_${vs.id}`,
      title: `Voice Classroom: ${vs.topic}`,
      subtitle: `${vs.subject} (${vs.language}) • ${vs.turns.length} dialogue turns`,
      category: 'voice',
      timestamp: vs.updatedAt || vs.createdAt,
      verifiedSource: 'Voice Classroom',
      xpCredited: 20,
    });
  }

  for (const mm of input.mindMaps.slice(0, 6)) {
    milestones.push({
      id: `ms_mm_${mm.id}`,
      title: `Mind Map Saved: ${mm.title}`,
      subtitle: `${mm.subject} • ${mm.nodes.length} concept nodes`,
      category: 'mastery',
      timestamp: mm.updatedAt || mm.createdAt,
      verifiedSource: 'Mind Map Studio',
      xpCredited: 25,
    });
  }

  for (const room of input.studyRooms) {
    for (const note of room.notes) {
      if (note.authorUid === input.userId && note.status !== 'hidden') {
        milestones.push({
          id: `ms_pod_note_${note.id}`,
          title: `Shared Study Note: ${note.title}`,
          subtitle: `Pod: ${room.title} • ${room.subject}`,
          category: 'collaboration',
          timestamp: note.createdAt,
          verifiedSource: 'Peer Study Pods',
          xpCredited: 20,
        });
      }
    }
    for (const goal of room.goals) {
      if (goal.contributorUids.includes(input.userId) || goal.createdByUid === input.userId) {
        milestones.push({
          id: `ms_pod_goal_${goal.id}`,
          title: `${goal.completed ? 'Completed' : 'Contributed to'} Pod Goal: ${goal.title}`,
          subtitle: `Pod: ${room.title} • ${goal.currentCount}/${goal.targetCount} ${goal.unit}`,
          category: 'collaboration',
          timestamp: goal.updatedAt,
          verifiedSource: 'Peer Study Pods',
          xpCredited: goal.completed ? 20 : 12,
        });
      }
    }
    for (const map of room.mindMaps) {
      if (map.sharedByUid === input.userId) {
        milestones.push({
          id: `ms_pod_map_${map.id}`,
          title: `Shared Pod Mind Map: ${map.title}`,
          subtitle: `Pod: ${room.title} • ${map.nodes.length} nodes`,
          category: 'collaboration',
          timestamp: map.createdAt,
          verifiedSource: 'Peer Study Pods',
          xpCredited: 20,
        });
      }
    }
    for (const quiz of room.quizzes) {
      const sub = quiz.submissions.find((s) => s.uid === input.userId);
      if (sub) {
        milestones.push({
          id: `ms_pod_quiz_${quiz.id}`,
          title: `Group Quiz Completed: ${quiz.title}`,
          subtitle: `Pod: ${room.title} • Scored ${sub.score}/${sub.total}`,
          category: 'collaboration',
          timestamp: sub.submittedAt,
          verifiedSource: 'Peer Study Pods',
          xpCredited: 25,
        });
      }
    }
  }

  for (const rev of input.flashcardReviews.slice(0, 5)) {
    milestones.push({
      id: `ms_rev_${rev.id}`,
      title: `Active Recall Review: ${rev.topic}`,
      subtitle: `${rev.subject} • Next interval ${rev.nextIntervalDays} day(s)`,
      category: 'revision',
      timestamp: rev.reviewedAt,
      verifiedSource: 'Memory Booster',
      xpCredited: rev.wasCorrect ? 12 : 8,
    });
  }

  milestones.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    streakDays,
    activeDaysLast7,
    dailyBreakdownLast7,
    totalVerifiedXp: baseTotals.totalVerifiedXp,
    todayXpEarned,
    todayXpCap: DAILY_HEALTHY_XP_CAP,
    todayEstimatedMinutes,
    healthyMinuteCap: DAILY_HEALTHY_MINUTE_CAP,
    healthyCapReached,
    wellnessNotice,
    dailyGoals,
    badges,
    unlockedCount: badges.filter((b) => b.unlocked).length,
    totalBadgesCount: badges.length,
    milestones: milestones.slice(0, 25),
    masteryProgress: {
      masteredTopics,
      developingTopics,
      totalTopics: input.topicMastery.length,
      totalRevisions,
      examsCompleted: input.examAttempts.length,
      voiceLessons: input.voiceSessions.length,
      studyRoomsJoined,
      doubtsResolved: input.doubts.length,
      mindMapsCreated: input.mindMaps.length,
    },
    lastComputedAt: now.toISOString(),
  };
}

export function buildAchievementStateRecord(
  userId: string,
  dashboard: MotivationDashboardState
): AchievementStateRecord {
  const unlockedBadgeMap: Record<string, string> = {};
  for (const b of dashboard.badges) {
    if (b.unlocked && b.unlockedAt) {
      unlockedBadgeMap[b.id] = b.unlockedAt;
    }
  }
  return {
    userId,
    streakDays: Math.min(3650, Math.max(0, Math.round(dashboard.streakDays))),
    totalVerifiedXp: Math.min(500000, Math.max(0, Math.round(dashboard.totalVerifiedXp))),
    todayXpEarned: Math.min(DAILY_HEALTHY_XP_CAP, Math.max(0, Math.round(dashboard.todayXpEarned))),
    todayEstimatedMinutes: Math.min(720, Math.max(0, Math.round(dashboard.todayEstimatedMinutes))),
    unlockedBadgeMap,
    lastComputedAt: dashboard.lastComputedAt,
  };
}
