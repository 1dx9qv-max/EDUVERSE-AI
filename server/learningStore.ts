import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ClassGrade, IndianBoard } from '../src/types/auth.ts';
import type { ActivityRecord, ChapterNode } from '../src/types/curriculum.ts';
import type { DoubtTicket, TeacherSession } from '../src/types/ai.ts';
import type { MindMapDocument } from '../src/types/phase3.ts';
import type {
  FlashcardRecord,
  FlashcardReviewLog,
  PracticeAttemptRecord,
  TopicMasteryRecord,
} from '../src/types/phase4.ts';
import type { ExamAttemptRecord } from '../src/types/phase5.ts';
import type { VoiceSessionRecord } from '../src/types/phase6.ts';
import type {
  AdaptivePracticeRecommendation,
  DashboardLearningSummary,
  LearningActivityEvent,
  LearningEventType,
  LearningSourceModule,
  LessonProgressRecord,
  RecommendationHistoryEntry,
  RecommendationReasonCode,
} from '../src/types/learning.ts';
import {
  RECOMMENDATION_SKIP_COOLDOWN_MS,
  buildDynamicDailyGoals,
  computeChapterProgressList,
  computeDeterministicXpForEvent,
  generateAdaptiveRecommendations,
  getLocalDateKey,
  normalizeSlug,
} from '../src/utils/recommendationEngine.ts';
import { getCurriculumForStudent } from '../src/utils/curriculum.ts';
import {
  DAILY_HEALTHY_XP_CAP,
  computeStreakFromDates,
} from '../src/utils/motivationEngine.ts';

export interface DomainSnapshotPayload {
  practiceAttempts?: PracticeAttemptRecord[];
  topicMastery?: TopicMasteryRecord[];
  flashcards?: FlashcardRecord[];
  flashcardReviews?: FlashcardReviewLog[];
  examAttempts?: ExamAttemptRecord[];
  doubts?: DoubtTicket[];
  mindMaps?: MindMapDocument[];
  teacherSessions?: TeacherSession[];
  voiceSessions?: VoiceSessionRecord[];
  lessonProgress?: LessonProgressRecord[];
  legacyActivities?: ActivityRecord[];
  verifiedSyllabusNodes?: ChapterNode[];
}

export interface DashboardSyncContext {
  board?: IndianBoard;
  classGrade?: ClassGrade;
  subjects?: string[];
  learningGoals?: string[];
  preferredPace?: 'steady' | 'accelerated' | 'revision-focus';
  localDateKey?: string;
  timezone?: string;
  refresh?: boolean;
  currentRecIds?: string[];
  domainSnapshot?: DomainSnapshotPayload;
}

interface UserLearningState {
  uid: string;
  events: LearningActivityEvent[];
  lessonProgress: Record<string, LessonProgressRecord>;
  recommendationHistory: Record<string, RecommendationHistoryEntry>;
  topicMastery: Record<string, TopicMasteryRecord>;
  flashcards: Record<string, FlashcardRecord>;
  refreshCount: number;
  lastTimezone?: string;
  lastBoard?: IndianBoard;
  lastClassGrade?: ClassGrade;
  lastSubjects?: string[];
  lastLearningGoals?: string[];
  updatedAt: string;
}

interface LearningStoreFileData {
  users: Record<string, UserLearningState>;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const LEARNING_STORE_PATH = path.resolve(DATA_DIR, 'learning_store.json');

const ALLOWED_EVENT_TYPES = new Set<LearningEventType>([
  'lesson_started',
  'lesson_completed',
  'topic_completed',
  'doubt_submitted',
  'practice_attempted',
  'flashcard_reviewed',
  'revision_completed',
  'exam_attempted',
  'study_goal_completed',
  'mindmap_created',
  'voice_turn',
]);

const ALLOWED_SOURCE_MODULES = new Set<LearningSourceModule>([
  'ai-teacher',
  'visual-lab',
  'doubt-solver',
  'practice',
  'memory-booster',
  'exam-simulator',
  'mind-maps',
  'voice-learning',
  'dashboard',
]);

function loadLearningStore(): LearningStoreFileData {
  try {
    if (fs.existsSync(LEARNING_STORE_PATH)) {
      const raw = fs.readFileSync(LEARNING_STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as LearningStoreFileData;
      if (parsed && typeof parsed === 'object' && parsed.users) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[LearningStore] Failed loading persisted store, initializing clean store:', err);
  }
  const initial: LearningStoreFileData = { users: {} };
  saveLearningStore(initial);
  return initial;
}

function saveLearningStore(target = store): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LEARNING_STORE_PATH, JSON.stringify(target, null, 2), 'utf8');
  } catch (err) {
    console.warn('[LearningStore] Failed persisting store:', err);
  }
}

