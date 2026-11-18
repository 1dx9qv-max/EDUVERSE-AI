import type { TutorLanguage } from '../types/ai.ts';
import type {
  GeminiVoiceName,
  MicPermissionState,
  VoiceSessionRecord,
  VoiceTranscribeRequestPayload,
  VoiceTransportMode,
  VoiceTtsRequestPayload,
  VoiceTurnItem,
  VoiceTurnRequestPayload,
} from '../types/phase6.ts';
import { normalizeLanguageForTutor, stripDataUrlPrefix } from './aiValidation.ts';
import { sanitizeDocumentId } from './learningEngine.ts';

export const ALLOWED_VOICE_NAMES: readonly GeminiVoiceName[] = [
  'Kore',
  'Zephyr',
  'Puck',
  'Charon',
  'Fenrir',
] as const;

export const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
] as const;

export const MAX_VOICE_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB ephemeral turn clip
export const MAX_VOICE_HISTORY_TURNS = 12;
export const MAX_VOICE_SESSION_TURNS = 60;

export function normalizeVoiceName(raw?: string | null): GeminiVoiceName {
  if (raw && (ALLOWED_VOICE_NAMES as readonly string[]).includes(raw)) {
    return raw as GeminiVoiceName;
  }
  return 'Kore';
}

export function getBcp47LanguageTag(language: TutorLanguage): string {
  if (language === 'Hindi') return 'hi-IN';
  // Bilingual Indian teachers and Indian English speakers work best with en-IN
  return 'en-IN';
}

export function cleanTextForSpeech(rawText: string): string {
  return (rawText || '')
    .replace(/```[\s\S]*?```/g, ' code snippet omitted ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1400);
}

export function normalizeAudioMimeType(rawMime?: string | null): string {
  const clean = (rawMime || '').trim().toLowerCase();
  if (!clean) return '';
  const base = clean.split(';')[0].trim();
  if (base === 'audio/webm') return 'audio/webm';
  if (base === 'audio/ogg') return 'audio/ogg';
  if (base === 'audio/mp4' || base === 'audio/m4a' || base === 'audio/x-m4a') return 'audio/mp4';
  if (base === 'audio/mpeg' || base === 'audio/mp3') return 'audio/mp3';
  if (base === 'audio/wav' || base === 'audio/x-wav' || base === 'audio/wave') return 'audio/wav';
  if (base === 'audio/aac') return 'audio/aac';
  return base;
}

export function validateVoiceTurnRequest(payload: Partial<VoiceTurnRequestPayload>): {
  valid: boolean;
  error?: string;
  sanitized?: VoiceTurnRequestPayload;
} {
  const subject = (payload.subject || '').trim().slice(0, 100);
  const topic = (payload.topic || '').trim().slice(0, 140);
  const classGrade = (payload.classGrade || 'Class 10').trim().slice(0, 30);
  const board = (payload.board || 'CBSE').trim().slice(0, 32);
  const language = normalizeLanguageForTutor(payload.language);
  const message = (payload.message || '').trim();

  if (!subject) {
    return { valid: false, error: 'Please choose a school subject for your voice lesson.' };
  }
  if (!message) {
    return { valid: false, error: 'Spoken or typed question text cannot be empty.' };
  }
  if (message.length > 2000) {
    return { valid: false, error: 'Question exceeds 2,000 characters. Please ask a shorter question.' };
  }

  const rawHistory = Array.isArray(payload.history) ? payload.history : [];
  const boundedHistory = rawHistory
    .filter(
      (h) =>
        h &&
        (h.role === 'user' || h.role === 'assistant') &&
        typeof h.content === 'string' &&
        h.content.trim().length > 0
    )
    .slice(-MAX_VOICE_HISTORY_TURNS)
    .map((h) => ({
      role: h.role,
      content: h.content.trim().slice(0, 1500),
    }));

  return {
    valid: true,
    sanitized: {
      subject,
      topic: topic || undefined,
      classGrade,
      board,
      language,
      message,
      history: boundedHistory,
    },
  };
}

export function validateVoiceTranscribeRequest(payload: Partial<VoiceTranscribeRequestPayload>): {
  valid: boolean;
  error?: string;
  sanitized?: VoiceTranscribeRequestPayload;
} {
  const rawAudio = (payload.audioBase64 || '').trim();
  const normalizedMime = normalizeAudioMimeType(payload.mimeType);
  const language = normalizeLanguageForTutor(payload.language);
  const subjectHint = (payload.subjectHint || '').trim().slice(0, 80);

  if (!rawAudio) {
    return { valid: false, error: 'No captured audio payload provided for transcription.' };
  }

  const allowedBaseMimes = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mp3', 'audio/wav', 'audio/aac'];
  if (!allowedBaseMimes.includes(normalizedMime)) {
    return {
      valid: false,
      error: `Unsupported audio MIME type "${payload.mimeType || 'unknown'}".`,
    };
  }

  const cleanBase64 = stripDataUrlPrefix(rawAudio).replace(/\s+/g, '');
  if (!cleanBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleanBase64) || cleanBase64.length % 4 === 1) {
    return { valid: false, error: 'Captured audio encoding was invalid.' };
  }

  const estimatedBytes = Math.floor((cleanBase64.length * 3) / 4);
  if (estimatedBytes < 64) {
    return { valid: false, error: 'Recorded audio clip was too short to contain speech.' };
  }
  if (estimatedBytes > MAX_VOICE_AUDIO_BYTES) {
    return { valid: false, error: 'Voice clip exceeds 5 MB limit. Please speak in shorter turns.' };
  }

  return {
    valid: true,
    sanitized: {
      audioBase64: cleanBase64,
      mimeType: normalizedMime,
      language,
      subjectHint: subjectHint || undefined,
    },
  };
}

