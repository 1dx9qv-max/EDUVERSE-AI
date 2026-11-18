import {
  sanitizeUploadedFilename,
  validateFileMagicBytes,
} from './securityEngine.ts';
import type {
  DoubtAttachmentInput,
  DoubtInputMode,
  DoubtTicket,
  ExplanationLevel,
  SolveDoubtRequestPayload,
  TeacherMessage,
  TeacherRequestPayload,
  TeacherSession,
  TeachingMode,
  TutorLanguage,
} from '../types/ai.ts';

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4 MB
export const MAX_HISTORY_TURNS = 12;
export const MAX_SESSION_MESSAGES = 40;

export const TEACHING_MODES: Array<{
  id: TeachingMode;
  label: string;
  shortLabel: string;
  description: string;
  starterPrompt: string;
}> = [
  {
    id: 'explain',
    label: 'Explain a concept',
    shortLabel: 'Concept',
    description: 'Deep, structured conceptual clarity with analogies and everyday Indian examples.',
    starterPrompt: 'Explain the core concept and why it matters in our board syllabus.',
  },
  {
    id: 'step-by-step',
    label: 'Teach step by step',
    shortLabel: 'Step by Step',
    description: 'Breaks complex chapters into small, sequential mini-lessons with checkpoints.',
    starterPrompt: 'Teach me this topic one small step at a time from the basics.',
  },
  {
    id: 'examples',
    label: 'Give examples',
    shortLabel: 'Examples',
    description: 'Worked numericals, board-style solved cases, and real-world applications.',
    starterPrompt: 'Show me worked examples and real-world applications of this topic.',
  },
  {
    id: 'explain-mistake',
    label: 'Explain my mistake',
    shortLabel: 'Fix Mistake',
    description: 'Paste your attempt or reasoning to uncover conceptual gaps without judgment.',
    starterPrompt: 'Here is my attempt — please point out where my reasoning went wrong and how to fix it.',
  },
  {
    id: 'test-understanding',
    label: 'Test my understanding',
    shortLabel: 'Check Me',
    description: 'Interactive conceptual checking questions and progressive challenge prompts.',
    starterPrompt: 'Quiz me step by step to test whether I truly understand this topic.',
  },
  {
    id: 'summarize-chapter',
    label: 'Summarize a chapter',
    shortLabel: 'Summary',
    description: 'High-yield revision map with key laws, formulas, definitions, and pitfalls.',
    starterPrompt: 'Give me a structured chapter summary with key formulas and exam takeaways.',
  },
];

export const EXPLANATION_LEVELS: ExplanationLevel[] = ['Beginner', 'Intermediate', 'Advanced'];
export const TUTOR_LANGUAGES: TutorLanguage[] = ['English', 'Hindi', 'Hinglish'];

export function normalizeLanguageForTutor(language?: string | null): TutorLanguage {
  const cleaned = (language || '').trim().toLowerCase();
  if (cleaned === 'hindi' || cleaned === 'हिंदी' || cleaned === 'हिन्दी') return 'Hindi';
  if (cleaned === 'hinglish') return 'Hinglish';
  if (cleaned === 'bilingual') return 'Bilingual';
  return 'English';
}

export function getTutorLanguageLabel(language?: string | null): string {
  const normalized = normalizeLanguageForTutor(language);
  if (normalized === 'Hindi') return 'हिंदी';
  if (normalized === 'Hinglish' || normalized === 'Bilingual') return 'Hinglish';
  return 'English';
}