let store: LearningStoreFileData = loadLearningStore();

export function reloadLearningStoreForTest(): void {
  store = loadLearningStore();
}

function getOrCreateUserState(uid: string): UserLearningState {
  const existing = store.users[uid];
  if (existing) return existing;
  const fresh: UserLearningState = {
    uid,
    events: [],
    lessonProgress: {},
    recommendationHistory: {},
    topicMastery: {},
    flashcards: {},
    refreshCount: 0,
    updatedAt: new Date().toISOString(),
  };
  store.users[uid] = fresh;
  saveLearningStore();
  return fresh;
}

function buildLessonProgressKey(subject: string, chapter: string, topic: string): string {
  return `${normalizeSlug(subject)}::${normalizeSlug(chapter || subject)}::${normalizeSlug(topic || chapter || subject)}`;
}

function computeVerifiedTotalsAndStreak(
  events: LearningActivityEvent[],
  todayDateKey: string
): {
  verifiedXp: number;
  todayXp: number;
  streakDays: number;
  longestStreakDays: number;
  todayCompletedActivities: number;
} {
  const byDayXp = new Map<string, number>();
  const timestamps: string[] = [];
  let todayCompletedActivities = 0;

  for (const ev of events) {
    const dk = ev.localDateKey || getLocalDateKey(ev.timestamp);
    timestamps.push(dk);
    byDayXp.set(dk, (byDayXp.get(dk) || 0) + Math.max(0, ev.xpAwarded || 0));
    if (dk === todayDateKey && ev.eventType !== 'lesson_started') {
      todayCompletedActivities += 1;
    }
  }

  let verifiedXp = 0;
  for (const rawDayXp of byDayXp.values()) {
    verifiedXp += Math.min(DAILY_HEALTHY_XP_CAP, Math.round(rawDayXp));
  }
  const todayXp = Math.min(DAILY_HEALTHY_XP_CAP, Math.round(byDayXp.get(todayDateKey) || 0));

  const { streakDays } = computeStreakFromDates(timestamps, todayDateKey);

  // Compute longest streak across active day keys
  const uniqueDays = Array.from(byDayXp.keys()).sort();
  let longestStreakDays = streakDays;
  let running = 0;
  let prevDayMs: number | null = null;
  for (const dk of uniqueDays) {
    const [y, m, d] = dk.split('-').map(Number);
    const ms = Date.UTC(y, (m || 1) - 1, d || 1);
    if (prevDayMs !== null && Math.round((ms - prevDayMs) / 86_400_000) === 1) {
      running += 1;
    } else {
      running = 1;
    }
    if (running > longestStreakDays) longestStreakDays = running;
    prevDayMs = ms;
  }

  return {
    verifiedXp,
    todayXp,
    streakDays,
    longestStreakDays,
    todayCompletedActivities,
  };
}

