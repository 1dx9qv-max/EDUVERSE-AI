import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
  SmartDoubtResponse,
  SolveDoubtRequestPayload,
  TeacherRequestPayload,
  TeacherStructuredResponse,
  TutorLanguage,
  WorksheetQuestionSolution,
} from '../src/types/ai.ts';
import type {
  GeneratedVisualSpec,
  MindMapCrossLink,
  MindMapGenerateRequest,
  MindMapGenerateResponse,
  MindMapNode,
  VisualExplorationStep,
  VisualGenerateRequest,
} from '../src/types/phase3.ts';
import {
  buildVisualCacheKey,
  validateAndSanitizeGeneratedVisual,
} from '../src/utils/visualLabEngine.ts';
import type {
  DifficultyTier,
  FlashcardGenerateRequest,
  FlashcardGenerateResponse,
  PracticeGenerateRequest,
  PracticeGenerateResponse,
  PracticeQuestion,
  QuestionType,
  RemediateRequest,
  RemediateResponse,
  ShortAnswerEvaluateRequest,
  ShortAnswerEvaluateResponse,
} from '../src/types/phase4.ts';
import type {
  ExamAnswerSubmission,
  ExamAttemptRecord,
  ExamGenerateRequest,
  ExamMode,
  ExamPaper,
  ExamQuestion,
  ExamQuestionResult,
  ExamQuestionType,
  ExamStartRequest,
  ExamStartResponse,
  ExamSubmitRequest,
  ExamSubmitResponse,
  ExamTimingStatus,
} from '../src/types/phase5.ts';
import {
  TEACHING_MODES,
  buildAiTeacherSystemInstruction,
  buildTeacherLanguageInstruction,
  normalizeLanguageForTutor,
  validateDoubtRequest,
  validateTeacherRequest,
} from '../src/utils/aiValidation.ts';
import {
  normalizeMindMapNodes,
  validateMindMapGenerateRequest,
} from '../src/utils/mindMapEngine.ts';
import {
  sanitizeDocumentId,
  validatePracticeGenerateRequest,
} from '../src/utils/learningEngine.ts';
import { validateFlashcardGenerateRequest } from '../src/utils/memoryEngine.ts';
import {
  buildExamPaperDisclaimer,
  computeExamBreakdowns,
  gradeObjectiveExamQuestion,
  gradeSubjectiveKeywordFallback,
  isSubjectiveExamQuestion,
  sanitizeExamAttemptForStorage,
} from '../src/utils/examEngine.ts';
import type {
  VoiceTranscribeRequestPayload,
  VoiceTranscribeResponsePayload,
  VoiceTtsRequestPayload,
  VoiceTtsResponsePayload,
  VoiceTurnRequestPayload,
  VoiceTurnResponsePayload,
} from '../src/types/phase6.ts';
import {
  buildVoiceClassroomInstruction,
  cleanTextForSpeech,
  validateVoiceTranscribeRequest,
  validateVoiceTtsRequest,
  validateVoiceTurnRequest,
} from '../src/utils/voiceEngine.ts';

const GEMINI_VOICE_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const GEMINI_VOICE_TTS_MODEL = 'gemini-3.8-flash-lite-tts';

const GEMINI_MODEL = 'gemini-4-hydrogen';
const GEMINI_FAST_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_TIMEOUT_MS = 75000;

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

function getAiClient(apiVersion?: string): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      ...(apiVersion ? { apiVersion } : {}),
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
  const status =
    typeof (error as any)?.status === 'number'
      ? (error as any).status
      : typeof (error as any)?.statusCode === 'number'
        ? (error as any).statusCode
        : undefined;

  if (
    rawMsg.includes('MODEL_TIMEOUT') ||
    rawMsg.toLowerCase().includes('timeout') ||
    (error as any)?.name === 'AbortError' ||
    rawMsg.toLowerCase().includes('aborted')
  ) {
    return new GeminiServiceError(
      504,
      'MODEL_TIMEOUT',
      'The AI tutor took too long to respond. Please try a shorter prompt or smaller file and retry.',
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
      'The AI service could not process that input or format. Please adjust your prompt or attachment and retry.',
      false
    );
  }

  console.warn('[Gemini Unmapped Upstream Error]', rawMsg.slice(0, 320));
  return new GeminiServiceError(
    502,
    'AI_GENERATION_FAILED',
    'Unable to complete AI request right now due to a temporary upstream error. Please retry.',
    true
  );
}

async function generateWithRetry<T>(
  operation: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs = GEMINI_TIMEOUT_MS,
  options?: {
    retryOnTransientExhaustion?: boolean;
    maxRetries?: number;
    skipSameModelOnOverload?: boolean;
  }
): Promise<T> {
  const executeWithTimeout = async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('MODEL_TIMEOUT'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const maxRetries = Math.max(0, Math.min(3, options?.maxRetries ?? 1));
  const allowTransientRetry = Boolean(options?.retryOnTransientExhaustion);
  let lastMapped: GeminiServiceError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await executeWithTimeout();
    } catch (err) {
      const mapped = mapGeminiError(err);
      lastMapped = mapped;

      const isCapacityOrRate = mapped.statusCode === 503 || mapped.statusCode === 429;
      if (options?.skipSameModelOnOverload && (isCapacityOrRate || mapped.statusCode === 504)) {
        throw mapped;
      }

      const canRetry =
        attempt < maxRetries &&
        mapped.retryable &&
        (allowTransientRetry || (mapped.statusCode !== 429 && mapped.statusCode !== 504));

      if (!canRetry) {
        throw mapped;
      }

      const baseDelay = isCapacityOrRate ? 1000 * Math.pow(2, attempt) : 650;
      const jitter = Math.floor(Math.random() * 450);
      await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
    }
  }

  throw lastMapped || new GeminiServiceError(502, 'AI_GENERATION_FAILED', 'AI request failed. Please retry.', true);
}

function safeParseJson<T>(rawText: string | undefined, fallbackError: string): T {
  const cleaned = (rawText || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (!cleaned) {
    throw new GeminiServiceError(502, 'AI_EMPTY_RESPONSE', fallbackError, true);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new GeminiServiceError(502, 'AI_PARSE_ERROR', fallbackError, true);
  }
}

const TEACHER_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    lessonTitle: { type: Type.STRING, description: 'Short concise title for this teaching turn or lesson.' },
    reply: { type: Type.STRING, description: 'Main encouraging explanation tailored to the student class, board, language, and level.' },
    lessonBreakdown: {
      type: Type.ARRAY,
      description: '2 to 4 small bite-sized sequential sub-lessons breaking down the complex concept.',
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          content: { type: Type.STRING },
        },
        required: ['title', 'content'],
      },
    },
    realWorldExamples: {
      type: Type.ARRAY,
      description: '2 to 3 relatable everyday Indian or real-world examples.',
      items: { type: Type.STRING },
    },
    analogy: { type: Type.STRING, description: 'One memorable intuitive analogy making the concept stick.' },
    checkingQuestion: {
      type: Type.OBJECT,
      description: 'A conceptual checking question to verify understanding before moving forward.',
      properties: {
        question: { type: Type.STRING },
        hint: { type: Type.STRING },
        expectedConcept: { type: Type.STRING },
      },
      required: ['question', 'hint', 'expectedConcept'],
    },
    followUpExercises: {
      type: Type.ARRAY,
      description: '2 follow-up practice exercises calibrated to the chosen explanation level.',
      items: {
        type: Type.OBJECT,
        properties: {
          prompt: { type: Type.STRING },
          difficulty: { type: Type.STRING },
          hint: { type: Type.STRING },
        },
        required: ['prompt', 'difficulty', 'hint'],
      },
    },
    syllabusNote: {
      type: Type.STRING,
      description: 'Honest curricular context note without fabricating unverified NCERT page numbers or official circular IDs.',
    },
    suggestedNextStep: {
      type: Type.STRING,
      description: 'Brief next learning prompt or step to keep momentum.',
    },
  },
  required: [
    'lessonTitle',
    'reply',
    'lessonBreakdown',
    'realWorldExamples',
    'analogy',
    'checkingQuestion',
    'followUpExercises',
    'syllabusNote',
    'suggestedNextStep',
  ],
};

const SIMILAR_PRACTICE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    question: { type: Type.STRING },
    options: {
      type: Type.ARRAY,
      description: '4 short MCQ options when helpful, or an empty array for subjective/open practice.',
      items: { type: Type.STRING },
    },
    hint: { type: Type.STRING },
    answer: { type: Type.STRING },
  },
  required: ['question', 'options', 'hint', 'answer'],
};

const WORKSHEET_ITEM_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    questionNumber: { type: Type.INTEGER },
    understoodQuestion: { type: Type.STRING },
    identifiedTopic: { type: Type.STRING },
    stepByStepSolution: { type: Type.ARRAY, items: { type: Type.STRING } },
    whyItWorks: { type: Type.STRING },
    commonMisconceptions: { type: Type.ARRAY, items: { type: Type.STRING } },
    similarPracticeQuestion: SIMILAR_PRACTICE_SCHEMA,
    easierExplanation: { type: Type.STRING },
  },
  required: [
    'questionNumber',
    'understoodQuestion',
    'identifiedTopic',
    'stepByStepSolution',
    'whyItWorks',
    'commonMisconceptions',
    'similarPracticeQuestion',
    'easierExplanation',
  ],
};

const SMART_DOUBT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    identifiedSubject: { type: Type.STRING },
    identifiedTopic: { type: Type.STRING },
    understoodQuestion: { type: Type.STRING },
    stepByStepSolution: { type: Type.ARRAY, items: { type: Type.STRING } },
    whyItWorks: { type: Type.STRING },
    commonMisconceptions: { type: Type.ARRAY, items: { type: Type.STRING } },
    similarPracticeQuestion: SIMILAR_PRACTICE_SCHEMA,
    easierExplanation: { type: Type.STRING },
    syllabusDisclaimer: { type: Type.STRING },
    isWorksheet: { type: Type.BOOLEAN },
    worksheetQuestions: {
      type: Type.ARRAY,
      description: 'Populated when multiple questions appear in a typed list, image, or PDF worksheet; otherwise empty array.',
      items: WORKSHEET_ITEM_SCHEMA,
    },
  },
  required: [
    'identifiedSubject',
    'identifiedTopic',
    'understoodQuestion',
    'stepByStepSolution',
    'whyItWorks',
    'commonMisconceptions',
    'similarPracticeQuestion',
    'easierExplanation',
    'syllabusDisclaimer',
    'isWorksheet',
    'worksheetQuestions',
  ],
};

function getLanguageInstruction(language: TutorLanguage): string {
  return buildTeacherLanguageInstruction(language);
}

export async function runAiTeacherTurn(
  rawPayload: Partial<TeacherRequestPayload>
): Promise<TeacherStructuredResponse> {
  const validation = validateTeacherRequest(rawPayload);
  if (!validation.valid || !validation.sanitized) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', validation.error || 'Invalid AI Teacher request.');
  }

  const ai = getAiClient();
  if (!ai) {
    throw new GeminiServiceError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Gemini AI service is not configured on this server (GEMINI_API_KEY missing).'
    );
  }

  const req = validation.sanitized;
  const modeMeta = TEACHING_MODES.find((m) => m.id === req.mode) || TEACHING_MODES[0];

  const systemInstruction = buildAiTeacherSystemInstruction({
    subject: req.subject,
    classGrade: req.classGrade,
    board: req.board,
    language: req.language,
    level: req.level,
    modeLabel: modeMeta.label,
    modeDescription: modeMeta.description,
  });

  const contents = [
    ...req.history.map((turn) => ({
      role: turn.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: turn.content }],
    })),
    {
      role: 'user' as const,
      parts: [
        {
          text: `[CURRENT EXPLANATION LANGUAGE: ${req.language} | Mode: ${modeMeta.label} | Level: ${req.level} | Subject: ${req.subject}]\n(Instruction: Respond strictly in ${req.language} for every field while continuing the active lesson context.)\n${req.message}`,
        },
      ],
    },
  ];

  let response;
  try {
    response = await generateWithRetry(
      (abortSignal) =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents,
          config: {
            systemInstruction,
            safetySettings: K12_SAFETY_SETTINGS,
            responseMimeType: 'application/json',
            responseSchema: TEACHER_RESPONSE_SCHEMA,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            abortSignal,
          },
        }),
      GEMINI_TIMEOUT_MS,
      { skipSameModelOnOverload: true }
    );
  } catch (primaryErr) {
    if (primaryErr instanceof GeminiServiceError && primaryErr.retryable) {
      console.info(`[AI Teacher] Switching from ${GEMINI_MODEL} (${primaryErr.code}) to ${GEMINI_FAST_FALLBACK_MODEL}`);
      response = await generateWithRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_FAST_FALLBACK_MODEL,
            contents,
            config: {
              systemInstruction,
              safetySettings: K12_SAFETY_SETTINGS,
              responseMimeType: 'application/json',
              responseSchema: TEACHER_RESPONSE_SCHEMA,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              abortSignal,
            },
          }),
        45000,
        { retryOnTransientExhaustion: true, maxRetries: 2 }
      );
    } else {
      throw primaryErr;
    }
  }

  const parsed = safeParseJson<Partial<TeacherStructuredResponse>>(
    response.text,
    'The AI Teacher returned an unreadable response. Please retry your lesson turn.'
  );

  const fallbackCheckingQuestion =
    req.language === 'Hindi'
      ? {
          question: 'क्या आप इस मुख्य कॉन्सेप्ट को अपने शब्दों में एक वाक्य में समझा सकते हैं?',
          hint: 'ध्यान दें कि क्या बदलता है और क्या स्थिर रहता है।',
          expectedConcept: req.subject,
        }
      : req.language === 'Hinglish' || req.language === 'Bilingual'
        ? {
            question: 'Kya aap is main concept ko apne words mein ek short sentence mein explain kar sakte ho?',
            hint: 'Dhyan do ki is process mein kya change ho raha hai aur kaunsi cheez constant rehti hai.',
            expectedConcept: req.subject,
          }
        : {
            question: 'Can you summarize the core idea in one sentence in your own words?',
            hint: 'Focus on what changes and what stays constant.',
            expectedConcept: req.subject,
          };

  return {
    lessonTitle: parsed.lessonTitle || `${req.subject} — ${modeMeta.shortLabel}`,
    reply: parsed.reply || 'Here is your personalized explanation.',
    lessonBreakdown: Array.isArray(parsed.lessonBreakdown) ? parsed.lessonBreakdown : [],
    realWorldExamples: Array.isArray(parsed.realWorldExamples) ? parsed.realWorldExamples : [],
    analogy: parsed.analogy || '',
    checkingQuestion: parsed.checkingQuestion || fallbackCheckingQuestion,
    followUpExercises: Array.isArray(parsed.followUpExercises) ? parsed.followUpExercises : [],
    syllabusNote:
      parsed.syllabusNote ||
      `General conceptual guidance tailored to ${req.classGrade} (${req.board}). Check your board-issued textbook or admin-verified syllabus for exact exam weightage.`,
    suggestedNextStep: parsed.suggestedNextStep || 'Reply to the checking question or pick an exercise to continue.',
  };
}

