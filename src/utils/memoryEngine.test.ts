import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextSm2Schedule,
  createFlashcardRecord,
  groupCardsByChapter,
  previewNextIntervals,
  sanitizeFlashcardForStorage,
  sortDailyRevisionQueue,
} from './memoryEngine';

const NOW = '2026-11-13T08:00:00.000Z';

test('SM-2 spaced repetition intervals progress cleanly on Good/Easy and reset with lapse on Again', () => {
  const card = createFlashcardRecord({
    userId: 'stu_1',
    subject: 'Chemistry',
    chapter: 'Chemical Kinetics',
    topic: 'Rate Law',
    front: 'What is the unit of rate constant k for a zero-order reaction?',
    back: 'mol L⁻¹ s⁻¹',
    source: 'ai-generated',
    nowIso: NOW,
  });

  // First Good review -> 1 day
  const step1 = computeNextSm2Schedule(card, 4, NOW);
  assert.equal(step1.wasCorrect, true);
  assert.equal(step1.updatedCard.repetitions, 1);
  assert.equal(step1.updatedCard.intervalDays, 1);

  // Second Good review -> 6 days
  const step2 = computeNextSm2Schedule(step1.updatedCard, 4, '2026-11-14T08:00:00.000Z');
  assert.equal(step2.updatedCard.repetitions, 2);
  assert.equal(step2.updatedCard.intervalDays, 6);

  // Third Good review -> round(6 * EF)
  const step3 = computeNextSm2Schedule(step2.updatedCard, 4, '2026-11-20T08:00:00.000Z');
  assert.equal(step3.updatedCard.repetitions, 3);
  assert.ok(step3.updatedCard.intervalDays >= 14);

  // Lapse with Again (0) -> resets repetitions, sets interval 0, flags difficult
  const lapsed = computeNextSm2Schedule(step3.updatedCard, 0, '2026-12-05T08:00:00.000Z');
  assert.equal(lapsed.wasCorrect, false);
  assert.equal(lapsed.updatedCard.repetitions, 0);
  assert.equal(lapsed.updatedCard.intervalDays, 0);
  assert.equal(lapsed.updatedCard.lapses, 1);
  assert.equal(lapsed.updatedCard.difficultyTag, 'difficult');
  assert.ok(lapsed.updatedCard.easeFactor >= 1.3);
});

test('previewNextIntervals formats readable day labels for all 4 SM-2 buttons', () => {
  const card = createFlashcardRecord({
    userId: 'stu_1',
    subject: 'Mathematics',
    chapter: 'Polynomials',
    topic: 'Discriminant',
    front: 'Condition for real and equal roots of ax² + bx + c = 0?',
    back: 'b² - 4ac = 0',
    source: 'student-custom',
    nowIso: NOW,
  });

  const previews = previewNextIntervals(card, NOW);
  assert.equal(previews[0], 'Today');
  assert.equal(previews[2], '1 day');
  assert.equal(previews[4], '1 day');
  assert.equal(previews[5], '3 days');
});

test('daily queue sorts due cards placing difficult and error-remediation cards first and excluding future cards', () => {
  const futureCard = {
    ...createFlashcardRecord({
      userId: 'stu_1',
      subject: 'Physics',
      chapter: 'Optics',
      topic: 'Prism',
      front: 'Future card',
      back: 'Back',
      source: 'ai-generated',
      nowIso: NOW,
    }),
    id: 'fc_future',
    dueDate: '2026-11-20T08:00:00.000Z',
  };

  const normalDue = {
    ...createFlashcardRecord({
      userId: 'stu_1',
      subject: 'Physics',
      chapter: 'Optics',
      topic: 'Refraction',
      front: 'Normal due',
      back: 'Back',
      source: 'ai-generated',
      nowIso: '2026-11-12T08:00:00.000Z',
    }),
    id: 'fc_normal',
  };

  const remediationDue = {
    ...createFlashcardRecord({
      userId: 'stu_1',
      subject: 'Physics',
      chapter: 'Optics',
      topic: 'Mirror Formula',
      front: 'Sign convention check',
      back: 'u is negative',
      source: 'error-remediation',
      linkedErrorTag: 'sign-convention-error',
      nowIso: '2026-11-13T07:00:00.000Z',
    }),
    id: 'fc_remed',
  };

  const queue = sortDailyRevisionQueue([futureCard, normalDue, remediationDue], NOW);
  assert.equal(queue.length, 2);
  assert.equal(queue[0].id, 'fc_remed');
  assert.equal(queue[1].id, 'fc_normal');

  const decks = groupCardsByChapter([futureCard, normalDue, remediationDue], NOW);
  assert.equal(decks.length, 1);
  assert.equal(decks[0].totalCards, 3);
  assert.equal(decks[0].dueCount, 2);
  assert.equal(decks[0].difficultCount, 1);
});

test('sanitizeFlashcardForStorage clamps easeFactor within [1.3, 4.0] and bounds strings', () => {
  const sanitized = sanitizeFlashcardForStorage({
    id: 'bad id',
    userId: 'u1',
    subject: 'Biology',
    chapter: 'Life Processes',
    topic: 'Respiration',
    front: 'F'.repeat(1000),
    back: 'B'.repeat(2000),
    source: 'student-custom',
    difficultyTag: 'normal',
    repetitions: -2,
    intervalDays: 9000,
    easeFactor: 0.5,
    lapses: -1,
    dueDate: NOW,
  });

  assert.match(sanitized.id, /^[a-zA-Z0-9_\-]+$/);
  assert.equal(sanitized.front.length, 800);
  assert.equal(sanitized.back.length, 1400);
  assert.equal(sanitized.easeFactor, 1.3);
  assert.equal(sanitized.intervalDays, 3650);
  assert.equal(sanitized.repetitions, 0);
});
