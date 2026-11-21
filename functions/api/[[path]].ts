import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import type {
  AnalyzeDatesheetRequestPayload,
  AnalyzeDatesheetResponsePayload,
  DatesheetMetadata,
  ExtractedExamEntry,
} from '../../src/types/datesheet.ts';
import {
  buildDatesheetIntelligence,
  normalizeWeekdayName,
  parseTimeRangeToMinutes,
  validateDatesheetUploadBatch,
} from '../../src/utils/datesheetEngine.ts';
import {
  sanitizeDocumentId,
  SlidingWindowRateLimiter,
  screenAgeAppropriateContent,
} from '../../src/utils/securityEngine.ts';

export interface PagesEnv {
  BACKEND_URL?: string;
  API_ORIGIN?: string;
  VITE_API_BASE_URL?: string;
  FIREBASE_PROJECT_ID?: string;
  GEMINI_API_KEY?: string;
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

export interface PagesEventContext {
  request: Request;
  env: PagesEnv;
  params?: { path?: string | string[] };
}

interface GoogleJwk {
  kty: string;
  alg?: string;
  use?: string;
  kid: string;
  n: string;
  e: string;
}

const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_account/v1/jwk/securetoken@system.gserviceaccount.com';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_PRIMARY_MODEL = 'gemini-4-hydrogen';
const GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

const K12_SAFETY_SETTINGS_REST = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_LOW_AND_ABOVE' },
];

