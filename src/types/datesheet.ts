export type ExamEntryType = 'theory' | 'practical' | 'optional';

export interface ExtractedExamEntry {
  id: string;
  subject: string;
  subjectCode?: string;
  date: string; // ISO YYYY-MM-DD or '' if unparsed/missing
  rawDateText?: string;
  weekday: string; // e.g. Monday, Tuesday or ''
  startTime?: string; // Normalized 24h HH:MM or readable time
  endTime?: string;
  rawTimeText?: string;
  durationMinutes?: number;
  entryType: ExamEntryType;
  notes?: string;
  isUncertain: boolean;
  uncertaintyReason?: string;
}

export interface DatesheetMetadata {
  examName: string;
  board: string;
  classGrade: string;
  academicSession: string;
  importantInstructions: string[];
  isUncertain: boolean;
  uncertaintyReasons: string[];
}

export interface DatesheetSourceFileMeta {
  fileName: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  sizeBytes: number;
  pageCount: number;
}

export interface DatesheetUploadAttachment {
  fileName: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  sizeBytes: number;
  pageCount: number;
  dataBase64: string;
}

export interface AnalyzeDatesheetRequestPayload {
  files: DatesheetUploadAttachment[];
  studentBoard?: string;
  studentClassGrade?: string;
}

export interface AnalyzeDatesheetResponsePayload {
  metadata: DatesheetMetadata;
  entries: ExtractedExamEntry[];
  sourceFiles: DatesheetSourceFileMeta[];
  analyzedAt: string;
  intelligence?: DatesheetIntelligence;
}

export type DatesheetWarningSeverity = 'error' | 'warning' | 'info';

export type DatesheetWarningCode =
  | 'MISSING_SUBJECT'
  | 'MISSING_DATE'
  | 'INVALID_DATE_FORMAT'
  | 'WEEKDAY_MISMATCH'
  | 'DUPLICATE_EXAM'
  | 'CONFLICTING_TIME_SLOT'
  | 'UNCLEAR_TIMING'
  | 'TIGHT_GAP'
  | 'UNCERTAIN_FIELD';

export interface DatesheetValidationWarning {
  id: string;
  severity: DatesheetWarningSeverity;
  code: DatesheetWarningCode;
  message: string;
  entryId?: string;
}

export interface DatesheetIntelligence {
  documentReadable: boolean;
  extractionSummary: string;
  numberOfExaminations: number;
  firstExam: {
    id: string;
    subject: string;
    date: string;
    weekday: string;
  } | null;
  lastExam: {
    id: string;
    subject: string;
    date: string;
    weekday: string;
  } | null;
  chronologicalSequence: Array<{
    id: string;
    subject: string;
    date: string;
    weekday: string;
    entryType: ExamEntryType;
    prepDaysFromPrevious: number | null;
  }>;
  consecutiveExamPairs: PreparationAnalysis['consecutiveExamPairs'];
  tightSequences: PreparationAnalysis['tightSequences'];
  weekdayMismatchCount: number;
  duplicateOrConflictCount: number;
  uncertainCount: number;
  warnings: DatesheetValidationWarning[];
}

export interface EnrichedExamScheduleItem {
  entry: ExtractedExamEntry;
  daysRemaining: number | null;
  status: 'upcoming' | 'today' | 'past' | 'unscheduled';
  isNextUpcoming: boolean;
  previousExamSubject: string | null;
  previousExamDate: string | null;
  calendarDaysFromPrevious: number | null;
  prepDaysFromPrevious: number | null;
  nextExamSubject: string | null;
  calendarDaysUntilNext: number | null;
  prepDaysUntilNext: number | null;
}

export interface ExamGapInfo {
  fromSubject: string;
  toSubject: string;
  fromDate: string;
  toDate: string;
  calendarDays: number;
  prepDays: number;
}

export interface PreparationAnalysis {
  totalExams: number;
  scheduledExamsCount: number;
  upcomingExamsCount: number;
  firstExam: {
    id: string;
    subject: string;
    date: string;
    weekday: string;
  } | null;
  lastExam: {
    id: string;
    subject: string;
    date: string;
    weekday: string;
  } | null;
  nextUpcomingExam: {
    id: string;
    subject: string;
    date: string;
    weekday: string;
    daysRemaining: number;
    rawTimeText?: string;
  } | null;
  prepDaysUntilFirstOrNext: number | null;
  totalSpanDays: number | null;
  consecutiveExamPairs: Array<{
    firstSubject: string;
    firstDate: string;
    secondSubject: string;
    secondDate: string;
  }>;
  largestGap: ExamGapInfo | null;
  shortestGap: ExamGapInfo | null;
  tightSequences: Array<{
    subjects: string[];
    startDate: string;
    endDate: string;
    note: string;
  }>;
  overallSummary: string;
}

export type DatesheetStatus = 'draft' | 'confirmed';

export interface SavedDatesheet {
  id: string;
  userId: string;
  title: string;
  status: DatesheetStatus;
  metadata: DatesheetMetadata;
  entries: ExtractedExamEntry[];
  sourceFiles: DatesheetSourceFileMeta[];
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamActivityItem {
  id: string;
  userId: string;
  datesheetId: string;
  action: 'analyzed' | 'saved_draft' | 'confirmed' | 'updated' | 'deleted';
  title: string;
  detail: string;
  timestamp: string;
}
