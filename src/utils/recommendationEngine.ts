import type { ClassGrade, IndianBoard } from '../types/auth.ts';
import type { ChapterNode, SubjectCurriculum } from '../types/curriculum.ts';
import type {
  AdaptivePracticeRecommendation,
  ChapterProgressSummary,
  DynamicDailyGoal,
  LearningActivityEvent,
  LearningEventType,
  LessonProgressRecord,
  RecommendationActionModule,
  RecommendationHistoryEntry,
  RecommendationReasonCode,
} from '../types/learning.ts';
import type {
  DifficultyTier,
  FlashcardRecord,
  PracticeAttemptRecord,
  TopicMasteryRecord,
} from '../types/phase4.ts';
import { getCurriculumForStudent } from './curriculum.ts';
import { FEATURE_FLAGS } from '../config/featureFlags.ts';

export const RECOMMENDATION_SKIP_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
export const RECOMMENDATION_SHOWN_SOFT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export function normalizeSlug(value: string): string {
  return (value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

export function normalizeTopicMatchKey(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function subjectsRoughlyMatch(a: string, b: string): boolean {
  const ka = normalizeTopicMatchKey(a);
  const kb = normalizeTopicMatchKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.includes('math') && kb.includes('math')) return true;
  if (ka.includes('english') && kb.includes('english')) return true;
  if (ka.includes('hindi') && kb.includes('hindi')) return true;
  if (
    (ka.includes('computer') || ka.includes('information') || ka.includes('artificial')) &&
    (kb.includes('computer') || kb.includes('information') || kb.includes('artificial'))
  ) {
    return true;
  }
  return ka.includes(kb) || kb.includes(ka);
}

export function getLocalDateKey(dateOrIso?: Date | string, timezone?: string): string {
  const dt =
    dateOrIso instanceof Date
      ? dateOrIso
      : dateOrIso
        ? new Date(dateOrIso)
        : new Date();
  const safeDt = Number.isNaN(dt.getTime()) ? new Date() : dt;

  if (timezone && timezone.trim()) {
    try {
      const formatted = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone.trim(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(safeDt);
      if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
        return formatted;
      }
    } catch {
      // Fallback to local formatting below if timezone string is invalid
    }
  }

  const y = safeDt.getFullYear();
  const m = String(safeDt.getMonth() + 1).padStart(2, '0');
  const d = String(safeDt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function computeDeterministicXpForEvent(
  eventType: LearningEventType,
  options?: {
    isCorrect?: boolean;
    scoreRatio?: number;
  }
): number {
  switch (eventType) {
    case 'lesson_started':
      return 10;
    case 'lesson_completed':
      return 35;
    case 'topic_completed':
      return 30;
    case 'doubt_submitted':
      return 20;
    case 'practice_attempted':
      return options?.isCorrect ? 15 : 8;
    case 'flashcard_reviewed':
      return options?.isCorrect ? 12 : 8;
    case 'revision_completed':
      return 25;
    case 'exam_attempted': {
      const ratio = Math.max(0, Math.min(1, options?.scoreRatio ?? 0.5));
      return Math.min(120, Math.max(25, Math.round(ratio * 80 + 15)));
    }
    case 'study_goal_completed':
      return 20;
    case 'mindmap_created':
      return 25;
    case 'voice_turn':
      return 15;
    default:
      return 0;
  }
}

export function buildRecommendationId(
  subject: string,
  chapter: string,
  topic: string,
  category: RecommendationReasonCode
): string {
  return `rec_${normalizeSlug(subject)}_${normalizeSlug(chapter).slice(0, 24)}_${normalizeSlug(topic).slice(0, 28)}_${normalizeSlug(category)}`;
}

export function buildDeepLinkRoute(params: {
  module: RecommendationActionModule;
  subject: string;
  chapter?: string;
  topic?: string;
  difficulty?: DifficultyTier;
  errorTag?: string;
  recId?: string;
}): string {
  const qs = new URLSearchParams();
  if (params.subject) qs.set('subject', params.subject);
  if (params.chapter) qs.set('chapter', params.chapter);
  if (params.topic) qs.set('topic', params.topic);
  if (params.difficulty) qs.set('difficulty', params.difficulty);
  if (params.errorTag) qs.set('errorTag', params.errorTag);
  if (params.recId) qs.set('recId', params.recId);

  const query = qs.toString();
  switch (params.module) {
    case 'practice':
      return `/practice${query ? `?${query}` : ''}`;
    case 'memory-booster':
      return `/memory-booster${query ? `?${query}` : ''}`;
    case 'ai-teacher':
      return `/ai-teacher${query ? `?${query}` : ''}`;
    case 'visual-lab':
      return FEATURE_FLAGS.visualLearningEnabled
        ? `/visual-lab${query ? `?${query}` : ''}`
        : `/ai-teacher${query ? `?${query}` : ''}`;
    case 'exam-simulator':
      return `/exam-simulator${query ? `?${query}` : ''}`;
  }
}

export function computeChapterProgressList(params: {
  curriculum: SubjectCurriculum[];
  lessonProgress: LessonProgressRecord[];
  verifiedEvents: LearningActivityEvent[];
  topicMastery: TopicMasteryRecord[];
}): ChapterProgressSummary[] {
  const { curriculum, lessonProgress, verifiedEvents, topicMastery } = params;
  const summaries: ChapterProgressSummary[] = [];

  for (const subj of curriculum) {
    for (const ch of subj.chapters) {
      const topics = ch.keyTopics.length > 0 ? ch.keyTopics : [ch.title];
      const completedTopicTitles: string[] = [];
      let startedTopicsCount = 0;
      let lastStudiedAt: string | undefined;

      const touchTs = (ts?: string) => {
        if (!ts) return;
        if (!lastStudiedAt || ts > lastStudiedAt) {
          lastStudiedAt = ts;
        }
      };

      // Check chapter-level events too in case lesson was tracked at chapter title level
      const chKey = normalizeTopicMatchKey(ch.title);

      for (const topicTitle of topics) {
        const tKey = normalizeTopicMatchKey(topicTitle);

        const matchingLessons = lessonProgress.filter(
          (lp) =>
            subjectsRoughlyMatch(lp.subject, subj.name) &&
            (normalizeTopicMatchKey(lp.topic) === tKey ||
              (normalizeTopicMatchKey(lp.chapter) === chKey &&
                normalizeTopicMatchKey(lp.topic) === chKey))
        );

        const matchingEvents = verifiedEvents.filter(
          (ev) =>
            subjectsRoughlyMatch(ev.subject, subj.name) &&
            (normalizeTopicMatchKey(ev.topic || '') === tKey ||
              normalizeTopicMatchKey(ev.chapter || '') === chKey)
        );

        const matchingMastery = topicMastery.find(
          (tm) =>
            subjectsRoughlyMatch(tm.subject, subj.name) &&
            normalizeTopicMatchKey(tm.topic) === tKey
        );

        for (const lp of matchingLessons) {
          touchTs(lp.completedAt || lp.startedAt);
        }
        for (const ev of matchingEvents) {
          touchTs(ev.timestamp);
        }
        if (matchingMastery) {
          touchTs(matchingMastery.lastPracticedAt || matchingMastery.updatedAt);
        }

        const isCompleted =
          matchingLessons.some((lp) => lp.status === 'completed') ||
          matchingEvents.some(
            (ev) =>
              (ev.eventType === 'lesson_completed' || ev.eventType === 'topic_completed') &&
              (normalizeTopicMatchKey(ev.topic || '') === tKey ||
                (normalizeTopicMatchKey(ev.chapter || '') === chKey && !ev.topic))
          ) ||
          matchingMastery?.status === 'mastered';

        const isStarted =
          !isCompleted &&
          (matchingLessons.some((lp) => lp.status === 'started') ||
            matchingEvents.some((ev) =>
              [
                'lesson_started',
                'practice_attempted',
                'doubt_submitted',
                'flashcard_reviewed',
                'revision_completed',
                'mindmap_created',
                'voice_turn',
              ].includes(ev.eventType)
            ) ||
            Boolean(matchingMastery && matchingMastery.attemptsCount > 0));

        if (isCompleted) {
          completedTopicTitles.push(topicTitle);
        } else if (isStarted) {
          startedTopicsCount += 1;
        }
      }

      const completedTopics = completedTopicTitles.length;
      const totalTopics = topics.length;
      let percentComplete = 0;

      if (totalTopics > 0) {
        if (completedTopics === 0 && startedTopicsCount === 0) {
          percentComplete = 0;
        } else if (completedTopics >= totalTopics) {
          percentComplete = 100;
        } else {
          const rawPct = Math.round(
            ((completedTopics + startedTopicsCount * 0.35) / totalTopics) * 100
          );
          percentComplete = Math.max(10, Math.min(95, rawPct));
        }
      }

      const status: ChapterProgressSummary['status'] =
        percentComplete >= 100
          ? 'completed'
          : percentComplete > 0
            ? 'in_progress'
            : 'not_started';

      const baseMinutes = Math.max(15, Math.round((ch.estimatedHours || 2) * 12));
      const estimatedMinutesRemaining =
        status === 'completed'
          ? 0
          : Math.max(10, Math.round(baseMinutes * (1 - percentComplete / 100)));

      summaries.push({
        chapterId: ch.id,
        subject: subj.name,
        chapterNumber: ch.number,
        chapterTitle: ch.title,
        totalTopics,
        completedTopics,
        completedTopicTitles,
        startedTopicsCount,
        percentComplete,
        status,
        estimatedMinutesRemaining,
        lastStudiedAt,
        topics,
      });
    }
  }

  // Put in-progress chapters first (most recently studied), then unstarted, then completed
  summaries.sort((a, b) => {
    const rank = (s: ChapterProgressSummary['status']) =>
      s === 'in_progress' ? 0 : s === 'not_started' ? 1 : 2;
    const ra = rank(a.status);
    const rb = rank(b.status);
    if (ra !== rb) return ra - rb;
    if (a.lastStudiedAt && b.lastStudiedAt) {
      return b.lastStudiedAt.localeCompare(a.lastStudiedAt);
    }
    return a.chapterNumber - b.chapterNumber;
  });

  return summaries;
}

export function buildDynamicDailyGoals(params: {
  uid: string;
  board: IndianBoard;
  classGrade: ClassGrade;
  subjects: string[];
  learningGoals: string[];
  curriculum: SubjectCurriculum[];
  chapterProgress: ChapterProgressSummary[];
  topicMastery: TopicMasteryRecord[];
  dueFlashcards: FlashcardRecord[];
  todayEvents: LearningActivityEvent[];
  localDateKey: string;
}): DynamicDailyGoal[] {
  const {
    curriculum,
    chapterProgress,
    topicMastery,
    dueFlashcards,
    todayEvents,
    localDateKey,
    learningGoals,
  } = params;

  const activeChapter =
    chapterProgress.find((c) => c.status === 'in_progress') ||
    chapterProgress.find((c) => c.status === 'not_started') ||
    chapterProgress[0];

  const firstUncompletedTopic = activeChapter
    ? activeChapter.topics.find((t) => !activeChapter.completedTopicTitles.includes(t)) ||
      activeChapter.topics[0] ||
      activeChapter.chapterTitle
    : 'Core Foundations';

  const secondarySubject =
    curriculum.find(
      (s) => !activeChapter || !subjectsRoughlyMatch(s.name, activeChapter.subject)
    ) || curriculum[0];
  const secondaryChapter = secondarySubject?.chapters[0];
  const secondaryTopic =
    secondaryChapter?.keyTopics[0] || secondaryChapter?.title || 'Concept Clarity';

  const weakTopic = [...topicMastery]
    .filter((tm) => tm.status === 'needs-revision' || tm.weightedMasteryScore < 65)
    .sort((a, b) => a.weightedMasteryScore - b.weightedMasteryScore)[0];

  // Goal 1: Study 1 targeted lesson topic
  const lessonSubject = activeChapter?.subject || curriculum[0]?.name || 'Mathematics';
  const lessonChapter = activeChapter?.chapterTitle || 'Core Chapter';
  const lessonEventsToday = todayEvents.filter(
    (e) =>
      e.eventType === 'lesson_completed' ||
      e.eventType === 'topic_completed' ||
      e.eventType === 'study_goal_completed'
  );
  const lessonTarget = 1;
  const lessonCount = Math.min(lessonTarget, lessonEventsToday.length);

  const goal1: DynamicDailyGoal = {
    id: `dg_${localDateKey}_lesson`,
    goalKey: 'daily_lesson',
    localDateKey,
    title:
      activeChapter?.status === 'in_progress'
        ? `Continue ${lessonSubject}: ${firstUncompletedTopic}`
        : `Start ${lessonSubject}: ${firstUncompletedTopic}`,
    description: FEATURE_FLAGS.visualLearningEnabled
      ? `Complete 1 guided lesson in ${lessonChapter} via AI Teacher or Visual Lab.`
      : `Complete 1 guided lesson in ${lessonChapter} via AI Teacher.`,
    category: 'lesson',
    subject: lessonSubject,
    chapter: lessonChapter,
    topic: firstUncompletedTopic,
    targetCount: lessonTarget,
    currentCount: lessonCount,
    completed: lessonCount >= lessonTarget,
    completedAt: lessonEventsToday[0]?.timestamp,
    xpReward: 35,
    actionRoute: buildDeepLinkRoute({
      module: 'ai-teacher',
      subject: lessonSubject,
      chapter: lessonChapter,
      topic: firstUncompletedTopic,
    }),
  };

  // Goal 2: Adaptive practice questions on weak topic or secondary subject
  const practiceSubject = weakTopic?.subject || secondarySubject?.name || lessonSubject;
  const practiceChapter =
    weakTopic?.chapter || secondaryChapter?.title || lessonChapter;
  const practiceTopic = weakTopic?.topic || secondaryTopic;
  const practiceDifficulty: DifficultyTier = weakTopic ? 'foundation' : 'intermediate';
  const practiceEventsToday = todayEvents.filter(
    (e) => e.eventType === 'practice_attempted'
  );
  const practiceTarget = 3;
  const practiceCount = Math.min(practiceTarget, practiceEventsToday.length);

  const goal2: DynamicDailyGoal = {
    id: `dg_${localDateKey}_practice`,
    goalKey: 'daily_practice',
    localDateKey,
    title: weakTopic
      ? `Strengthen ${practiceTopic} (3 Practice Questions)`
      : `Solve 3 ${practiceSubject} Practice Questions`,
    description: weakTopic
      ? `Targeted recovery practice in ${practiceSubject} (${Math.round(weakTopic.weightedMasteryScore)}% mastery).`
      : `Test understanding on ${practiceTopic} with instant AI feedback.`,
    category: 'practice',
    subject: practiceSubject,
    chapter: practiceChapter,
    topic: practiceTopic,
    targetCount: practiceTarget,
    currentCount: practiceCount,
    completed: practiceCount >= practiceTarget,
    completedAt: practiceEventsToday[practiceTarget - 1]?.timestamp,
    xpReward: 45,
    actionRoute: buildDeepLinkRoute({
      module: 'practice',
      subject: practiceSubject,
      chapter: practiceChapter,
      topic: practiceTopic,
      difficulty: practiceDifficulty,
      errorTag: weakTopic?.recurringErrors?.[0]?.errorTag,
    }),
  };

  // Goal 3: Spaced repetition if cards due, otherwise Doubt / Visual exploration
  const hasDueCards = dueFlashcards.length > 0;
  const dueCard = dueFlashcards[0];
  const revEventsToday = todayEvents.filter(
    (e) => e.eventType === 'flashcard_reviewed' || e.eventType === 'revision_completed'
  );
  const conceptEventsToday = todayEvents.filter(
    (e) =>
      e.eventType === 'doubt_submitted' ||
      e.eventType === 'voice_turn' ||
      e.eventType === 'mindmap_created'
  );

  const goal3: DynamicDailyGoal = hasDueCards
    ? {
        id: `dg_${localDateKey}_revision`,
        goalKey: 'daily_revision',
        localDateKey,
        title: `Review ${Math.min(3, dueFlashcards.length)} Due Recall Card${dueFlashcards.length > 1 ? 's' : ''}`,
        description: `Spaced-repetition review starting with ${dueCard.subject}: ${dueCard.topic}.`,
        category: 'revision',
        subject: dueCard.subject,
        chapter: dueCard.chapter,
        topic: dueCard.topic,
        targetCount: Math.min(3, dueFlashcards.length),
        currentCount: Math.min(Math.min(3, dueFlashcards.length), revEventsToday.length),
        completed: revEventsToday.length >= Math.min(3, dueFlashcards.length),
        completedAt: revEventsToday[Math.min(3, dueFlashcards.length) - 1]?.timestamp,
        xpReward: 30,
        actionRoute: buildDeepLinkRoute({
          module: 'memory-booster',
          subject: dueCard.subject,
          chapter: dueCard.chapter,
          topic: dueCard.topic,
        }),
      }
    : {
        id: `dg_${localDateKey}_doubt`,
        goalKey: 'daily_concept_clarity',
        localDateKey,
        title: `Resolve 1 Doubt or Build a Concept Mind Map`,
        description: FEATURE_FLAGS.visualLearningEnabled
          ? `Ask a question on ${secondarySubject?.name || lessonSubject} or create a visual summary.`
          : `Ask a question on ${secondarySubject?.name || lessonSubject} or create a concept mind map.`,
        category: 'doubt',
        subject: secondarySubject?.name || lessonSubject,
        topic: secondaryTopic,
        targetCount: 1,
        currentCount: Math.min(1, conceptEventsToday.length),
        completed: conceptEventsToday.length >= 1,
        completedAt: conceptEventsToday[0]?.timestamp,
        xpReward: 25,
        actionRoute: '/doubt-solver',
      };

  // Goal 4: Board / Mock readiness or interactive Visual Lab exploration
  const boardFocus =
    learningGoals.some((g) => /board|exam|mcq|jee|neet/i.test(g)) ||
    params.classGrade === 'Class 10' ||
    params.classGrade === 'Class 12';
  const fourthEventsToday = todayEvents.filter((e) =>
    boardFocus
      ? e.eventType === 'exam_attempted' ||
        (e.eventType === 'practice_attempted' && practiceEventsToday.length >= 5)
      : e.eventType === 'mindmap_created' ||
        e.eventType === 'voice_turn' ||
        e.eventType === 'lesson_started'
  );

  const thirdSubject = curriculum[2]?.name || secondarySubject?.name || lessonSubject;
  const thirdTopic = curriculum[2]?.chapters[0]?.keyTopics[0] || secondaryTopic;

  const goal4: DynamicDailyGoal = boardFocus
    ? {
        id: `dg_${localDateKey}_exam`,
        goalKey: 'daily_board_check',
        localDateKey,
        title: `Attempt 1 Timed Exam Check or 5+ Practice Set`,
        description: `Build speed & board-paper accuracy in ${thirdSubject}.`,
        category: 'exam',
        subject: thirdSubject,
        topic: thirdTopic,
        targetCount: 1,
        currentCount: Math.min(1, fourthEventsToday.length),
        completed: fourthEventsToday.length >= 1,
        completedAt: fourthEventsToday[0]?.timestamp,
        xpReward: 40,
        actionRoute: '/exam-simulator',
      }
    : FEATURE_FLAGS.visualLearningEnabled
      ? {
          id: `dg_${localDateKey}_visual`,
          goalKey: 'daily_visual_lab',
          localDateKey,
          title: `Explore 1 Visual Lab Simulation (${thirdSubject})`,
          description: `Build deep intuition on ${thirdTopic} with interactive steps.`,
          category: 'lesson',
          subject: thirdSubject,
          topic: thirdTopic,
          targetCount: 1,
          currentCount: Math.min(1, fourthEventsToday.length),
          completed: fourthEventsToday.length >= 1,
          completedAt: fourthEventsToday[0]?.timestamp,
          xpReward: 30,
          actionRoute: buildDeepLinkRoute({
            module: 'visual-lab',
            subject: thirdSubject,
            topic: thirdTopic,
          }),
        }
      : {
          id: `dg_${localDateKey}_mindmap`,
          goalKey: 'daily_mind_map',
          localDateKey,
          title: `Build 1 Concept Mind Map (${thirdSubject})`,
          description: `Map key relationships in ${thirdTopic} with AI Mind Maps.`,
          category: 'lesson',
          subject: thirdSubject,
          topic: thirdTopic,
          targetCount: 1,
          currentCount: Math.min(1, fourthEventsToday.length),
          completed: fourthEventsToday.length >= 1,
          completedAt: fourthEventsToday[0]?.timestamp,
          xpReward: 30,
          actionRoute: '/mindmaps',
        };

  return [goal1, goal2, goal3, goal4];
}

export function generateAdaptiveRecommendations(params: {
  board: IndianBoard;
  classGrade: ClassGrade;
  enrolledSubjects: string[];
  verifiedNodes?: ChapterNode[];
  curriculum?: SubjectCurriculum[];
  chapterProgress: ChapterProgressSummary[];
  topicMastery: TopicMasteryRecord[];
  practiceAttempts: PracticeAttemptRecord[];
  flashcards: FlashcardRecord[];
  history: Record<string, RecommendationHistoryEntry>;
  nowIso?: string;
  count?: number;
  excludeRecIds?: string[];
  learningPace?: 'steady' | 'accelerated' | 'revision-focus';
}): AdaptivePracticeRecommendation[] {
  const nowIso = params.nowIso || new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();
  const targetCount = Math.max(1, Math.min(6, params.count || 4));
  const excludeSet = new Set(params.excludeRecIds || []);

  const curriculum =
    params.curriculum ||
    getCurriculumForStudent(
      params.board,
      params.classGrade,
      params.enrolledSubjects,
      params.verifiedNodes
    );

  const candidates: AdaptivePracticeRecommendation[] = [];
  const seenKeys = new Set<string>();

  const pushCandidate = (cand: AdaptivePracticeRecommendation) => {
    const dedupeKey = `${normalizeTopicMatchKey(cand.subject)}::${normalizeTopicMatchKey(cand.topic)}::${cand.category}`;
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);
    candidates.push(cand);
  };

  // 1. Due spaced-repetition flashcards
  const dueFlashcards = params.flashcards.filter((fc) => fc.dueDate <= nowIso);
  for (const fc of dueFlashcards.slice(0, 6)) {
    const category: RecommendationReasonCode = 'due_revision';
    const id = buildRecommendationId(fc.subject, fc.chapter || fc.subject, fc.topic, category);
    pushCandidate({
      id,
      subject: fc.subject,
      chapter: fc.chapter || fc.subject,
      topic: fc.topic,
      title: `Spaced Recall: ${fc.topic}`,
      difficulty: 'intermediate',
      category,
      reason: `Due for SM-2 active recall review (${fc.lapses > 0 ? 'previously missed' : 'retention window open'}).`,
      estimatedMinutes: 8,
      xpReward: 25,
      actionModule: 'memory-booster',
      actionRoute: buildDeepLinkRoute({
        module: 'memory-booster',
        subject: fc.subject,
        chapter: fc.chapter,
        topic: fc.topic,
        recId: id,
      }),
      priorityScore: params.learningPace === 'revision-focus' ? 98 : 92,
      errorTag: fc.linkedErrorTag,
    });
  }

  // 2. Weak topics & recurring error tags from topic mastery
  for (const tm of params.topicMastery) {
    if (tm.status === 'needs-revision' || tm.weightedMasteryScore < 68) {
      const hasRecurring = tm.recurringErrors && tm.recurringErrors.length > 0;
      const category: RecommendationReasonCode = hasRecurring
        ? 'recurring_error'
        : 'weak_topic';
      const primaryErr = tm.recurringErrors?.[0]?.errorTag;
      const id = buildRecommendationId(tm.subject, tm.chapter || tm.subject, tm.topic, category);
      const diff: DifficultyTier =
        tm.weightedMasteryScore < 45 ? 'foundation' : 'intermediate';

      pushCandidate({
        id,
        subject: tm.subject,
        chapter: tm.chapter || tm.subject,
        topic: tm.topic,
        title: `${tm.topic}: Targeted Mastery Drill`,
        difficulty: diff,
        category,
        reason: primaryErr
          ? `Recurring "${primaryErr.replace(/-/g, ' ')}" errors (${Math.round(tm.weightedMasteryScore)}% mastery).`
          : `Accuracy at ${Math.round(tm.weightedMasteryScore)}% — focused recovery practice recommended.`,
        estimatedMinutes: 12,
        xpReward: 40,
        actionModule: 'practice',
        actionRoute: buildDeepLinkRoute({
          module: 'practice',
          subject: tm.subject,
          chapter: tm.chapter,
          topic: tm.topic,
          difficulty: diff,
          errorTag: primaryErr,
          recId: id,
        }),
        priorityScore: hasRecurring ? 95 : 89,
        errorTag: primaryErr,
        masteryScore: Math.round(tm.weightedMasteryScore),
      });
    } else if (tm.status === 'developing' && tm.weightedMasteryScore >= 68) {
      // 3. Difficulty step-up for strong developing topics
      const nextDiff: DifficultyTier =
        tm.currentRecommendedDifficulty === 'board-challenge'
          ? 'board-challenge'
          : tm.weightedMasteryScore >= 78
            ? 'board-challenge'
            : 'intermediate';
      const category: RecommendationReasonCode = 'difficulty_step_up';
      const id = buildRecommendationId(tm.subject, tm.chapter || tm.subject, tm.topic, category);

      pushCandidate({
        id,
        subject: tm.subject,
        chapter: tm.chapter || tm.subject,
        topic: tm.topic,
        title: `${tm.topic}: ${nextDiff === 'board-challenge' ? 'Board Challenge' : 'Level-Up'} Set`,
        difficulty: nextDiff,
        category,
        reason: `Mastery reached ${Math.round(tm.weightedMasteryScore)}% — step up to ${nextDiff.replace(/-/g, ' ')} questions.`,
        estimatedMinutes: 15,
        xpReward: 45,
        actionModule: 'practice',
        actionRoute: buildDeepLinkRoute({
          module: 'practice',
          subject: tm.subject,
          chapter: tm.chapter,
          topic: tm.topic,
          difficulty: nextDiff,
          recId: id,
        }),
        priorityScore: 79,
        masteryScore: Math.round(tm.weightedMasteryScore),
      });
    }
  }

  // 4. Unfinished (in-progress) chapters -> continue next uncompleted topic
  for (const ch of params.chapterProgress) {
    if (ch.status === 'in_progress') {
      const nextTopic =
        ch.topics.find((t) => !ch.completedTopicTitles.includes(t)) || ch.topics[0] || ch.chapterTitle;
      const category: RecommendationReasonCode = 'unfinished_chapter';
      const id = buildRecommendationId(ch.subject, ch.chapterTitle, nextTopic, category);

      pushCandidate({
        id,
        subject: ch.subject,
        chapter: ch.chapterTitle,
        topic: nextTopic,
        title: `Continue ${ch.chapterTitle}: ${nextTopic}`,
        difficulty: 'intermediate',
        category,
        reason: `Chapter is ${ch.percentComplete}% complete — practice this next topic to advance.`,
        estimatedMinutes: 12,
        xpReward: 35,
        actionModule: 'practice',
        actionRoute: buildDeepLinkRoute({
          module: 'practice',
          subject: ch.subject,
          chapter: ch.chapterTitle,
          topic: nextTopic,
          difficulty: 'intermediate',
          recId: id,
        }),
        priorityScore: 84,
      });
    }
  }

  // 5. Unstudied syllabus topics across all enrolled subjects & chapters
  const practicedTopicKeys = new Set(
    params.practiceAttempts.map(
      (a) => `${normalizeTopicMatchKey(a.subject)}::${normalizeTopicMatchKey(a.topic)}`
    )
  );
  const completedTopicKeys = new Set<string>();
  for (const ch of params.chapterProgress) {
    for (const ct of ch.completedTopicTitles) {
      completedTopicKeys.add(`${normalizeTopicMatchKey(ch.subject)}::${normalizeTopicMatchKey(ct)}`);
    }
  }

  curriculum.forEach((subj, sIdx) => {
    subj.chapters.forEach((ch, cIdx) => {
      const topics = ch.keyTopics.length > 0 ? ch.keyTopics : [ch.title];
      topics.forEach((topicTitle, tIdx) => {
        const key = `${normalizeTopicMatchKey(subj.name)}::${normalizeTopicMatchKey(topicTitle)}`;
        if (completedTopicKeys.has(key)) return;

        const isPracticed = practicedTopicKeys.has(key);
        const category: RecommendationReasonCode = 'unstudied_syllabus';
        const id = buildRecommendationId(subj.name, ch.title, topicTitle, category);
        const diff: DifficultyTier =
          params.learningPace === 'accelerated' && cIdx > 0 ? 'intermediate' : 'foundation';

        // Interleave subjects & chapters naturally so candidate pool isn't biased to 1 subject
        const baseScore = 70 - cIdx * 5 - tIdx * 3 - sIdx * 1.5 - (isPracticed ? 6 : 0);
        const actionModule: RecommendationActionModule =
          tIdx % 3 === 2 ? 'ai-teacher' : 'practice';

        pushCandidate({
          id,
          subject: subj.name,
          chapter: ch.title,
          topic: topicTitle,
          title: `${subj.name}: ${topicTitle}`,
          difficulty: diff,
          category,
          reason: isPracticed
            ? `Build further fluency in ${ch.title} (${params.board} ${params.classGrade}).`
            : `Next unstudied syllabus topic from ${ch.title}.`,
          estimatedMinutes: 10 + (tIdx % 2) * 5,
          xpReward: 35,
          actionModule,
          actionRoute: buildDeepLinkRoute({
            module: actionModule,
            subject: subj.name,
            chapter: ch.title,
            topic: topicTitle,
            difficulty: diff,
            recId: id,
          }),
          priorityScore: baseScore,
        });
      });
    });
  });

  // Score & filter with history awareness
  const evaluatePool = (options: {
    respectSkipCooldown: boolean;
    respectExcludeIds: boolean;
    penalizeRecentlyShown: boolean;
  }) => {
    const scored: Array<{ item: AdaptivePracticeRecommendation; effectiveScore: number }> = [];

    for (const cand of candidates) {
      const hist = params.history[cand.id];

      // Completed recommendations should not be recommended again unless newly due SM-2 review
      if (hist?.status === 'completed') {
        if (cand.category === 'due_revision') {
          const newlyDue = dueFlashcards.some(
            (fc) =>
              subjectsRoughlyMatch(fc.subject, cand.subject) &&
              normalizeTopicMatchKey(fc.topic) === normalizeTopicMatchKey(cand.topic) &&
              (!hist.completedAt || fc.dueDate > hist.completedAt)
          );
          if (!newlyDue) continue;
        } else {
          continue;
        }
      }

      if (
        options.respectSkipCooldown &&
        hist?.status === 'skipped' &&
        hist.cooldownUntil &&
        new Date(hist.cooldownUntil).getTime() > nowMs
      ) {
        continue;
      }

      if (options.respectExcludeIds && excludeSet.has(cand.id)) {
        continue;
      }

      let score = cand.priorityScore;

      if (hist) {
        // Rotate items that have already been shown multiple times
        score -= Math.min(28, (hist.shownCount || 0) * 6);
        if (options.penalizeRecentlyShown && hist.lastShownAt) {
          const ageMs = nowMs - new Date(hist.lastShownAt).getTime();
          if (ageMs >= 0 && ageMs < RECOMMENDATION_SHOWN_SOFT_COOLDOWN_MS) {
            score -= 14;
          }
        }
        if (hist.status === 'skipped') {
          score -= 12;
        }
      }

      scored.push({ item: cand, effectiveScore: score });
    }

    scored.sort((a, b) => b.effectiveScore - a.effectiveScore);
    return scored.map((s) => s.item);
  };

  let ranked = evaluatePool({
    respectSkipCooldown: true,
    respectExcludeIds: true,
    penalizeRecentlyShown: true,
  });

  if (ranked.length < targetCount) {
    const relaxed = evaluatePool({
      respectSkipCooldown: true,
      respectExcludeIds: false,
      penalizeRecentlyShown: true,
    });
    const have = new Set(ranked.map((r) => r.id));
    for (const r of relaxed) {
      if (!have.has(r.id)) {
        ranked.push(r);
        have.add(r.id);
      }
    }
  }

  if (ranked.length < targetCount) {
    const lastResort = evaluatePool({
      respectSkipCooldown: false,
      respectExcludeIds: false,
      penalizeRecentlyShown: false,
    });
    const have = new Set(ranked.map((r) => r.id));
    for (const r of lastResort) {
      if (!have.has(r.id)) {
        ranked.push(r);
        have.add(r.id);
      }
    }
  }

  // Enforce subject diversity in top picks (max 2 per subject while alternatives exist)
  const picked: AdaptivePracticeRecommendation[] = [];
  const deferred: AdaptivePracticeRecommendation[] = [];
  const subjectCounts = new Map<string, number>();

  for (const item of ranked) {
    const sKey = normalizeTopicMatchKey(item.subject);
    const current = subjectCounts.get(sKey) || 0;
    if (current < 2) {
      picked.push(item);
      subjectCounts.set(sKey, current + 1);
      if (picked.length >= targetCount) break;
    } else {
      deferred.push(item);
    }
  }

  while (picked.length < targetCount && deferred.length > 0) {
    picked.push(deferred.shift()!);
  }

  return picked.slice(0, targetCount);
}