const DATESHEET_SCHEMA_REST = {
  type: 'OBJECT',
  properties: {
    examinationName: {
      type: 'STRING',
      description: 'Official examination title shown on the datesheet, or empty string if absent.',
    },
    board: {
      type: 'STRING',
      description: 'Education board or school name printed on the datesheet, or empty string if absent.',
    },
    classGrade: {
      type: 'STRING',
      description: 'Class or grade printed on the datesheet (e.g. Class 10, Class 12), or empty string.',
    },
    academicSession: {
      type: 'STRING',
      description: 'Academic session printed on the datesheet (e.g. 2025-26), or empty string.',
    },
    importantInstructions: {
      type: 'ARRAY',
      description: 'Key official examination instructions printed on the datesheet, if present.',
      items: { type: 'STRING' },
    },
    metadataUncertain: {
      type: 'BOOLEAN',
      description: 'True if any header metadata was blurry, cropped, or ambiguous.',
    },
    metadataUncertaintyReason: {
      type: 'STRING',
      description: 'Brief explanation if metadataUncertain is true.',
    },
    documentReadable: {
      type: 'BOOLEAN',
      description: 'True if at least one exam schedule table or paper entry is legible as a datesheet; false if blank, corrupted, illegible, or unrelated to an exam schedule.',
    },
    extractionSummary: {
      type: 'STRING',
      description: 'Concise factual summary of what schedule details were extracted and any unclear sections.',
    },
    entries: {
      type: 'ARRAY',
      description: 'All examination entries extracted from every page of the datesheet.',
      items: {
        type: 'OBJECT',
        properties: {
          subject: { type: 'STRING' },
          subjectCode: { type: 'STRING' },
          date: { type: 'STRING' },
          rawDateText: { type: 'STRING' },
          weekday: { type: 'STRING' },
          startTime: { type: 'STRING' },
          endTime: { type: 'STRING' },
          rawTimeText: { type: 'STRING' },
          durationMinutes: { type: 'NUMBER' },
          entryType: { type: 'STRING' },
          notes: { type: 'STRING' },
          isUncertain: { type: 'BOOLEAN' },
          uncertaintyReason: { type: 'STRING' },
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

interface RawGeminiDatesheetResult {
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

let cachedJwks: GoogleJwk[] = [];
let jwksExpiresAtMs = 0;
const edgeAiLimiter = new SlidingWindowRateLimiter(30, 60_000);

export function resetEdgeRateLimiterForTests(): void {
  edgeAiLimiter.reset();
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get('origin');
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return headers;
}

function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function base64UrlToUint8Array(segment: string): Uint8Array {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const bytes = base64UrlToUint8Array(segment);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

async function fetchGoogleJwks(): Promise<GoogleJwk[]> {
  const now = Date.now();
  if (now < jwksExpiresAtMs && cachedJwks.length > 0) {
    return cachedJwks;
  }

  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) {
    throw new Error(`Unable to fetch Google JWKS (HTTP ${res.status})`);
  }

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  const data = (await res.json()) as { keys?: GoogleJwk[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  cachedJwks = keys;
  jwksExpiresAtMs = now + Math.max(60, ttlSeconds) * 1000;
  return keys;
}

interface VerifiedEdgeFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
}

async function verifyFirebaseJwtEdge(
  token: string,
  projectId: string
): Promise<VerifiedEdgeFirebaseUser> {
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = decodeBase64UrlJson<Record<string, unknown>>(payloadB64);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported Firebase token signing algorithm or missing key ID.');
  }

  let keys = await fetchGoogleJwks();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    jwksExpiresAtMs = 0;
    keys = await fetchGoogleJwks();
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) {
    throw new Error('Firebase signing key ID not found.');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlToUint8Array(sigB64);
  const sigBuffer = signatureBytes.buffer.slice(
    signatureBytes.byteOffset,
    signatureBytes.byteOffset + signatureBytes.byteLength
  ) as ArrayBuffer;
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    sigBuffer,
    signingInput
  );
  if (!valid) {
    throw new Error('Firebase ID token RSA signature verification failed.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) {
    throw new Error('Firebase ID token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Firebase ID token issuer mismatch.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Firebase ID token has expired.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Firebase ID token issued-at timestamp is invalid.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new Error('Firebase ID token subject (uid) is missing or invalid.');
  }

  return {
    uid: payload.sub.trim(),
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '',
    emailVerified: payload.email_verified === true,
    displayName:
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : 'Eduverse Scholar',
  };
}

async function authenticateEdgeRequest(
  request: Request,
  projectId: string
): Promise<{ user?: VerifiedEdgeFirebaseUser; errorResponse?: Response }> {
  const authHeader = (request.headers.get('authorization') || '').trim();
  if (!authHeader.startsWith('Bearer ')) {
    return {
      errorResponse: jsonResponse(
        request,
        {
          error: 'Authentication is required to access this endpoint.',
          code: 'UNAUTHENTICATED',
          retryable: false,
        },
        401
      ),
    };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return {
      errorResponse: jsonResponse(
        request,
        {
          error: 'Authentication is required to access this endpoint.',
          code: 'UNAUTHENTICATED',
          retryable: false,
        },
        401
      ),
    };
  }

  try {
    const user = await verifyFirebaseJwtEdge(token, projectId);
    return { user };
  } catch (err) {
    return {
      errorResponse: jsonResponse(
        request,
        {
          error: err instanceof Error ? err.message : 'Invalid authentication credentials.',
          code: 'INVALID_AUTH_TOKEN',
          retryable: false,
        },
        401
      ),
    };
  }
}

function validateUsernameEdge(raw: string): {
  valid: boolean;
  available: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { valid: false, available: false, normalized, error: 'Username is required.' };
  }
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(normalized)) {
    return {
      valid: false,
      available: false,
      normalized,
      error:
        'Username must be 3–24 characters, start with a letter, and use only lowercase letters, numbers, or underscores.',
    };
  }
  const reserved = new Set([
    'admin',
    'administrator',
    'root',
    'support',
    'eduverse',
    'system',
    'mod',
    'moderator',
  ]);
  if (reserved.has(normalized)) {
    return {
      valid: false,
      available: false,
      normalized,
      error: 'That username is reserved.',
    };
  }
  return { valid: true, available: true, normalized };
}

export function resolveValidBackendOrigin(
  env: Pick<PagesEnv, 'BACKEND_URL' | 'API_ORIGIN'>,
  currentOrigin: string
): { origin: string | null; rejectedReason?: string } {
  const raw = (env.BACKEND_URL || env.API_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!raw) return { origin: null };

  let stripped = raw;
  if (stripped.toLowerCase().endsWith('/api')) {
    stripped = stripped.slice(0, -4).replace(/\/+$/, '');
  }

  let parsed: URL;
  try {
    parsed = new URL(stripped);
  } catch {
    return {
      origin: null,
      rejectedReason: 'Configured BACKEND_URL is not a valid HTTP/HTTPS URL.',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      origin: null,
      rejectedReason: 'Configured BACKEND_URL must use http:// or https://.',
    };
  }

  if (parsed.origin === currentOrigin) {
    return { origin: null };
  }

  if (/^ais-(?:dev|pre)-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/i.test(parsed.hostname)) {
    return {
      origin: null,
      rejectedReason:
        'Configured BACKEND_URL points to an AI Studio authenticated preview origin (ais-dev/ais-pre).',
    };
  }

  return { origin: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` };
}

class EdgeGeminiError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;

  constructor(statusCode: number, code: string, message: string, retryable = false) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

function mapEdgeGeminiHttpError(status: number, rawBody: string, model: string): EdgeGeminiError {
  if (
    status === 503 ||
    rawBody.includes('"code":503') ||
    rawBody.includes('UNAVAILABLE') ||
    /high demand|temporarily unavailable|overloaded|service unavailable|try again later/i.test(rawBody)
  ) {
    return new EdgeGeminiError(
      503,
      'MODEL_OVERLOADED',
      'The AI model is experiencing temporary high demand right now. Please wait a few seconds and retry.',
      true
    );
  }
  if (status === 429 || rawBody.includes('RESOURCE_EXHAUSTED')) {
    return new EdgeGeminiError(
      429,
      'RATE_LIMIT_EXCEEDED',
      'AI usage quota or rate limit was reached right now. Please wait a few seconds and try again.',
      true
    );
  }
  if (status === 400 && (rawBody.includes('API_KEY_INVALID') || /api key/i.test(rawBody))) {
    return new EdgeGeminiError(
      403,
      'API_KEY_INVALID',
      'The server Gemini API key appears invalid. Please verify GEMINI_API_KEY in Cloudflare secrets.',
      false
    );
  }
  if (status === 403 || rawBody.includes('PERMISSION_DENIED')) {
    return new EdgeGeminiError(
      403,
      'PERMISSION_DENIED',
      'Gemini API access was denied for the configured key. Please verify GEMINI_API_KEY permissions.',
      false
    );
  }
  if (status === 404 || rawBody.includes('NOT_FOUND')) {
    return new EdgeGeminiError(
      502,
      'MODEL_NOT_FOUND',
      `Configured AI model (${model}) was not found or unavailable.`,
      false
    );
  }
  if (status === 400 || rawBody.includes('INVALID_ARGUMENT')) {
    return new EdgeGeminiError(
      400,
      'INVALID_REQUEST',
      'The AI service could not read that datesheet file format. Please upload a crisp PDF, JPG, or PNG.',
      false
    );
  }
  return new EdgeGeminiError(
    502,
    'AI_GENERATION_FAILED',
    'Unable to complete datesheet extraction right now due to a temporary upstream error. Please retry.',
    true
  );
}

function extractGeminiCandidateText(data: unknown): string {
  const candidates = (
    data as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: boolean }> } }>;
    }
  )?.candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => p && !p.thought && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
}

function buildEdgeDatesheetInstruction(context?: {
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
    '4. Convert clearly readable dates into ISO YYYY-MM-DD in the `date` field while also keeping `rawDateText` as printed.',
    '5. Keep `weekday` as printed on the sheet.',
    '6. Include theory exams, practical exams (`entryType: "practical"`), and optional/elective subjects (`entryType: "optional"`) when present.',
    '7. Extract `durationMinutes` ONLY when explicitly printed or directly calculable from clear startTime and endTime. Otherwise omit or return 0.',
    context?.studentBoard || context?.studentClassGrade
      ? `Student profile context (for disambiguation ONLY if printed on multi-class sheets, never invent): Board=${context.studentBoard || 'Unknown'}, Class=${context.studentClassGrade || 'Unknown'}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeEdgeDatesheetExtraction(
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

async function invokeGeminiDatesheetModel(params: {
  apiKey: string;
  model: string;
  thinkingLevel?: 'MEDIUM' | 'LOW' | 'MINIMAL';
  systemInstruction: string;
  parts: Array<
    | { inlineData: { mimeType: string; data: string } }
    | { text: string }
  >;
  timeoutMs: number;
}): Promise<RawGeminiDatesheetResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  let res: Response;

  try {
    res = await fetch(`${GEMINI_API_BASE}/${params.model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': params.apiKey,
        'User-Agent': 'aistudio-build',
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: params.systemInstruction }],
        },
        contents: [{ role: 'user', parts: params.parts }],
        safetySettings: K12_SAFETY_SETTINGS_REST,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: DATESHEET_SCHEMA_REST,
          ...(params.thinkingLevel ? { thinkingConfig: { thinkingLevel: params.thinkingLevel } } : {}),
        },
      }),
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new EdgeGeminiError(
        504,
        'MODEL_TIMEOUT',
        'Datesheet analysis timed out. Please try a clearer or smaller PDF/image and retry.',
        true
      );
    }
    throw new EdgeGeminiError(
      502,
      'GEMINI_UPSTREAM_UNREACHABLE',
      'Unable to reach Gemini API from Cloudflare edge right now. Please retry.',
      true
    );
  } finally {
    clearTimeout(timer);
  }

  const rawBody = await res.text();
  if (!res.ok) {
    throw mapEdgeGeminiHttpError(res.status, rawBody, params.model);
  }

  let parsedEnvelope: unknown;
  try {
    parsedEnvelope = JSON.parse(rawBody);
  } catch {
    throw new EdgeGeminiError(
      502,
      'AI_PARSE_ERROR',
      'AI extraction returned an unreadable response. Please retry.',
      true
    );
  }

  const finishReason = String(
    (parsedEnvelope as { candidates?: Array<{ finishReason?: string }> })?.candidates?.[0]
      ?.finishReason || ''
  );
  if (
    finishReason === 'SAFETY' ||
    finishReason === 'PROHIBITED_CONTENT' ||
    finishReason === 'BLOCKLIST' ||
    finishReason === 'SPII'
  ) {
    throw new EdgeGeminiError(
      400,
      'SAFETY_BLOCKED',
      'The uploaded file triggered content safety filters. Please upload a clear official school or board exam datesheet.',
      false
    );
  }

  const rawText = extractGeminiCandidateText(parsedEnvelope)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (!rawText) {
    throw new EdgeGeminiError(
      502,
      'AI_EMPTY_RESPONSE',
      'AI extraction returned an empty response. Please try a clearer file and retry.',
      true
    );
  }

  try {
    const parsedJson = JSON.parse(rawText) as RawGeminiDatesheetResult;
    if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
      throw new Error('Non-object JSON');
    }
    return parsedJson;
  } catch {
    throw new EdgeGeminiError(
      502,
      'AI_PARSE_ERROR',
      'AI extraction returned an unreadable response. Please retry.',
      true
    );
  }
}

async function runDatesheetAnalysisEdge(
  rawPayload: Partial<AnalyzeDatesheetRequestPayload>,
  apiKey: string
): Promise<AnalyzeDatesheetResponsePayload> {
  const batchCheck = validateDatesheetUploadBatch(
    Array.isArray(rawPayload.files) ? rawPayload.files : []
  );
  if (!batchCheck.valid || !batchCheck.sanitizedFiles) {
    throw new EdgeGeminiError(
      400,
      'VALIDATION_ERROR',
      batchCheck.error || 'Please upload a valid PDF, JPG, JPEG, or PNG datesheet file.',
      false
    );
  }

  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new EdgeGeminiError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Gemini AI service is not configured on this Cloudflare deployment (GEMINI_API_KEY missing).',
      false
    );
  }

  const systemInstruction = buildEdgeDatesheetInstruction({
    studentBoard: rawPayload.studentBoard,
    studentClassGrade: rawPayload.studentClassGrade,
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

  let parsed: RawGeminiDatesheetResult;
  try {
    parsed = await invokeGeminiDatesheetModel({
      apiKey: cleanKey,
      model: GEMINI_PRIMARY_MODEL,
      thinkingLevel: 'LOW',
      systemInstruction,
      parts,
      timeoutMs: 32_000,
    });
  } catch (primaryErr) {
    if (primaryErr instanceof EdgeGeminiError && primaryErr.retryable) {
      parsed = await invokeGeminiDatesheetModel({
        apiKey: cleanKey,
        model: GEMINI_FALLBACK_MODEL,
        systemInstruction,
        parts,
        timeoutMs: 58_000,
      });
    } else {
      throw primaryErr;
    }
  }

  const normalized = normalizeEdgeDatesheetExtraction(parsed, sourceMeta);

  if (parsed.documentReadable === false || normalized.entries.length === 0) {
    throw new EdgeGeminiError(
      422,
      'UNREADABLE_OR_EMPTY_EXTRACTION',
      parsed.extractionSummary?.trim() ||
        'No exam entries could be extracted from this file. Please upload a clearer PDF or photo of your exam datesheet and retry.',
      false
    );
  }

  return normalized;
}

async function handleDatesheetAnalyzeEdge(
  request: Request,
  env: PagesEnv,
  projectId: string
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse(
      request,
      {
        error: `Method ${request.method} is not allowed on /api/ai/datesheet/analyze. Use POST.`,
        code: 'METHOD_NOT_ALLOWED',
        retryable: false,
      },
      405,
      { Allow: 'POST, OPTIONS' }
    );
  }

  const authResult = await authenticateEdgeRequest(request, projectId);
  if (authResult.errorResponse || !authResult.user) {
    return authResult.errorResponse!;
  }

  const rateResult = edgeAiLimiter.check(authResult.user.uid);
  if (!rateResult.allowed) {
    return jsonResponse(
      request,
      {
        error: `Too many AI requests in a short window. Please wait ${rateResult.retryAfterSeconds}s before retrying.`,
        code: 'AI_RATE_LIMITED',
        retryable: true,
      },
      429,
      { 'Retry-After': String(rateResult.retryAfterSeconds) }
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonResponse(
        request,
        { error: 'Request body must be a JSON object.', code: 'INVALID_JSON', retryable: false },
        400
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(
      request,
      { error: 'Invalid JSON request body.', code: 'INVALID_JSON', retryable: false },
      400
    );
  }

  const textFields = [body.studentBoard, body.studentClassGrade]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('\n');

  const safety = screenAgeAppropriateContent(textFields);
  if (!safety.safe) {
    return jsonResponse(
      request,
      {
        error: safety.reason || 'Request blocked by K-12 student safety policy.',
        code: 'AGE_SAFETY_BLOCKED',
        retryable: false,
      },
      400
    );
  }

  try {
    const result = await runDatesheetAnalysisEdge(
      body as Partial<AnalyzeDatesheetRequestPayload>,
      env.GEMINI_API_KEY || ''
    );
    return jsonResponse(request, result, 200);
  } catch (err) {
    if (err instanceof EdgeGeminiError) {
      return jsonResponse(
        request,
        {
          error: err.message,
          code: err.code,
          retryable: err.retryable,
        },
        err.statusCode
      );
    }
    return jsonResponse(
      request,
      {
        error: 'Unexpected datesheet extraction error. Please retry.',
        code: 'INTERNAL_SERVER_ERROR',
        retryable: true,
      },
      500
    );
  }
}

export async function onRequest(context: PagesEventContext): Promise<Response> {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const reqUrl = new URL(request.url);
  const subpath = reqUrl.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const projectId = (env.FIREBASE_PROJECT_ID || firebaseConfig.projectId || 'decent-web-s46tg').trim();
  const hasGeminiKey = Boolean((env.GEMINI_API_KEY || '').trim());

  const { origin: validBackendOrigin, rejectedReason } = resolveValidBackendOrigin(
    env,
    reqUrl.origin
  );

  if (validBackendOrigin) {
    const targetUrl = `${validBackendOrigin}${reqUrl.pathname}${reqUrl.search}`;
    const proxyHeaders = new Headers();
    for (const name of ['authorization', 'content-type', 'accept']) {
      const value = request.headers.get(name);
      if (value) proxyHeaders.set(name, value);
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    try {
      const upstream = await fetch(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: hasBody ? await request.clone().arrayBuffer() : undefined,
        redirect: 'manual',
      });

      const upstreamContentType = upstream.headers.get('content-type') || '';
      const isRedirect = upstream.status >= 300 && upstream.status < 400;
      const isNonJsonStaticReject =
        (upstream.status === 404 || upstream.status === 405) &&
        !upstreamContentType.toLowerCase().includes('application/json');

      if (!isRedirect && !isNonJsonStaticReject) {
        const respHeaders = corsHeaders(request);
        if (upstreamContentType) respHeaders.set('Content-Type', upstreamContentType);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: respHeaders,
        });
      }

      const canHandleAtEdge =
        subpath === 'health' ||
        subpath === 'auth/capabilities' ||
        subpath === 'auth/username/check' ||
        subpath === 'auth/profile' ||
        (subpath === 'ai/datesheet/analyze' && hasGeminiKey);

      if (!canHandleAtEdge) {
        return jsonResponse(
          request,
          {
            error: `Configured BACKEND_URL returned HTTP ${upstream.status} on ${reqUrl.pathname}.`,
            code: 'BAD_BACKEND_UPSTREAM',
            retryable: false,
          },
          502
        );
      }
    } catch {
      const canHandleAtEdge =
        subpath === 'health' ||
        subpath === 'auth/capabilities' ||
        subpath === 'auth/username/check' ||
        subpath === 'auth/profile' ||
        (subpath === 'ai/datesheet/analyze' && hasGeminiKey);

      if (!canHandleAtEdge) {
        return jsonResponse(
          request,
          {
            error: `Unable to connect to configured BACKEND_URL from Cloudflare edge on ${reqUrl.pathname}.`,
            code: 'BACKEND_UNREACHABLE',
            retryable: true,
          },
          502
        );
      }
    }
  }

  if (subpath === 'health' && request.method === 'GET') {
    return jsonResponse(request, {
      status: 'healthy',
      platform: 'EDUVERSE AI — Exam Preparation & Practice Platform',
      version: '2.0.0',
      runtime: 'cloudflare-edge',
      geminiConfigured: hasGeminiKey,
      backendProxyConfigured: Boolean(validBackendOrigin),
      ...(rejectedReason ? { backendConfigWarning: rejectedReason } : {}),
      timestamp: new Date().toISOString(),
      supportedBoards: ['CBSE', 'CISCE', 'ICSE', 'ISC', 'StateBoard', 'Other'],
      supportedGrades: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'],
    });
  }

  if (subpath === 'auth/capabilities' && request.method === 'GET') {
    return jsonResponse(request, {
      googleOAuthReady: true,
      emailPasswordReady: true,
      emailVerificationLinksReady: true,
      passwordResetReady: true,
    });
  }

  if (subpath === 'auth/username/check' && request.method === 'GET') {
    const rawUsername = reqUrl.searchParams.get('username') || '';
    return jsonResponse(request, validateUsernameEdge(rawUsername));
  }

  if (subpath === 'auth/profile') {
    if (!['GET', 'POST', 'PATCH', 'PUT'].includes(request.method)) {
      return jsonResponse(
        request,
        { error: `Method ${request.method} not allowed.`, code: 'METHOD_NOT_ALLOWED', retryable: false },
        405,
        { Allow: 'GET, POST, PATCH, PUT, OPTIONS' }
      );
    }

    const authResult = await authenticateEdgeRequest(request, projectId);
    if (authResult.errorResponse || !authResult.user) {
      return authResult.errorResponse!;
    }
    const verifiedUser = authResult.user;

    let body: Record<string, unknown> = {};
    if (request.method !== 'GET') {
      try {
        const parsed = await request.json();
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        return jsonResponse(
          request,
          { error: 'Invalid JSON request body.', code: 'INVALID_JSON', retryable: false },
          400
        );
      }
    }

    const usernameResult =
      typeof body.username === 'string' && body.username.trim()
        ? validateUsernameEdge(body.username)
        : null;
    if (usernameResult && !usernameResult.valid) {
      return jsonResponse(
        request,
        {
          error: usernameResult.error || 'Invalid username format.',
          code: 'INVALID_USERNAME',
          retryable: false,
        },
        400
      );
    }

    const now = new Date().toISOString();
    const isBootstrapAdmin =
      verifiedUser.emailVerified && verifiedUser.email === 'a40332177@gmail.com';

    return jsonResponse(request, {
      profile: {
        uid: verifiedUser.uid,
        email: verifiedUser.email,
        emailVerified: verifiedUser.emailVerified,
        displayName:
          typeof body.displayName === 'string' && body.displayName.trim()
            ? body.displayName.trim().slice(0, 100)
            : verifiedUser.displayName,
        username: usernameResult?.normalized,
        avatarId: typeof body.avatarId === 'string' ? body.avatarId : 'aurora-indigo',
        role: isBootstrapAdmin ? 'admin' : 'student',
        board: typeof body.board === 'string' ? body.board : 'CBSE',
        classGrade: typeof body.classGrade === 'string' ? body.classGrade : 'Class 10',
        state: typeof body.state === 'string' ? body.state : 'Delhi (NCT)',
        language: typeof body.language === 'string' ? body.language : 'English',
        onboardingCompleted:
          typeof body.onboardingCompleted === 'boolean' ? body.onboardingCompleted : false,
        updatedAt: now,
      },
    });
  }

  if (subpath === 'ai/datesheet/analyze') {
    return handleDatesheetAnalyzeEdge(request, env, projectId);
  }

  return jsonResponse(
    request,
    {
      error: rejectedReason
        ? rejectedReason
        : `API endpoint ${reqUrl.pathname} is not available.`,
      code: rejectedReason ? 'INVALID_BACKEND_URL' : 'NOT_FOUND',
      retryable: false,
    },
    rejectedReason ? 502 : 404
  );
}