export function buildTeacherLanguageInstruction(language: TutorLanguage): string {
  const normalized = normalizeLanguageForTutor(language);
  if (normalized === 'Hindi') {
    return [
      'EXPLANATION LANGUAGE MODE: Hindi (हिंदी — Devanagari script).',
      '- Respond naturally in warm, clear academic Hindi written in Devanagari script—avoid robotic or awkward literal word-for-word translation.',
      '- Keep universal scientific symbols, formulas, units, SI notations, and equations standard (e.g., V = IR, F = ma, CO2, H2O, D = b² - 4ac).',
      '- Mention essential board-exam English terms in parentheses only where genuinely helpful for students (e.g., विद्युत धारा (Electric Current)).',
      '- Keep ALL JSON fields (lessonTitle, reply, lessonBreakdown, realWorldExamples, analogy, checkingQuestion, followUpExercises, syllabusNote, suggestedNextStep) consistently in Hindi.',
    ].join('\n');
  }

  if (normalized === 'Hinglish' || normalized === 'Bilingual') {
    return [
      'EXPLANATION LANGUAGE MODE: Natural Hinglish (conversational Hindi + English mixed naturally in Roman script, ~50% Hindi and ~50% English).',
      'STYLE & TONE:',
      '- Teach like a real, friendly Indian school teacher speaking naturally to students in a classroom.',
      '- Use natural Hindi sentence structure and conversational connectors (e.g., "hai", "hota hai", "karte hain", "kyunki", "toh", "samjho", "dekhte hain", "iskaa matlab") seamlessly mixed with English academic, scientific, and mathematical terminology.',
      '- Keep important scientific, mathematical, and technical terms in English (e.g., potential difference, free electrons, photosynthesis, quadratic equation, numerator, kinetic energy, convex lens) and explain difficult terminology in simple conversational Hindi.',
      '- Write Hindi words naturally in Roman script (NOT Devanagari blocks, and NEVER awkward word-by-word English-to-Hindi translation).',
      '- Naturally weave in classroom phrases such as:',
      '  * "Ab isko ek example se samajhte hain."',
      '  * "Yahan ek important point notice karo."',
      '  * "Iska simple meaning ye hai..."',
      '  * "Ab next step dekhte hain."',
      '- Reference examples of authentic natural Hinglish style:',
      '  * "Ab samjho ki electricity actually flow kaise karti hai. Jab hum kisi conductor ke across potential difference apply karte hain, toh free electrons move karna start karte hain. Isi movement ko electric current kehte hain."',
      '  * "Photosynthesis ek process hai jisme green plants sunlight ki help se apna food prepare karte hain. Is process mein plants carbon dioxide aur water use karte hain, aur glucose ke saath oxygen release hoti hai."',
      'CONSISTENCY RULES:',
      '- Explain step by step using relatable Indian daily-life examples where appropriate (ceiling fan, cricket, train journey, pressure cooker, solar panel, metro card).',
      '- Do NOT sound like a formal textbook or robotic translator.',
      '- Do NOT randomly switch between pure English paragraphs and pure Hindi paragraphs—maintain a cohesive, consistent Hinglish voice across ALL JSON fields (lessonTitle, reply, lessonBreakdown, realWorldExamples, analogy, checkingQuestion, followUpExercises, syllabusNote, suggestedNextStep).',
      '- Maintain 100% accurate facts, grammar, board terminology, and mathematical/chemical formulas.',
    ].join('\n');
  }

  return [
    'EXPLANATION LANGUAGE MODE: English (Indian academic English).',
    '- Respond in crisp, clear, encouraging Indian academic English appropriate for school board exams.',
    '- Use step-by-step clarity, accurate scientific/mathematical formulas, and relatable Indian daily-life examples.',
    '- Keep ALL JSON fields consistently in English.',
  ].join('\n');
}

export function buildAiTeacherSystemInstruction(params: {
  subject: string;
  classGrade: string;
  board: string;
  language: TutorLanguage;
  level: ExplanationLevel;
  modeLabel: string;
  modeDescription: string;
}): string {
  const normalizedLang = normalizeLanguageForTutor(params.language);
  const displayLang = normalizedLang === 'Bilingual' ? 'Hinglish' : normalizedLang;
  return `You are EDUVERSE AI Personal Teacher — a patient, expert Indian school educator teaching ${params.subject} for ${params.classGrade} (${params.board} board).
${buildTeacherLanguageInstruction(normalizedLang)}

Mid-Conversation Language Adaptation Rule:
- Always output EVERY field of your response strictly in the active language mode (${displayLang}), even if earlier turns in conversation history were written in a different language.
- If the student switched language mid-conversation, adapt immediately to ${displayLang} without losing the ongoing topic, prior steps, or teaching context.

Explanation Level: ${params.level}
- Beginner: Warm, intuition-first, simple vocabulary, zero assumed jargon, gentle pacing.
- Intermediate: Standard school board depth (${params.classGrade}), balanced intuition + formal definitions + equations.
- Advanced: Rigorous analytical depth, edge cases, derivations, and competitive foundation connections (JEE/NEET/Olympiad where appropriate for the grade).

Active Teaching Mode: "${params.modeLabel}" — ${params.modeDescription}

Pedagogical Rules:
1. Break complex concepts into 2-4 smaller, digestible mini-lessons in \`lessonBreakdown\`.
2. Give 2-3 relatable real-world Indian examples (cricket, trains, monsoon, kitchen chemistry, solar panels, metro circuits, etc.) in \`realWorldExamples\`.
3. Provide a crisp intuitive analogy in \`analogy\`.
4. Always ask one thoughtful conceptual checking question in \`checkingQuestion\` (not rote memorization) with a helpful hint.
5. Generate 2 follow-up exercises in \`followUpExercises\`.
6. Maintain conversation continuity: if the student answered your previous checking question in history, evaluate their reasoning warmly and accurately before advancing.
7. SYLLABUS HONESTY INVARIANT: Never fabricate official NCERT/ICSE/State Board page numbers, question numbers, or circular codes, and NEVER claim an unverified source is an official board document. Frame curriculum notes honestly as general educational guidance aligned with typical ${params.classGrade} ${params.board} topics.`;
}