function hydrateStateFromDomainSnapshot(
  userState: UserLearningState,
  uid: string,
  snapshot: DomainSnapshotPayload | undefined,
  timezone?: string
): boolean {
  if (!snapshot) return false;
  let dirty = false;
  const existingKeys = new Set(userState.events.map((e) => e.idempotencyKey));

  const appendIfNew = (ev: Omit<LearningActivityEvent, 'id' | 'uid'>, aliasKeys: string[] = []) => {
    if (existingKeys.has(ev.idempotencyKey) || aliasKeys.some((k) => existingKeys.has(k))) return;
    existingKeys.add(ev.idempotencyKey);
    for (const k of aliasKeys) existingKeys.add(k);
    userState.events.push({
      ...ev,
      id: `ev_${crypto.randomBytes(6).toString('hex')}`,
      uid,
    });
    dirty = true;
  };

  for (const att of snapshot.practiceAttempts || []) {
    const idKey = `fs_practice_${att.id}`;
    const ts = att.createdAt || new Date().toISOString();
    appendIfNew(
      {
        eventType: 'practice_attempted',
        subject: att.subject || 'General',
        chapter: att.chapter,
        topic: att.topic,
        sourceModule: 'practice',
        idempotencyKey: idKey,
        xpAwarded: computeDeterministicXpForEvent('practice_attempted', {
          isCorrect: att.isCorrect,
        }),
        isCorrect: att.isCorrect,
        scoreRatio: att.scoreRatio,
        errorTag: att.errorTag,
        difficulty: att.difficulty,
        localDateKey: getLocalDateKey(ts, timezone),
        timezone,
        title: `Practice: ${att.topic || att.subject}`,
        timestamp: ts,
      },
      [`practice_attempt_${att.id}`]
    );
  }

  for (const d of snapshot.doubts || []) {
    const ts = d.createdAt || new Date().toISOString();
    appendIfNew(
      {
        eventType: 'doubt_submitted',
        subject: d.subject || 'General',
        topic: d.topic || d.title || d.questionText?.slice(0, 60),
        sourceModule: 'doubt-solver',
        idempotencyKey: `fs_doubt_${d.id}`,
        xpAwarded: computeDeterministicXpForEvent('doubt_submitted'),
        localDateKey: getLocalDateKey(ts, timezone),
        timezone,
        title: `Doubt Resolved: ${d.subject}`,
        timestamp: ts,
      },
      [`doubt_${d.id}`]
    );
  }

  for (const rev of snapshot.flashcardReviews || []) {
    const ts = rev.reviewedAt || new Date().toISOString();
    appendIfNew(
      {
        eventType: 'flashcard_reviewed',
        subject: rev.subject || 'General',
        topic: rev.topic,
        sourceModule: 'memory-booster',
        idempotencyKey: `fs_review_${rev.id}`,
        xpAwarded: computeDeterministicXpForEvent('flashcard_reviewed', {
          isCorrect: rev.wasCorrect,
        }),
        isCorrect: rev.wasCorrect,
        localDateKey: getLocalDateKey(ts, timezone),
        timezone,
        title: `Flashcard Review: ${rev.topic}`,
        timestamp: ts,
      },
      [`fc_review_${rev.id}`]
    );
  }

  for (const ex of snapshot.examAttempts || []) {
    const ts = ex.submittedAt || new Date().toISOString();
    appendIfNew(
      {
        eventType: 'exam_attempted',
        subject: ex.subject || 'General',
        title: `Exam Mock: ${ex.paperTitle}`,
        sourceModule: 'exam-simulator',
        idempotencyKey: `fs_exam_${ex.id}`,
        xpAwarded: computeDeterministicXpForEvent('exam_attempted', {
          scoreRatio: Math.max(0, Math.min(1, (ex.percentage || 0) / 100)),
        }),
        scoreRatio: Math.max(0, Math.min(1, (ex.percentage || 0) / 100)),
        localDateKey: getLocalDateKey(ts, timezone),
        timezone,
        timestamp: ts,
      },
      [`exam_${ex.id}`]
    );
  }

  for (const mm of snapshot.mindMaps || []) {
    const ts = mm.createdAt || new Date().toISOString();
    appendIfNew(
      {
        eventType: 'mindmap_created',
        subject: mm.subject || 'General',
        topic: mm.topic,
        sourceModule: 'mind-maps',
        idempotencyKey: `fs_mindmap_${mm.id}`,
        xpAwarded: computeDeterministicXpForEvent('mindmap_created'),
        localDateKey: getLocalDateKey(ts, timezone),
        timezone,
        title: `Mind Map: ${mm.title}`,
        timestamp: ts,
      },
      [`mindmap_${mm.id}`]
    );
  }

  for (const vs of snapshot.voiceSessions || []) {
    const ts = vs.updatedAt || vs.createdAt || new Date().toISOString();
    const turns = Math.max(1, vs.turns?.filter((t) => t.role === 'student').length || 1);
    const teacherTurnIds = (vs.turns || [])
      .filter((t) => t.role === 'teacher')
      .map((t) => `voice_${t.id}`);
    appendIfNew(
      {
        eventType: 'voice_turn',
        subject: vs.subject || 'General',
        topic: vs.topic,
        sourceModule: 'voice-learning',
        idempotencyKey: `fs_voice_${vs.id}`,
        xpAwarded: Math.min(60, turns * 15),
        localDateKey: getLocalDateKey(ts, timezone),
        timezone,
        title: `Voice Classroom: ${vs.topic}`,
        timestamp: ts,
      },
      teacherTurnIds
    );
  }

  for (const tsSess of snapshot.teacherSessions || []) {
    const ts = tsSess.updatedAt || tsSess.createdAt || new Date().toISOString();
    appendIfNew(
      {
        eventType: 'lesson_started',
        subject: tsSess.subject || 'General',
        topic: tsSess.title,
        sourceModule: 'ai-teacher',
        idempotencyKey: `fs_teacher_${tsSess.id}`,
        xpAwarded: computeDeterministicXpForEvent('lesson_started'),
        localDateKey: getLocalDateKey(ts, timezone),
        timezone,
        title: `AI Teacher Lesson: ${tsSess.title}`,
        timestamp: ts,
      },
      [`ai_teacher_start_${tsSess.id}`]
    );
  }

  for (const lp of snapshot.lessonProgress || []) {
    const key = buildLessonProgressKey(lp.subject, lp.chapter, lp.topic);
    const existing = userState.lessonProgress[key];
    if (!existing || (lp.status === 'completed' && existing.status !== 'completed')) {
      userState.lessonProgress[key] = { ...lp, uid };
      dirty = true;
    }
    if (lp.status === 'completed') {
      const ts = lp.completedAt || lp.startedAt || new Date().toISOString();
      appendIfNew({
        eventType: 'lesson_completed',
        subject: lp.subject,
        chapter: lp.chapter,
        topic: lp.topic,
        sourceModule: (ALLOWED_SOURCE_MODULES.has(lp.lastSourceModule as LearningSourceModule)
          ? lp.lastSourceModule
          : 'ai-teacher') as LearningSourceModule,
        idempotencyKey: `lesson_completed_${normalizeSlug(lp.subject)}_${normalizeSlug(lp.chapter)}_${normalizeSlug(lp.topic)}`,
        xpAwarded: computeDeterministicXpForEvent('lesson_completed'),
        localDateKey: getLocalDateKey(ts, timezone),
        timezone,
        title: `Completed Lesson: ${lp.topic}`,
        timestamp: ts,
      });
    }
  }

  for (const tm of snapshot.topicMastery || []) {
    const existing = userState.topicMastery[tm.id];
    if (!existing || (tm.updatedAt && (!existing.updatedAt || tm.updatedAt >= existing.updatedAt))) {
      userState.topicMastery[tm.id] = tm;
      dirty = true;
    }
  }

  for (const fc of snapshot.flashcards || []) {
    const existing = userState.flashcards[fc.id];
    if (!existing || (fc.updatedAt && (!existing.updatedAt || fc.updatedAt >= existing.updatedAt))) {
      userState.flashcards[fc.id] = fc;
      dirty = true;
    }
  }

  // Sort chronological order & keep bounded
  if (dirty) {
    userState.events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (userState.events.length > 600) {
      userState.events = userState.events.slice(-600);
    }
    userState.updatedAt = new Date().toISOString();
  }

  return dirty;
}