export async function solveSmartDoubt(
  rawPayload: Partial<SolveDoubtRequestPayload>
): Promise<SmartDoubtResponse> {
  const validation = validateDoubtRequest(rawPayload);
  if (!validation.valid || !validation.sanitized) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', validation.error || 'Invalid doubt request.');
  }

  const ai = getAiClient();
  if (!ai) {
    throw new GeminiServiceError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Gemini AI service is not configured on this server (GEMINI_API_KEY missing).'
    );
  }

  const req = validation.sanitized;

  const systemInstruction = `You are EDUVERSE AI Smart Doubt Solver for Indian school students (${req.classGrade}, ${req.board}).
${getLanguageInstruction(req.language)}

Your task for EVERY doubt (typed, photo, handwritten note, PDF page, or multi-question worksheet):
1. Identify the academic \`identifiedSubject\` and specific \`identifiedTopic\`.
2. Faithfully transcribe/understand the student's question in \`understoodQuestion\` (including reading handwritten work or equations from uploaded images/PDFs).
3. Explain the solution clearly step by step in \`stepByStepSolution\`.
4. Explain WHY the solution works conceptually in \`whyItWorks\` (never just mechanical steps).
5. Highlight 2-3 \`commonMisconceptions\` students often make on this topic.
6. Generate one \`similarPracticeQuestion\` (with options, hint, and final answer) so the student can verify mastery.
7. Provide an intuitive \`easierExplanation\` using simpler words and an everyday analogy.
8. WORKSHEET / MULTIPLE QUESTIONS: If the input or attached image/PDF contains multiple distinct questions (or \`isWorksheet\` is requested), set \`isWorksheet: true\` and populate \`worksheetQuestions\` with each numbered question (up to 8 questions), while putting the primary/first question summary in the top-level fields. If there is only one question, set \`isWorksheet: false\` and \`worksheetQuestions: []\`.
9. ${req.simplerRequested ? 'SIMPLER EXPLANATION REQUESTED: Make every step ultra-clear, jargon-free, and grounded in simple intuition.' : ''}
10. SYLLABUS HONESTY INVARIANT: Never fabricate official NCERT/ICSE/State Board page numbers or claim unverified syllabus records are official. Always put an honest general guidance disclaimer in \`syllabusDisclaimer\`.`;

  const promptLines = [
    `Student Profile: ${req.classGrade}, ${req.board} Board.`,
    req.subjectHint ? `Subject Hint: ${req.subjectHint}` : 'Subject Hint: Auto-detect from question/attachment',
    `Input Mode: ${req.inputMode}${req.isWorksheet ? ' (Worksheet / Multi-question check)' : ''}`,
    req.simplerRequested ? 'Special Instruction: Provide an EXTRA EASY, intuitive beginner-friendly explanation.' : '',
    req.question ? `Student Question / Context:\n${req.question}` : 'Student uploaded an attachment without extra typed text. Carefully read every question in the attachment and solve it.',
  ]
    .filter(Boolean)
    .join('\n');

  const contents = req.attachment
    ? {
        parts: [
          {
            inlineData: {
              mimeType: req.attachment.mimeType,
              data: req.attachment.dataBase64,
            },
          },
          { text: promptLines },
        ],
      }
    : promptLines;

  let response;
  try {
    response = await generateWithRetry(
      (abortSignal) =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents,
          config: {
            systemInstruction,
            safetySettings: K12_SAFETY_SETTINGS,
            responseMimeType: 'application/json',
            responseSchema: SMART_DOUBT_SCHEMA,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            abortSignal,
          },
        }),
      GEMINI_TIMEOUT_MS,
      { skipSameModelOnOverload: true }
    );
  } catch (primaryErr) {
    if (primaryErr instanceof GeminiServiceError && primaryErr.retryable) {
      console.info(`[Smart Doubt Solver] Switching from ${GEMINI_MODEL} (${primaryErr.code}) to ${GEMINI_FAST_FALLBACK_MODEL}`);
      response = await generateWithRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_FAST_FALLBACK_MODEL,
            contents,
            config: {
              systemInstruction,
              safetySettings: K12_SAFETY_SETTINGS,
              responseMimeType: 'application/json',
              responseSchema: SMART_DOUBT_SCHEMA,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              abortSignal,
            },
          }),
        55000,
        { retryOnTransientExhaustion: true, maxRetries: 2 }
      );
    } else {
      throw primaryErr;
    }
  }

  const parsed = safeParseJson<Partial<SmartDoubtResponse>>(
    response.text,
    'The Doubt Solver returned an unreadable response. Please retry.'
  );

  const defaultPractice = {
    question: 'Try creating a slight variation by changing one given number and re-solving using the same principle.',
    options: [] as string[],
    hint: 'Identify the governing law first before substituting values.',
    answer: 'Verify dimensional and logical consistency at the final step.',
  };

  const worksheetQuestions: WorksheetQuestionSolution[] = Array.isArray(parsed.worksheetQuestions)
    ? parsed.worksheetQuestions.slice(0, 10).map((item, idx) => ({
        questionNumber: typeof item.questionNumber === 'number' ? item.questionNumber : idx + 1,
        understoodQuestion: item.understoodQuestion || `Question ${idx + 1}`,
        identifiedTopic: item.identifiedTopic || parsed.identifiedTopic || 'Core Concept',
        stepByStepSolution: Array.isArray(item.stepByStepSolution) ? item.stepByStepSolution : [],
        whyItWorks: item.whyItWorks || '',
        commonMisconceptions: Array.isArray(item.commonMisconceptions) ? item.commonMisconceptions : [],
        similarPracticeQuestion: item.similarPracticeQuestion || defaultPractice,
        easierExplanation: item.easierExplanation || '',
      }))
    : [];

  return {
    identifiedSubject: parsed.identifiedSubject || req.subjectHint || 'General Studies',
    identifiedTopic: parsed.identifiedTopic || 'Concept Application',
    understoodQuestion: parsed.understoodQuestion || req.question || 'Uploaded study question',
    stepByStepSolution: Array.isArray(parsed.stepByStepSolution) ? parsed.stepByStepSolution : [],
    whyItWorks: parsed.whyItWorks || '',
    commonMisconceptions: Array.isArray(parsed.commonMisconceptions) ? parsed.commonMisconceptions : [],
    similarPracticeQuestion: parsed.similarPracticeQuestion || defaultPractice,
    easierExplanation: parsed.easierExplanation || '',
    syllabusDisclaimer:
      parsed.syllabusDisclaimer ||
      `General ${req.classGrade} (${req.board}) guidance. Confirm exact chapter/syllabus alignment with verified curriculum records.`,
    isWorksheet: Boolean(parsed.isWorksheet || worksheetQuestions.length > 1),
    worksheetQuestions,
  };
}

const MIND_MAP_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: 'Clear concise mind map title.' },
    summary: { type: Type.STRING, description: '1-2 short sentences summarizing the topic.' },
    syllabusNote: {
      type: Type.STRING,
      description: 'Short honest syllabus disclaimer without fabricating official board page numbers.',
    },
    nodes: {
      type: Type.ARRAY,
      description: '9 to 13 hierarchical mind map nodes starting with root node (id root, parentId empty string, category root).',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          parentId: { type: Type.STRING, description: 'Parent node id, or empty string "" for the root node.' },
          label: { type: Type.STRING },
          hindiLabel: { type: Type.STRING, description: 'Hindi translation when language is Hindi or Bilingual; otherwise empty string.' },
          relationshipLabel: {
            type: Type.STRING,
            description: 'Short 1-2 word connector verb (e.g. governed by, types, formula).',
          },
          note: { type: Type.STRING, description: 'Ultra-crisp 1-sentence exam takeaway (max 15 words).' },
          category: {
            type: Type.STRING,
            enum: ['root', 'pillar', 'concept', 'formula', 'example'],
          },
        },
        required: ['id', 'parentId', 'label', 'note', 'category'],
      },
    },
    crossLinks: {
      type: Type.ARRAY,
      description: '2 insightful relationships connecting nodes across different branches.',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          fromId: { type: Type.STRING },
          toId: { type: Type.STRING },
          label: { type: Type.STRING },
        },
        required: ['id', 'fromId', 'toId', 'label'],
      },
    },
  },
  required: ['title', 'summary', 'syllabusNote', 'nodes', 'crossLinks'],
};

