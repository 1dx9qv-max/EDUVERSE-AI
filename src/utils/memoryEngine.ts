import type {
  FlashcardGenerateRequest,
  FlashcardRecord,
  FlashcardReviewLog,
  FlashcardSource,
  Sm2Rating,
} from '../types/phase4.ts';
import { sanitizeDocumentId } from './learningEngine.ts';

export function clampEaseFactor(ef: number): number {
  return Number(Math.min(4.0, Math.max(1.3, ef)).toFixed(2));
}

export function addDaysIso(baseIso: string, days: number): string {
  const baseDate = new Date(baseIso);
  const safeBase = Number.isNaN(baseDate.getTime()) ? new Date() : baseDate;
  const next = new Date(safeBase.getTime() + Math.max(0, days) * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

export interface Sm2ScheduleOutcome {
  updatedCard: FlashcardRecord;
  reviewLog: FlashcardReviewLog;
  wasCorrect: boolean;
}

/**
 * Pure SuperMemo SM-2 spaced repetition calculation.
 * quality ratings: 0 = Again (lapse), 2 = Hard, 4 = Good, 5 = Easy
 */
export function computeNextSm2Schedule(
  card: FlashcardRecord,
  quality: Sm2Rating,
  nowIso: string = new Date().toISOString()
): Sm2ScheduleOutcome {
  const previousIntervalDays = Math.max(0, Math.round(card.intervalDays || 0));
  const currentEf = clampEaseFactor(card.easeFactor || 2.5);
  const currentReps = Math.max(0, Math.round(card.repetitions || 0));
  const currentLapses = Math.max(0, Math.round(card.lapses || 0));

  let nextReps = currentReps;
  let nextIntervalDays = previousIntervalDays;
  let nextEf = currentEf;
  let nextLapses = currentLapses;
  const wasCorrect = quality >= 3;

  if (!wasCorrect) {
    // Again (0) or Hard (2): treat Again as lapse, Hard keeps partial progress with shorter review
    if (quality === 0) {
      nextReps = 0;
      nextIntervalDays = 0; // Due immediately / re-queue today
      nextLapses = currentLapses + 1;
      nextEf = clampEaseFactor(currentEf - 0.2);
    } else {
      // Hard (2): gentle interval growth or 1 day, slight EF penalty
      nextReps = Math.max(1, currentReps);
      nextIntervalDays = previousIntervalDays <= 1 ? 1 : Math.max(1, Math.round(previousIntervalDays * 1.2));
      nextLapses = currentLapses;
      nextEf = clampEaseFactor(currentEf - 0.14);
    }
  } else {
    // Good (4) or Easy (5)
    nextReps = currentReps + 1;
    if (currentReps === 0) {
      nextIntervalDays = quality === 5 ? 3 : 1;
    } else if (currentReps === 1) {
      nextIntervalDays = quality === 5 ? 8 : 6;
    } else {
      const multiplier = quality === 5 ? currentEf * 1.25 : currentEf;
      nextIntervalDays = Math.min(3650, Math.max(1, Math.round(previousIntervalDays * multiplier)));
    }

    const qDiff = 5 - quality;
    const efDelta = 0.1 - qDiff * (0.08 + qDiff * 0.02);
    nextEf = clampEaseFactor(currentEf + efDelta);
  }

  const dueDate = nextIntervalDays === 0 ? nowIso : addDaysIso(nowIso, nextIntervalDays);
  const difficultyTag: 'normal' | 'difficult' =
    nextLapses >= 2 || (quality === 0 && currentReps > 0) || nextEf <= 1.75
      ? 'difficult'
      : quality === 5 && nextReps >= 3 && nextLapses === 0
        ? 'normal'
        : card.difficultyTag === 'difficult' && quality < 4
          ? 'difficult'
          : card.difficultyTag === 'difficult' && nextReps >= 2
            ? 'normal'
            : card.difficultyTag;

  const updatedCard: FlashcardRecord = {
    ...card,
    repetitions: nextReps,
    intervalDays: nextIntervalDays,
    easeFactor: nextEf,
    lapses: nextLapses,
    difficultyTag,
    dueDate,
    lastReviewedAt: nowIso,
    updatedAt: nowIso,
  };

  const reviewLog: FlashcardReviewLog = {
    id: sanitizeDocumentId(`${card.id}_${Date.now()}`, 'rev'),
    userId: card.userId,
    cardId: card.id,
    subject: card.subject,
    topic: card.topic,
    quality,
    wasCorrect,
    previousIntervalDays,
    nextIntervalDays,
    reviewedAt: nowIso,
  };

  return {
    updatedCard,
    reviewLog,
    wasCorrect,
  };
}

export function previewNextIntervals(card: FlashcardRecord, nowIso: string = new Date().toISOString()): Record<Sm2Rating, string> {
  const formatDays = (days: number): string => {
    if (days <= 0) return 'Today';
    if (days === 1) return '1 day';
    if (days < 30) return `${days} days`;
    const months = Math.round(days / 30);
    return months === 1 ? '1 mo' : `${months} mos`;
  };

  return {
    0: formatDays(computeNextSm2Schedule(card, 0, nowIso).reviewLog.nextIntervalDays),
    2: formatDays(computeNextSm2Schedule(card, 2, nowIso).reviewLog.nextIntervalDays),
    4: formatDays(computeNextSm2Schedule(card, 4, nowIso).reviewLog.nextIntervalDays),
    5: formatDays(computeNextSm2Schedule(card, 5, nowIso).reviewLog.nextIntervalDays),
  };
}

export function isCardDue(card: FlashcardRecord, nowIso: string = new Date().toISOString()): boolean {
  const dueMs = new Date(card.dueDate).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (Number.isNaN(dueMs)) return true;
  return dueMs <= nowMs;
}

export function sortDailyRevisionQueue(
  cards: FlashcardRecord[],
  nowIso: string = new Date().toISOString()
): FlashcardRecord[] {
  return cards
    .filter((card) => isCardDue(card, nowIso))
    .sort((a, b) => {
      // Priority 1: Difficult or error-remediation cards
      const aPriority = (a.difficultyTag === 'difficult' ? 2 : 0) + (a.source === 'error-remediation' ? 1 : 0);
      const bPriority = (b.difficultyTag === 'difficult' ? 2 : 0) + (b.source === 'error-remediation' ? 1 : 0);
      if (aPriority !== bPriority) return bPriority - aPriority;
      // Priority 2: Most overdue first
      return a.dueDate.localeCompare(b.dueDate);
    });
}

export interface ChapterDeckSummary {
  key: string;
  subject: string;
  chapter: string;
  totalCards: number;
  dueCount: number;
  difficultCount: number;
  cards: FlashcardRecord[];
}

export function groupCardsByChapter(
  cards: FlashcardRecord[],
  nowIso: string = new Date().toISOString()
): ChapterDeckSummary[] {
  const map = new Map<string, ChapterDeckSummary>();
  for (const card of cards) {
    const key = `${card.subject}::${card.chapter}`;
    const existing = map.get(key) || {
      key,
      subject: card.subject,
      chapter: card.chapter,
      totalCards: 0,
      dueCount: 0,
      difficultCount: 0,
      cards: [],
    };
    existing.totalCards += 1;
    if (isCardDue(card, nowIso)) existing.dueCount += 1;
    if (card.difficultyTag === 'difficult') existing.difficultCount += 1;
    existing.cards.push(card);
    map.set(key, existing);
  }
  return Array.from(map.values()).sort((a, b) => b.dueCount - a.dueCount || a.subject.localeCompare(b.subject));
}

export function createFlashcardRecord(params: {
  userId: string;
  subject: string;
  chapter: string;
  topic: string;
  board?: string;
  classGrade?: string;
  front: string;
  back: string;
  hint?: string;
  source: FlashcardSource;
  linkedErrorTag?: string;
  nowIso?: string;
}): FlashcardRecord {
  const nowIso = params.nowIso || new Date().toISOString();
  const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return sanitizeFlashcardForStorage({
    id: `fc_${uniqueSuffix}`,
    userId: params.userId,
    subject: params.subject,
    chapter: params.chapter,
    topic: params.topic,
    board: params.board,
    classGrade: params.classGrade,
    front: params.front,
    back: params.back,
    hint: params.hint,
    source: params.source,
    linkedErrorTag: params.linkedErrorTag,
    difficultyTag: params.source === 'error-remediation' ? 'difficult' : 'normal',
    repetitions: 0,
    intervalDays: 0,
    easeFactor: 2.5,
    lapses: 0,
    dueDate: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
}

export function validateFlashcardGenerateRequest(
  raw: Partial<FlashcardGenerateRequest>
): { valid: boolean; error?: string; sanitized?: FlashcardGenerateRequest } {
  const subject = (raw.subject || '').trim();
  const topic = (raw.topic || '').trim();
  if (!subject || !topic) {
    return { valid: false, error: 'Subject and topic are required to generate flashcards.' };
  }
  return {
    valid: true,
    sanitized: {
      board: raw.board || 'CBSE',
      classGrade: raw.classGrade || 'Class 10',
      subject: subject.slice(0, 80),
      chapter: (raw.chapter || topic).trim().slice(0, 160),
      topic: topic.slice(0, 160),
      count: Math.min(8, Math.max(2, Number(raw.count) || 5)),
      language:
        raw.language === 'Hindi'
          ? 'Hindi'
          : raw.language === 'Bilingual' || (raw.language as string) === 'Hinglish'
          ? 'Bilingual'
          : 'English',
      focusErrorTag: raw.focusErrorTag?.trim().slice(0, 80),
      misconceptionNote: raw.misconceptionNote?.trim().slice(0, 400),
    },
  };
}

export function sanitizeFlashcardForStorage(card: FlashcardRecord): FlashcardRecord {
  const nowIso = new Date().toISOString();
  const sanitized: FlashcardRecord = {
    id: sanitizeDocumentId(card.id.replace(/^fc_/, ''), 'fc'),
    userId: card.userId.slice(0, 128),
    subject: (card.subject || 'General').trim().slice(0, 80),
    chapter: (card.chapter || card.topic || 'Chapter').trim().slice(0, 160),
    topic: (card.topic || 'Concept').trim().slice(0, 160),
    front: (card.front || 'Recall question').trim().slice(0, 800),
    back: (card.back || 'Answer').trim().slice(0, 1400),
    source: card.source || 'ai-generated',
    difficultyTag: card.difficultyTag === 'difficult' ? 'difficult' : 'normal',
    repetitions: Math.max(0, Math.round(card.repetitions || 0)),
    intervalDays: Math.min(3650, Math.max(0, Math.round(card.intervalDays || 0))),
    easeFactor: clampEaseFactor(card.easeFactor || 2.5),
    lapses: Math.max(0, Math.round(card.lapses || 0)),
    dueDate: card.dueDate || nowIso,
    createdAt: card.createdAt || nowIso,
    updatedAt: card.updatedAt || nowIso,
  };

  if (card.board?.trim()) sanitized.board = card.board.trim().slice(0, 32);
  if (card.classGrade?.trim()) sanitized.classGrade = card.classGrade.trim().slice(0, 30);
  if (card.hint?.trim()) sanitized.hint = card.hint.trim().slice(0, 400);
  if (card.linkedErrorTag?.trim()) sanitized.linkedErrorTag = card.linkedErrorTag.trim().slice(0, 80);
  if (card.lastReviewedAt) sanitized.lastReviewedAt = card.lastReviewedAt;

  return sanitized;
}

export function sanitizeFlashcardReviewForStorage(review: FlashcardReviewLog): FlashcardReviewLog {
  return {
    id: sanitizeDocumentId(review.id.replace(/^rev_/, ''), 'rev'),
    userId: review.userId.slice(0, 128),
    cardId: sanitizeDocumentId(review.cardId.replace(/^fc_/, ''), 'fc'),
    subject: (review.subject || 'General').trim().slice(0, 80),
    topic: (review.topic || 'Concept').trim().slice(0, 160),
    quality: Math.min(5, Math.max(0, Math.round(review.quality))),
    wasCorrect: Boolean(review.wasCorrect),
    previousIntervalDays: Math.max(0, Math.round(review.previousIntervalDays || 0)),
    nextIntervalDays: Math.max(0, Math.round(review.nextIntervalDays || 0)),
    reviewedAt: review.reviewedAt || new Date().toISOString(),
  };
}
