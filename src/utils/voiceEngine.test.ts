import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VOICE_AUDIO_BYTES,
  MAX_VOICE_HISTORY_TURNS,
  MAX_VOICE_SESSION_TURNS,
  base64Int16ToFloat32,
  buildVoiceClassroomInstruction,
  calculateRmsLevel,
  classifyMicrophoneError,
  cleanTextForSpeech,
  float32ToInt16Base64,
  getBcp47LanguageTag,
  normalizeVoiceName,
  sanitizeVoiceSessionForStorage,
  validateVoiceTranscribeRequest,
  validateVoiceTtsRequest,
  validateVoiceTurnRequest,
} from './voiceEngine';
import { VoiceSessionRecord } from '../types/phase6';

describe('Phase 6 Voice Learning Engine Utilities', () => {
  it('cleans markdown syntax cleanly while preserving English and Hindi Devanagari text for TTS', () => {
    const raw = '**Ohm’s Law:** $V = IR$! Check [notes](https://example.com) and `# important`: `वोल्टेज = धारा × प्रतिरोध`।';
    const cleaned = cleanTextForSpeech(raw);
    assert.doesNotMatch(cleaned, /\*\*|`|\[notes\]|https:\/\/example\.com/);
    assert.match(cleaned, /Ohm’s Law/);
    assert.match(cleaned, /वोल्टेज = धारा × प्रतिरोध/);
  });

  it('round-trips Float32 PCM audio to Int16 Base64 and computes RMS level accurately', () => {
    const input = new Float32Array([0, 0.5, -0.5, 0.25, -0.25]);
    const b64 = float32ToInt16Base64(input);
    const output = base64Int16ToFloat32(b64);
    assert.equal(output.length, input.length);
    for (let i = 0; i < input.length; i += 1) {
      assert.ok(Math.abs(output[i] - input[i]) < 0.001, `Sample ${i} mismatch`);
    }
    const silent = calculateRmsLevel(new Float32Array([0, 0, 0]));
    const loud = calculateRmsLevel(new Float32Array([0.4, -0.4, 0.4, -0.4]));
    assert.equal(silent, 0);
    assert.ok(loud > 0.5 && loud <= 1);
  });

  it('validates voice turn requests across English, Hindi, and Bilingual modes with bounded history', () => {
    const longHistory = Array.from({ length: 20 }, (_, idx) => ({
      role: (idx % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Turn ${idx}`,
    }));

    const res = validateVoiceTurnRequest({
      subject: 'Physics',
      topic: 'Current Electricity',
      classGrade: 'Class 12',
      board: 'CBSE',
      language: 'Hindi',
      message: 'कृपया किरचॉफ का नियम समझाइए।',
      history: longHistory,
    });

    assert.equal(res.valid, true);
    assert.equal(res.sanitized?.language, 'Hindi');
    assert.equal(res.sanitized?.history.length, MAX_VOICE_HISTORY_TURNS);
    assert.equal(getBcp47LanguageTag('Hindi'), 'hi-IN');
    assert.equal(getBcp47LanguageTag('English'), 'en-IN');
    assert.equal(getBcp47LanguageTag('Bilingual'), 'en-IN');

    const empty = validateVoiceTurnRequest({ subject: 'Physics', message: '   ' });
    assert.equal(empty.valid, false);
  });

  it('validates audio transcription clips and rejects oversized or invalid MIME payloads', () => {
    const sampleAudio = Buffer.from('a'.repeat(200)).toString('base64');
    const ok = validateVoiceTranscribeRequest({
      audioBase64: `data:audio/webm;codecs=opus;base64,${sampleAudio}`,
      mimeType: 'audio/webm;codecs=opus',
      language: 'Bilingual',
    });
    assert.equal(ok.valid, true);
    assert.equal(ok.sanitized?.mimeType, 'audio/webm');

    const badMime = validateVoiceTranscribeRequest({
      audioBase64: sampleAudio,
      mimeType: 'application/pdf',
      language: 'English',
    });
    assert.equal(badMime.valid, false);

    const tooShort = validateVoiceTranscribeRequest({
      audioBase64: Buffer.from('tiny').toString('base64'),
      mimeType: 'audio/wav',
      language: 'English',
    });
    assert.equal(tooShort.valid, false);

    const oversizedB64 = 'A'.repeat(Math.ceil((MAX_VOICE_AUDIO_BYTES + 1024) * 1.4));
    const tooBig = validateVoiceTranscribeRequest({
      audioBase64: oversizedB64,
      mimeType: 'audio/webm',
      language: 'English',
    });
    assert.equal(tooBig.valid, false);
  });

  it('validates TTS requests and normalizes voice presets cleanly', () => {
    const res = validateVoiceTtsRequest({
      text: '**प्रकाश संश्लेषण** क्या है?',
      language: 'Hindi',
      voiceName: 'Zephyr',
    });
    assert.equal(res.valid, true);
    assert.equal(res.sanitized?.text, 'प्रकाश संश्लेषण क्या है?');
    assert.equal(res.sanitized?.voiceName, 'Zephyr');
    assert.equal(normalizeVoiceName('UnknownVoice'), 'Kore');
  });

  it('classifies microphone permission and hardware errors gracefully', () => {
    const denied = classifyMicrophoneError({ name: 'NotAllowedError', message: 'Permission denied' });
    assert.equal(denied.permissionState, 'denied');

    const noDevice = classifyMicrophoneError({ name: 'NotFoundError', message: 'Requested device not found' });
    assert.equal(noDevice.permissionState, 'no-device');

    const unsupported = classifyMicrophoneError(new Error('AudioContext unsupported in browser'));
    assert.equal(unsupported.permissionState, 'unsupported');
  });

  it('strips raw audio data URLs and enforces bounded text-only transcript storage (Privacy Guard)', () => {
    const dirtySession: VoiceSessionRecord & { audioBlob?: string; extraKey?: boolean } = {
      id: 'vs_custom_1',
      userId: 'student_42',
      title: 'Optics Dialogue',
      subject: 'Physics',
      topic: 'Refraction',
      classGrade: 'Class 10',
      board: 'CBSE',
      language: 'Bilingual',
      voiceName: 'Kore',
      transportUsed: 'gemini-live',
      turns: Array.from({ length: 75 }, (_, i) => ({
        id: `vt_${i}`,
        role: i % 2 === 0 ? 'student' : 'teacher',
        text: `Turn ${i} data:audio/webm;base64,AAAA1111==`,
        spokenScript: `Spoken ${i}`,
        inputSource: 'live-voice' as const,
        language: 'Bilingual' as const,
        timestamp: '2026-01-01T00:00:00.000Z',
      })),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      audioBlob: 'secret-raw-recording',
      extraKey: true,
    };

    const sanitized = sanitizeVoiceSessionForStorage(dirtySession);
    assert.equal(sanitized.id, 'vs_custom_1');
    assert.equal(sanitized.userId, 'student_42');
    assert.equal(sanitized.turns.length, MAX_VOICE_SESSION_TURNS);
    assert.doesNotMatch(sanitized.turns[0].text, /data:audio\/webm;base64/);
    assert.equal('audioBlob' in sanitized, false);
    assert.equal('extraKey' in sanitized, false);
  });

  it('builds syllabus-honest Hindi, Hinglish, and English classroom system instructions', () => {
    const hi = buildVoiceClassroomInstruction({
      subject: 'Science',
      topic: 'Acids and Bases',
      classGrade: 'Class 10',
      board: 'CBSE',
      language: 'Hindi',
    });
    assert.match(hi, /Hindi \(Devanagari script/i);
    assert.match(hi, /Never fabricate official/i);

    const hinglish = buildVoiceClassroomInstruction({
      subject: 'Science',
      topic: 'Electric Current',
      classGrade: 'Class 10',
      board: 'CBSE',
      language: 'Hinglish',
    });
    assert.match(hinglish, /classroom Hinglish/i);
    assert.equal(getBcp47LanguageTag('Hinglish'), 'en-IN');
  });
});