export async function generateStructuredMindMap(
  rawPayload: Partial<MindMapGenerateRequest>
): Promise<MindMapGenerateResponse> {
  const validation = validateMindMapGenerateRequest(rawPayload);
  if (!validation.valid || !validation.sanitized) {
    throw new GeminiServiceError(
      400,
      'VALIDATION_ERROR',
      validation.error || 'Invalid Mind Map generation request.'
    );
  }

  const ai = getAiClient();
  if (!ai) {
    throw new GeminiServiceError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Gemini AI service is not configured on this server (GEMINI_API_KEY missing).'
    );
  }

  const req = validation.sanitized;

  const systemInstruction = `You are EDUVERSE AI Visual Curriculum Architect for Indian school students (${req.classGrade}, ${req.board} Board, Subject: ${req.subject}).
${getLanguageInstruction(req.language)}

Task: Generate a crisp, deeply logical hierarchical Mind Map for the topic "${req.topic}".

Structure Rules:
1. Exactly ONE root node with id "root", parentId "", category "root", representing "${req.topic}".
2. Create 3 to 4 major branch nodes ("pillar" category) directly under "root", and 2 child nodes ("concept", "formula", or "example") under each pillar (9 to 13 nodes total).
3. Keep every \`label\` crisp (2 to 5 words) and \`note\` concise (max 15 words).
4. ${req.language === 'English' ? 'Leave \`hindiLabel\` as empty string "".' : 'Populate concise Hindi/Devanagari phrasing in \`hindiLabel\`.'}
5. Set \`relationshipLabel\` on non-root nodes (1 to 2 words like "types", "governed by", "formula", "example").
6. Include 2 meaningful \`crossLinks\` connecting nodes from DIFFERENT branches.
7. SYLLABUS HONESTY: Never fabricate official NCERT/ICSE/State Board page numbers. Put a brief honest note in \`syllabusNote\`.`;

  const promptText = [
    `Topic / Chapter: ${req.topic}`,
    `Subject: ${req.subject}`,
    `Class & Board: ${req.classGrade} (${req.board})`,
    `Language Preference: ${req.language}`,
    req.chapterContext ? `Syllabus Context: ${req.chapterContext}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  let response;
  try {
    response = await generateWithRetry(
      (abortSignal) =>
        ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: promptText,
          config: {
            systemInstruction,
            safetySettings: K12_SAFETY_SETTINGS,
            responseMimeType: 'application/json',
            responseSchema: MIND_MAP_SCHEMA,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            abortSignal,
          },
        }),
      26000,
      { skipSameModelOnOverload: true }
    );
  } catch (primaryErr) {
    if (primaryErr instanceof GeminiServiceError && (primaryErr.code === 'MODEL_TIMEOUT' || primaryErr.retryable)) {
      console.warn(`[Mind Map] Primary model failed (${primaryErr.code}), falling back to ${GEMINI_FAST_FALLBACK_MODEL}`);
      response = await generateWithRetry(
        (abortSignal) =>
          ai.models.generateContent({
            model: GEMINI_FAST_FALLBACK_MODEL,
            contents: promptText,
            config: {
              systemInstruction,
              safetySettings: K12_SAFETY_SETTINGS,
              responseMimeType: 'application/json',
              responseSchema: MIND_MAP_SCHEMA,
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              abortSignal,
            },
          }),
        35000,
        { retryOnTransientExhaustion: true, maxRetries: 2 }
      );
    } else {
      throw primaryErr;
    }
  }

  const parsed = safeParseJson<Partial<MindMapGenerateResponse>>(
    response.text,
    'The Mind Map generator returned an unreadable structure. Please retry.'
  );

  const normalizedNodes: MindMapNode[] = normalizeMindMapNodes(
    Array.isArray(parsed.nodes) ? parsed.nodes : [],
    req.topic
  );
  const validIds = new Set(normalizedNodes.map((n) => n.id));
  const rawLinks = Array.isArray(parsed.crossLinks) ? parsed.crossLinks : [];
  const crossLinks: MindMapCrossLink[] = rawLinks
    .filter(
      (l) =>
        l &&
        typeof l.fromId === 'string' &&
        typeof l.toId === 'string' &&
        validIds.has(l.fromId) &&
        validIds.has(l.toId) &&
        l.fromId !== l.toId
    )
    .slice(0, 8)
    .map((l, idx) => ({
      id: l.id || `xlink_${idx + 1}`,
      fromId: l.fromId,
      toId: l.toId,
      label: (l.label || 'connects to').slice(0, 60),
    }));

  return {
    title: parsed.title || `${req.topic} — Concept Map`,
    summary:
      parsed.summary ||
      `Visual concept breakdown of ${req.topic} for ${req.classGrade} ${req.subject} (${req.board}).`,
    syllabusNote:
      parsed.syllabusNote ||
      `Conceptual map aligned with typical ${req.classGrade} ${req.board} topics. Check your admin-verified syllabus or textbook for official scope.`,
    nodes: normalizedNodes,
    crossLinks,
  };
}

async function generateJsonWithFastFallback(params: {
  label: string;
  systemInstruction: string;
  contents: string;
  schema: Schema;
  preferFastModel?: boolean;
  primaryTimeoutMs?: number;
  fallbackTimeoutMs?: number;
}): Promise<string | undefined> {
  const ai = getAiClient();
  if (!ai) {
    throw new GeminiServiceError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Gemini AI service is not configured on this server (GEMINI_API_KEY missing).'
    );
  }

  const primaryModel = params.preferFastModel ? GEMINI_FAST_FALLBACK_MODEL : GEMINI_MODEL;
  const primaryThinking = params.preferFastModel ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
  const primaryTimeoutMs = params.primaryTimeoutMs ?? (params.preferFastModel ? 14000 : 28000);

  const secondaryModel = params.preferFastModel ? GEMINI_MODEL : GEMINI_FAST_FALLBACK_MODEL;
  const secondaryThinking = params.preferFastModel ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL;
  const fallbackTimeoutMs = params.fallbackTimeoutMs ?? (params.preferFastModel ? 22000 : 34000);

  let response;
  try {
    response = await generateWithRetry(
      (abortSignal) =>
        ai.models.generateContent({
          model: primaryModel,
          contents: params.contents,
          config: {
            systemInstruction: params.systemInstruction,
            safetySettings: K12_SAFETY_SETTINGS,
            responseMimeType: 'application/json',
            responseSchema: params.schema,
            thinkingConfig: { thinkingLevel: primaryThinking },
            abortSignal,
          },
        }),
      primaryTimeoutMs,
      { skipSameModelOnOverload: true }
    );
  } catch (primaryErr) {
    if (
      primaryErr instanceof GeminiServiceError &&
      (primaryErr.code === 'MODEL_TIMEOUT' || primaryErr.retryable)
    ) {
      console.info(
        `[${params.label}] Switching from ${primaryModel} (${primaryErr.code}) to ${secondaryModel}`
      );
      try {
        response = await generateWithRetry(
          (abortSignal) =>
            ai.models.generateContent({
              model: secondaryModel,
              contents: params.contents,
              config: {
                systemInstruction: params.systemInstruction,
                safetySettings: K12_SAFETY_SETTINGS,
                responseMimeType: 'application/json',
                responseSchema: params.schema,
                thinkingConfig: { thinkingLevel: secondaryThinking },
                abortSignal,
              },
            }),
          fallbackTimeoutMs,
          { retryOnTransientExhaustion: true, maxRetries: 2 }
        );
      } catch (secondaryErr) {
        if (
          secondaryErr instanceof GeminiServiceError &&
          (secondaryErr.code === 'MODEL_TIMEOUT' || secondaryErr.retryable)
        ) {
          console.info(
            `[${params.label}] ${secondaryModel} also transient (${secondaryErr.code}); waiting briefly to retry ${primaryModel}`
          );
          await new Promise((resolve) => setTimeout(resolve, 1600 + Math.floor(Math.random() * 500)));
          response = await generateWithRetry(
            (abortSignal) =>
              ai.models.generateContent({
                model: primaryModel,
                contents: params.contents,
                config: {
                  systemInstruction: params.systemInstruction,
                  safetySettings: K12_SAFETY_SETTINGS,
                  responseMimeType: 'application/json',
                  responseSchema: params.schema,
                  thinkingConfig: { thinkingLevel: primaryThinking },
                  abortSignal,
                },
              }),
            fallbackTimeoutMs,
            { retryOnTransientExhaustion: true, maxRetries: 1 }
          );
        } else {
          throw secondaryErr;
        }
      }
    } else {
      throw primaryErr;
    }
  }
  return response.text;
}

const PRACTICE_SET_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    adaptiveReason: { type: Type.STRING, description: 'Short explanation of how questions match difficulty and target mistakes.' },
    syllabusNote: { type: Type.STRING, description: 'Honest board alignment disclaimer without fabricating official citations.' },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          questionType: {
            type: Type.STRING,
            enum: ['mcq', 'true-false', 'fill-blank', 'short-answer', 'numerical'],
          },
          difficulty: {
            type: Type.STRING,
            enum: ['foundation', 'intermediate', 'board-challenge'],
          },
          prompt: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            description: '4 options for mcq; ["True","False"] for true-false; empty array [] for fill-blank, short-answer, numerical.',
            items: { type: Type.STRING },
          },
          correctAnswer: { type: Type.STRING },
          acceptableAnswers: { type: Type.ARRAY, items: { type: Type.STRING } },
          numericalValue: { type: Type.NUMBER, description: 'Numeric value for numerical questions; 0 if non-numerical.' },
          numericalTolerance: { type: Type.NUMBER, description: 'Allowed tolerance for numerical questions; 0.05 default.' },
          unit: { type: Type.STRING, description: 'SI or problem unit if numerical, else empty string.' },
          expectedKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
          hint: { type: Type.STRING },
          explanation: { type: Type.STRING },
          errorTag: { type: Type.STRING, description: 'Short kebab-case conceptual error tag e.g. sign-convention-error.' },
          commonMistake: { type: Type.STRING, description: 'What misconception causes wrong answers here.' },
        },
        required: [
          'id',
          'questionType',
          'difficulty',
          'prompt',
          'options',
          'correctAnswer',
          'hint',
          'explanation',
          'errorTag',
          'commonMistake',
        ],
      },
    },
  },
  required: ['adaptiveReason', 'syllabusNote', 'questions'],
};

export async function generateAdaptivePracticeSet(
  rawPayload: Partial<PracticeGenerateRequest>
): Promise<PracticeGenerateResponse> {
  const validation = validatePracticeGenerateRequest(rawPayload);
  if (!validation.valid || !validation.sanitized) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', validation.error || 'Invalid practice request.');
  }
  const req = validation.sanitized;

  const isSimilarFollowUp = Boolean(req.similarToQuestion?.prompt);
  const effectiveCount = isSimilarFollowUp ? 1 : req.count;

  const systemInstruction = `You are EDUVERSE AI Adaptive Practice Architect for Indian school students (${req.classGrade}, ${req.board} Board, Subject: ${req.subject}).
${getLanguageInstruction(req.language)}

Generate ${effectiveCount} high-quality practice question(s) for Topic "${req.topic}" (Chapter: "${req.chapter}") at "${req.difficulty}" difficulty.
Allowed question formats: ${req.questionTypes.join(', ')}. Distribute across requested formats cleanly!

Format Rules:
- mcq: Provide exactly 4 plausible distinct options in \`options\`. \`correctAnswer\` MUST match one option verbatim.
- true-false: Set \`options\` to ["True", "False"] and \`correctAnswer\` to "True" or "False".
- fill-blank: Include "_____" inside \`prompt\`. Put the exact word/phrase in \`correctAnswer\` and 1-2 synonyms/variants in \`acceptableAnswers\`. Set \`options: []\`.
- numerical: Only for quantitative topics (Physics/Math/Chemistry calculations). Set numeric target in \`numericalValue\`, reasonable \`numericalTolerance\` (e.g. 0.05), \`unit\` (e.g. "cm", "m/s", "A"), and \`correctAnswer\` like "12.5 cm". Set \`options: []\`.
- short-answer: Conceptual 1-2 sentence question. Put model concise answer in \`correctAnswer\` and 3 core concept keywords in \`expectedKeywords\`. Set \`options: []\`.
- Always provide a clear \`hint\`, thorough step-by-step \`explanation\`, a concise kebab-case \`errorTag\` (2-4 words, e.g. "sign-convention-error", "formula-inversion"), and \`commonMistake\`.
- Never fabricate official NCERT/ICSE page numbers or circular codes.`;

  const promptText = [
    `Board & Grade: ${req.board}, ${req.classGrade}`,
    `Subject: ${req.subject} | Chapter: ${req.chapter} | Topic: ${req.topic}`,
    `Target Difficulty: ${req.difficulty}`,
    `Requested Formats: ${req.questionTypes.join(', ')}`,
    req.focusErrorTag ? `Target Misconception / Error Tag to address: ${req.focusErrorTag}` : '',
    req.previousPerformanceSummary ? `Student Performance Context: ${req.previousPerformanceSummary}` : '',
    isSimilarFollowUp && req.similarToQuestion
      ? `GENERATE 1 FRESH ANALOGOUS FOLLOW-UP QUESTION testing the exact same concept as: "${req.similarToQuestion.prompt}" (use new numbers/scenario, preferred type: ${req.similarToQuestion.questionType}).`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const rawText = await generateJsonWithFastFallback({
    label: 'Adaptive Practice',
    systemInstruction,
    contents: promptText,
    schema: PRACTICE_SET_SCHEMA,
  });

  const parsed = safeParseJson<Partial<PracticeGenerateResponse>>(
    rawText,
    'Could not parse generated practice questions. Please retry.'
  );

  const validTypes: QuestionType[] = ['mcq', 'true-false', 'fill-blank', 'short-answer', 'numerical'];
  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions: PracticeQuestion[] = rawQuestions.slice(0, 8).map((q, idx) => {
    const qType: QuestionType = validTypes.includes(q.questionType as QuestionType)
      ? (q.questionType as QuestionType)
      : req.questionTypes[idx % req.questionTypes.length];
    const diff: DifficultyTier =
      q.difficulty === 'foundation' || q.difficulty === 'board-challenge'
        ? q.difficulty
        : req.difficulty;

    const options =
      qType === 'true-false'
        ? ['True', 'False']
        : qType === 'mcq' && Array.isArray(q.options) && q.options.length >= 2
          ? q.options.slice(0, 4)
          : undefined;

    return {
      id: sanitizeDocumentId(q.id || `pq_${Date.now()}_${idx}`, 'pq'),
      questionType: qType,
      difficulty: diff,
      subject: req.subject,
      chapter: req.chapter,
      topic: req.topic,
      prompt: (q.prompt || `Practice question ${idx + 1} on ${req.topic}`).trim(),
      options,
      correctAnswer: (q.correctAnswer || (options ? options[0] : 'Concept application')).trim(),
      acceptableAnswers: Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : [],
      numericalValue: typeof q.numericalValue === 'number' && Number.isFinite(q.numericalValue) ? q.numericalValue : undefined,
      numericalTolerance: typeof q.numericalTolerance === 'number' && q.numericalTolerance >= 0 ? q.numericalTolerance : 0.05,
      unit: typeof q.unit === 'string' && q.unit.trim() ? q.unit.trim() : undefined,
      expectedKeywords: Array.isArray(q.expectedKeywords) ? q.expectedKeywords : [],
      hint: (q.hint || 'Break down the problem from the fundamental definition.').trim(),
      explanation: (q.explanation || 'Apply the governing concept carefully step by step.').trim(),
      errorTag: sanitizeDocumentId(q.errorTag || 'conceptual-gap', 'err').replace(/^err_/, '').slice(0, 80),
      commonMistake: (q.commonMistake || 'Watch out for sign conventions, units, or condition limits.').trim(),
    };
  });

  if (questions.length === 0) {
    throw new GeminiServiceError(502, 'AI_EMPTY_RESPONSE', 'No practice questions were returned. Please retry.', true);
  }

  return {
    questions,
    adaptiveReason:
      parsed.adaptiveReason ||
      `Calibrated to ${req.difficulty} difficulty for ${req.topic}${req.focusErrorTag ? ` focusing on ${req.focusErrorTag}` : ''}.`,
    syllabusNote:
      parsed.syllabusNote ||
      `Practice items aligned with typical ${req.classGrade} ${req.board} concepts. Refer to verified syllabus records for official exam scope.`,
  };
}

const SHORT_ANSWER_EVAL_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    isCorrect: { type: Type.BOOLEAN },
    scoreRatio: { type: Type.NUMBER, description: 'Score between 0.0 and 1.0' },
    feedback: { type: Type.STRING },
    detectedErrorTag: { type: Type.STRING, description: 'Empty string if correct, else kebab-case error tag.' },
    misconceptionNote: { type: Type.STRING, description: 'Empty string if correct, else brief constructive diagnosis.' },
  },
  required: ['isCorrect', 'scoreRatio', 'feedback', 'detectedErrorTag', 'misconceptionNote'],
};