export interface RecordLearningEventInput {
  eventType: LearningEventType;
  subject: string;
  chapter?: string;
  topic?: string;
  objectiveId?: string;
  sourceModule: LearningSourceModule;
  idempotencyKey?: string;
  isCorrect?: boolean;
  scoreRatio?: number;
  errorTag?: string;
  difficulty?: string;
  localDateKey?: string;
  timezone?: string;
  title?: string;
  description?: string;
  recId?: string;
  timestamp?: string;
}

export interface RecordLearningEventResult {
  recorded: boolean;
  duplicate: boolean;
  xpAwarded: number;
  event?: LearningActivityEvent;
  verifiedXp: number;
  todayXp: number;
  streakDays: number;
}

export function recordLearningEventOnServer(
  uid: string,
  input: RecordLearningEventInput
): RecordLearningEventResult {
  if (!ALLOWED_EVENT_TYPES.has(input.eventType)) {
    throw new Error('INVALID_LEARNING_EVENT_TYPE');
  }

  const userState = getOrCreateUserState(uid);
  const nowIso = input.timestamp && !Number.isNaN(Date.parse(input.timestamp))
    ? new Date(input.timestamp).toISOString()
    : new Date().toISOString();
  const timezone = input.timezone || userState.lastTimezone;
  const localDateKey =
    input.localDateKey && /^\d{4}-\d{2}-\d{2}$/.test(input.localDateKey)
      ? input.localDateKey
      : getLocalDateKey(nowIso, timezone);

  const subject = String(input.subject || 'General').trim().slice(0, 80) || 'General';
  const chapter = input.chapter ? String(input.chapter).trim().slice(0, 120) : undefined;
  const topic = input.topic ? String(input.topic).trim().slice(0, 120) : undefined;
  const sourceModule: LearningSourceModule = ALLOWED_SOURCE_MODULES.has(input.sourceModule)
    ? input.sourceModule
    : 'dashboard';

  const idempotencyKey =
    (input.idempotencyKey && String(input.idempotencyKey).trim().slice(0, 160)) ||
    `${input.eventType}_${normalizeSlug(subject)}_${normalizeSlug(topic || chapter || 'general')}_${localDateKey}_${crypto.randomBytes(4).toString('hex')}`;

  if (userState.events.some((e) => e.idempotencyKey === idempotencyKey)) {
    const totals = computeVerifiedTotalsAndStreak(userState.events, localDateKey);
    return {
      recorded: false,
      duplicate: true,
      xpAwarded: 0,
      verifiedXp: totals.verifiedXp,
      todayXp: totals.todayXp,
      streakDays: totals.streakDays,
    };
  }

  // Never trust client XP amounts — compute deterministically on the server
  const xpAwarded = computeDeterministicXpForEvent(input.eventType, {
    isCorrect: input.isCorrect,
    scoreRatio: input.scoreRatio,
  });

  const event: LearningActivityEvent = {
    id: `ev_${crypto.randomBytes(6).toString('hex')}`,
    uid,
    eventType: input.eventType,
    subject,
    chapter,
    topic,
    objectiveId: input.objectiveId?.slice(0, 80),
    sourceModule,
    idempotencyKey,
    xpAwarded,
    isCorrect: typeof input.isCorrect === 'boolean' ? input.isCorrect : undefined,
    scoreRatio: typeof input.scoreRatio === 'number' ? input.scoreRatio : undefined,
    errorTag: input.errorTag?.slice(0, 80),
    difficulty: input.difficulty?.slice(0, 40),
    localDateKey,
    timezone,
    title:
      (input.title || `${input.eventType.replace(/_/g, ' ')}: ${topic || chapter || subject}`)
        .trim()
        .slice(0, 140),
    description: input.description?.trim().slice(0, 240),
    timestamp: nowIso,
  };

  userState.events.push(event);
  if (userState.events.length > 600) {
    userState.events = userState.events.slice(-600);
  }
  if (timezone) userState.lastTimezone = timezone;

  // Update lesson_progress map on lesson events
  if (
    input.eventType === 'lesson_started' ||
    input.eventType === 'lesson_completed' ||
    input.eventType === 'topic_completed'
  ) {
    const chTitle = chapter || topic || subject;
    const tTitle = topic || chapter || subject;
    const lpKey = buildLessonProgressKey(subject, chTitle, tTitle);
    const existing = userState.lessonProgress[lpKey];
    const nextStatus: 'started' | 'completed' =
      input.eventType === 'lesson_completed' || input.eventType === 'topic_completed'
        ? 'completed'
        : existing?.status === 'completed'
          ? 'completed'
          : 'started';

    userState.lessonProgress[lpKey] = {
      id: lpKey,
      uid,
      subject,
      chapter: chTitle,
      topic: tTitle,
      status: nextStatus,
      startedAt: existing?.startedAt || nowIso,
      completedAt:
        nextStatus === 'completed' ? existing?.completedAt || nowIso : existing?.completedAt,
      lastSourceModule: sourceModule,
    };
  }

  // Update recommendation history if recId matches or completing event matches a shown recommendation
  const completingEvents = new Set<LearningEventType>([
    'lesson_completed',
    'topic_completed',
    'practice_attempted',
    'flashcard_reviewed',
    'revision_completed',
    'exam_attempted',
  ]);

  if (input.recId && userState.recommendationHistory[input.recId] && completingEvents.has(input.eventType)) {
    const rec = userState.recommendationHistory[input.recId];
    rec.status = 'completed';
    rec.completedAt = nowIso;
    rec.cooldownUntil = undefined;
  } else if (topic && completingEvents.has(input.eventType)) {
    const tNorm = normalizeSlug(topic);
    const sNorm = normalizeSlug(subject);
    for (const hist of Object.values(userState.recommendationHistory)) {
      if (
        normalizeSlug(hist.subject) === sNorm &&
        normalizeSlug(hist.topic) === tNorm &&
        hist.status !== 'completed'
      ) {
        hist.status = 'completed';
        hist.completedAt = nowIso;
        hist.cooldownUntil = undefined;
      }
    }
  }

  userState.updatedAt = nowIso;
  saveLearningStore();

  const totals = computeVerifiedTotalsAndStreak(userState.events, localDateKey);
  return {
    recorded: true,
    duplicate: false,
    xpAwarded,
    event,
    verifiedXp: totals.verifiedXp,
    todayXp: totals.todayXp,
    streakDays: totals.streakDays,
  };
}

