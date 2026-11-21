import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  Type,
  type SafetySetting,
  type Schema,
} from '@google/genai';
import type {
  AnalyzeDatesheetRequestPayload,
  AnalyzeDatesheetResponsePayload,
  DatesheetMetadata,
  ExtractedExamEntry,
} from '../src/types/datesheet.ts';
import {
  buildDatesheetIntelligence,
  normalizeWeekdayName,
  parseTimeRangeToMinutes,
  validateDatesheetUploadBatch,
} from '../src/utils/datesheetEngine.ts';
import { sanitizeDocumentId } from '../src/utils/securityEngine.ts';

export const GEMINI_MODEL = 'gemini-4-hydrogen';
export const GEMINI_FAST_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_TIMEOUT_MS = 40_000;
const GEMINI_FALLBACK_TIMEOUT_MS = 75_000;

const K12_SAFETY_SETTINGS: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE },
];

export class GeminiServiceError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;

  constructor(statusCode: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = 'GeminiServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  return Boolean((process.env.GEMINI_API_KEY || '').trim());
}

export function mapGeminiError(error: unknown): GeminiServiceError {
  if (error instanceof GeminiServiceError) return error;

  const rawMsg = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
  const causeCode = String(cause?.code || (error as { code?: string })?.code || '');
  const causeMsg = String(cause?.message || '');
  const combinedMsg = `${rawMsg} ${causeCode} ${causeMsg}`.trim();
  const status =
    typeof (error as any)?.status === 'number'
      ? (error as any).status
      : typeof (error as any)?.statusCode === 'number'
        ? (error as any).statusCode
        : undefined;

  if (
    rawMsg.includes('MODEL_TIMEOUT') ||
    /timeout|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/i.test(combinedMsg) ||
    (error as any)?.name === 'AbortError' ||
    rawMsg.toLowerCase().includes('aborted')
  ) {
    return new GeminiServiceError(
      504,
      'MODEL_TIMEOUT',
      'Datesheet analysis timed out waiting for the AI model. Please try a clearer or smaller PDF/image and retry.',
      true
    );
  }

  if (
    status === 503 ||
    rawMsg.includes('"code":503') ||
    rawMsg.includes('UNAVAILABLE') ||
    /high demand|temporarily unavailable|overloaded|service unavailable|try again later/i.test(rawMsg)
  ) {
    return new GeminiServiceError(
      503,
      'MODEL_OVERLOADED',
      'The AI model is experiencing temporary high demand right now. Please wait a few seconds and retry.',
      true
    );
  }

  if (status === 429 || rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('429')) {
    return new GeminiServiceError(
      429,
      'RATE_LIMIT_EXCEEDED',
      'AI usage quota or rate limit was reached right now. Please wait a few seconds and try again.',
      true
    );
  }

  if (status === 400 && (rawMsg.includes('API_KEY_INVALID') || rawMsg.toLowerCase().includes('api key'))) {
    return new GeminiServiceError(
      403,
      'API_KEY_INVALID',
      'The server Gemini API key appears invalid. Please verify GEMINI_API_KEY in Settings > Secrets.',
      false
    );
  }

  if (status === 403 || rawMsg.includes('PERMISSION_DENIED')) {
    return new GeminiServiceError(
      403,
      'PERMISSION_DENIED',
      'Gemini API access was denied for the configured key. Please verify permissions in Settings > Secrets.',
      false
    );
  }

  if (status === 404 || rawMsg.includes('NOT_FOUND')) {
    return new GeminiServiceError(
      502,
      'MODEL_NOT_FOUND',
      `Configured AI model (${GEMINI_MODEL}) was not found or unavailable.`,
      false
    );
  }

  if (status === 400 || rawMsg.includes('INVALID_ARGUMENT')) {
    return new GeminiServiceError(
      400,
      'INVALID_REQUEST',
      'The AI service could not read that datesheet file format. Please upload a crisp PDF, JPG, or PNG.',
      false
    );
  }

  if (
    /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|network|socket hang up/i.test(
      combinedMsg
    )
  ) {
    console.warn('[Gemini Upstream Network Error]', combinedMsg.slice(0, 320));
    return new GeminiServiceError(
      502,
      'GEMINI_UPSTREAM_UNREACHABLE',
      'The backend could not reach Google Gemini API right now. Please retry in a few seconds.',
      true
    );
  }

  console.warn('[Gemini Unmapped Upstream Error]', combinedMsg.slice(0, 320));
  return new GeminiServiceError(
    502,
    'AI_GENERATION_FAILED',
    'Unable to complete datesheet extraction right now due to a temporary upstream error. Please retry.',
    true
  );
}