export function isValidTeachingMode(mode: string): mode is TeachingMode {
  return TEACHING_MODES.some((m) => m.id === mode);
}

export function isValidExplanationLevel(level: string): level is ExplanationLevel {
  return (EXPLANATION_LEVELS as string[]).includes(level);
}

export function stripDataUrlPrefix(rawBase64: string): string {
  const trimmed = rawBase64.trim();
  const commaIdx = trimmed.indexOf(',');
  if (trimmed.startsWith('data:') && commaIdx !== -1) {
    return trimmed.slice(commaIdx + 1);
  }
  return trimmed;
}

export function estimateBase64DecodedBytes(rawBase64: string): number {
  const clean = stripDataUrlPrefix(rawBase64).replace(/\s+/g, '');
  if (!clean) return 0;
  // Validate base64 character set
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) {
    return -1;
  }
  let padding = 0;
  if (clean.endsWith('==')) padding = 2;
  else if (clean.endsWith('=')) padding = 1;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export interface AttachmentValidationResult {
  valid: boolean;
  error?: string;
  normalizedBase64?: string;
  decodedBytes?: number;
  sanitizedFileName?: string;
}

export function validateAttachmentMetadata(input: {
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  dataBase64?: string;
}): AttachmentValidationResult {
  const rawName = (input.fileName || '').trim();
  if (!rawName) {
    return { valid: false, error: 'Uploaded file is missing a valid file name.' };
  }
  if (rawName.includes('..') || rawName.includes('/') || rawName.includes('\\')) {
    return {
      valid: false,
      error: 'Unsafe file name rejected (path traversal characters are not allowed).',
    };
  }

  const mimeType = (input.mimeType || '').trim().toLowerCase();
  if (!(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported file type (${mimeType || 'unknown'}). Upload a PNG, JPEG, WEBP image, or PDF document.`,
    };
  }

  const nameCheck = sanitizeUploadedFilename(rawName);
  if (!nameCheck.valid || !nameCheck.sanitizedName) {
    return { valid: false, error: nameCheck.error || 'Invalid uploaded file name.' };
  }
  const fileName = nameCheck.sanitizedName;

  if (typeof input.sizeBytes !== 'number' || Number.isNaN(input.sizeBytes) || input.sizeBytes <= 0) {
    return { valid: false, error: 'Uploaded file appears to be empty (0 bytes).' };
  }

  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
    const sizeMb = (input.sizeBytes / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `File "${fileName}" is ${sizeMb} MB, which exceeds the 4 MB upload limit. Please compress or crop the file and try again.`,
    };
  }

  if (typeof input.dataBase64 === 'string') {
    const cleanBase64 = stripDataUrlPrefix(input.dataBase64).replace(/\s+/g, '');
    const decodedBytes = estimateBase64DecodedBytes(cleanBase64);
    if (decodedBytes <= 0) {
      return { valid: false, error: 'Uploaded file content is unreadable or corrupted.' };
    }
    if (decodedBytes > MAX_ATTACHMENT_BYTES) {
      const sizeMb = (decodedBytes / (1024 * 1024)).toFixed(2);
      return {
        valid: false,
        error: `Decoded file size (${sizeMb} MB) exceeds the 4 MB maximum limit.`,
      };
    }
    const magicCheck = validateFileMagicBytes(mimeType, cleanBase64);
    if (!magicCheck.valid) {
      return { valid: false, error: magicCheck.error };
    }
    return {
      valid: true,
      normalizedBase64: cleanBase64,
      decodedBytes,
      sanitizedFileName: fileName,
    };
  }

  return { valid: true, sanitizedFileName: fileName };
}

export function validateTeacherRequest(payload: Partial<TeacherRequestPayload>): {
  valid: boolean;
  error?: string;
  sanitized?: TeacherRequestPayload;
} {
  const subject = (payload.subject || '').trim().slice(0, 100);
  const classGrade = (payload.classGrade || '').trim().slice(0, 30);
  const board = (payload.board || 'CBSE').trim().slice(0, 32);
  const message = (payload.message || '').trim();
  const language = normalizeLanguageForTutor(payload.language);
  const level: ExplanationLevel = isValidExplanationLevel(payload.level || '')
    ? (payload.level as ExplanationLevel)
    : 'Intermediate';
  const mode: TeachingMode = isValidTeachingMode(payload.mode || '')
    ? (payload.mode as TeachingMode)
    : 'explain';

  if (!subject) {
    return { valid: false, error: 'Please select a school subject before starting the lesson.' };
  }
  if (!classGrade) {
    return { valid: false, error: 'Class grade (Class 6 to Class 12) is required.' };
  }
  if (!message) {
    return { valid: false, error: 'Please type a topic, question, or concept for the AI Teacher.' };
  }
  if (message.length > 2500) {
    return { valid: false, error: 'Message exceeds 2,500 characters. Please shorten your prompt.' };
  }

  const rawHistory = Array.isArray(payload.history) ? payload.history : [];
  const boundedHistory = rawHistory
    .filter(
      (item) =>
        item &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim().length > 0
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 2000),
    }));

  return {
    valid: true,
    sanitized: {
      subject,
      classGrade,
      board,
      language,
      level,
      mode,
      message,
      history: boundedHistory,
    },
  };
}

export function validateDoubtRequest(payload: Partial<SolveDoubtRequestPayload>): {
  valid: boolean;
  error?: string;
  sanitized?: SolveDoubtRequestPayload;
} {
  const question = (payload.question || '').trim();
  const subjectHint = (payload.subjectHint || '').trim().slice(0, 80);
  const classGrade = (payload.classGrade || 'Class 10').trim().slice(0, 30);
  const board = (payload.board || 'CBSE').trim().slice(0, 32);
  const language = normalizeLanguageForTutor(payload.language);
  const allowedModes: DoubtInputMode[] = ['typed', 'image', 'handwritten', 'pdf', 'worksheet'];
  const inputMode: DoubtInputMode = allowedModes.includes(payload.inputMode as DoubtInputMode)
    ? (payload.inputMode as DoubtInputMode)
    : 'typed';

  let cleanAttachment: DoubtAttachmentInput | null = null;
  if (payload.attachment) {
    const check = validateAttachmentMetadata(payload.attachment);
    if (!check.valid) {
      return { valid: false, error: check.error };
    }
    cleanAttachment = {
      fileName: payload.attachment.fileName.trim().slice(0, 180),
      mimeType: payload.attachment.mimeType.trim().toLowerCase(),
      sizeBytes: check.decodedBytes ?? payload.attachment.sizeBytes,
      dataBase64: check.normalizedBase64 ?? stripDataUrlPrefix(payload.attachment.dataBase64),
    };
  }

  if (!question && !cleanAttachment) {
    return {
      valid: false,
      error: 'Please type a question or upload an image, handwritten note, or PDF worksheet.',
    };
  }

  if (question.length > 3000) {
    return {
      valid: false,
      error: 'Question exceeds 3,000 characters. Please trim or split into parts.',
    };
  }

  return {
    valid: true,
    sanitized: {
      question,
      subjectHint: subjectHint || undefined,
      classGrade,
      board,
      language,
      inputMode,
      simplerRequested: Boolean(payload.simplerRequested),
      isWorksheet: Boolean(payload.isWorksheet || inputMode === 'worksheet'),
      attachment: cleanAttachment,
    },
  };
}

export function sanitizeFirestoreId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || `id_${Date.now()}`;
}

export function formatAttachmentLabel(fileName: string, mimeType: string, sizeBytes: number): string {
  const kind = mimeType === 'application/pdf' ? 'PDF' : 'Image';
  const sizeKb = Math.max(1, Math.round(sizeBytes / 1024));
  const safeName = fileName.trim().slice(0, 80);
  return `${safeName} (${kind}, ${sizeKb} KB)`;
}

/**
 * Privacy & Blueprint guard:
 * Never stores raw file bytes, data URLs, or base64 document payloads in doubt history.
 */
export function sanitizeDoubtForStorage(ticket: DoubtTicket): DoubtTicket {
  const safeId = sanitizeFirestoreId(ticket.id);
  const safeQuestion = (ticket.questionText || 'Uploaded study question')
    .replace(/data:[a-zA-Z0-9/+.-]+;base64,[A-Za-z0-9+/=]+/g, '[attachment omitted]')
    .trim()
    .slice(0, 3000);

  const sanitized: DoubtTicket = {
    id: safeId,
    userId: sanitizeFirestoreId(ticket.userId),
    title: (ticket.title || 'Academic Doubt').trim().slice(0, 200),
    subject: (ticket.subject || 'General').trim().slice(0, 80),
    classGrade: (ticket.classGrade || 'Class 10').trim().slice(0, 30),
    questionText: safeQuestion || 'Uploaded study question',
    language: (ticket.language || 'English').trim().slice(0, 30),
    status: ticket.status === 'open' || ticket.status === 'closed' ? ticket.status : 'answered',
    aiAnswer: (ticket.aiAnswer || '').trim().slice(0, 10000),
    createdAt: ticket.createdAt || new Date().toISOString(),
    updatedAt: ticket.updatedAt || new Date().toISOString(),
  };

  if (ticket.topic) sanitized.topic = ticket.topic.trim().slice(0, 150);
  if (ticket.board) sanitized.board = ticket.board.trim().slice(0, 32);
  if (ticket.inputMode) sanitized.inputMode = ticket.inputMode;
  if (ticket.attachmentLabel) {
    sanitized.attachmentLabel = ticket.attachmentLabel.trim().slice(0, 160);
  }
  if (ticket.structuredSolution) {
    sanitized.structuredSolution = {
      ...ticket.structuredSolution,
      identifiedSubject: (ticket.structuredSolution.identifiedSubject || sanitized.subject).slice(0, 80),
      identifiedTopic: (ticket.structuredSolution.identifiedTopic || '').slice(0, 150),
      understoodQuestion: (ticket.structuredSolution.understoodQuestion || '').slice(0, 1500),
      stepByStepSolution: (ticket.structuredSolution.stepByStepSolution || []).slice(0, 12).map((s) => s.slice(0, 1200)),
      whyItWorks: (ticket.structuredSolution.whyItWorks || '').slice(0, 2000),
      commonMisconceptions: (ticket.structuredSolution.commonMisconceptions || []).slice(0, 6).map((m) => m.slice(0, 500)),
      easierExplanation: (ticket.structuredSolution.easierExplanation || '').slice(0, 2500),
      syllabusDisclaimer: (ticket.structuredSolution.syllabusDisclaimer || '').slice(0, 500),
      worksheetQuestions: (ticket.structuredSolution.worksheetQuestions || []).slice(0, 10),
    };
  }

  return sanitized;
}

export function sanitizeTeacherSessionForStorage(session: TeacherSession): TeacherSession {
  const boundedMessages: TeacherMessage[] = (session.messages || [])
    .slice(-MAX_SESSION_MESSAGES)
    .map((m) => ({
      ...m,
      id: sanitizeFirestoreId(m.id),
      content: (m.content || '').slice(0, 6000),
    }));

  return {
    id: sanitizeFirestoreId(session.id),
    userId: sanitizeFirestoreId(session.userId),
    title: (session.title || `${session.subject} Lesson`).trim().slice(0, 200),
    subject: (session.subject || 'Science').trim().slice(0, 100),
    classGrade: (session.classGrade || 'Class 10').trim().slice(0, 30),
    board: (session.board || 'CBSE').trim().slice(0, 32),
    language: normalizeLanguageForTutor(session.language),
    difficultyLevel: isValidExplanationLevel(session.difficultyLevel)
      ? session.difficultyLevel
      : 'Intermediate',
    teachingMode: isValidTeachingMode(session.teachingMode) ? session.teachingMode : 'explain',
    messages: boundedMessages,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
  };
}