export function getDashboardLearningSummaryFromServer(
  uid: string,
  context: DashboardSyncContext = {}
): DashboardLearningSummary {
  const userState = getOrCreateUserState(uid);
  const nowIso = new Date().toISOString();
  const timezone = context.timezone || userState.lastTimezone;
  const localDateKey =
    context.localDateKey && /^\d{4}-\d{2}-\d{2}$/.test(context.localDateKey)
      ? context.localDateKey
      : getLocalDateKey(nowIso, timezone);

  const board: IndianBoard = context.board || userState.lastBoard || 'CBSE';
  const classGrade: ClassGrade = context.classGrade || userState.lastClassGrade || 'Class 10';
  const subjects =
    context.subjects && context.subjects.length > 0
      ? context.subjects
      : userState.lastSubjects || [];
  const learningGoals =
    context.learningGoals && context.learningGoals.length > 0
      ? context.learningGoals
      : userState.lastLearningGoals || [];

  userState.lastBoard = board;
  userState.lastClassGrade = classGrade;
  if (subjects.length > 0) userState.lastSubjects = subjects;
  if (learningGoals.length > 0) userState.lastLearningGoals = learningGoals;
  if (timezone) userState.lastTimezone = timezone;

  const hydratedDirty = hydrateStateFromDomainSnapshot(
    userState,
    uid,
    context.domainSnapshot,
    timezone
  );

  const domain = context.domainSnapshot || {};
  const mergedMasteryMap = new Map<string, TopicMasteryRecord>();
  for (const tm of Object.values(userState.topicMastery)) mergedMasteryMap.set(tm.id, tm);
  for (const tm of domain.topicMastery || []) mergedMasteryMap.set(tm.id, tm);
  const mergedTopicMastery = Array.from(mergedMasteryMap.values());

  const mergedFlashcardsMap = new Map<string, FlashcardRecord>();
  for (const fc of Object.values(userState.flashcards)) mergedFlashcardsMap.set(fc.id, fc);
  for (const fc of domain.flashcards || []) mergedFlashcardsMap.set(fc.id, fc);
  const mergedFlashcards = Array.from(mergedFlashcardsMap.values());

  const curriculum = getCurriculumForStudent(
    board,
    classGrade,
    subjects,
    domain.verifiedSyllabusNodes
  );

  const lessonProgressList = Object.values(userState.lessonProgress);
  const chapterProgress = computeChapterProgressList({
    curriculum,
    lessonProgress: lessonProgressList,
    verifiedEvents: userState.events,
    topicMastery: mergedTopicMastery,
  });

  const todayEvents = userState.events.filter(
    (ev) => (ev.localDateKey || getLocalDateKey(ev.timestamp, timezone)) === localDateKey
  );

  const dueFlashcards = mergedFlashcards.filter((fc) => fc.dueDate <= nowIso);

  const dailyGoals = buildDynamicDailyGoals({
    uid,
    board,
    classGrade,
    subjects,
    learningGoals,
    curriculum,
    chapterProgress,
    topicMastery: mergedTopicMastery,
    dueFlashcards,
    todayEvents,
    localDateKey,
  });

  if (context.refresh) {
    userState.refreshCount += 1;
  }

  const recommendations = generateAdaptiveRecommendations({
    board,
    classGrade,
    enrolledSubjects: subjects,
    verifiedNodes: domain.verifiedSyllabusNodes,
    curriculum,
    chapterProgress,
    topicMastery: mergedTopicMastery,
    practiceAttempts: domain.practiceAttempts || [],
    flashcards: mergedFlashcards,
    history: userState.recommendationHistory,
    nowIso,
    count: 4,
    excludeRecIds: context.refresh ? context.currentRecIds : undefined,
    learningPace: context.preferredPace,
  });

  // Track shown history so recommendations rotate & evolve cleanly across refreshes/sessions
  for (const rec of recommendations) {
    const existing = userState.recommendationHistory[rec.id];
    if (existing) {
      existing.shownCount += 1;
      existing.lastShownAt = nowIso;
    } else {
      userState.recommendationHistory[rec.id] = {
        recId: rec.id,
        subject: rec.subject,
        chapter: rec.chapter,
        topic: rec.topic,
        category: rec.category,
        shownCount: 1,
        lastShownAt: nowIso,
        status: 'shown',
      };
    }
  }

  userState.updatedAt = nowIso;
  if (hydratedDirty || recommendations.length > 0 || context.refresh) {
    saveLearningStore();
  }

  const totals = computeVerifiedTotalsAndStreak(userState.events, localDateKey);

  return {
    uid,
    localDateKey,
    timezone: timezone || 'UTC',
    verifiedXp: totals.verifiedXp,
    todayXp: totals.todayXp,
    streakDays: totals.streakDays,
    longestStreakDays: totals.longestStreakDays,
    totalCompletedActivities: userState.events.filter((e) => e.eventType !== 'lesson_started')
      .length,
    todayCompletedActivities: totals.todayCompletedActivities,
    chapterProgress,
    dailyGoals,
    recommendations,
    recommendationRefreshCount: userState.refreshCount,
    lastUpdatedAt: nowIso,
  };
}

