import type { TutorLanguage } from './ai.ts';

export type VoiceTransportMode = 'gemini-live' | 'stt-tts-pipeline' | 'text-fallback';

export type VoiceSessionState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'paused'
  | 'error';

export type MicPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported' | 'no-device';

export type GeminiVoiceName = 'Kore' | 'Zephyr' | 'Puck' | 'Charon' | 'Fenrir';

export interface VoiceTurnItem {
  id: string;
  role: 'student' | 'teacher';
  text: string;
  spokenScript?: string;
  conceptualCheck?: string;
  inputSource: 'live-voice' | 'stt-voice' | 'text';
  language: TutorLanguage;
  timestamp: string;
}

export interface VoiceSessionRecord {
  id: string;
  userId: string;
  title: string;
  subject: string;
  topic: string;
  classGrade: string;
  board: string;
  language: TutorLanguage;
  voiceName: GeminiVoiceName;
  transportUsed: VoiceTransportMode;
  turns: VoiceTurnItem[];
  createdAt: string;
  updatedAt: string;
}

export interface VoiceTurnRequestPayload {
  subject: string;
  topic?: string;
  classGrade: string;
  board: string;
  language: TutorLanguage;
  message: string;
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export interface VoiceTurnResponsePayload {
  detectedTopic: string;
  replyText: string;
  spokenScript: string;
  conceptualCheck: string;
  languageUsed: TutorLanguage;
  syllabusNote: string;
}

export interface VoiceTranscribeRequestPayload {
  audioBase64: string;
  mimeType: string;
  language: TutorLanguage;
  subjectHint?: string;
}

export interface VoiceTranscribeResponsePayload {
  transcript: string;
  detectedLanguage: TutorLanguage;
}

export interface VoiceTtsRequestPayload {
  text: string;
  language: TutorLanguage;
  voiceName?: GeminiVoiceName;
}

export interface VoiceTtsResponsePayload {
  audioBase64: string;
  mimeType: string;
  voiceName: GeminiVoiceName;
  engine: 'gemini-3.8-flash-lite-tts' | 'gemini-3.8-flash-tts';
}