export function validateVoiceTtsRequest(payload: Partial<VoiceTtsRequestPayload>): {
  valid: boolean;
  error?: string;
  sanitized?: Required<VoiceTtsRequestPayload>;
} {
  const text = cleanTextForSpeech(payload.text || '');
  const language = normalizeLanguageForTutor(payload.language);
  const voiceName = normalizeVoiceName(payload.voiceName);

  if (!text) {
    return { valid: false, error: 'Text for speech synthesis cannot be empty.' };
  }

  return {
    valid: true,
    sanitized: {
      text,
      language,
      voiceName,
    },
  };
}

export function buildVoiceClassroomInstruction(params: {
  subject: string;
  topic?: string;
  classGrade: string;
  board: string;
  language: TutorLanguage;
}): string {
  const normalizedLang = normalizeLanguageForTutor(params.language);
  const langGuide =
    normalizedLang === 'Hindi'
      ? 'Speak warmly and clearly in natural Hindi (Devanagari script for transcripts), keeping scientific equations/terms accurate.'
      : normalizedLang === 'Hinglish'
        ? 'Speak naturally in conversational classroom Hinglish (~50% Hindi + ~50% English in Roman script, keeping scientific and math terminology in English while explaining intuition in friendly spoken Hindi).'
        : 'Speak warmly and clearly in natural Indian academic English.';

  return [
    `You are EDUVERSE AI Voice Teacher — a patient, encouraging Indian school teacher holding a 1-on-1 spoken classroom session with a ${params.classGrade} (${params.board} board) student studying ${params.subject}${params.topic ? ` (Topic: ${params.topic})` : ''}.`,
    langGuide,
    'Voice Teaching Rules:',
    '1. Keep explanations conversational, crisp, and easy to follow by ear (2 to 4 short sentences at a time rather than a wall of text).',
    '2. Never judge or rush the student. Praise good intuition and gently correct misconceptions.',
    '3. Use everyday Indian analogies (trains, fans, cricket, kitchen experiments, monsoon) when helpful.',
    '4. End with one gentle conceptual check question to keep the dialogue interactive.',
    '5. SYLLABUS HONESTY: Never fabricate official NCERT/ICSE page numbers or official circular codes.',
  ].join('\n');
}

