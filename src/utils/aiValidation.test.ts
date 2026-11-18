import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_HISTORY_TURNS,
  MAX_SESSION_MESSAGES,
  TUTOR_LANGUAGES,
  buildAiTeacherSystemInstruction,
  buildTeacherLanguageInstruction,
  estimateBase64DecodedBytes,
  formatAttachmentLabel,
  getTutorLanguageLabel,
  normalizeLanguageForTutor,
  sanitizeDoubtForStorage,
  sanitizeTeacherSessionForStorage,
  validateAttachmentMetadata,
  validateDoubtRequest,
  validateTeacherRequest,
} from './aiValidation';
import { DoubtTicket, TeacherSession } from '../types/ai';

describe('AI Teacher & Doubt Solver Validation Utilities', () => {
  it('validates allowed image and PDF MIME types and rejects unsafe types', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const validPngBuf = Buffer.concat([pngHeader, Buffer.from('hello world')]);
    const validPng = validPngBuf.toString('base64');
    const okPng = validateAttachmentMetadata({
      fileName: 'homework.png',
      mimeType: 'image/png',
      sizeBytes: validPngBuf.length,
      dataBase64: validPng,
    });
    assert.equal(okPng.valid, true);
    assert.equal(okPng.decodedBytes, validPngBuf.length);

    const okPdf = validateAttachmentMetadata({
      fileName: 'worksheet.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
    assert.equal(okPdf.valid, true);

    const badExe = validateAttachmentMetadata({
      fileName: 'script.exe',
      mimeType: 'application/x-msdownload',
      sizeBytes: 512,
    });
    assert.equal(badExe.valid, false);
    assert.match(badExe.error || '', /Unsupported file type/i);
  });

  it('rejects empty (0-byte), oversized (>4MB), and corrupt base64 attachments', () => {
    const emptyRes = validateAttachmentMetadata({
      fileName: 'empty.png',
      mimeType: 'image/png',
      sizeBytes: 0,
    });
    assert.equal(emptyRes.valid, false);

    const hugeRes = validateAttachmentMetadata({
      fileName: 'scan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: MAX_ATTACHMENT_BYTES + 1024,
    });
    assert.equal(hugeRes.valid, false);
    assert.match(hugeRes.error || '', /exceeds the 4 MB/i);

    const corruptRes = validateAttachmentMetadata({
      fileName: 'notes.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      dataBase64: '!!!not-valid-base64!!!',
    });
    assert.equal(corruptRes.valid, false);
    assert.equal(estimateBase64DecodedBytes('!!!invalid!!!'), -1);
  });

  it('strips data URL prefixes cleanly when calculating decoded bytes', () => {
    const raw = Buffer.from('Sample PNG payload').toString('base64');
    const bytes = estimateBase64DecodedBytes(`data:image/png;base64,${raw}`);
    assert.equal(bytes, Buffer.from('Sample PNG payload').length);
  });

  it('validates AI Teacher requests and bounds conversation history', () => {
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Turn ${i}`,
    }));

    const res = validateTeacherRequest({
      subject: 'Physics',
      classGrade: 'Class 12',
      board: 'ISC',
      language: 'Bilingual',
      level: 'Advanced',
      mode: 'step-by-step',
      message: 'Explain Gauss Theorem with spherical symmetry',
      history: longHistory,
    });

    assert.equal(res.valid, true);
    assert.equal(res.sanitized?.history.length, MAX_HISTORY_TURNS);
    assert.equal(res.sanitized?.mode, 'step-by-step');

    const emptyMsg = validateTeacherRequest({
      subject: 'Physics',
      classGrade: 'Class 10',
      message: '   ',
    });
    assert.equal(emptyMsg.valid, false);
  });

  it('supports English, Hindi (हिंदी), and Hinglish as first-class tutor languages while normalizing legacy Bilingual', () => {
    assert.deepEqual(TUTOR_LANGUAGES, ['English', 'Hindi', 'Hinglish']);
    assert.equal(getTutorLanguageLabel('English'), 'English');
    assert.equal(getTutorLanguageLabel('Hindi'), 'हिंदी');
    assert.equal(getTutorLanguageLabel('Hinglish'), 'Hinglish');
    assert.equal(getTutorLanguageLabel('Bilingual'), 'Hinglish');

    assert.equal(normalizeLanguageForTutor('Hinglish'), 'Hinglish');
    assert.equal(normalizeLanguageForTutor('Bilingual'), 'Bilingual');
    assert.equal(normalizeLanguageForTutor('Hindi'), 'Hindi');
    assert.equal(normalizeLanguageForTutor('हिंदी'), 'Hindi');
    assert.equal(normalizeLanguageForTutor('English'), 'English');

    const teacherHinglishReq = validateTeacherRequest({
      subject: 'Science',
      classGrade: 'Class 10',
      board: 'CBSE',
      language: 'Hinglish',
      level: 'Intermediate',
      mode: 'explain',
      message: 'Explain how electricity flows through a conductor',
    });
    assert.equal(teacherHinglishReq.valid, true);
    assert.equal(teacherHinglishReq.sanitized?.language, 'Hinglish');
  });

  it('builds natural classroom Hinglish prompt instructions and mid-conversation language adaptation directives', () => {
    const hinglishRules = buildTeacherLanguageInstruction('Hinglish');
    assert.match(hinglishRules, /Natural Hinglish/i);
    assert.match(hinglishRules, /50% Hindi and ~50% English/i);
    assert.match(hinglishRules, /Ab isko ek example se samajhte hain/);
    assert.match(hinglishRules, /Yahan ek important point notice karo/);
    assert.match(hinglishRules, /Ab next step dekhte hain/);
    assert.match(hinglishRules, /electric current kehte hain/i);

    const hindiRules = buildTeacherLanguageInstruction('Hindi');
    assert.match(hindiRules, /Devanagari script/i);

    const englishRules = buildTeacherLanguageInstruction('English');
    assert.match(englishRules, /Indian academic English/i);

    const sysPrompt = buildAiTeacherSystemInstruction({
      subject: 'Mathematics',
      classGrade: 'Class 10',
      board: 'CBSE',
      language: 'Hinglish',
      level: 'Intermediate',
      modeLabel: 'Explain a concept',
      modeDescription: 'Step-by-step clarity',
    });
    assert.match(sysPrompt, /Mid-Conversation Language Adaptation Rule/);
    assert.match(sysPrompt, /active language mode \(Hinglish\)/);
    assert.match(sysPrompt, /Mathematics for Class 10 \(CBSE board\)/);
  });

  it('validates and builds prompts for all three language modes across Science and Mathematics including mid-conversation switches', () => {
    const subjects = ['Science', 'Mathematics'] as const;
    const languages = ['English', 'Hindi', 'Hinglish'] as const;

    for (const subject of subjects) {
      for (const language of languages) {
        const promptQuestion =
          subject === 'Science'
            ? 'Explain how electric current flows in a conductor.'
            : 'Explain how the discriminant determines the nature of roots of a quadratic equation.';

        const req = validateTeacherRequest({
          subject,
          classGrade: 'Class 10',
          board: 'CBSE',
          language,
          level: 'Intermediate',
          mode: 'explain',
          message: promptQuestion,
          history: [
            { role: 'user', content: 'Previous English question' },
            { role: 'assistant', content: '[English] Previous English explanation' },
          ],
        });

        assert.equal(req.valid, true, `${subject} ${language} request must be valid`);
        assert.equal(req.sanitized?.language, language);
        assert.equal(req.sanitized?.history.length, 2);

        const sysPrompt = buildAiTeacherSystemInstruction({
          subject,
          classGrade: 'Class 10',
          board: 'CBSE',
          language,
          level: 'Intermediate',
          modeLabel: 'Explain a concept',
          modeDescription: 'Step-by-step clarity',
        });
        assert.match(sysPrompt, new RegExp(subject));
        assert.match(sysPrompt, new RegExp(`active language mode \\(${language}\\)`));
        assert.match(sysPrompt, /immediately to .* without losing the ongoing topic/i);
      }
    }
  });

  it('requires either question text or valid attachment in Doubt Solver requests', () => {
    const empty = validateDoubtRequest({
      classGrade: 'Class 10',
      board: 'CBSE',
      language: 'English',
      inputMode: 'typed',
      question: '   ',
    });
    assert.equal(empty.valid, false);

    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('image-bytes'),
    ]);
    const pngBase64 = pngBytes.toString('base64');
    const attachmentOnly = validateDoubtRequest({
      classGrade: 'Class 10',
      board: 'CBSE',
      language: 'Bilingual',
      inputMode: 'handwritten',
      attachment: {
        fileName: 'handwritten.png',
        mimeType: 'image/png',
        sizeBytes: pngBytes.length,
        dataBase64: `data:image/png;base64,${pngBase64}`,
      },
    });
    assert.equal(attachmentOnly.valid, true);
    assert.equal(attachmentOnly.sanitized?.attachment?.dataBase64, pngBase64);
  });

  it('strips sensitive data URLs and respects blueprint limits when sanitizing doubt history', () => {
    const dirtyTicket: DoubtTicket & { extraData?: string } = {
      id: 'doubt/../../hack',
      userId: 'user-1',
      title: 'A'.repeat(250),
      subject: 'Mathematics',
      classGrade: 'Class 10',
      questionText: 'Solve data:image/png;base64,AAAA1234== for x',
      language: 'English',
      status: 'answered',
      aiAnswer: 'Answer',
      attachmentLabel: formatAttachmentLabel('notes.png', 'image/png', 20480),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      extraData: 'should be stripped',
    };

    const sanitized = sanitizeDoubtForStorage(dirtyTicket);
    assert.doesNotMatch(sanitized.id, /[/.]/);
    assert.equal(sanitized.title.length, 200);
    assert.doesNotMatch(sanitized.questionText, /data:image\/png;base64/);
    assert.equal('extraData' in sanitized, false);
  });

  it('bounds persisted teacher session messages to MAX_SESSION_MESSAGES', () => {
    const messages = Array.from({ length: 55 }, (_, i) => ({
      id: `m-${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Content ${i}`,
      mode: 'explain' as const,
      level: 'Intermediate' as const,
      language: 'English' as const,
      timestamp: '2026-01-01T00:00:00.000Z',
    }));

    const session: TeacherSession = {
      id: 'sess-1',
      userId: 'user-1',
      title: 'Electrostatics',
      subject: 'Physics',
      classGrade: 'Class 12',
      board: 'CBSE',
      language: 'English',
      difficultyLevel: 'Intermediate',
      teachingMode: 'explain',
      messages,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const sanitized = sanitizeTeacherSessionForStorage(session);
    assert.equal(sanitized.messages.length, MAX_SESSION_MESSAGES);
    assert.equal(sanitized.messages[0].id, 'm-15');
  });
});