export async function evaluateShortAnswerResponse(
  rawPayload: Partial<ShortAnswerEvaluateRequest>
): Promise<ShortAnswerEvaluateResponse> {
  const questionPrompt = (rawPayload.questionPrompt || '').trim();
  const studentAnswer = (rawPayload.studentAnswer || '').trim();
  if (!questionPrompt || !studentAnswer) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', 'Question prompt and student answer are required.');
  }

  const language = normalizeLanguageForTutor(rawPayload.language);

  const systemInstruction = `You are a fair, encouraging Indian board examiner evaluating a short answer for ${rawPayload.classGrade || 'Class 10'} (${rawPayload.board || 'CBSE'}, ${rawPayload.subject || 'General'}).
${getLanguageInstruction(language)}
Award credit for conceptually sound student wording even if phrased differently from the model key. Mark \`isCorrect: true\` when \`scoreRatio >= 0.6\`. Never mock or discourage the student.`;

  const promptText = [
    `Topic: ${rawPayload.topic || 'Core Concept'}`,
    `Question: ${questionPrompt}`,
    `Expected Key Answer: ${rawPayload.expectedAnswer || ''}`,
    Array.isArray(rawPayload.expectedKeywords) && rawPayload.expectedKeywords.length > 0
      ? `Core Concepts Expected: ${rawPayload.expectedKeywords.join(', ')}`
      : '',
    `Student Answer: ${studentAnswer}`,
  ]
    .filter(Boolean)
    .join('\n');

  const rawText = await generateJsonWithFastFallback({
    label: 'Short Answer Eval',
    systemInstruction,
    contents: promptText,
    schema: SHORT_ANSWER_EVAL_SCHEMA,
  });

  const parsed = safeParseJson<Partial<ShortAnswerEvaluateResponse>>(
    rawText,
    'Could not evaluate short answer right now.'
  );

  const scoreRatio =
    typeof parsed.scoreRatio === 'number' && Number.isFinite(parsed.scoreRatio)
      ? Number(Math.min(1, Math.max(0, parsed.scoreRatio)).toFixed(2))
      : parsed.isCorrect
        ? 1
        : 0.3;

  const isCorrect = typeof parsed.isCorrect === 'boolean' ? parsed.isCorrect : scoreRatio >= 0.6;

  return {
    isCorrect,
    scoreRatio,
    feedback: parsed.feedback || (isCorrect ? 'Well explained!' : 'Partial credit — review the key mechanism.'),
    detectedErrorTag: isCorrect ? '' : (parsed.detectedErrorTag || 'incomplete-concept-explanation').slice(0, 80),
    misconceptionNote: isCorrect ? '' : (parsed.misconceptionNote || 'Missed key conceptual link.').slice(0, 600),
  };
}

const REMEDIATE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    coreExplanation: { type: Type.STRING },
    wrongVsRightComparison: {
      type: Type.OBJECT,
      properties: {
        commonTrap: { type: Type.STRING },
        correctApproach: { type: Type.STRING },
      },
      required: ['commonTrap', 'correctApproach'],
    },
    quickCheckQuestion: {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING },
        answer: { type: Type.STRING },
      },
      required: ['prompt', 'answer'],
    },
    recommendedAction: { type: Type.STRING },
  },
  required: ['headline', 'coreExplanation', 'wrongVsRightComparison', 'quickCheckQuestion', 'recommendedAction'],
};

export async function generateErrorRemediation(
  rawPayload: Partial<RemediateRequest>
): Promise<RemediateResponse> {
  const topic = (rawPayload.topic || '').trim();
  const errorTag = (rawPayload.errorTag || '').trim();
  if (!topic || !errorTag) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', 'Topic and errorTag are required for targeted remediation.');
  }

  const language = normalizeLanguageForTutor(rawPayload.language);

  const systemInstruction = `You are EDUVERSE AI Conceptual Mentor helping a ${rawPayload.classGrade || 'Class 10'} (${rawPayload.board || 'CBSE'}) student fix a recurring mistake without judgment.
${getLanguageInstruction(language)}
Explain WHY the recurring error happens, contrast the common trap vs the exact right reasoning, and give 1 crisp quick-check question.`;

  const promptText = [
    `Subject: ${rawPayload.subject || 'General'} | Topic: ${topic}`,
    `Recurring Error Pattern: ${errorTag}`,
    `Misconception Context: ${rawPayload.sampleMisconception || 'Repeated confusion in solving steps.'}`,
  ].join('\n');

  const rawText = await generateJsonWithFastFallback({
    label: 'Error Remediation',
    systemInstruction,
    contents: promptText,
    schema: REMEDIATE_SCHEMA,
  });

  const parsed = safeParseJson<Partial<RemediateResponse>>(
    rawText,
    'Unable to generate targeted remediation explanation.'
  );

  return {
    headline: parsed.headline || `Clearing up ${errorTag.replace(/-/g, ' ')} in ${topic}`,
    coreExplanation: parsed.coreExplanation || 'Focus on the core rule governing this step before substituting values.',
    wrongVsRightComparison: parsed.wrongVsRightComparison || {
      commonTrap: rawPayload.sampleMisconception || 'Applying the formula without checking boundary conditions.',
      correctApproach: 'Verify sign conventions, definitions, and units before solving.',
    },
    quickCheckQuestion: parsed.quickCheckQuestion || {
      prompt: `In ${topic}, what check should you perform first to avoid ${errorTag.replace(/-/g, ' ')}?`,
      answer: 'State the rule and verify conditions/signs before calculating.',
    },
    recommendedAction:
      parsed.recommendedAction || 'Try 3 Foundation practice questions targeting this pattern and save a recall card.',
  };
}

const FLASHCARD_GENERATE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    syllabusNote: { type: Type.STRING },
    cards: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          front: { type: Type.STRING, description: 'Active-recall prompt or formula question on front of card.' },
          back: { type: Type.STRING, description: 'Clear crisp answer/formula/rule on back of card.' },
          hint: { type: Type.STRING, description: 'Short 1-line memory cue.' },
          topic: { type: Type.STRING },
          linkedErrorTag: { type: Type.STRING, description: 'Optional kebab-case tag or empty string.' },
        },
        required: ['front', 'back', 'hint', 'topic'],
      },
    },
  },
  required: ['syllabusNote', 'cards'],
};

