import type {
  DatesheetIntelligence,
  DatesheetMetadata,
  DatesheetSourceFileMeta,
  DatesheetUploadAttachment,
  DatesheetValidationWarning,
  EnrichedExamScheduleItem,
  ExamGapInfo,
  ExtractedExamEntry,
  PreparationAnalysis,
  SavedDatesheet,
} from '../types/datesheet.ts';
import {
  sanitizeDocumentId,
  sanitizeUploadedFilename,
  validateFileMagicBytes,
} from './securityEngine.ts';

export const MAX_DATESHEET_FILES = 6;
export const MAX_DATESHEET_TOTAL_BYTES = 6 * 1024 * 1024; // 6 MB decoded binary total

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const WEEKDAY_ALIASES: Record<string, string> = {
  sun: 'Sunday',
  sunday: 'Sunday',
  mon: 'Monday',
  monday: 'Monday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',
  wed: 'Wednesday',
  wednesday: 'Wednesday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  thursday: 'Thursday',
  fri: 'Friday',
  friday: 'Friday',
  sat: 'Saturday',
  saturday: 'Saturday',
};

export function normalizeWeekdayName(raw?: string): string {
  const clean = (raw || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return WEEKDAY_ALIASES[clean] || (raw || '').trim();
}

export function getTodayIsoDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseStrictIsoDate(dateStr?: string): {
  valid: boolean;
  utcMs: number | null;
  year?: number;
  month?: number;
  day?: number;
} {
  const trimmed = (dateStr || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    return { valid: false, utcMs: null };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { valid: false, utcMs: null };
  }
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return { valid: false, utcMs: null };
  }
  return { valid: true, utcMs: utc, year, month, day };
}

export function getExpectedWeekday(dateStr?: string): string | null {
  const parsed = parseStrictIsoDate(dateStr);
  if (!parsed.valid || parsed.utcMs === null) return null;
  const dayIdx = new Date(parsed.utcMs).getUTCDay();
  return WEEKDAY_NAMES[dayIdx] || null;
}

export function diffCalendarDays(fromIso: string, toIso: string): number | null {
  const a = parseStrictIsoDate(fromIso);
  const b = parseStrictIsoDate(toIso);
  if (!a.valid || !b.valid || a.utcMs === null || b.utcMs === null) return null;
  return Math.round((b.utcMs - a.utcMs) / 86_400_000);
}

