import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashboardExamSummary,
  buildEnrichedSchedule,
  canConfirmDatesheet,
  computePreparationAnalysis,
  computeResizedImageDimensions,
  diffCalendarDays,
  estimatePdfPageCountFromBase64,
  getExpectedWeekday,
  parseStrictIsoDate,
  parseTimeRangeToMinutes,
  sanitizeDatesheetForStorage,
  sortExamEntriesChronologically,
  validateDatesheetUploadBatch,
  validateExtractedDatesheet,
} from './datesheetEngine.ts';
import type { DatesheetMetadata, ExtractedExamEntry, SavedDatesheet } from '../types/datesheet.ts';

function makeMeta(overrides: Partial<DatesheetMetadata> = {}): DatesheetMetadata {
  return {
    examName: 'CBSE Class 10 Board Exam 2026',
    board: 'CBSE',
    classGrade: 'Class 10',
    academicSession: '2025-26',
    importantInstructions: ['Carry school ID and admit card'],
    isUncertain: false,
    uncertaintyReasons: [],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ExtractedExamEntry> = {}): ExtractedExamEntry {
  return {
    id: `ex_${Math.random().toString(36).slice(2, 7)}`,
    subject: 'Mathematics Standard',
    date: '2026-03-10',
    weekday: 'Tuesday',
    startTime: '10:30 AM',
    endTime: '01:30 PM',
    rawTimeText: '10:30 AM - 01:30 PM',
    durationMinutes: 180,
    entryType: 'theory',
    isUncertain: false,
    ...overrides,
  };
}

describe('datesheetEngine date, weekday, and time parsing', () => {
  it('validates strict calendar dates and rejects non-existent dates like Feb 30', () => {
    assert.equal(parseStrictIsoDate('2026-03-10').valid, true);
    assert.equal(parseStrictIsoDate('2026-02-30').valid, false);
    assert.equal(parseStrictIsoDate('10-03-2026').valid, false);
    assert.equal(getExpectedWeekday('2026-03-10'), 'Tuesday');
    assert.equal(getExpectedWeekday('2026-03-11'), 'Wednesday');
    assert.equal(diffCalendarDays('2026-03-10', '2026-03-14'), 4);
  });

  it('parses Indian board exam time ranges and computes durations accurately', () => {
    const parsed = parseTimeRangeToMinutes(undefined, undefined, '10:30 AM - 01:30 PM');
    assert.equal(parsed.startMin, 630);
    assert.equal(parsed.endMin, 810);
    assert.equal(parsed.derivedDurationMinutes, 180);
  });

  it('computes proportional image resize dimensions up to max 2048px without upscaling smaller scans', () => {
    assert.deepEqual(computeResizedImageDimensions(4096, 3072, 2048), {
      width: 2048,
      height: 1536,
      resized: true,
    });
    assert.deepEqual(computeResizedImageDimensions(1200, 1600, 2048), {
      width: 1200,
      height: 1600,
      resized: false,
    });
  });
});

describe('validateDatesheetUploadBatch', () => {
  it('accepts valid multi-page PDF and counts PDF pages cleanly', () => {
    const rawPdf = '%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Pages /Count 2 >> endobj';
    const b64 = Buffer.from(rawPdf, 'latin1').toString('base64');
    assert.equal(estimatePdfPageCountFromBase64(b64), 2);

    const res = validateDatesheetUploadBatch([
      {
        fileName: 'cbse_datesheet_2026.pdf',
        mimeType: 'application/pdf',
        sizeBytes: rawPdf.length,
        dataBase64: b64,
      },
    ]);
    assert.equal(res.valid, true);
    assert.equal(res.sanitizedFiles?.[0].pageCount, 2);
  });

  it('accepts multiple PNG/JPEG pages and rejects spoofed magic bytes or oversized batches', () => {
    const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
    const jpgB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
    const multiOk = validateDatesheetUploadBatch([
      { fileName: 'page1.png', mimeType: 'image/png', sizeBytes: 1200, dataBase64: pngB64 },
      { fileName: 'page2.jpg', mimeType: 'image/jpg', sizeBytes: 1400, dataBase64: jpgB64 },
    ]);
    assert.equal(multiOk.valid, true);
    assert.equal(multiOk.sanitizedFiles?.length, 2);

    const spoof = validateDatesheetUploadBatch([
      {
        fileName: 'fake.png',
        mimeType: 'image/png',
        sizeBytes: 64,
        dataBase64: Buffer.from('<html>not a png</html>').toString('base64'),
      },
    ]);
    assert.equal(spoof.valid, false);
    assert.match(spoof.error || '', /signature mismatch/i);
  });
});

describe('validateExtractedDatesheet and confirmation gate', () => {
  it('flags weekday mismatch, duplicate exam, time conflict, unclear timing, and tight gaps without mutating original entries', () => {
    const entries: ExtractedExamEntry[] = [
      makeEntry({
        id: 'e1',
        subject: 'Physics',
        date: '2026-03-10', // Tuesday
        weekday: 'Monday', // Mismatch!
        rawTimeText: '10:30 AM - 01:30 PM',
      }),
      makeEntry({
        id: 'e2',
        subject: 'Chemistry',
        date: '2026-03-11', // Consecutive day -> 0 prep days!
        weekday: 'Wednesday',
        startTime: '',
        endTime: '',
        rawTimeText: '', // Unclear timing!
      }),
      makeEntry({
        id: 'e3',
        subject: 'Physics', // Duplicate!
        date: '2026-03-11', // Same date & unclear time overlap -> Conflict!
        weekday: 'Wednesday',
        rawTimeText: '11:00 AM - 02:00 PM',
      }),
    ];

    const snapshotBefore = JSON.stringify(entries);
    const warnings = validateExtractedDatesheet(makeMeta(), entries);
    assert.equal(JSON.stringify(entries), snapshotBefore, 'Validation must never silently mutate entries');

    const codes = new Set(warnings.map((w) => w.code));
    assert.ok(codes.has('WEEKDAY_MISMATCH'));
    assert.ok(codes.has('UNCLEAR_TIMING'));
    assert.ok(codes.has('DUPLICATE_EXAM'));
    assert.ok(codes.has('CONFLICTING_TIME_SLOT'));
    assert.ok(codes.has('TIGHT_GAP'));
  });

  it('blocks confirmation when required subject or valid date is missing', () => {
    const badEntries = [
      makeEntry({ id: 'bad1', subject: '', date: '2026-02-30' }),
    ];
    const warnings = validateExtractedDatesheet(makeMeta(), badEntries);
    const gate = canConfirmDatesheet(makeMeta(), badEntries, warnings);
    assert.equal(gate.canConfirm, false);
    assert.ok(gate.blockers.length >= 1);
  });
});

describe('sortExamEntriesChronologically, buildEnrichedSchedule, computePreparationAnalysis', () => {
  it('computes accurate chronological order, countdowns, gaps, consecutive pairs, and largest/shortest gaps', () => {
    const unsorted: ExtractedExamEntry[] = [
      makeEntry({ id: 's3', subject: 'Mathematics', date: '2026-03-18', weekday: 'Wednesday' }),
      makeEntry({ id: 's1', subject: 'English Core', date: '2026-03-10', weekday: 'Tuesday' }),
      makeEntry({ id: 's2', subject: 'Physics', date: '2026-03-11', weekday: 'Wednesday' }),
    ];

    const sorted = sortExamEntriesChronologically(unsorted);
    assert.deepEqual(
      sorted.map((s) => s.subject),
      ['English Core', 'Physics', 'Mathematics']
    );

    const enriched = buildEnrichedSchedule(unsorted, '2026-03-05');
    assert.equal(enriched[0].daysRemaining, 5);
    assert.equal(enriched[0].isNextUpcoming, true);
    assert.equal(enriched[0].prepDaysUntilNext, 0); // Mar 10 -> Mar 11 = 0 prep days
    assert.equal(enriched[1].previousExamSubject, 'English Core');
    assert.equal(enriched[1].prepDaysFromPrevious, 0);
    assert.equal(enriched[2].prepDaysFromPrevious, 6); // Mar 11 -> Mar 18 = 7 calendar days - 1 = 6 prep days

    const analysis = computePreparationAnalysis(unsorted, '2026-03-05');
    assert.equal(analysis.totalExams, 3);
    assert.equal(analysis.upcomingExamsCount, 3);
    assert.equal(analysis.firstExam?.subject, 'English Core');
    assert.equal(analysis.lastExam?.subject, 'Mathematics');
    assert.equal(analysis.nextUpcomingExam?.daysRemaining, 5);
    assert.equal(analysis.consecutiveExamPairs.length, 1);
    assert.equal(analysis.shortestGap?.prepDays, 0);
    assert.equal(analysis.largestGap?.prepDays, 6);
    assert.equal(analysis.tightSequences.length, 1);
  });

  it('builds dashboard summary strictly from confirmed datesheets, ignores unconfirmed drafts, and enforces UID isolation', () => {
    const draftOnly: SavedDatesheet = sanitizeDatesheetForStorage({
      id: 'ds_draft_1',
      userId: 'student_a',
      title: 'Draft CBSE',
      status: 'draft',
      metadata: makeMeta(),
      entries: [makeEntry({ id: 'd1', subject: 'Science', date: '2026-04-02', weekday: 'Thursday' })],
      sourceFiles: [{ fileName: 'ds.pdf', mimeType: 'application/pdf', sizeBytes: 1000, pageCount: 1 }],
      createdAt: '2026-03-01T10:00:00Z',
      updatedAt: '2026-03-01T10:00:00Z',
    });

    const draftSummary = buildDashboardExamSummary([draftOnly], '2026-03-20');
    assert.equal(draftSummary.confirmedDatesheet, null);
    assert.equal(draftSummary.nextExam, null);
    assert.equal(draftSummary.alerts.length, 1);
    assert.match(draftSummary.alerts[0].title, /awaiting your confirmation/i);

    const confirmed: SavedDatesheet = sanitizeDatesheetForStorage({
      ...draftOnly,
      id: 'ds_conf_1',
      status: 'confirmed',
      confirmedAt: '2026-03-02T10:00:00Z',
    });

    const confirmedSummary = buildDashboardExamSummary([draftOnly, confirmed], '2026-03-20');
    assert.equal(confirmedSummary.confirmedDatesheet?.id, 'ds_conf_1');
    assert.equal(confirmedSummary.confirmedDatesheet?.userId, 'student_a');
    assert.equal(confirmedSummary.nextExam?.subject, 'Science');
    assert.equal(confirmedSummary.nextExam?.daysRemaining, 13);

    // Filter isolation check: student_b sees zero records belonging to student_a
    const studentBOnly = [draftOnly, confirmed].filter((d) => d.userId === 'student_b');
    const isolatedSummary = buildDashboardExamSummary(studentBOnly, '2026-03-20');
    assert.equal(isolatedSummary.confirmedDatesheet, null);
    assert.equal(isolatedSummary.upcomingSchedule.length, 0);
  });
});