export async function generateAdaptiveFlashcards(
  rawPayload: Partial<FlashcardGenerateRequest>
): Promise<FlashcardGenerateResponse> {
  const validation = validateFlashcardGenerateRequest(rawPayload);
  if (!validation.valid || !validation.sanitized) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', validation.error || 'Invalid flashcard generation request.');
  }
  const req = validation.sanitized;

  const systemInstruction = `You are EDUVERSE AI Active Recall Specialist for ${req.classGrade} (${req.board} Board, Subject: ${req.subject}).
${getLanguageInstruction(req.language)}

Generate ${req.count} sharp, high-retention active recall flashcards for Chapter "${req.chapter}" / Topic "${req.topic}".
- Front must ask a crisp recall question (formula, law condition, difference, or conceptual trap — never vague "Explain chapter").
- Back must give a concise, exam-ready answer (under 3 sentences).
- ${req.focusErrorTag ? `PRIORITIZE fixing recurring misconception "${req.focusErrorTag}" (${req.misconceptionNote || ''}) so the student never repeats this mistake.` : ''}
- Never fabricate official NCERT page numbers.`;

  const promptText = [
    `Subject: ${req.subject} | Chapter: ${req.chapter} | Topic: ${req.topic}`,
    `Card Count: ${req.count}`,
    req.focusErrorTag ? `Focus Misconception: ${req.focusErrorTag} — ${req.misconceptionNote || ''}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const rawText = await generateJsonWithFastFallback({
    label: 'Flashcard Generator',
    systemInstruction,
    contents: promptText,
    schema: FLASHCARD_GENERATE_SCHEMA,
  });

  const parsed = safeParseJson<Partial<FlashcardGenerateResponse>>(
    rawText,
    'Could not parse generated flashcards. Please retry.'
  );

  const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
  if (rawCards.length === 0) {
    throw new GeminiServiceError(502, 'AI_EMPTY_RESPONSE', 'No flashcards returned. Please retry.', true);
  }

  return {
    cards: rawCards.slice(0, 8).map((c) => ({
      front: (c.front || `Recall key rule for ${req.topic}`).trim().slice(0, 800),
      back: (c.back || 'Review core concept definition.').trim().slice(0, 1400),
      hint: (c.hint || 'Think about the underlying principle.').trim().slice(0, 400),
      topic: (c.topic || req.topic).trim().slice(0, 160),
      linkedErrorTag: (c.linkedErrorTag || req.focusErrorTag || '').trim().slice(0, 80) || undefined,
    })),
    syllabusNote:
      parsed.syllabusNote ||
      `Active-recall deck aligned with ${req.classGrade} ${req.board} concepts.`,
  };
}

// ==========================================
// PHASE 5: EXAM SIMULATOR ENGINE
// ==========================================

const ALL_EXAM_QUESTION_TYPES: ExamQuestionType[] = [
  'mcq',
  'multiple-select',
  'true-false',
  'fill-blank',
  'short-answer',
  'long-answer',
  'numerical',
];

const EXAM_PAPER_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    syllabusNote: {
      type: Type.STRING,
      description: 'Honest board practice alignment note explicitly clarifying this is an AI practice mock, not an official board examination.',
    },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          section: { type: Type.STRING, description: 'e.g. Section A (Objective), Section B (Short Answer), Section C (Long & Numerical)' },
          questionType: {
            type: Type.STRING,
            enum: ['mcq', 'multiple-select', 'true-false', 'fill-blank', 'short-answer', 'long-answer', 'numerical'],
          },
          difficulty: {
            type: Type.STRING,
            enum: ['foundation', 'intermediate', 'board-challenge'],
          },
          chapter: { type: Type.STRING },
          topic: { type: Type.STRING },
          marks: { type: Type.INTEGER },
          prompt: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '4 distinct options for mcq and multiple-select; ["True", "False"] for true-false; empty [] for other types.',
          },
          correctAnswer: { type: Type.STRING },
          correctAnswers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Required for multiple-select (2 or 3 exact items from options); empty [] otherwise.',
          },
          acceptableAnswers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          numericalValue: { type: Type.NUMBER },
          numericalTolerance: { type: Type.NUMBER },
          unit: { type: Type.STRING },
          expectedKeywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          markingRubric: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          explanation: { type: Type.STRING },
          errorTag: { type: Type.STRING },
          commonMistake: { type: Type.STRING },
        },
        required: [
          'id',
          'section',
          'questionType',
          'difficulty',
          'chapter',
          'topic',
          'marks',
          'prompt',
          'options',
          'correctAnswer',
          'explanation',
          'errorTag',
          'commonMistake',
        ],
      },
    },
  },
  required: ['title', 'syllabusNote', 'questions'],
};

function defaultMarksForExamQuestion(qType: ExamQuestionType): number {
  if (qType === 'mcq' || qType === 'true-false' || qType === 'fill-blank') return 1;
  if (qType === 'multiple-select' || qType === 'numerical') return 2;
  if (qType === 'short-answer') return 3;
  return 5;
}

function defaultSectionForExamQuestion(qType: ExamQuestionType): string {
  if (qType === 'mcq' || qType === 'true-false' || qType === 'fill-blank' || qType === 'multiple-select') {
    return 'Section A · Objective & Multiple Select';
  }
  if (qType === 'short-answer' || qType === 'numerical') {
    return 'Section B · Short Answer & Numericals';
  }
  return 'Section C · Long Structured Questions';
}

export async function generateExamPaper(
  rawPayload: Partial<ExamGenerateRequest>
): Promise<ExamPaper> {
  const subject = (rawPayload.subject || '').trim().slice(0, 80);
  if (!subject) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', 'Subject is required to generate an exam paper.');
  }

  const board = (rawPayload.board || 'CBSE') as ExamPaper['board'];
  const classGrade = (rawPayload.classGrade || 'Class 10') as ExamPaper['classGrade'];
  const examMode: ExamMode =
    rawPayload.examMode === 'full-syllabus' || rawPayload.examMode === 'custom-test'
      ? rawPayload.examMode
      : 'chapter-test';
  const normalizedExamLang = normalizeLanguageForTutor(rawPayload.language);
  const language: ExamPaper['language'] =
    normalizedExamLang === 'Hindi'
      ? 'Hindi'
      : normalizedExamLang === 'Hinglish' || normalizedExamLang === 'Bilingual'
        ? 'Bilingual'
        : 'English';
  const chapter = (rawPayload.chapter || '').trim().slice(0, 160);
  const topics = Array.isArray(rawPayload.topics)
    ? rawPayload.topics.map((t) => String(t).trim()).filter(Boolean).slice(0, 12)
    : [];

  const durationMinutes = Math.max(5, Math.min(240, Math.round(Number(rawPayload.durationMinutes) || 30)));
  const questionCount = Math.max(3, Math.min(25, Math.round(Number(rawPayload.questionCount) || 8)));
  const difficultyMix =
    rawPayload.difficultyMix === 'foundation-focus' || rawPayload.difficultyMix === 'board-challenge'
      ? rawPayload.difficultyMix
      : 'balanced';
  const negativeMarkingEnabled = Boolean(rawPayload.negativeMarkingEnabled);

  const requestedTypesRaw = Array.isArray(rawPayload.questionTypes) ? rawPayload.questionTypes : [];
  const questionTypes = requestedTypesRaw.filter((t): t is ExamQuestionType =>
    ALL_EXAM_QUESTION_TYPES.includes(t as ExamQuestionType)
  );
  const activeTypes: ExamQuestionType[] =
    questionTypes.length > 0
      ? questionTypes
      : ['mcq', 'multiple-select', 'true-false', 'fill-blank', 'short-answer', 'numerical'];

  const scopeDescription =
    examMode === 'full-syllabus'
      ? `Full Subject Revision Mock across core ${classGrade} ${subject} chapters`
      : examMode === 'custom-test'
        ? `Custom Test focusing on ${chapter || subject}${topics.length > 0 ? ` (${topics.join(', ')})` : ''}`
        : `Chapter-Wise Test on "${chapter || 'Core Concepts'}"${topics.length > 0 ? ` covering ${topics.join(', ')}` : ''}`;

  const systemInstruction = `You are an expert Indian school exam paper setter creating an AI-GENERATED PRACTICE PAPER for ${classGrade} (${board} Board, Subject: ${subject}).
${getLanguageInstruction(language)}

STRICT COMPLIANCE & QUALITY RULES:
1. NEVER claim this is an official board exam, CBSE/CISCE question paper, or leaked/previous official paper. Clearly frame syllabusNote as AI-generated self-assessment practice.
2. Scope: ${scopeDescription}.
3. Generate EXACTLY ${questionCount} questions distributed cleanly across these formats: ${activeTypes.join(', ')}.
4. Difficulty mix preference: ${difficultyMix}.
5. Question type rules:
   - "mcq": 4 distinct options; correctAnswer MUST match one option verbatim (1 mark).
   - "multiple-select": 4 distinct options; correctAnswers MUST list 2 or 3 exact options verbatim; correctAnswer is them comma-joined (2 marks).
   - "true-false": options MUST be ["True", "False"]; correctAnswer is "True" or "False" (1 mark).
   - "fill-blank": options=[]; prompt contains "____"; provide exact correctAnswer + acceptableAnswers (1 mark).
   - "numerical": options=[]; provide numeric answer string (with unit if applicable) AND exact numeric numericalValue, numericalTolerance (e.g. 0.05), unit (2 marks).
   - "short-answer": options=[]; 2-3 marks; provide concise model answer in correctAnswer + 3-5 expectedKeywords + 2-3 markingRubric checkpoints.
   - "long-answer": options=[]; 4-5 marks; provide structured board-style marking scheme in correctAnswer + 4-6 expectedKeywords + 3-4 markingRubric checkpoints.
6. Every question MUST specify accurate topic, chapter, marks, explanation, kebab-case errorTag, and commonMistake.`;

  const promptText = [
    `Board: ${board} | Class: ${classGrade} | Subject: ${subject}`,
    `Exam Mode: ${examMode}`,
    chapter ? `Selected Chapter: ${chapter}` : 'Scope: Broad multi-chapter mock',
    topics.length > 0 ? `Priority Topics: ${topics.join(', ')}` : '',
    `Question Count: ${questionCount}`,
    `Allowed Question Types: ${activeTypes.join(', ')}`,
    `Difficulty Mix: ${difficultyMix}`,
    `Negative Marking Enabled: ${negativeMarkingEnabled ? 'Yes (objective errors deduct 0.25x marks)' : 'No'}`,
  ]
    .filter(Boolean)
    .join('\n');

  const rawText = await generateJsonWithFastFallback({
    label: 'Exam Paper Generator',
    systemInstruction,
    contents: promptText,
    schema: EXAM_PAPER_SCHEMA,
  });

  const parsed = safeParseJson<{ title?: string; syllabusNote?: string; questions?: Partial<ExamQuestion>[] }>(
    rawText,
    'Could not parse generated exam paper. Please retry.'
  );

  const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
  if (rawQuestions.length === 0) {
    throw new GeminiServiceError(502, 'AI_EMPTY_RESPONSE', 'Exam paper returned no questions. Please retry.', true);
  }

  const questions: ExamQuestion[] = rawQuestions.slice(0, 25).map((q, idx) => {
    const qType: ExamQuestionType = ALL_EXAM_QUESTION_TYPES.includes(q.questionType as ExamQuestionType)
      ? (q.questionType as ExamQuestionType)
      : activeTypes[idx % activeTypes.length];

    const diff: DifficultyTier =
      q.difficulty === 'foundation' || q.difficulty === 'intermediate' || q.difficulty === 'board-challenge'
        ? q.difficulty
        : 'intermediate';

    let options: string[] | undefined;
    if (qType === 'true-false') {
      options = ['True', 'False'];
    } else if (qType === 'mcq' || qType === 'multiple-select') {
      const cleaned = Array.isArray(q.options)
        ? q.options.map((o) => String(o).trim()).filter(Boolean)
        : [];
      options = cleaned.length >= 2 ? cleaned.slice(0, 4) : ['Option A', 'Option B', 'Option C', 'Option D'];
    }

    let correctAnswer = (q.correctAnswer || '').trim();
    let correctAnswers: string[] | undefined;

    if (qType === 'multiple-select' && options) {
      const candidateCorrect = Array.isArray(q.correctAnswers)
        ? q.correctAnswers.map((c) => String(c).trim()).filter((c) => options!.includes(c))
        : [];
      correctAnswers =
        candidateCorrect.length > 0 ? candidateCorrect : options.slice(0, Math.min(2, options.length));
      correctAnswer = correctAnswers.join(', ');
    } else if (qType === 'mcq' && options) {
      if (!options.includes(correctAnswer)) {
        correctAnswer = options[0];
      }
    } else if (qType === 'true-false') {
      correctAnswer = correctAnswer.toLowerCase().startsWith('f') ? 'False' : 'True';
    } else if (!correctAnswer) {
      correctAnswer = 'Core conceptual derivation';
    }

    const marks =
      typeof q.marks === 'number' && Number.isFinite(q.marks) && q.marks >= 1 && q.marks <= 10
        ? Math.round(q.marks)
        : defaultMarksForExamQuestion(qType);

    const isObjective = !isSubjectiveExamQuestion(qType);
    const negativeMarks =
      negativeMarkingEnabled && isObjective ? Number((marks * 0.25).toFixed(2)) : 0;

    return {
      id: sanitizeDocumentId(q.id || `eq_${idx + 1}`, 'eq'),
      questionNumber: idx + 1,
      section: (q.section || defaultSectionForExamQuestion(qType)).trim().slice(0, 80),
      questionType: qType,
      difficulty: diff,
      subject,
      chapter: (q.chapter || chapter || subject).trim().slice(0, 160),
      topic: (q.topic || topics[idx % Math.max(1, topics.length)] || chapter || subject)
        .trim()
        .slice(0, 160),
      marks,
      negativeMarks,
      prompt: (q.prompt || `Question ${idx + 1} on ${subject}`).trim(),
      options,
      correctAnswer,
      correctAnswers,
      acceptableAnswers: Array.isArray(q.acceptableAnswers)
        ? q.acceptableAnswers.map((a) => String(a).trim()).filter(Boolean)
        : [],
      numericalValue:
        typeof q.numericalValue === 'number' && Number.isFinite(q.numericalValue)
          ? q.numericalValue
          : undefined,
      numericalTolerance:
        typeof q.numericalTolerance === 'number' && q.numericalTolerance >= 0
          ? q.numericalTolerance
          : 0.05,
      unit: typeof q.unit === 'string' && q.unit.trim() ? q.unit.trim() : undefined,
      expectedKeywords: Array.isArray(q.expectedKeywords)
        ? q.expectedKeywords.map((k) => String(k).trim()).filter(Boolean)
        : [],
      markingRubric: Array.isArray(q.markingRubric)
        ? q.markingRubric.map((r) => String(r).trim()).filter(Boolean)
        : [],
      explanation: (q.explanation || 'Apply the governing concept and verify units/steps carefully.').trim(),
      errorTag: sanitizeDocumentId(q.errorTag || 'conceptual-gap', 'err')
        .replace(/^err_/, '')
        .slice(0, 80),
      commonMistake: (q.commonMistake || 'Watch out for boundary conditions, signs, or units.').trim(),
    };
  });

  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
  const examId = sanitizeDocumentId(
    `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    'exam'
  );

  return {
    id: examId,
    title:
      (parsed.title || '').trim().slice(0, 180) ||
      `${classGrade} ${subject} · ${
        examMode === 'full-syllabus'
          ? 'Full Syllabus Practice Mock'
          : examMode === 'custom-test'
            ? 'Custom Practice Paper'
            : `${chapter || 'Chapter'} Practice Test`
      }`,
    board,
    classGrade,
    subject,
    chapter: chapter || undefined,
    examMode,
    language,
    durationMinutes,
    totalMarks,
    negativeMarkingEnabled,
    isOfficialBoardExam: false,
    paperDisclaimer: buildExamPaperDisclaimer(board, classGrade),
    syllabusNote:
      parsed.syllabusNote ||
      `AI-generated practice mock calibrated for ${classGrade} ${board}. Not an official board examination.`,
    questions,
    createdAt: new Date().toISOString(),
  };
}

interface SignedExamTokenPayload {
  sessionId: string;
  examId: string;
  durationMinutes: number;
  startedAt: number;
  expiresAt: number;
}

function getExamSigningSecret(): string {
  return (
    process.env.EXAM_SESSION_SECRET ||
    process.env.GEMINI_API_KEY ||
    'eduverse-exam-session-integrity-key'
  ).trim();
}

function signExamToken(payload: SignedExamTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getExamSigningSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyExamToken(token: string): SignedExamTokenPayload | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getExamSigningSecret())
    .update(encoded)
    .digest('base64url');

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as SignedExamTokenPayload;
    if (
      !parsed.sessionId ||
      !parsed.examId ||
      typeof parsed.startedAt !== 'number' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const STRICT_EXAM_ID_RE = /^[a-zA-Z0-9_\-]{1,128}$/;

export function startExamSession(rawPayload: Partial<ExamStartRequest>): ExamStartResponse {
  const examId = (rawPayload.examId || '').trim();
  if (!STRICT_EXAM_ID_RE.test(examId)) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', 'Valid examId is required to start a timed exam.');
  }
  const durationMinutes = Math.max(5, Math.min(240, Math.round(Number(rawPayload.durationMinutes) || 30)));
  const sessionId = `esess_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
  const startedAt = Date.now();
  const expiresAt = startedAt + durationMinutes * 60 * 1000;

  const examToken = signExamToken({
    sessionId,
    examId,
    durationMinutes,
    startedAt,
    expiresAt,
  });

  return {
    sessionId,
    examId,
    startedAt,
    expiresAt,
    durationMinutes,
    examToken,
  };
}

const processedExamSubmissions = new Map<string, ExamSubmitResponse>();
const inFlightExamSubmissions = new Map<string, Promise<ExamSubmitResponse>>();

function storeProcessedExamSubmission(submissionId: string, response: ExamSubmitResponse): void {
  if (processedExamSubmissions.size >= 500) {
    const oldestKey = processedExamSubmissions.keys().next().value;
    if (oldestKey) processedExamSubmissions.delete(oldestKey);
  }
  processedExamSubmissions.set(submissionId, response);
}

const EXAM_SUBJECTIVE_BATCH_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    evaluations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          questionId: { type: Type.STRING },
          marksAwarded: { type: Type.NUMBER },
          isCorrect: { type: Type.BOOLEAN },
          feedback: { type: Type.STRING },
          detectedErrorTag: { type: Type.STRING },
          misconceptionNote: { type: Type.STRING },
        },
        required: [
          'questionId',
          'marksAwarded',
          'isCorrect',
          'feedback',
          'detectedErrorTag',
          'misconceptionNote',
        ],
      },
    },
  },
  required: ['evaluations'],
};

interface SubjectiveEvalItem {
  question: ExamQuestion;
  studentAnswer: string;
  markedForReview: boolean;
}

async function evaluateExamSubjectiveBatch(
  paper: ExamPaper,
  items: SubjectiveEvalItem[]
): Promise<Map<string, ExamQuestionResult>> {
  const resultMap = new Map<string, ExamQuestionResult>();
  if (items.length === 0) return resultMap;

  try {
    const systemInstruction = `You are a fair Indian board examiner grading subjective exam answers for ${paper.classGrade} (${paper.board}, ${paper.subject}).
${getLanguageInstruction(paper.language)}
Evaluate every item strictly against its maxMarks and marking rubric.
- Award step/partial marks proportionally (half-mark increments allowed).
- Mark \`isCorrect: true\` when marksAwarded >= 0.6 * maxMarks.
- Never award more than maxMarks or less than 0.
- Provide constructive examiner feedback and a kebab-case detectedErrorTag when marks are deducted.`;

    const promptText = items
      .map(
        (item, i) =>
          `[${i + 1}] questionId: ${item.question.id} | Type: ${item.question.questionType} | Max Marks: ${item.question.marks}\nPrompt: ${item.question.prompt}\nModel Answer: ${item.question.correctAnswer}\nRubric/Keywords: ${(item.question.markingRubric?.length ? item.question.markingRubric : item.question.expectedKeywords || []).join('; ')}\nStudent Answer: ${item.studentAnswer}`
      )
      .join('\n\n---\n\n');

    const rawText = await generateJsonWithFastFallback({
      label: 'Exam Subjective Batch Grader',
      systemInstruction,
      contents: promptText,
      schema: EXAM_SUBJECTIVE_BATCH_SCHEMA,
    });

    const parsed = safeParseJson<{
      evaluations?: Array<{
        questionId?: string;
        marksAwarded?: number;
        isCorrect?: boolean;
        feedback?: string;
        detectedErrorTag?: string;
        misconceptionNote?: string;
      }>;
    }>(rawText, 'Subjective batch parser failed.');

    const byId = new Map(
      (parsed.evaluations || [])
        .filter((e) => e && typeof e.questionId === 'string')
        .map((e) => [e.questionId!, e])
    );

    for (const item of items) {
      const ev = byId.get(item.question.id);
      if (!ev) {
        resultMap.set(
          item.question.id,
          gradeSubjectiveKeywordFallback(item.question, item.studentAnswer, item.markedForReview)
        );
        continue;
      }
      const rawMarks =
        typeof ev.marksAwarded === 'number' && Number.isFinite(ev.marksAwarded)
          ? ev.marksAwarded
          : ev.isCorrect
            ? item.question.marks
            : item.question.marks * 0.4;
      const marksAwarded = Number(
        Math.min(item.question.marks, Math.max(0, Math.round(rawMarks * 2) / 2)).toFixed(2)
      );
      const isCorrect =
        typeof ev.isCorrect === 'boolean'
          ? ev.isCorrect
          : marksAwarded >= item.question.marks * 0.6;

      resultMap.set(item.question.id, {
        questionId: item.question.id,
        questionNumber: item.question.questionNumber,
        questionType: item.question.questionType,
        difficulty: item.question.difficulty,
        topic: item.question.topic,
        chapter: item.question.chapter,
        prompt: item.question.prompt,
        maxMarks: item.question.marks,
        marksAwarded,
        isCorrect,
        isAttempted: true,
        evaluationMethod: 'ai-subjective-rubric',
        studentAnswerDisplay: item.studentAnswer,
        expectedAnswerDisplay: item.question.correctAnswer,
        feedback: (
          ev.feedback ||
          (isCorrect
            ? `Clear explanation (${marksAwarded}/${item.question.marks} marks).`
            : `Partial credit (${marksAwarded}/${item.question.marks} marks).`)
        ).slice(0, 600),
        explanation: item.question.explanation,
        detectedErrorTag: isCorrect
          ? ''
          : (ev.detectedErrorTag || item.question.errorTag || 'incomplete-explanation').slice(0, 80),
        misconceptionNote: isCorrect
          ? ''
          : (ev.misconceptionNote || item.question.commonMistake).slice(0, 500),
        markedForReview: item.markedForReview,
      });
    }
  } catch (err) {
    console.warn('[Exam Subjective Batch Grader] Falling back to rubric keyword matcher:', err);
    for (const item of items) {
      resultMap.set(
        item.question.id,
        gradeSubjectiveKeywordFallback(item.question, item.studentAnswer, item.markedForReview)
      );
    }
  }

  return resultMap;
}