const DATESHEET_SCHEMA_SDK: Schema = {
  type: Type.OBJECT,
  properties: {
    examinationName: {
      type: Type.STRING,
      description: 'Official examination title shown on the datesheet, or empty string if absent.',
    },
    board: {
      type: Type.STRING,
      description: 'Education board or school name printed on the datesheet (e.g. CBSE, ICSE, ISC, State Board), or empty string if not shown.',
    },
    classGrade: {
      type: Type.STRING,
      description: 'Class or grade printed on the datesheet (e.g. Class 10, Class 12), or empty string if not printed.',
    },
    academicSession: {
      type: Type.STRING,
      description: 'Academic year/session printed on the datesheet (e.g. 2025-26), or empty string if absent.',
    },
    importantInstructions: {
      type: Type.ARRAY,
      description: 'Key official examination instructions printed on the datesheet, if present.',
      items: { type: Type.STRING },
    },
    metadataUncertain: {
      type: Type.BOOLEAN,
      description: 'True if any header metadata (exam name, board, class, session) was blurry, cut off, or ambiguous.',
    },
    metadataUncertaintyReason: {
      type: Type.STRING,
      description: 'Brief explanation if metadataUncertain is true.',
    },
    documentReadable: {
      type: Type.BOOLEAN,
      description: 'True if at least one exam schedule table or paper entry is legible as a datesheet; false if blank, corrupted, illegible, or unrelated to an exam schedule.',
    },
    extractionSummary: {
      type: Type.STRING,
      description: 'Concise factual summary of what schedule details were extracted and any unclear sections.',
    },
    entries: {
      type: Type.ARRAY,
      description: 'All examination entries extracted from every page of the datesheet.',
      items: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING, description: 'Subject name as printed on the datesheet.' },
          subjectCode: { type: Type.STRING, description: 'Subject code if printed, else empty string.' },
          date: {
            type: Type.STRING,
            description: 'ISO date YYYY-MM-DD when clearly readable, or empty string if missing or illegible.',
          },
          rawDateText: { type: Type.STRING, description: 'Original date text exactly as printed.' },
          weekday: { type: Type.STRING, description: 'Weekday printed on the datesheet (e.g. Monday), or empty string.' },
          startTime: { type: Type.STRING, description: 'Start time as printed (e.g. 10:30 AM), or empty string if not shown.' },
          endTime: { type: Type.STRING, description: 'End time as printed (e.g. 01:30 PM), or empty string if not shown.' },
          rawTimeText: { type: Type.STRING, description: 'Full timing string as printed, or empty string.' },
          durationMinutes: {
            type: Type.NUMBER,
            description: 'Duration in minutes ONLY if explicitly stated or directly computable from printed start and end times; omit or 0 otherwise.',
          },
          entryType: {
            type: Type.STRING,
            description: 'One of: theory, practical, optional.',
          },
          notes: { type: Type.STRING, description: 'Any printed note specific to this exam row, else empty string.' },
          isUncertain: {
            type: Type.BOOLEAN,
            description: 'True if any part of this row (subject, date, weekday, time) was blurry, cropped, handwritten, or ambiguous.',
          },
          uncertaintyReason: {
            type: Type.STRING,
            description: 'Short explanation of what was uncertain when isUncertain is true.',
          },
        },
        required: ['subject', 'date', 'weekday', 'entryType', 'isUncertain'],
      },
    },
  },
  required: [
    'examinationName',
    'board',
    'classGrade',
    'academicSession',
    'importantInstructions',
    'metadataUncertain',
    'documentReadable',
    'entries',
  ],
};

export interface RawGeminiDatesheetResult {
  examinationName?: string;
  board?: string;
  classGrade?: string;
  academicSession?: string;
  importantInstructions?: string[];
  metadataUncertain?: boolean;
  metadataUncertaintyReason?: string;
  documentReadable?: boolean;
  extractionSummary?: string;
  entries?: Array<{
    subject?: string;
    subjectCode?: string;
    date?: string;
    rawDateText?: string;
    weekday?: string;
    startTime?: string;
    endTime?: string;
    rawTimeText?: string;
    durationMinutes?: number;
    entryType?: string;
    notes?: string;
    isUncertain?: boolean;
    uncertaintyReason?: string;
  }>;
}