export function recordRecommendationActionOnServer(
  uid: string,
  recId: string,
  action: 'skipped' | 'started' | 'completed',
  meta?: {
    subject?: string;
    chapter?: string;
    topic?: string;
    category?: RecommendationReasonCode;
  },
  refreshContext?: DashboardSyncContext
): {
  historyEntry: RecommendationHistoryEntry;
  recommendations: AdaptivePracticeRecommendation[];
} {
  const userState = getOrCreateUserState(uid);
  const nowIso = new Date().toISOString();
  const existing = userState.recommendationHistory[recId];

  const entry: RecommendationHistoryEntry = existing || {
    recId,
    subject: meta?.subject || 'General',
    chapter: meta?.chapter || meta?.subject || 'General',
    topic: meta?.topic || 'Concept',
    category: meta?.category || 'unstudied_syllabus',
    shownCount: 1,
    lastShownAt: nowIso,
    status: 'shown',
  };

  if (action === 'skipped') {
    entry.status = 'skipped';
    entry.skippedAt = nowIso;
    entry.cooldownUntil = new Date(Date.now() + RECOMMENDATION_SKIP_COOLDOWN_MS).toISOString();
  } else if (action === 'started') {
    if (entry.status !== 'completed') {
      entry.status = 'started';
      entry.startedAt = nowIso;
    }
  } else if (action === 'completed') {
    entry.status = 'completed';
    entry.completedAt = nowIso;
    entry.cooldownUntil = undefined;
  }

  userState.recommendationHistory[recId] = entry;
  userState.updatedAt = nowIso;
  saveLearningStore();

  const summary = getDashboardLearningSummaryFromServer(uid, refreshContext || {});
  return {
    historyEntry: entry,
    recommendations: summary.recommendations,
  };
}