export async function submitAndGradeExam(
  rawPayload: Partial<ExamSubmitRequest> & { userId?: string }
): Promise<ExamSubmitResponse> {
  const submissionId = (rawPayload.submissionId || '').trim();
  const sessionId = (rawPayload.sessionId || '').trim();
  const examToken = (rawPayload.examToken || '').trim();
  const paper = rawPayload.paper;

  if (
    !STRICT_EXAM_ID_RE.test(submissionId) ||
    !STRICT_EXAM_ID_RE.test(sessionId) ||
    !examToken ||
    !paper?.id ||
    !Array.isArray(paper.questions) ||
    paper.questions.length === 0
  ) {
    throw new GeminiServiceError(
      400,
      'VALIDATION_ERROR',
      'submissionId, sessionId, signed examToken, and valid exam paper are required.'
    );
  }

  const cached = processedExamSubmissions.get(submissionId);
  if (cached) {
    return {
      ...cached,
      isDuplicateReplay: true,
    };
  }

  const pending = inFlightExamSubmissions.get(submissionId);
  if (pending) {
    const res = await pending;
    return {
      ...res,
      isDuplicateReplay: true,
    };
  }

  const tokenPayload = verifyExamToken(examToken);
  if (!tokenPayload || tokenPayload.sessionId !== sessionId || tokenPayload.examId !== paper.id) {
    throw new GeminiServiceError(
      403,
      'INVALID_EXAM_TOKEN',
      'Exam session signature could not be verified. Please restart the exam cleanly.',
      false
    );
  }

  const now = Date.now();
  const elapsedSeconds = Math.max(1, Math.round((now - tokenPayload.startedAt) / 1000));
  const overtimeSeconds = Math.max(0, Math.round((now - tokenPayload.expiresAt) / 1000));

  if (overtimeSeconds > 300) {
    throw new GeminiServiceError(
      409,
      'EXAM_WINDOW_CLOSED',
      'Server timer window expired beyond the 5-minute grace period.',
      false
    );
  }

  let timingStatus: ExamTimingStatus = 'on-time';
  let serverTimingMessage = `Verified on-time completion (${Math.ceil(elapsedSeconds / 60)}m elapsed of ${tokenPayload.durationMinutes}m).`;
  if (rawPayload.autoSubmittedOnTimeout && overtimeSeconds <= 90) {
    timingStatus = 'auto-submitted-timeout';
    serverTimingMessage = `Auto-submitted cleanly at exam timeout (${tokenPayload.durationMinutes}m limit).`;
  } else if (overtimeSeconds > 45) {
    timingStatus = 'grace-accepted';
    serverTimingMessage = `Accepted within server network-recovery grace window (+${overtimeSeconds}s).`;
  }

  const workPromise = (async (): Promise<ExamSubmitResponse> => {
    const answerList = Array.isArray(rawPayload.answers) ? rawPayload.answers : [];
    const answersByQuestionId = new Map<string, ExamAnswerSubmission>();
    for (const ans of answerList) {
      if (ans && typeof ans.questionId === 'string') {
        answersByQuestionId.set(ans.questionId, ans);
      }
    }

    const subjectiveItems: SubjectiveEvalItem[] = [];
    for (const question of paper.questions) {
      const sub = answersByQuestionId.get(question.id);
      if (isSubjectiveExamQuestion(question.questionType)) {
        const text = (sub?.textAnswer || '').trim();
        if (text) {
          subjectiveItems.push({
            question,
            studentAnswer: text,
            markedForReview: Boolean(sub?.markedForReview),
          });
        }
      }
    }

    const subjectiveEvaluations = await evaluateExamSubjectiveBatch(paper, subjectiveItems);

    const questionResults: ExamQuestionResult[] = paper.questions.map((question) => {
      const sub = answersByQuestionId.get(question.id);
      if (isSubjectiveExamQuestion(question.questionType)) {
        const graded = subjectiveEvaluations.get(question.id);
        if (graded) return graded;
        return gradeSubjectiveKeywordFallback(
          question,
          sub?.textAnswer || '',
          Boolean(sub?.markedForReview)
        );
      }
      return gradeObjectiveExamQuestion(question, sub, Boolean(paper.negativeMarkingEnabled));
    });

    const summary = computeExamBreakdowns(questionResults);
    const attemptId = sanitizeDocumentId(submissionId, 'exam');
    const userId = String(rawPayload.userId || '').trim().slice(0, 128);
    if (!userId) {
      throw new GeminiServiceError(400, 'VALIDATION_ERROR', 'Authenticated student ID is required for exam submission.');
    }

    const rawAttempt: ExamAttemptRecord = {
      id: attemptId,
      submissionId,
      sessionId,
      userId,
      examId: paper.id,
      paperTitle: paper.title,
      board: paper.board,
      classGrade: paper.classGrade,
      subject: paper.subject,
      chapter: paper.chapter,
      examMode: paper.examMode,
      language: paper.language,
      isOfficialBoardExam: false,
      durationMinutes: tokenPayload.durationMinutes,
      elapsedSeconds,
      timingStatus,
      totalQuestions: questionResults.length,
      attemptedCount: summary.attemptedCount,
      correctCount: summary.correctCount,
      incorrectCount: summary.incorrectCount,
      totalMarks: summary.totalMarks,
      marksObtained: summary.marksObtained,
      percentage: summary.percentage,
      questionResults,
      topicBreakdown: summary.topicBreakdown,
      difficultyBreakdown: summary.difficultyBreakdown,
      mistakeSummary: summary.mistakeSummary,
      recommendedRevisionTopics: summary.recommendedRevisionTopics,
      submittedAt: new Date(now).toISOString(),
    };

    const sanitizedAttempt = sanitizeExamAttemptForStorage(rawAttempt);
    const response: ExamSubmitResponse = {
      attempt: sanitizedAttempt,
      isDuplicateReplay: false,
      timingValidated: true,
      serverTimingMessage,
    };

    storeProcessedExamSubmission(submissionId, response);
    return response;
  })();

  inFlightExamSubmissions.set(submissionId, workPromise);
  try {
    return await workPromise;
  } finally {
    inFlightExamSubmissions.delete(submissionId);
  }
}

// ==========================================
// PHASE 6: VOICE LEARNING CLASSROOM SERVICES
// ==========================================

const VOICE_TURN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    detectedTopic: { type: Type.STRING, description: 'Concise school topic name detected from the student question.' },
    replyText: { type: Type.STRING, description: 'Clear readable classroom explanation for transcript display.' },
    spokenScript: {
      type: Type.STRING,
      description: 'Natural, conversational version meant to be spoken aloud (plain text, zero markdown asterisks or code blocks).',
    },
    conceptualCheck: {
      type: Type.STRING,
      description: 'One short friendly follow-up question asking the student to reason aloud.',
    },
    syllabusNote: {
      type: Type.STRING,
      description: 'Short honest curricular alignment note without fabricating official board page numbers.',
    },
  },
  required: ['detectedTopic', 'replyText', 'spokenScript', 'conceptualCheck', 'syllabusNote'],
};

export async function transcribeVoiceAudio(
  rawPayload: Partial<VoiceTranscribeRequestPayload>
): Promise<VoiceTranscribeResponsePayload> {
  const validation = validateVoiceTranscribeRequest(rawPayload);
  if (!validation.valid || !validation.sanitized) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', validation.error || 'Invalid audio clip.');
  }

  const aiBeta = getAiClient('v1beta');
  const aiDefault = getAiClient();
  if (!aiBeta && !aiDefault) {
    throw new GeminiServiceError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Gemini AI service is not configured on this server (GEMINI_API_KEY missing).'
    );
  }

  const req = validation.sanitized;
  const langHint =
    req.language === 'Hindi'
      ? 'The speaker is likely speaking Hindi (transcribe in Devanagari script cleanly) or Indian classroom terminology.'
      : req.language === 'Hinglish' || req.language === 'Bilingual'
        ? 'The speaker is using natural Hinglish / Bilingual Hindi and English (transcribe Hindi words in clean Roman Hinglish or Devanagari and technical English terms in English).'
        : 'The speaker is speaking Indian English.';

  const prompt = [
    `Listen carefully to this student's spoken audio question and transcribe the exact spoken words.${req.subjectHint ? ` Subject: ${req.subjectHint}.` : ''}`,
    langHint,
    'Return ONLY the spoken words in natural script without timestamps or extra commentary.',
  ].join(' ');

  const callTranscribe = (client: GoogleGenAI, model: string) =>
    generateWithRetry(
      () =>
        client.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: req.mimeType,
                    data: req.audioBase64,
                  },
                },
                { text: prompt },
              ],
            },
          ],
        }),
      30000
    );

  let response;
  try {
    response = await callTranscribe(aiBeta!, GEMINI_VOICE_TRANSCRIBE_MODEL);
    if (!(response.text || '').trim()) {
      throw new Error('EMPTY_TRANSCRIBE_TEXT');
    }
  } catch (err1) {
    console.warn('[Voice STT] v1beta gemini-3.5-transcribe failed, falling back to v1beta gemini-4-hydrogen:', err1 instanceof Error ? err1.message : err1);
    try {
      response = await callTranscribe(aiBeta!, GEMINI_MODEL);
    } catch (err2) {
      console.warn('[Voice STT] v1beta gemini-4-hydrogen failed, trying gemini-3.1-flash-lite:', err2 instanceof Error ? err2.message : err2);
      response = await callTranscribe(aiDefault!, GEMINI_FAST_FALLBACK_MODEL);
    }
  }

  const transcript = (response.text || '').trim().replace(/^["']|["']$/g, '');
  if (!transcript) {
    throw new GeminiServiceError(
      422,
      'EMPTY_SPEECH',
      'No clear speech was detected in that clip. Please speak closer to the mic or type your question.'
    );
  }

  return {
    transcript: transcript.slice(0, 1800),
    detectedLanguage: req.language,
  };
}

export async function runVoiceTeacherTurn(
  rawPayload: Partial<VoiceTurnRequestPayload>
): Promise<VoiceTurnResponsePayload> {
  const validation = validateVoiceTurnRequest(rawPayload);
  if (!validation.valid || !validation.sanitized) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', validation.error || 'Invalid voice turn request.');
  }

  const ai = getAiClient();
  if (!ai) {
    throw new GeminiServiceError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Gemini AI service is not configured on this server (GEMINI_API_KEY missing).'
    );
  }

  const req = validation.sanitized;
  const systemInstruction = buildVoiceClassroomInstruction({
    subject: req.subject,
    topic: req.topic,
    classGrade: req.classGrade,
    board: req.board,
    language: req.language,
  });

  const historyLines = req.history
    .map((h) => `${h.role === 'user' ? 'Student' : 'Teacher'}: ${h.content}`)
    .join('\n');

  const contents = [
    historyLines ? `Recent Classroom Conversation:\n${historyLines}\n` : '',
    `Student now says (${req.language} mode): ${req.message}`,
  ]
    .filter(Boolean)
    .join('\n');

  const rawText = await generateJsonWithFastFallback({
    label: 'Voice Teacher Turn',
    systemInstruction,
    contents,
    schema: VOICE_TURN_SCHEMA,
    preferFastModel: true,
    primaryTimeoutMs: 12000,
    fallbackTimeoutMs: 18000,
  });

  const parsed = safeParseJson<Partial<VoiceTurnResponsePayload>>(
    rawText,
    'Could not understand the AI Voice Teacher response. Please try asking again.'
  );

  const replyText = (parsed.replyText || 'Let us explore this step by step together.').trim();
  const spokenScript = cleanTextForSpeech(parsed.spokenScript || replyText);

  return {
    detectedTopic: (parsed.detectedTopic || req.topic || req.subject).trim().slice(0, 140),
    replyText: replyText.slice(0, 2400),
    spokenScript: spokenScript || cleanTextForSpeech(replyText),
    conceptualCheck: (
      parsed.conceptualCheck ||
      (req.language === 'Hindi'
        ? 'क्या आप इसे अपने शब्दों में एक छोटे उदाहरण से बता सकते हैं?'
        : req.language === 'Hinglish' || req.language === 'Bilingual'
          ? 'Ab aap apne words mein ek chhota example dekar batao ki ye concept kaise kaam karta hai?'
          : 'In your own words, can you try explaining why this works?')
    ).trim().slice(0, 450),
    languageUsed: req.language,
    syllabusNote: (
      parsed.syllabusNote ||
      `Conceptual voice guidance aligned with general ${req.classGrade} (${req.board}) ${req.subject} studies.`
    ).trim().slice(0, 450),
  };
}