export function formatDisplayDate(isoDate?: string): string {
  const parsed = parseStrictIsoDate(isoDate);
  if (!parsed.valid || parsed.utcMs === null) {
    return isoDate?.trim() || 'Date Missing';
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(parsed.day).padStart(2, '0')} ${months[(parsed.month || 1) - 1]} ${parsed.year}`;
}

function parseSingleTimeToMinutes(raw?: string): number | null {
  const s = (raw || '').trim().toLowerCase().replace(/\./g, ':');
  if (!s) return null;
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
  if (!match) return null;
  let hours = Number(match[1]);
  const mins = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (mins < 0 || mins > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  } else if (hours < 0 || hours > 23) {
    return null;
  }
  return hours * 60 + mins;
}

export function parseTimeRangeToMinutes(
  startTime?: string,
  endTime?: string,
  rawTimeText?: string
): {
  startMin: number | null;
  endMin: number | null;
  derivedDurationMinutes: number | null;
} {
  let startMin = parseSingleTimeToMinutes(startTime);
  let endMin = parseSingleTimeToMinutes(endTime);

  if (startMin === null && rawTimeText) {
    const normalized = rawTimeText.replace(/\./g, ':').trim();
    const parts = normalized.split(/\s*(?:-|–|—|to)\s*/i);
    if (parts.length >= 1) {
      startMin = parseSingleTimeToMinutes(parts[0]);
    }
    if (parts.length >= 2 && endMin === null) {
      endMin = parseSingleTimeToMinutes(parts[1]);
    }
  }

  let derivedDurationMinutes: number | null = null;
  if (startMin !== null && endMin !== null && endMin > startMin) {
    derivedDurationMinutes = endMin - startMin;
  }

  return { startMin, endMin, derivedDurationMinutes };
}

export function estimatePdfPageCountFromBase64(cleanBase64: string): number {
  try {
    const normalized = cleanBase64.replace(/\s+/g, '');
    let text = '';
    if (typeof Buffer !== 'undefined') {
      text = Buffer.from(normalized, 'base64').toString('latin1');
    } else if (normalized.length <= 400_000) {
      text = atob(normalized);
    } else {
      // Avoid exceeding Edge Worker CPU limits by inspecting head/tail slices only on large PDFs
      const head = atob(normalized.slice(0, 120_000));
      const tailLen = 120_000 - (120_000 % 4);
      const tailStart = Math.max(0, normalized.length - tailLen);
      const alignedStart = tailStart - (tailStart % 4);
      const tail = atob(normalized.slice(alignedStart));
      text = `${head}\n${tail}`;
    }
    const countMatch = text.match(/\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/);
    if (countMatch && Number(countMatch[1]) > 0) {
      return Math.min(200, Number(countMatch[1]));
    }
    const matches = text.match(/\/Type\s*\/Page\b(?!s)/g);
    return matches && matches.length > 0 ? matches.length : 1;
  } catch {
    return 1;
  }
}

export function computeResizedImageDimensions(
  width: number,
  height: number,
  maxDimension = 2048
): { width: number; height: number; resized: boolean } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0, resized: false };
  }
  const largestSide = Math.max(width, height);
  if (largestSide <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height), resized: false };
  }
  const scale = maxDimension / largestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

export function validateDatesheetUploadBatch(
  files: Array<{
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    pageCount?: number;
    dataBase64: string;
  }>
): {
  valid: boolean;
  sanitizedFiles?: DatesheetUploadAttachment[];
  error?: string;
} {
  if (!Array.isArray(files) || files.length === 0) {
    return { valid: false, error: 'Please upload a PDF or at least one JPG/PNG image of your exam datesheet.' };
  }
  if (files.length > MAX_DATESHEET_FILES) {
    return {
      valid: false,
      error: `You can upload up to ${MAX_DATESHEET_FILES} files per analysis.`,
    };
  }

  let totalBytes = 0;
  let pdfCount = 0;
  const sanitizedFiles: DatesheetUploadAttachment[] = [];

  for (const file of files) {
    const nameCheck = sanitizeUploadedFilename(file.fileName);
    if (!nameCheck.valid || !nameCheck.sanitizedName) {
      return { valid: false, error: nameCheck.error || 'Invalid uploaded file name.' };
    }

    const rawMime = (file.mimeType || '').trim().toLowerCase();
    const normalizedMime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    if (
      normalizedMime !== 'application/pdf' &&
      normalizedMime !== 'image/jpeg' &&
      normalizedMime !== 'image/png'
    ) {
      return {
        valid: false,
        error: `Unsupported file format for "${nameCheck.sanitizedName}". Upload PDF, JPG, JPEG, or PNG only.`,
      };
    }

    const cleanBase64 = (file.dataBase64 || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
    if (!cleanBase64) {
      return { valid: false, error: `Uploaded file "${nameCheck.sanitizedName}" appears empty.` };
    }

    const estimatedBytes = Math.floor((cleanBase64.length * 3) / 4);
    const reportedBytes = Number(file.sizeBytes) > 0 ? Number(file.sizeBytes) : estimatedBytes;
    const effectiveBytes = Math.max(reportedBytes, estimatedBytes);
    if (effectiveBytes <= 0) {
      return { valid: false, error: `Uploaded file "${nameCheck.sanitizedName}" is empty.` };
    }

    totalBytes += effectiveBytes;
    if (totalBytes > MAX_DATESHEET_TOTAL_BYTES) {
      return {
        valid: false,
        error: 'Total uploaded datesheet size exceeds 6 MB. Please compress or split smaller pages.',
      };
    }

    const magicCheck = validateFileMagicBytes(normalizedMime, cleanBase64);
    if (!magicCheck.valid || !magicCheck.detectedType) {
      return { valid: false, error: magicCheck.error || `Invalid signature for "${nameCheck.sanitizedName}".` };
    }

    if (magicCheck.detectedType === 'application/pdf') {
      pdfCount += 1;
      if (pdfCount > 1 || files.length > 1) {
        return {
          valid: false,
          error: 'Upload either a single PDF (multi-page supported) OR multiple JPG/PNG image pages at once.',
        };
      }
    }

    const pageCount =
      magicCheck.detectedType === 'application/pdf'
        ? Math.max(1, file.pageCount || estimatePdfPageCountFromBase64(cleanBase64))
        : 1;

    sanitizedFiles.push({
      fileName: nameCheck.sanitizedName,
      mimeType: magicCheck.detectedType,
      sizeBytes: reportedBytes,
      pageCount,
      dataBase64: cleanBase64,
    });
  }

  return { valid: true, sanitizedFiles };
}

export function sortExamEntriesChronologically(entries: ExtractedExamEntry[]): ExtractedExamEntry[] {
  return [...entries].sort((a, b) => {
    const pa = parseStrictIsoDate(a.date);
    const pb = parseStrictIsoDate(b.date);

    if (pa.valid && pb.valid && pa.utcMs !== null && pb.utcMs !== null) {
      if (pa.utcMs !== pb.utcMs) return pa.utcMs - pb.utcMs;
      const ta = parseTimeRangeToMinutes(a.startTime, a.endTime, a.rawTimeText).startMin ?? 9999;
      const tb = parseTimeRangeToMinutes(b.startTime, b.endTime, b.rawTimeText).startMin ?? 9999;
      if (ta !== tb) return ta - tb;
      return a.subject.localeCompare(b.subject);
    }
    if (pa.valid && !pb.valid) return -1;
    if (!pa.valid && pb.valid) return 1;
    return a.subject.localeCompare(b.subject);
  });
}

/**
 * Validates datesheet metadata and extracted entries WITHOUT silently modifying any fields.
 */
export function validateExtractedDatesheet(
  metadata: DatesheetMetadata,
  entries: ExtractedExamEntry[]
): DatesheetValidationWarning[] {
  const warnings: DatesheetValidationWarning[] = [];

  if (metadata.isUncertain || metadata.uncertaintyReasons.length > 0) {
    warnings.push({
      id: 'warn_metadata_uncertain',
      severity: 'warning',
      code: 'UNCERTAIN_FIELD',
      message:
        metadata.uncertaintyReasons[0] ||
        'Some datesheet header details (exam name, board, or class) were unclear in the document. Please review and confirm.',
    });
  }

  const seenSubjectKeys = new Map<string, ExtractedExamEntry>();
  const entriesByDate = new Map<string, ExtractedExamEntry[]>();

  for (const entry of entries) {
    const subjTrimmed = (entry.subject || '').trim();
    const dateTrimmed = (entry.date || '').trim();

    if (!subjTrimmed) {
      warnings.push({
        id: `warn_missing_subject_${entry.id}`,
        severity: 'error',
        code: 'MISSING_SUBJECT',
        message: `Exam row${dateTrimmed ? ` on ${dateTrimmed}` : ''} is missing a subject name.`,
        entryId: entry.id,
      });
    }

    if (!dateTrimmed) {
      warnings.push({
        id: `warn_missing_date_${entry.id}`,
        severity: 'error',
        code: 'MISSING_DATE',
        message: `${subjTrimmed || 'An exam entry'} is missing an exam date.`,
        entryId: entry.id,
      });
    } else {
      const parsedDate = parseStrictIsoDate(dateTrimmed);
      if (!parsedDate.valid) {
        warnings.push({
          id: `warn_invalid_date_${entry.id}`,
          severity: 'error',
          code: 'INVALID_DATE_FORMAT',
          message: `${subjTrimmed || 'Exam'} has an invalid date ("${dateTrimmed}"). Use YYYY-MM-DD format.`,
          entryId: entry.id,
        });
      } else {
        const expectedWeekday = getExpectedWeekday(dateTrimmed);
        const extractedWeekday = normalizeWeekdayName(entry.weekday);
        if (extractedWeekday && expectedWeekday && extractedWeekday !== expectedWeekday) {
          warnings.push({
            id: `warn_weekday_mismatch_${entry.id}`,
            severity: 'warning',
            code: 'WEEKDAY_MISMATCH',
            message: `${subjTrimmed || 'Exam'} on ${formatDisplayDate(dateTrimmed)} lists "${entry.weekday}", which is actually a ${expectedWeekday}.`,
            entryId: entry.id,
          });
        }

        const bucket = entriesByDate.get(dateTrimmed) || [];
        bucket.push(entry);
        entriesByDate.set(dateTrimmed, bucket);
      }
    }

    const parsedTiming = parseTimeRangeToMinutes(entry.startTime, entry.endTime, entry.rawTimeText);
    if (parsedTiming.startMin === null) {
      warnings.push({
        id: `warn_unclear_timing_${entry.id}`,
        severity: 'warning',
        code: 'UNCLEAR_TIMING',
        message: `${subjTrimmed || 'Exam'} has missing or unclear exam start timing.`,
        entryId: entry.id,
      });
    }

    if (entry.isUncertain) {
      warnings.push({
        id: `warn_uncertain_${entry.id}`,
        severity: 'warning',
        code: 'UNCERTAIN_FIELD',
        message:
          entry.uncertaintyReason ||
          `${subjTrimmed || 'This entry'} had low extraction confidence—please verify against the original datesheet.`,
        entryId: entry.id,
      });
    }

    if (subjTrimmed) {
      const dupKey = `${subjTrimmed.toLowerCase()}__${entry.entryType || 'theory'}`;
      const existing = seenSubjectKeys.get(dupKey);
      if (existing) {
        warnings.push({
          id: `warn_duplicate_${entry.id}`,
          severity: 'warning',
          code: 'DUPLICATE_EXAM',
          message: `Duplicate exam entry detected for "${subjTrimmed}" (${entry.entryType}).`,
          entryId: entry.id,
        });
      } else {
        seenSubjectKeys.set(dupKey, entry);
      }
    }
  }

  // Time conflict check on same calendar date
  for (const [dateStr, dayEntries] of entriesByDate.entries()) {
    if (dayEntries.length < 2) continue;
    for (let i = 0; i < dayEntries.length; i += 1) {
      for (let j = i + 1; j < dayEntries.length; j += 1) {
        const a = dayEntries[i];
        const b = dayEntries[j];
        const ta = parseTimeRangeToMinutes(a.startTime, a.endTime, a.rawTimeText);
        const tb = parseTimeRangeToMinutes(b.startTime, b.endTime, b.rawTimeText);

        let overlaps = false;
        if (ta.startMin !== null && tb.startMin !== null) {
          const aEnd = ta.endMin ?? ta.startMin + (a.durationMinutes || 180);
          const bEnd = tb.endMin ?? tb.startMin + (b.durationMinutes || 180);
          overlaps = ta.startMin < bEnd && tb.startMin < aEnd;
        } else {
          // Both on same date with unclear times -> warn student about potential clash
          overlaps = true;
        }

        if (overlaps) {
          warnings.push({
            id: `warn_conflict_${a.id}_${b.id}`,
            severity: a.entryType === 'optional' || b.entryType === 'optional' ? 'warning' : 'error',
            code: 'CONFLICTING_TIME_SLOT',
            message: `Scheduling conflict on ${formatDisplayDate(dateStr)}: "${a.subject || 'Subject 1'}" and "${b.subject || 'Subject 2'}" overlap or share the same date slot.`,
            entryId: b.id,
          });
        }
      }
    }
  }

  // Tight/consecutive exam gap notices
  const sortedScheduled = sortExamEntriesChronologically(entries).filter(
    (e) => parseStrictIsoDate(e.date).valid
  );
  for (let i = 1; i < sortedScheduled.length; i += 1) {
    const prev = sortedScheduled[i - 1];
    const curr = sortedScheduled[i];
    const calDiff = diffCalendarDays(prev.date, curr.date);
    if (calDiff !== null && calDiff > 0 && calDiff <= 2) {
      const prepDays = calDiff - 1;
      warnings.push({
        id: `warn_tight_gap_${curr.id}`,
        severity: 'info',
        code: 'TIGHT_GAP',
        message:
          prepDays === 0
            ? `Consecutive exam dates: ${prev.subject || 'Previous'} (${formatDisplayDate(prev.date)}) → ${curr.subject || 'Next'} (${formatDisplayDate(curr.date)}) with 0 full prep days between.`
            : `Tight 1-day gap between ${prev.subject || 'Previous'} (${formatDisplayDate(prev.date)}) and ${curr.subject || 'Next'} (${formatDisplayDate(curr.date)}).`,
        entryId: curr.id,
      });
    }
  }

  return warnings;
}

export function canConfirmDatesheet(
  metadata: DatesheetMetadata,
  entries: ExtractedExamEntry[],
  warnings: DatesheetValidationWarning[]
): {
  canConfirm: boolean;
  blockers: string[];
  warningCount: number;
} {
  const blockers: string[] = [];
  if (!metadata.examName.trim()) {
    blockers.push('Enter an examination name before confirming.');
  }
  if (entries.length === 0) {
    blockers.push('Add at least one subject exam entry before confirming.');
  }
  const blockingErrors = warnings.filter(
    (w) =>
      w.severity === 'error' &&
      (w.code === 'MISSING_SUBJECT' ||
        w.code === 'MISSING_DATE' ||
        w.code === 'INVALID_DATE_FORMAT')
  );
  if (blockingErrors.length > 0) {
    blockers.push(
      `Resolve ${blockingErrors.length} missing or invalid subject/date error${blockingErrors.length === 1 ? '' : 's'} first.`
    );
  }

  const warningCount = warnings.filter((w) => w.severity !== 'info').length;
  return {
    canConfirm: blockers.length === 0,
    blockers,
    warningCount,
  };
}

export function buildEnrichedSchedule(
  entries: ExtractedExamEntry[],
  referenceDateStr = getTodayIsoDate()
): EnrichedExamScheduleItem[] {
  const sorted = sortExamEntriesChronologically(entries);
  let nextUpcomingAssigned = false;

  return sorted.map((entry, idx) => {
    const validDate = parseStrictIsoDate(entry.date).valid;
    const daysRemaining = validDate ? diffCalendarDays(referenceDateStr, entry.date) : null;

    let status: EnrichedExamScheduleItem['status'] = 'unscheduled';
    if (daysRemaining !== null) {
      if (daysRemaining > 0) status = 'upcoming';
      else if (daysRemaining === 0) status = 'today';
      else status = 'past';
    }

    let isNextUpcoming = false;
    if (!nextUpcomingAssigned && daysRemaining !== null && daysRemaining >= 0) {
      isNextUpcoming = true;
      nextUpcomingAssigned = true;
    }

    const prev = idx > 0 ? sorted[idx - 1] : null;
    const prevValid = prev && parseStrictIsoDate(prev.date).valid;
    const calendarDaysFromPrevious =
      validDate && prevValid ? diffCalendarDays(prev!.date, entry.date) : null;
    const prepDaysFromPrevious =
      calendarDaysFromPrevious !== null
        ? calendarDaysFromPrevious === 0
          ? 0
          : Math.max(0, calendarDaysFromPrevious - 1)
        : null;

    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;
    const nextValid = next && parseStrictIsoDate(next.date).valid;
    const calendarDaysUntilNext =
      validDate && nextValid ? diffCalendarDays(entry.date, next!.date) : null;
    const prepDaysUntilNext =
      calendarDaysUntilNext !== null
        ? calendarDaysUntilNext === 0
          ? 0
          : Math.max(0, calendarDaysUntilNext - 1)
        : null;

    return {
      entry,
      daysRemaining,
      status,
      isNextUpcoming,
      previousExamSubject: prev ? prev.subject : null,
      previousExamDate: prev && prevValid ? prev.date : null,
      calendarDaysFromPrevious,
      prepDaysFromPrevious,
      nextExamSubject: next ? next.subject : null,
      calendarDaysUntilNext,
      prepDaysUntilNext,
    };
  });
}

export function computePreparationAnalysis(
  entries: ExtractedExamEntry[],
  referenceDateStr = getTodayIsoDate()
): PreparationAnalysis {
  const enriched = buildEnrichedSchedule(entries, referenceDateStr);
  const scheduled = enriched.filter((item) => parseStrictIsoDate(item.entry.date).valid);
  const upcoming = scheduled.filter(
    (item) => item.daysRemaining !== null && item.daysRemaining >= 0
  );

  const first = scheduled[0] || null;
  const last = scheduled.length > 0 ? scheduled[scheduled.length - 1] : null;
  const nextUpcoming = upcoming[0] || null;

  let totalSpanDays: number | null = null;
  if (scheduled.length >= 2) {
    const span = diffCalendarDays(
      scheduled[0].entry.date,
      scheduled[scheduled.length - 1].entry.date
    );
    totalSpanDays = span !== null ? span + 1 : null;
  } else if (scheduled.length === 1) {
    totalSpanDays = 1;
  }

  const gapPairs: ExamGapInfo[] = [];
  const consecutiveExamPairs: PreparationAnalysis['consecutiveExamPairs'] = [];

  for (let i = 1; i < scheduled.length; i += 1) {
    const prev = scheduled[i - 1].entry;
    const curr = scheduled[i].entry;
    const calDays = diffCalendarDays(prev.date, curr.date);
    if (calDays === null || calDays <= 0) continue;
    const prepDays = Math.max(0, calDays - 1);
    gapPairs.push({
      fromSubject: prev.subject || 'Subject',
      toSubject: curr.subject || 'Subject',
      fromDate: prev.date,
      toDate: curr.date,
      calendarDays: calDays,
      prepDays,
    });
    if (prepDays === 0) {
      consecutiveExamPairs.push({
        firstSubject: prev.subject || 'Subject',
        firstDate: prev.date,
        secondSubject: curr.subject || 'Subject',
        secondDate: curr.date,
      });
    }
  }

  const largestGap =
    gapPairs.length > 0
      ? [...gapPairs].sort((a, b) => b.prepDays - a.prepDays || b.calendarDays - a.calendarDays)[0]
      : null;
  const shortestGap =
    gapPairs.length > 0
      ? [...gapPairs].sort((a, b) => a.prepDays - b.prepDays || a.calendarDays - b.calendarDays)[0]
      : null;

  // Group contiguous runs where prepDays <= 1
  const tightSequences: PreparationAnalysis['tightSequences'] = [];
  let currentRun: ExtractedExamEntry[] = [];
  for (let i = 0; i < scheduled.length; i += 1) {
    const curr = scheduled[i].entry;
    if (currentRun.length === 0) {
      currentRun.push(curr);
      continue;
    }
    const prev = currentRun[currentRun.length - 1];
    const calDiff = diffCalendarDays(prev.date, curr.date);
    if (calDiff !== null && calDiff >= 0 && calDiff <= 2) {
      currentRun.push(curr);
    } else {
      if (currentRun.length >= 2) {
        tightSequences.push({
          subjects: currentRun.map((e) => e.subject || 'Exam'),
          startDate: currentRun[0].date,
          endDate: currentRun[currentRun.length - 1].date,
          note: `${currentRun.length} exams compressed with 0–1 prep days between papers.`,
        });
      }
      currentRun = [curr];
    }
  }
  if (currentRun.length >= 2) {
    tightSequences.push({
      subjects: currentRun.map((e) => e.subject || 'Exam'),
      startDate: currentRun[0].date,
      endDate: currentRun[currentRun.length - 1].date,
      note: `${currentRun.length} exams compressed with 0–1 prep days between papers.`,
    });
  }

  let overallSummary = 'No valid exam dates have been scheduled yet.';
  if (scheduled.length > 0) {
    const parts: string[] = [];
    parts.push(`${scheduled.length} dated exam${scheduled.length === 1 ? '' : 's'} organized chronologically`);
    if (nextUpcoming && nextUpcoming.daysRemaining !== null) {
      parts.push(
        nextUpcoming.daysRemaining === 0
          ? `next exam (${nextUpcoming.entry.subject}) is today`
          : `next exam (${nextUpcoming.entry.subject}) is in ${nextUpcoming.daysRemaining} day${nextUpcoming.daysRemaining === 1 ? '' : 's'}`
      );
    } else {
      parts.push('all listed exam dates are earlier than today');
    }
    if (consecutiveExamPairs.length > 0) {
      parts.push(
        `${consecutiveExamPairs.length} back-to-back exam pair${consecutiveExamPairs.length === 1 ? '' : 's'} with zero gap days`
      );
    }
    overallSummary = `${parts.join(', ')}.`;
  }

  return {
    totalExams: entries.length,
    scheduledExamsCount: scheduled.length,
    upcomingExamsCount: upcoming.length,
    firstExam: first
      ? {
          id: first.entry.id,
          subject: first.entry.subject,
          date: first.entry.date,
          weekday: first.entry.weekday || getExpectedWeekday(first.entry.date) || '',
        }
      : null,
    lastExam: last
      ? {
          id: last.entry.id,
          subject: last.entry.subject,
          date: last.entry.date,
          weekday: last.entry.weekday || getExpectedWeekday(last.entry.date) || '',
        }
      : null,
    nextUpcomingExam:
      nextUpcoming && nextUpcoming.daysRemaining !== null
        ? {
            id: nextUpcoming.entry.id,
            subject: nextUpcoming.entry.subject,
            date: nextUpcoming.entry.date,
            weekday:
              nextUpcoming.entry.weekday || getExpectedWeekday(nextUpcoming.entry.date) || '',
            daysRemaining: nextUpcoming.daysRemaining,
            rawTimeText: nextUpcoming.entry.rawTimeText,
          }
        : null,
    prepDaysUntilFirstOrNext: nextUpcoming?.daysRemaining ?? null,
    totalSpanDays,
    consecutiveExamPairs,
    largestGap,
    shortestGap,
    tightSequences,
    overallSummary,
  };
}

export function buildDatesheetIntelligence(
  metadata: DatesheetMetadata,
  entries: ExtractedExamEntry[],
  options?: {
    documentReadable?: boolean;
    extractionSummary?: string;
    referenceDateStr?: string;
  }
): DatesheetIntelligence {
  const analysis = computePreparationAnalysis(entries, options?.referenceDateStr);
  const enriched = buildEnrichedSchedule(entries, options?.referenceDateStr);
  const warnings = validateExtractedDatesheet(metadata, entries);

  const weekdayMismatchCount = warnings.filter((w) => w.code === 'WEEKDAY_MISMATCH').length;
  const duplicateOrConflictCount = warnings.filter(
    (w) => w.code === 'DUPLICATE_EXAM' || w.code === 'CONFLICTING_TIME_SLOT'
  ).length;
  const uncertainCount =
    entries.filter((e) => e.isUncertain).length + (metadata.isUncertain ? 1 : 0);

  return {
    documentReadable: options?.documentReadable ?? entries.length > 0,
    extractionSummary: options?.extractionSummary?.trim() || analysis.overallSummary,
    numberOfExaminations: analysis.totalExams,
    firstExam: analysis.firstExam,
    lastExam: analysis.lastExam,
    chronologicalSequence: enriched.map((item) => ({
      id: item.entry.id,
      subject: item.entry.subject,
      date: item.entry.date,
      weekday: item.entry.weekday || getExpectedWeekday(item.entry.date) || '',
      entryType: item.entry.entryType,
      prepDaysFromPrevious: item.prepDaysFromPrevious,
    })),
    consecutiveExamPairs: analysis.consecutiveExamPairs,
    tightSequences: analysis.tightSequences,
    weekdayMismatchCount,
    duplicateOrConflictCount,
    uncertainCount,
    warnings,
  };
}

export interface DashboardExamAlert {
  id: string;
  level: 'urgent' | 'warning' | 'info';
  title: string;
  detail: string;
}

export interface DashboardExamSummary {
  confirmedDatesheet: SavedDatesheet | null;
  latestDraftDatesheet: SavedDatesheet | null;
  nextExam: PreparationAnalysis['nextUpcomingExam'];
  upcomingSchedule: EnrichedExamScheduleItem[];
  analysis: PreparationAnalysis | null;
  alerts: DashboardExamAlert[];
}

export function buildDashboardExamSummary(
  datesheets: SavedDatesheet[],
  referenceDateStr = getTodayIsoDate()
): DashboardExamSummary {
  const sortedByUpdated = [...datesheets].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  const confirmedList = sortedByUpdated.filter((d) => d.status === 'confirmed');
  const draftList = sortedByUpdated.filter((d) => d.status === 'draft');

  // Prefer confirmed datesheet that still has upcoming exams, else latest confirmed
  let activeConfirmed: SavedDatesheet | null = null;
  for (const ds of confirmedList) {
    const analysis = computePreparationAnalysis(ds.entries, referenceDateStr);
    if (analysis.upcomingExamsCount > 0) {
      activeConfirmed = ds;
      break;
    }
  }
  if (!activeConfirmed && confirmedList.length > 0) {
    activeConfirmed = confirmedList[0];
  }

  const latestDraft = draftList[0] || null;
  const alerts: DashboardExamAlert[] = [];

  if (!activeConfirmed) {
    if (latestDraft) {
      alerts.push({
        id: 'alert_unconfirmed_draft',
        level: 'warning',
        title: 'Datesheet awaiting your confirmation',
        detail: `"${latestDraft.title}" is saved as a draft. Review extracted dates and confirm it to activate countdowns.`,
      });
    }
    return {
      confirmedDatesheet: null,
      latestDraftDatesheet: latestDraft,
      nextExam: null,
      upcomingSchedule: [],
      analysis: null,
      alerts,
    };
  }

  const enriched = buildEnrichedSchedule(activeConfirmed.entries, referenceDateStr);
  const upcomingSchedule = enriched.filter(
    (item) => item.daysRemaining !== null && item.daysRemaining >= 0
  );
  const analysis = computePreparationAnalysis(activeConfirmed.entries, referenceDateStr);
  const warnings = validateExtractedDatesheet(activeConfirmed.metadata, activeConfirmed.entries);

  if (analysis.nextUpcomingExam) {
    if (analysis.nextUpcomingExam.daysRemaining === 0) {
      alerts.push({
        id: 'alert_exam_today',
        level: 'urgent',
        title: `Exam Today: ${analysis.nextUpcomingExam.subject}`,
        detail: `${formatDisplayDate(analysis.nextUpcomingExam.date)}${analysis.nextUpcomingExam.rawTimeText ? ` • ${analysis.nextUpcomingExam.rawTimeText}` : ''}`,
      });
    } else if (analysis.nextUpcomingExam.daysRemaining <= 7) {
      alerts.push({
        id: 'alert_exam_soon',
        level: 'urgent',
        title: `Next exam in ${analysis.nextUpcomingExam.daysRemaining} day${analysis.nextUpcomingExam.daysRemaining === 1 ? '' : 's'}: ${analysis.nextUpcomingExam.subject}`,
        detail: `Scheduled for ${formatDisplayDate(analysis.nextUpcomingExam.date)} (${analysis.nextUpcomingExam.weekday}).`,
      });
    }
  }

  if (analysis.consecutiveExamPairs.length > 0) {
    const firstPair = analysis.consecutiveExamPairs[0];
    alerts.push({
      id: 'alert_consecutive_exams',
      level: 'warning',
      title: `${analysis.consecutiveExamPairs.length} back-to-back exam sequence${analysis.consecutiveExamPairs.length === 1 ? '' : 's'}`,
      detail: `${firstPair.firstSubject} (${formatDisplayDate(firstPair.firstDate)}) followed immediately by ${firstPair.secondSubject} (${formatDisplayDate(firstPair.secondDate)}) with 0 gap days.`,
    });
  }

  const unresolvedErrorsOrWarnings = warnings.filter((w) => w.severity !== 'info');
  if (unresolvedErrorsOrWarnings.length > 0) {
    alerts.push({
      id: 'alert_schedule_warnings',
      level: 'info',
      title: `${unresolvedErrorsOrWarnings.length} datesheet review note${unresolvedErrorsOrWarnings.length === 1 ? '' : 's'}`,
      detail: unresolvedErrorsOrWarnings[0].message,
    });
  }

  return {
    confirmedDatesheet: activeConfirmed,
    latestDraftDatesheet: latestDraft,
    nextExam: analysis.nextUpcomingExam,
    upcomingSchedule,
    analysis,
    alerts,
  };
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

export function sanitizeDatesheetForStorage(raw: SavedDatesheet): SavedDatesheet {
  const now = new Date().toISOString();
  const safeId = sanitizeDocumentId(raw.id, 'ds');

  const safeEntries: ExtractedExamEntry[] = (Array.isArray(raw.entries) ? raw.entries : [])
    .slice(0, 60)
    .map((entry, idx) => ({
      id: sanitizeDocumentId(entry.id, `ex_${idx + 1}`),
      subject: String(entry.subject || '').trim().slice(0, 140),
      ...(entry.subjectCode?.trim() ? { subjectCode: entry.subjectCode.trim().slice(0, 32) } : {}),
      date: String(entry.date || '').trim().slice(0, 32),
      ...(entry.rawDateText?.trim() ? { rawDateText: entry.rawDateText.trim().slice(0, 64) } : {}),
      weekday: normalizeWeekdayName(entry.weekday).slice(0, 24),
      ...(entry.startTime?.trim() ? { startTime: entry.startTime.trim().slice(0, 24) } : {}),
      ...(entry.endTime?.trim() ? { endTime: entry.endTime.trim().slice(0, 24) } : {}),
      ...(entry.rawTimeText?.trim() ? { rawTimeText: entry.rawTimeText.trim().slice(0, 64) } : {}),
      ...(typeof entry.durationMinutes === 'number' && Number.isFinite(entry.durationMinutes)
        ? { durationMinutes: Math.max(15, Math.min(600, Math.round(entry.durationMinutes))) }
        : {}),
      entryType:
        entry.entryType === 'practical' || entry.entryType === 'optional'
          ? entry.entryType
          : 'theory',
      ...(entry.notes?.trim() ? { notes: entry.notes.trim().slice(0, 300) } : {}),
      isUncertain: Boolean(entry.isUncertain),
      ...(entry.uncertaintyReason?.trim()
        ? { uncertaintyReason: entry.uncertaintyReason.trim().slice(0, 240) }
        : {}),
    }));

  const safeSourceFiles: DatesheetSourceFileMeta[] = (
    Array.isArray(raw.sourceFiles) ? raw.sourceFiles : []
  )
    .slice(0, 10)
    .map((f) => ({
      fileName: String(f.fileName || 'datesheet').slice(0, 140),
      mimeType:
        f.mimeType === 'application/pdf' || f.mimeType === 'image/png'
          ? f.mimeType
          : 'image/jpeg',
      sizeBytes: Math.max(1, Math.round(Number(f.sizeBytes) || 1)),
      pageCount: Math.max(1, Math.min(100, Math.round(Number(f.pageCount) || 1))),
    }));

  const safeTitle = String(
    raw.title || raw.metadata?.examName || 'Exam Datesheet'
  )
    .trim()
    .slice(0, 160);

  return stripUndefinedDeep({
    id: safeId,
    userId: String(raw.userId || '').trim(),
    title: safeTitle || 'Exam Datesheet',
    status: raw.status === 'confirmed' ? 'confirmed' : 'draft',
    metadata: {
      examName: String(raw.metadata?.examName || safeTitle || '').trim().slice(0, 160),
      board: String(raw.metadata?.board || '').trim().slice(0, 80),
      classGrade: String(raw.metadata?.classGrade || '').trim().slice(0, 40),
      academicSession: String(raw.metadata?.academicSession || '').trim().slice(0, 40),
      importantInstructions: (Array.isArray(raw.metadata?.importantInstructions)
        ? raw.metadata.importantInstructions
        : []
      )
        .map((s) => String(s || '').trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 25),
      isUncertain: Boolean(raw.metadata?.isUncertain),
      uncertaintyReasons: (Array.isArray(raw.metadata?.uncertaintyReasons)
        ? raw.metadata.uncertaintyReasons
        : []
      )
        .map((s) => String(s || '').trim().slice(0, 240))
        .filter(Boolean)
        .slice(0, 10),
    },
    entries: safeEntries,
    sourceFiles: safeSourceFiles,
    ...(raw.status === 'confirmed'
      ? { confirmedAt: raw.confirmedAt || now }
      : {}),
    createdAt: raw.createdAt || now,
    updatedAt: now,
  });
}