export function float32ToInt16Base64(floatSamples: Float32Array): string {
  const int16 = new Int16Array(floatSamples.length);
  for (let i = 0; i < floatSamples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
    int16[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

export function base64Int16ToFloat32(base64Pcm: string): Float32Array {
  let bytes: Uint8Array;
  if (typeof atob === 'function') {
    const binary = atob(base64Pcm);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
  } else {
    bytes = new Uint8Array(Buffer.from(base64Pcm, 'base64'));
  }

  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    const intVal = view.getInt16(i * 2, true);
    float32[i] = intVal / 32768;
  }
  return float32;
}

export function calculateRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return Number(Math.min(1, rms * 3.5).toFixed(3));
}

export function classifyMicrophoneError(error: unknown): {
  permissionState: MicPermissionState;
  title: string;
  detail: string;
} {
  const errName = error && typeof error === 'object' && 'name' in error ? String((error as any).name) : '';
  const errMsg = error instanceof Error ? error.message : String(error || '');
  const lower = `${errName} ${errMsg}`.toLowerCase();

  if (lower.includes('notallowed') || lower.includes('permissiondenied') || lower.includes('permission dismissed')) {
    return {
      permissionState: 'denied',
      title: 'Microphone access was denied',
      detail: 'Allow microphone permission in your browser site settings, or continue seamlessly using the typed Text Fallback below.',
    };
  }

  if (lower.includes('notfound') || lower.includes('devicesnotfound') || lower.includes('requested device not found')) {
    return {
      permissionState: 'no-device',
      title: 'No microphone hardware detected',
      detail: 'No active microphone was found on this device. You can ask questions anytime using the Text Fallback box and still listen to AI Teacher replies.',
    };
  }

  if (lower.includes('notreadable') || lower.includes('trackstarterror') || lower.includes('in use')) {
    return {
      permissionState: 'denied',
      title: 'Microphone is busy or unavailable',
      detail: 'Another application may be locking the microphone. Close conflicting tabs/apps or type your question below.',
    };
  }

  if (lower.includes('not supported') || lower.includes('unsupported') || lower.includes('undefined')) {
    return {
      permissionState: 'unsupported',
      title: 'Voice capture is unsupported in this browser',
      detail: 'This browser context does not expose microphone recording APIs. Use Text Fallback below for the full AI Teacher experience.',
    };
  }

  return {
    permissionState: 'denied',
    title: 'Could not start microphone',
    detail: 'Microphone initialization failed safely. Type your question below to continue learning without interruption.',
  };
}

function scrubAudioDataUrls(text: string): string {
  return (text || '')
    .replace(/data:(audio|video|application)\/[a-zA-Z0-9/+.-]+;base64,[A-Za-z0-9+/=]+/g, '[audio omitted]')
    .trim();
}

function keepOrSanitizeId(raw: string | undefined, fallbackPrefix: string): string {
  const trimmed = (raw || '').trim();
  if (/^[a-zA-Z0-9_-]{1,128}$/.test(trimmed)) {
    return trimmed;
  }
  return sanitizeDocumentId(trimmed || `${fallbackPrefix}_${Date.now()}`, fallbackPrefix);
}

/**
 * Privacy & Blueprint guard:
 * Persists ONLY text conversation transcripts — raw voice audio bytes/blobs are never stored.
 */
export function sanitizeVoiceSessionForStorage(session: VoiceSessionRecord): VoiceSessionRecord {
  const validTransports: VoiceTransportMode[] = ['gemini-live', 'stt-tts-pipeline', 'text-fallback'];
  const transportUsed: VoiceTransportMode = validTransports.includes(session.transportUsed)
    ? session.transportUsed
    : 'stt-tts-pipeline';

  const safeTurns: VoiceTurnItem[] = (session.turns || [])
    .slice(-MAX_VOICE_SESSION_TURNS)
    .filter((t) => t && typeof t.text === 'string' && scrubAudioDataUrls(t.text).length > 0)
    .map((t, idx) => {
      const cleanTurn: VoiceTurnItem = {
        id: keepOrSanitizeId(t.id || `vt_${idx + 1}`, 'vt'),
        role: t.role === 'teacher' ? 'teacher' : 'student',
        text: scrubAudioDataUrls(t.text).slice(0, 2500),
        inputSource:
          t.inputSource === 'live-voice' || t.inputSource === 'stt-voice' ? t.inputSource : 'text',
        language: normalizeLanguageForTutor(t.language),
        timestamp: (t.timestamp || new Date().toISOString()).slice(0, 64),
      };
      if (t.spokenScript) {
        cleanTurn.spokenScript = scrubAudioDataUrls(t.spokenScript).slice(0, 1600);
      }
      if (t.conceptualCheck) {
        cleanTurn.conceptualCheck = scrubAudioDataUrls(t.conceptualCheck).slice(0, 500);
      }
      return cleanTurn;
    });

  return {
    id: keepOrSanitizeId(session.id, 'vs'),
    userId: keepOrSanitizeId(session.userId || '', 'usr'),
    title: scrubAudioDataUrls(session.title || `${session.subject || 'Science'} Voice Lesson`).slice(0, 160),
    subject: (session.subject || 'Science').trim().slice(0, 80),
    topic: (session.topic || 'Interactive Classroom').trim().slice(0, 140),
    classGrade: (session.classGrade || 'Class 10').trim().slice(0, 30),
    board: (session.board || 'CBSE').trim().slice(0, 32),
    language: normalizeLanguageForTutor(session.language),
    voiceName: normalizeVoiceName(session.voiceName),
    transportUsed,
    turns: safeTurns,
    createdAt: (session.createdAt || new Date().toISOString()).slice(0, 64),
    updatedAt: (session.updatedAt || new Date().toISOString()).slice(0, 64),
  };
}