export async function synthesizeVoiceSpeech(
  rawPayload: Partial<VoiceTtsRequestPayload>
): Promise<VoiceTtsResponsePayload> {
  const validation = validateVoiceTtsRequest(rawPayload);
  if (!validation.valid || !validation.sanitized) {
    throw new GeminiServiceError(400, 'VALIDATION_ERROR', validation.error || 'Invalid TTS request.');
  }

  const aiBeta = getAiClient('v1beta');
  const aiAlpha = getAiClient('v1alpha');
  if (!aiBeta && !aiAlpha) {
    throw new GeminiServiceError(
      503,
      'GEMINI_NOT_CONFIGURED',
      'Gemini AI service is not configured on this server (GEMINI_API_KEY missing).'
    );
  }

  const req = validation.sanitized;
  const style =
    req.language === 'Hindi'
      ? 'Warm, patient, articulate Indian Hindi school teacher explaining clearly'
      : req.language === 'Hinglish' || req.language === 'Bilingual'
        ? 'Warm, encouraging Indian classroom teacher speaking natural Hinglish (Hindi + English mix)'
        : 'Warm, patient, clear Indian school teacher explaining step by step';

  const buildContents = (withMetadata: boolean) => [
    {
      role: 'user',
      parts: [
        withMetadata
          ? {
              text: req.text,
              speechMetadata: {
                style,
              },
            }
          : {
              text: req.text,
            },
      ],
    },
  ];

  const callTtsModel = (client: GoogleGenAI, model: string, withMetadata: boolean) =>
    generateWithRetry(
      (abortSignal) =>
        client.models.generateContent({
          model,
          contents: buildContents(withMetadata),
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: req.voiceName },
              },
            },
            abortSignal,
          },
        }),
      25000
    );

  let response;
  let usedEngine: VoiceTtsResponsePayload['engine'] = GEMINI_VOICE_TTS_MODEL;
  try {
    response = await callTtsModel(aiBeta!, GEMINI_VOICE_TTS_MODEL, true);
  } catch (err1) {
    const mapped1 = err1 instanceof GeminiServiceError ? err1 : null;
    if (mapped1?.statusCode === 429 || mapped1?.statusCode === 504) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      try {
        usedEngine = 'gemini-3.8-flash-tts';
        response = await callTtsModel(aiBeta!, 'gemini-3.8-flash-tts', false);
      } catch {
        usedEngine = GEMINI_VOICE_TTS_MODEL;
        response = await callTtsModel(aiAlpha!, GEMINI_VOICE_TTS_MODEL, true);
      }
    } else {
      console.info('[Voice TTS] Retrying v1beta plain text:', err1 instanceof Error ? err1.message : err1);
      try {
        response = await callTtsModel(aiBeta!, GEMINI_VOICE_TTS_MODEL, false);
      } catch {
        response = await callTtsModel(aiAlpha!, GEMINI_VOICE_TTS_MODEL, true);
      }
    }
  }

  const inline = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  const base64Audio = inline?.data;
  if (!base64Audio) {
    throw new GeminiServiceError(
      502,
      'TTS_EMPTY_AUDIO',
      'Voice audio generator returned no audio bytes.',
      true
    );
  }

  return {
    audioBase64: base64Audio,
    mimeType: inline?.mimeType || 'audio/wav',
    voiceName: req.voiceName,
    engine: usedEngine,
  };
}

const STUDY_ROOM_QUIZ_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          prompt: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          correctIndex: { type: Type.INTEGER },
          explanation: { type: Type.STRING },
        },
        required: ['prompt', 'options', 'correctIndex', 'explanation'],
      },
    },
  },
  required: ['title', 'questions'],
};

export async function generateStudyRoomGroupQuiz(rawPayload: {
  subject?: string;
  topic?: string;
  board?: string;
  classGrade?: string;
  count?: number;
}) {
  const subject = String(rawPayload.subject || 'Science').trim().slice(0, 80);
  const topic = String(rawPayload.topic || 'Core Concepts').trim().slice(0, 140);
  const board = String(rawPayload.board || 'CBSE').trim().slice(0, 32);
  const classGrade = String(rawPayload.classGrade || 'Class 10').trim().slice(0, 30);
  const count = Math.min(5, Math.max(2, Number(rawPayload.count) || 3));

  const systemInstruction =
    'You are an Indian school curriculum mentor generating a concise, age-appropriate collaborative peer group quiz. Do not include external URLs or personal info.';
  const prompt = `Create ${count} conceptual MCQ questions for ${classGrade} (${board}) students studying ${subject} — Topic: "${topic}". Each question must have 4 options, zero-indexed correctIndex (0..3), and a short clear explanation.`;

  const rawText = await generateJsonWithFastFallback({
    label: 'Study Room Group Quiz',
    systemInstruction,
    contents: prompt,
    schema: STUDY_ROOM_QUIZ_SCHEMA,
    preferFastModel: true,
    primaryTimeoutMs: 14000,
    fallbackTimeoutMs: 20000,
  });

  const parsed = safeParseJson<{
    title?: string;
    questions?: Array<{
      prompt?: string;
      options?: string[];
      correctIndex?: number;
      explanation?: string;
    }>;
  }>(rawText, 'Unable to generate group quiz right now.');

  const questions = (parsed.questions || [])
    .slice(0, count)
    .map((q, idx) => {
      const opts = Array.isArray(q.options) && q.options.length >= 2
        ? q.options.slice(0, 4).map((o) => String(o || '').trim().slice(0, 180))
        : ['Option A', 'Option B', 'Option C', 'Option D'];
      const correctIdx =
        typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex < opts.length
          ? Math.floor(q.correctIndex)
          : 0;
      return {
        id: `rq_${Date.now()}_${idx}`,
        prompt: String(q.prompt || `Concept check #${idx + 1}`).trim().slice(0, 320),
        options: opts,
        correctIndex: correctIdx,
        explanation: String(q.explanation || 'Review the textbook definition for this concept.').trim().slice(0, 350),
      };
    });

  if (questions.length === 0) {
    throw new GeminiServiceError(502, 'EMPTY_QUIZ', 'No quiz questions were produced. Please retry.', true);
  }

  return {
    title: String(parsed.title || `${topic} Peer Challenge`).trim().slice(0, 120),
    questions,
  };
}

// ==========================================
// DYNAMIC AI VISUAL LEARNING LAB GENERATOR + CACHE
// ==========================================
const VISUAL_CACHE_FILE = path.join(process.cwd(), '.data', 'visual_lab_cache.json');
const VISUAL_CACHE_MAX_ENTRIES = 200;
const visualMemoryCache = new Map<string, GeneratedVisualSpec>();
let visualCacheLoaded = false;

function ensureVisualCacheLoaded(): void {
  if (visualCacheLoaded) return;
  visualCacheLoaded = true;
  try {
    if (!fs.existsSync(VISUAL_CACHE_FILE)) return;
    const raw = fs.readFileSync(VISUAL_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, GeneratedVisualSpec>;
    if (parsed && typeof parsed === 'object') {
      for (const [k, val] of Object.entries(parsed)) {
        if (val && typeof val === 'object' && val.rendererType) {
          visualMemoryCache.set(k, val);
        }
      }
    }
  } catch {
    // Ignore malformed cache file and regenerate cleanly
  }
}

function saveVisualToCache(cacheKey: string, spec: GeneratedVisualSpec): void {
  ensureVisualCacheLoaded();
  if (visualMemoryCache.has(cacheKey)) {
    visualMemoryCache.delete(cacheKey);
  }
  visualMemoryCache.set(cacheKey, spec);
  while (visualMemoryCache.size > VISUAL_CACHE_MAX_ENTRIES) {
    const oldestKey = visualMemoryCache.keys().next().value;
    if (!oldestKey) break;
    visualMemoryCache.delete(oldestKey);
  }
  try {
    const dir = path.dirname(VISUAL_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj: Record<string, GeneratedVisualSpec> = {};
    for (const [k, v] of visualMemoryCache.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(VISUAL_CACHE_FILE, JSON.stringify(obj), 'utf8');
  } catch {
    // Non-fatal if filesystem is read-only
  }
}

const VISUAL_LAB_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    subtitle: { type: Type.STRING },
    visualCategory: {
      type: Type.STRING,
      enum: [
        'physics-simulation',
        'math-graph',
        'geometry-construction',
        'chemistry-model',
        'annotated-diagram',
        'process-cycle',
        'illustrated-concept',
      ],
    },
    rendererType: {
      type: Type.STRING,
      enum: [
        'kinematics-projectile',
        'optics-ray',
        'circuit-network',
        'wave-oscillation',
        'bohr-atom',
        'molecular-geometry',
        'math-function-plot',
        'coordinate-geometry',
        'annotated-diagram',
        'illustrated-concept',
      ],
    },
    modalityHonestyLabel: { type: Type.STRING },
    conceptExplanation: { type: Type.STRING },
    whatYouAreObserving: { type: Type.STRING },
    interactionInstructions: { type: Type.STRING },
    formulaOrLaw: { type: Type.STRING },
    keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
    observationsChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          step: { type: Type.INTEGER },
          title: { type: Type.STRING },
          explanation: { type: Type.STRING },
          highlightTarget: { type: Type.STRING },
          presetParamKey: { type: Type.STRING },
          presetParamNumber: { type: Type.NUMBER },
          presetParamText: { type: Type.STRING },
        },
        required: ['step', 'title', 'explanation'],
      },
    },
    engineConfig: {
      type: Type.OBJECT,
      properties: {
        kinematics: {
          type: Type.OBJECT,
          properties: {
            speed: { type: Type.NUMBER },
            angle: { type: Type.NUMBER },
            gravity: { type: Type.NUMBER },
            environmentLabel: { type: Type.STRING },
            projectileLabel: { type: Type.STRING },
            showVectors: { type: Type.BOOLEAN },
          },
          required: ['speed', 'angle', 'gravity', 'environmentLabel', 'projectileLabel', 'showVectors'],
        },
        optics: {
          type: Type.OBJECT,
          properties: {
            opticalElement: {
              type: Type.STRING,
              enum: ['convex-lens', 'concave-lens', 'concave-mirror', 'convex-mirror'],
            },
            focalLengthCm: { type: Type.NUMBER },
            objectDistanceCm: { type: Type.NUMBER },
            objectHeightCm: { type: Type.NUMBER },
            mediumLabel: { type: Type.STRING },
          },
          required: ['opticalElement', 'focalLengthCm', 'objectDistanceCm', 'objectHeightCm'],
        },
        circuit: {
          type: Type.OBJECT,
          properties: {
            topology: { type: Type.STRING, enum: ['series', 'parallel'] },
            voltage: { type: Type.NUMBER },
            r1: { type: Type.NUMBER },
            r2: { type: Type.NUMBER },
            r1Label: { type: Type.STRING },
            r2Label: { type: Type.STRING },
            sourceLabel: { type: Type.STRING },
          },
          required: ['topology', 'voltage', 'r1', 'r2'],
        },
        wave: {
          type: Type.OBJECT,
          properties: {
            amplitude: { type: Type.NUMBER },
            frequency: { type: Type.NUMBER },
            wavelength: { type: Type.NUMBER },
            waveKind: { type: Type.STRING, enum: ['transverse', 'sound-pressure'] },
            waveLabel: { type: Type.STRING },
          },
          required: ['amplitude', 'frequency', 'wavelength', 'waveKind'],
        },
        bohr: {
          type: Type.OBJECT,
          properties: {
            atomicNumber: { type: Type.INTEGER },
            highlightShell: { type: Type.STRING, enum: ['K', 'L', 'M', 'N'] },
          },
          required: ['atomicNumber'],
        },
        molecule: {
          type: Type.OBJECT,
          properties: {
            formula: { type: Type.STRING },
            centralAtom: { type: Type.STRING },
            centralLabel: { type: Type.STRING },
            shapeName: { type: Type.STRING },
            hybridization: { type: Type.STRING },
            bondAngleDeg: { type: Type.NUMBER },
            lonePairs: { type: Type.INTEGER },
            bonds: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  atomLabel: { type: Type.STRING },
                  bondOrder: { type: Type.INTEGER },
                  angleDeg: { type: Type.NUMBER },
                  lengthRatio: { type: Type.NUMBER },
                },
                required: ['id', 'atomLabel', 'bondOrder', 'angleDeg'],
              },
            },
            explanation: { type: Type.STRING },
          },
          required: ['formula', 'centralAtom', 'shapeName', 'bondAngleDeg', 'lonePairs', 'bonds'],
        },
        mathPlot: {
          type: Type.OBJECT,
          properties: {
            curves: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  label: { type: Type.STRING },
                  expression: { type: Type.STRING },
                  color: { type: Type.STRING },
                },
                required: ['id', 'label', 'expression', 'color'],
              },
            },
            xMin: { type: Type.NUMBER },
            xMax: { type: Type.NUMBER },
            yMin: { type: Type.NUMBER },
            yMax: { type: Type.NUMBER },
            parameterA: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                min: { type: Type.NUMBER },
                max: { type: Type.NUMBER },
                step: { type: Type.NUMBER },
                defaultValue: { type: Type.NUMBER },
              },
              required: ['label', 'min', 'max', 'step', 'defaultValue'],
            },
            parameterB: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                min: { type: Type.NUMBER },
                max: { type: Type.NUMBER },
                step: { type: Type.NUMBER },
                defaultValue: { type: Type.NUMBER },
              },
              required: ['label', 'min', 'max', 'step', 'defaultValue'],
            },
            highlightRoots: { type: Type.BOOLEAN },
            showTangentAtX: { type: Type.NUMBER },
          },
          required: ['curves', 'xMin', 'xMax', 'yMin', 'yMax'],
        },
        geometry: {
          type: Type.OBJECT,
          properties: {
            coordinateBounds: { type: Type.INTEGER },
            gridStep: { type: Type.INTEGER },
            points: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  label: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  adjustable: { type: Type.BOOLEAN },
                },
                required: ['id', 'label', 'x', 'y'],
              },
            },
            segments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  fromId: { type: Type.STRING },
                  toId: { type: Type.STRING },
                  label: { type: Type.STRING },
                  dashed: { type: Type.BOOLEAN },
                  color: { type: Type.STRING },
                },
                required: ['fromId', 'toId'],
              },
            },
            circles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  centerId: { type: Type.STRING },
                  radius: { type: Type.NUMBER },
                  label: { type: Type.STRING },
                },
                required: ['centerId', 'radius'],
              },
            },
            polygons: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  pointIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  fill: { type: Type.STRING },
                  label: { type: Type.STRING },
                },
                required: ['pointIds'],
              },
            },
            theoremNote: { type: Type.STRING },
          },
          required: ['coordinateBounds', 'gridStep', 'points', 'segments', 'theoremNote'],
        },
        diagram: {
          type: Type.OBJECT,
          properties: {
            layoutKind: { type: Type.STRING, enum: ['layered', 'cycle', 'cross-section', 'comparison'] },
            backgroundTheme: { type: Type.STRING, enum: ['bio', 'geo', 'chem', 'phys'] },
            shapes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  kind: { type: Type.STRING, enum: ['circle', 'ellipse', 'rect', 'polygon', 'line', 'path'] },
                  label: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  x2: { type: Type.NUMBER },
                  y2: { type: Type.NUMBER },
                  width: { type: Type.NUMBER },
                  height: { type: Type.NUMBER },
                  rx: { type: Type.NUMBER },
                  ry: { type: Type.NUMBER },
                  r: { type: Type.NUMBER },
                  points: { type: Type.STRING },
                  d: { type: Type.STRING },
                  fill: { type: Type.STRING },
                  stroke: { type: Type.STRING },
                  strokeWidth: { type: Type.NUMBER },
                  dashed: { type: Type.BOOLEAN },
                  opacity: { type: Type.NUMBER },
                },
                required: ['id', 'kind'],
              },
            },
            arrows: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  fromX: { type: Type.NUMBER },
                  fromY: { type: Type.NUMBER },
                  toX: { type: Type.NUMBER },
                  toY: { type: Type.NUMBER },
                  label: { type: Type.STRING },
                  dashed: { type: Type.BOOLEAN },
                  color: { type: Type.STRING },
                },
                required: ['id', 'fromX', 'fromY', 'toX', 'toY'],
              },
            },
            hotspots: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  x: { type: Type.NUMBER },
                  y: { type: Type.NUMBER },
                  label: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  detail: { type: Type.STRING },
                  category: { type: Type.STRING },
                },
                required: ['id', 'x', 'y', 'label', 'summary', 'detail'],
              },
            },
            legend: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  color: { type: Type.STRING },
                  label: { type: Type.STRING },
                },
                required: ['color', 'label'],
              },
            },
          },
          required: ['layoutKind', 'backgroundTheme', 'shapes', 'arrows', 'hotspots', 'legend'],
        },
        illustrated: {
          type: Type.OBJECT,
          properties: {
            cards: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  stepBadge: { type: Type.STRING },
                  title: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  keyPoint: { type: Type.STRING },
                  metricOrFormula: { type: Type.STRING },
                  accent: { type: Type.STRING, enum: ['indigo', 'cyan', 'emerald', 'amber'] },
                },
                required: ['id', 'stepBadge', 'title', 'summary', 'keyPoint', 'accent'],
              },
            },
            leftHeader: { type: Type.STRING },
            rightHeader: { type: Type.STRING },
            comparisonRows: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  aspect: { type: Type.STRING },
                  leftLabel: { type: Type.STRING },
                  rightLabel: { type: Type.STRING },
                },
                required: ['aspect', 'leftLabel', 'rightLabel'],
              },
            },
          },
          required: ['cards'],
        },
      },
    },
  },
  required: [
    'title',
    'subtitle',
    'visualCategory',
    'rendererType',
    'modalityHonestyLabel',
    'conceptExplanation',
    'whatYouAreObserving',
    'interactionInstructions',
    'keyTakeaways',
    'observationsChecklist',
    'steps',
    'engineConfig',
  ],
};