export function buildDatesheetExtractionSystemInstruction(context?: {
  studentBoard?: string;
  studentClassGrade?: string;
}): string {
  return [
    'You are an academic exam datesheet extraction engine for Indian school students (Class 6 to Class 12).',
    'Your task is to inspect every page of the uploaded PDF or image datesheet and extract the exam schedule accurately as structured JSON.',
    '',
    'CRITICAL EXTRACTION RULES:',
    '1. Extract ONLY information that is actually visible in the uploaded document(s).',
    '2. NEVER invent, fabricate, or guess missing dates, subject names, subject codes, timings, boards, classes, or instructions.',
    '3. If any date, weekday, time, subject name, or header field is blurry, cropped, smudged, cut off, or ambiguous, leave uncertain subfields empty or preserve raw text AND set isUncertain: true (or metadataUncertain: true) with a clear uncertaintyReason explaining what needs student verification.',
    '4. Convert clearly readable dates into ISO YYYY-MM-DD in the `date` field while also keeping `rawDateText` as printed. If year is not explicitly shown, set isUncertain: true and explain.',
    '5. Keep `weekday` as printed on the sheet (do not silently alter a misprinted weekday—validation will flag mismatches for the student).',
    '6. Include theory exams, practical exams (`entryType: "practical"`), and optional/elective subjects (`entryType: "optional"`) when present.',
    '7. Extract `durationMinutes` ONLY when explicitly printed or directly calculable from clear startTime and endTime. Otherwise omit or return 0.',
    context?.studentBoard || context?.studentClassGrade
      ? `Student profile context (for disambiguation ONLY if printed on multi-class sheets, never invent): Board=${context.studentBoard || 'Unknown'}, Class=${context.studentClassGrade || 'Unknown'}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function normalizeRawDatesheetExtraction(
  parsed: RawGeminiDatesheetResult,
  sourceFiles: AnalyzeDatesheetResponsePayload['sourceFiles']
): AnalyzeDatesheetResponsePayload {
  const uncertaintyReasons: string[] = [];
  if (parsed.metadataUncertain && parsed.metadataUncertaintyReason?.trim()) {
    uncertaintyReasons.push(parsed.metadataUncertaintyReason.trim().slice(0, 240));
  }

  const metadata: DatesheetMetadata = {
    examName: (parsed.examinationName || '').trim().slice(0, 160),
    board: (parsed.board || '').trim().slice(0, 80),
    classGrade: (parsed.classGrade || '').trim().slice(0, 40),
    academicSession: (parsed.academicSession || '').trim().slice(0, 40),
    importantInstructions: Array.isArray(parsed.importantInstructions)
      ? parsed.importantInstructions
          .map((item) => String(item || '').trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, 25)
      : [],
    isUncertain: Boolean(parsed.metadataUncertain || !parsed.examinationName?.trim()),
    uncertaintyReasons:
      uncertaintyReasons.length > 0
        ? uncertaintyReasons
        : !parsed.examinationName?.trim()
          ? ['Examination title was not clearly detected in the uploaded document; please confirm or enter it below.']
          : [],
  };

  const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const entries: ExtractedExamEntry[] = rawEntries.slice(0, 60).map((item, idx) => {
    const rawType = String(item.entryType || '').trim().toLowerCase();
    const entryType: ExtractedExamEntry['entryType'] =
      rawType === 'practical' ? 'practical' : rawType === 'optional' ? 'optional' : 'theory';

    const startTime = item.startTime?.trim() ? item.startTime.trim().slice(0, 24) : '';
    const endTime = item.endTime?.trim() ? item.endTime.trim().slice(0, 24) : '';
    const rawTimeText = item.rawTimeText?.trim()
      ? item.rawTimeText.trim().slice(0, 64)
      : startTime && endTime
        ? `${startTime} - ${endTime}`.slice(0, 64)
        : '';

    const parsedDuration = parseTimeRangeToMinutes(startTime, endTime, rawTimeText).derivedDurationMinutes;
    const explicitDur =
      typeof item.durationMinutes === 'number' &&
      Number.isFinite(item.durationMinutes) &&
      item.durationMinutes >= 15 &&
      item.durationMinutes <= 600
        ? Math.round(item.durationMinutes)
        : undefined;
    const dur =
      explicitDur ||
      (parsedDuration && parsedDuration >= 15 && parsedDuration <= 600 ? parsedDuration : undefined);

    return {
      id: sanitizeDocumentId(`ex_${Date.now()}_${idx + 1}`, 'ex'),
      subject: String(item.subject || '').trim().slice(0, 140),
      ...(item.subjectCode?.trim() ? { subjectCode: item.subjectCode.trim().slice(0, 32) } : {}),
      date: String(item.date || '').trim().slice(0, 32),
      ...(item.rawDateText?.trim() ? { rawDateText: item.rawDateText.trim().slice(0, 64) } : {}),
      weekday: normalizeWeekdayName(item.weekday).slice(0, 24),
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      ...(rawTimeText ? { rawTimeText } : {}),
      ...(dur ? { durationMinutes: dur } : {}),
      entryType,
      ...(item.notes?.trim() ? { notes: item.notes.trim().slice(0, 300) } : {}),
      isUncertain: Boolean(item.isUncertain),
      ...(item.uncertaintyReason?.trim()
        ? { uncertaintyReason: item.uncertaintyReason.trim().slice(0, 240) }
        : {}),
    };
  });

  const documentReadable = parsed.documentReadable !== false && entries.length > 0;
  const intelligence = buildDatesheetIntelligence(metadata, entries, {
    documentReadable,
    extractionSummary: parsed.extractionSummary,
  });

  return {
    metadata,
    entries,
    sourceFiles,
    analyzedAt: new Date().toISOString(),
    intelligence,
  };
}

async function callWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeoutErr = new Error('MODEL_TIMEOUT');
      controller.abort(timeoutErr);
      reject(timeoutErr);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } catch (err) {
    throw mapGeminiError(err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function callGeminiWithRetry<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = GEMINI_TIMEOUT_MS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await callWithTimeout(operation, timeoutMs);
    } catch (err) {
      lastError = err;
      const mapped = mapGeminiError(err);
      // Fail over / return immediately on non-retryable errors or timeouts
      if (!mapped.retryable || mapped.code === 'MODEL_TIMEOUT' || attempt === 1) {
        throw mapped;
      }
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
  }
  throw mapGeminiError(lastError);
}

export interface AnalyzeDatesheetDependencies {
  aiClient?: {
    models: Pick<GoogleGenAI['models'], 'generateContent'> &
      Partial<Pick<GoogleGenAI['models'], 'generateContentStream'>>;
  };
  timeoutMs?: number;
}

export async function analyzeDatesheetDocuments(
  payload: Partial<AnalyzeDatesheetRequestPayload>,
  dependencies?: AnalyzeDatesheetDependencies
): Promise<AnalyzeDatesheetResponsePayload> {
  const batchCheck = validateDatesheetUploadBatch(
    Array.isArray(payload.files) ? payload.files : []
  );
  if (!batchCheck.valid || !batchCheck.sanitizedFiles) {
    throw new GeminiServiceError(
      400,
      'VALIDATION_ERROR',
      batchCheck.error || 'Please upload a valid PDF, JPG, JPEG, or PNG datesheet file.',
      false
    );
  }

  const ai = dependencies?.aiClient || getAiClient();
  if (!ai) {
    throw new GeminiServiceError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Gemini AI service is not configured on the server (GEMINI_API_KEY missing). Please set GEMINI_API_KEY and retry.',
      false
    );
  }

  const systemInstruction = buildDatesheetExtractionSystemInstruction({
    studentBoard: payload.studentBoard,
    studentClassGrade: payload.studentClassGrade,
  });

  const parts = [
    ...batchCheck.sanitizedFiles.map((file) => ({
      inlineData: {
        mimeType: file.mimeType,
        data: file.dataBase64,
      },
    })),
    {
      text: `Analyze all ${batchCheck.sanitizedFiles.length} uploaded datesheet file(s) carefully. Extract every subject, code, date, weekday, startTime, endTime, durationMinutes, instructions, practicals, and optional papers. Set documentReadable=false if the file is blank, corrupted, illegible, or not an exam datesheet. Never invent missing details.`,
    },
  ];

  const sourceMeta = batchCheck.sanitizedFiles.map((f) => ({
    fileName: f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    pageCount: f.pageCount,
  }));

  const primaryTimeoutMs = dependencies?.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const fallbackTimeoutMs = dependencies?.timeoutMs ?? GEMINI_FALLBACK_TIMEOUT_MS;

  const runModel = async (
    model: string,
    thinkingLevel: ThinkingLevel | undefined,
    abortSignal: AbortSignal
  ) => {
    const startedAt = Date.now();
    const requestConfig = {
      abortSignal,
      systemInstruction,
      safetySettings: K12_SAFETY_SETTINGS,
      responseMimeType: 'application/json',
      responseSchema: DATESHEET_SCHEMA_SDK,
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
    };

    let finishReason = '';
    let rawText = '';

    if (typeof ai.models.generateContentStream === 'function') {
      const stream = await ai.models.generateContentStream({
        model,
        contents: [{ role: 'user', parts }],
        config: requestConfig,
      });
      for await (const chunk of stream) {
        const chunkReason = String(chunk.candidates?.[0]?.finishReason || '');
        if (chunkReason) finishReason = chunkReason;
        if (typeof chunk.text === 'string' && chunk.text) {
          rawText += chunk.text;
        }
      }
      rawText = rawText.trim();
    } else {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: requestConfig,
      });
      finishReason = String(response.candidates?.[0]?.finishReason || '');
      rawText = (response.text || '').trim();
    }

    console.info(
      `[Datesheet Analyzer] ${model} (${thinkingLevel || 'DEFAULT'}) responded in ${Date.now() - startedAt}ms`
    );

    if (
      finishReason === 'SAFETY' ||
      finishReason === 'PROHIBITED_CONTENT' ||
      finishReason === 'BLOCKLIST' ||
      finishReason === 'SPII'
    ) {
      throw new GeminiServiceError(
        400,
        'SAFETY_BLOCKED',
        'The uploaded file triggered content safety filters. Please upload a clear official school or board exam datesheet.',
        false
      );
    }

    if (!rawText) {
      throw new GeminiServiceError(
        502,
        'AI_EMPTY_RESPONSE',
        'AI extraction returned an empty response. Please try a clearer image or PDF and retry.',
        true
      );
    }

    const cleanJson = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    let parsedJson: RawGeminiDatesheetResult;
    try {
      parsedJson = JSON.parse(cleanJson) as RawGeminiDatesheetResult;
    } catch {
      throw new GeminiServiceError(
        502,
        'AI_PARSE_ERROR',
        'AI extraction returned malformed structured output. Please retry.',
        true
      );
    }

    if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
      throw new GeminiServiceError(
        502,
        'AI_PARSE_ERROR',
        'AI extraction returned an unexpected format. Please retry.',
        true
      );
    }

    return parsedJson;
  };

  let parsed: RawGeminiDatesheetResult;
  try {
    // Try primary model once; on overload/timeout fail over immediately to fast fallback
    parsed = await callWithTimeout(
      (signal) => runModel(GEMINI_MODEL, ThinkingLevel.LOW, signal),
      primaryTimeoutMs
    );
  } catch (primaryErr) {
    const mapped = mapGeminiError(primaryErr);
    if (!mapped.retryable) throw mapped;
    console.info(
      `[Datesheet Analyzer] Failing over from ${GEMINI_MODEL} (${mapped.code}) to ${GEMINI_FAST_FALLBACK_MODEL}.`
    );
    parsed = await callGeminiWithRetry(
      (signal) => runModel(GEMINI_FAST_FALLBACK_MODEL, undefined, signal),
      fallbackTimeoutMs
    );
  }

  const normalized = normalizeRawDatesheetExtraction(parsed, sourceMeta);

  if (parsed.documentReadable === false || normalized.entries.length === 0) {
    throw new GeminiServiceError(
      422,
      'UNREADABLE_OR_EMPTY_EXTRACTION',
      parsed.extractionSummary?.trim() ||
        'No exam entries could be extracted from this file. Please upload a clearer PDF or photo of your exam datesheet and retry.',
      false
    );
  }

  return normalized;
}