export function getVerifiedLearningTelemetryForGuardian(uid: string): {
  streakDays: number;
  totalVerifiedXp: number;
  todayXpEarned: number;
  todayEstimatedMinutes: number;
  masteredTopicsCount: number;
  developingTopicsCount: number;
  needsRevisionTopics: string[];
  strongTopics: string[];
  dailyGoals: Array<{ title: string; current: number; target: number; completed: boolean }>;
  learningGoals: string[];
} {
  const userState = store.users[uid];
  if (!userState) {
    return {
      streakDays: 0,
      totalVerifiedXp: 0,
      todayXpEarned: 0,
      todayEstimatedMinutes: 0,
      masteredTopicsCount: 0,
      developingTopicsCount: 0,
      needsRevisionTopics: [],
      strongTopics: [],
      dailyGoals: [],
      learningGoals: [],
    };
  }

  const todayKey = getLocalDateKey(new Date(), userState.lastTimezone);
  const totals = computeVerifiedTotalsAndStreak(userState.events, todayKey);
  const todayEvents = userState.events.filter(
    (e) => (e.localDateKey || getLocalDateKey(e.timestamp, userState.lastTimezone)) === todayKey
  );

  const mastery = Object.values(userState.topicMastery);
  const mastered = mastery.filter((m) => m.status === 'mastered');
  const developing = mastery.filter((m) => m.status === 'developing');
  const needsRevision = mastery
    .filter((m) => m.status === 'needs-revision')
    .slice(0, 4)
    .map((m) => `${m.subject}: ${m.topic}`);
  const strongTopics = mastered.slice(0, 4).map((m) => `${m.subject}: ${m.topic}`);

  const summary = getDashboardLearningSummaryFromServer(uid, {
    localDateKey: todayKey,
    timezone: userState.lastTimezone,
  });

  return {
    streakDays: totals.streakDays,
    totalVerifiedXp: totals.verifiedXp,
    todayXpEarned: totals.todayXp,
    todayEstimatedMinutes: Math.min(720, todayEvents.length * 8),
    masteredTopicsCount: mastered.length,
    developingTopicsCount: developing.length,
    needsRevisionTopics: needsRevision,
    strongTopics,
    dailyGoals: summary.dailyGoals.map((g) => ({
      title: g.title,
      current: g.currentCount,
      target: g.targetCount,
      completed: g.completed,
    })),
    learningGoals: userState.lastLearningGoals || [],
  };
}

export function purgeUserLearningStore(uid: string): void {
  if (store.users[uid]) {
    delete store.users[uid];
    saveLearningStore();
  }
}