interface RawGeneratedVisualStep {
  step?: number;
  title?: string;
  explanation?: string;
  highlightTarget?: string;
  presetParamKey?: string;
  presetParamNumber?: number;
  presetParamText?: string;
}

export async function generateDynamicVisualExperience(
  rawPayload: Partial<VisualGenerateRequest>,
  userId: string
): Promise<GeneratedVisualSpec> {
  const board = String(rawPayload.board || 'CBSE').trim().slice(0, 32);
  const classGrade = String(rawPayload.classGrade || 'Class 10').trim().slice(0, 30);
  const subject = String(rawPayload.subject || '').trim().slice(0, 80);
  const chapter = String(rawPayload.chapter || '').trim().slice(0, 160);
  const topic = String(rawPayload.topic || '').trim().slice(0, 180);
  const customPrompt = String(rawPayload.customPrompt || '').trim().slice(0, 400);
  const language = rawPayload.language === 'Hindi' ? 'Hindi' : 'English';
  const forceRegenerate = Boolean(rawPayload.forceRegenerate);

  if (!subject || !topic) {
    throw new GeminiServiceError(
      400,
      'VALIDATION_ERROR',
      'Please specify a subject and a topic or concept to generate a visual learning experience.'
    );
  }

  const cacheKey = buildVisualCacheKey({
    board,
    classGrade,
    subject,
    chapter: chapter || subject,
    topic,
    customPrompt,
    language,
  });

  ensureVisualCacheLoaded();
  if (!forceRegenerate && visualMemoryCache.has(cacheKey)) {
    const hit = visualMemoryCache.get(cacheKey)!;
    return {
      ...hit,
      id: `vis_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId,
      saved: false,
      cached: true,
      updatedAt: new Date().toISOString(),
    };
  }

  const systemInstruction = `You are EDUVERSE AI's Visual Curriculum Architect for Indian Class 6-12 students (${board}).
Your job is to choose the MOST HONEST, accurate, interactive visual renderer for the student's requested topic and output ONLY schema-valid JSON configuring that SINGLE chosen renderer.

RENDERER SELECTION RULES (CRITICAL):
1. Parametric & Computed Renderers (ONLY choose when the topic truly fits that mathematical model):
   - "kinematics-projectile": projectile motion, trajectory, range, max height, gravity comparison, parabolic free-fall launch. Fill ONLY engineConfig.kinematics.
   - "optics-ray": convex/concave lenses, concave/convex mirrors, focal length, image formation, magnification, ray diagrams. Fill ONLY engineConfig.optics.
   - "circuit-network": Ohm's law, series vs parallel resistors, current division, voltage drop, electric power. Fill ONLY engineConfig.circuit.
   - "wave-oscillation": transverse waves, sound pressure longitudinal waves, amplitude, frequency, wavelength, SHM oscillations. Fill ONLY engineConfig.wave.
   - "bohr-atom": atomic structure, K/L/M/N shell distribution, atomic number 1..36, valence electrons, valency. Fill ONLY engineConfig.bohr.
   - "molecular-geometry": covalent molecules, VSEPR shape, bond angle, single/double/triple bonds, lone pairs (H2O, CO2, NH3, CH4, BF3, C2H4, etc.). Fill ONLY engineConfig.molecule.
   - "math-function-plot": ANY algebraic, linear, quadratic, polynomial, trigonometric, exponential, or logarithmic function/equation/calculus tangent/roots topic! Expressions MUST use valid syntax like "a*x^2 + b*x - 3", "sin(a*x) + b", "2*x + 1" using only variable x, optional parameters a/b, numbers, + - * / ^, and functions sin/cos/tan/abs/sqrt/ln/log/exp. Fill ONLY engineConfig.mathPlot.
   - "coordinate-geometry": Cartesian distance formula, midpoint, slope, collinear points, triangles/polygons/circles on coordinate grid. Fill ONLY engineConfig.geometry.
2. Interactive SVG Diagram Renderer ("annotated-diagram"):
   - Choose for Biology anatomy/organelles/cycles (chloroplast, photosynthesis, nephron, synapse, heart flow, stomata, DNA replication, food web), Geography/Earth science (water cycle, volcano/plate boundaries, soil horizons, rock cycle, monsoon circulation, river delta), Chemistry lab setups (electrolysis, fractional distillation, titration), or schematic Physics devices (AC generator, electric motor, solar cell).
   - Coordinate space is strictly 600 wide x 360 tall (x in 25..575, y in 25..335). Provide 5..14 clean SVG shapes (circle, ellipse, rect, polygon, line, or simple safe SVG path d), 2..8 directional arrows, 4..8 interactive clickable hotspots positioned ON the key shapes, and 2..5 legend items. Fill ONLY engineConfig.diagram.
3. Structured Illustrated Concept ("illustrated-concept"):
   - Choose HONESTLY for abstract, historical, grammatical, theoretical, classification, comparison, civics, economics, or qualitative topics where a physics simulation or spatial SVG diagram would be contrived or misleading (e.g. "Newton's Laws summary", "Mendeleev vs Modern Periodic Table", "Democracy vs Monarchy", "Tenses", "Financial Ratios"). Also include comparisonRows when contrasting two ideas. Fill ONLY engineConfig.illustrated.

HONESTY & ACCURACY:
- Never pretend a diagram or card deck is a physics simulation. Write modalityHonestyLabel clearly stating whether it is a Computed Interactive Simulation, Interactive Plotted Graph, Clickable Annotated Diagram, or Structured Illustrated Explanation.
- Language: "${language}" (${language === 'Hindi' ? 'Write student-facing title, explanations, steps, takeaways, and labels in clear Devanagari Hindi with standard scientific symbols/units' : 'Write clear, grade-appropriate English'}).
- Never include external URLs, fake trivia, or harmful content. Keep student-facing text crisp and pedagogical.`;

  const contents = [
    `Student Profile: ${classGrade}, Board: ${board}, Subject: ${subject}`,
    chapter ? `Chapter: ${chapter}` : '',
    `Topic / Concept: ${topic}`,
    customPrompt ? `Student Custom Visual Request: ${customPrompt}` : '',
    'Generate the best single-renderer interactive visual specification following all rules.',
  ]
    .filter(Boolean)
    .join('\n');

  const rawText = await generateJsonWithFastFallback({
    label: 'AI Visual Lab Generator',
    systemInstruction,
    contents,
    schema: VISUAL_LAB_SCHEMA,
    preferFastModel: false,
    primaryTimeoutMs: 26000,
    fallbackTimeoutMs: 32000,
  });

  const parsed = safeParseJson<
    Omit<Partial<GeneratedVisualSpec>, 'steps'> & { steps?: RawGeneratedVisualStep[] }
  >(rawText, 'Unable to generate a visual learning model right now. Please try refining your topic.');

  const normalizedSteps: VisualExplorationStep[] | undefined = Array.isArray(parsed.steps)
    ? parsed.steps.map((st, idx) => {
        const presetParams: Record<string, number | string> = {};
        if (st.presetParamKey) {
          if (typeof st.presetParamNumber === 'number' && Number.isFinite(st.presetParamNumber)) {
            presetParams[st.presetParamKey] = st.presetParamNumber;
          } else if (typeof st.presetParamText === 'string' && st.presetParamText.trim()) {
            presetParams[st.presetParamKey] = st.presetParamText.trim();
          }
        }
        return {
          step: typeof st.step === 'number' ? st.step : idx + 1,
          title: String(st.title || `Step ${idx + 1}`),
          explanation: String(st.explanation || ''),
          highlightTarget: st.highlightTarget,
          presetParams: Object.keys(presetParams).length > 0 ? presetParams : undefined,
        };
      })
    : undefined;

  const sanitized = validateAndSanitizeGeneratedVisual(
    {
      ...parsed,
      steps: normalizedSteps,
      saved: false,
      cached: false,
    },
    {
      cacheKey,
      userId,
      board,
      classGrade,
      subject,
      chapter: chapter || subject,
      topic,
      customPrompt,
      language,
    }
  );

  saveVisualToCache(cacheKey, sanitized);
  return sanitized;
}





