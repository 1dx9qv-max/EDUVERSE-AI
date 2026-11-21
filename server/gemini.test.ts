import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_FAST_FALLBACK_MODEL,
  GEMINI_MODEL,
  GeminiServiceError,
  analyzeDatesheetDocuments,
  mapGeminiError,
  normalizeRawDatesheetExtraction,
} from './gemini.ts';

function createValidPdfAttachment() {
  const rawPdf = '%PDF-1.5\n1 0 obj << /Type /Page >> endobj';
  return {
    fileName: 'cbse_class12_2026.pdf',
    mimeType: 'application/pdf' as const,
    sizeBytes: rawPdf.length,
    pageCount: 1,
    dataBase64: Buffer.from(rawPdf, 'latin1').toString('base64'),
  };
}

function createValidPngAttachment() {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  return {
    fileName: 'datesheet_page1.png',
    mimeType: 'image/png' as const,
    sizeBytes: bytes.length,
    pageCount: 1,
    dataBase64: bytes.toString('base64'),
  };
}

test('mapGeminiError classifies 503, 429, 400 API_KEY_INVALID, 403, 504 timeout, and unmapped errors cleanly without leaking raw JSON', () => {
  const errWithJson = new Error(
    '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}'
  );
  const mapped = mapGeminiError(errWithJson);

  assert.ok(mapped instanceof GeminiServiceError);
  assert.equal(mapped.statusCode, 503);
  assert.equal(mapped.code, 'MODEL_OVERLOADED');
  assert.equal(mapped.retryable, true);
  assert.doesNotMatch(mapped.message, /"error"|\{code|"code"/);
  assert.match(mapped.message, /high demand/i);

  const rateLimit = mapGeminiError(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }));
  assert.equal(rateLimit.statusCode, 429);
  assert.equal(rateLimit.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(rateLimit.retryable, true);

  const invalidKey = mapGeminiError(Object.assign(new Error('API_KEY_INVALID'), { status: 400 }));
  assert.equal(invalidKey.statusCode, 403);
  assert.equal(invalidKey.code, 'API_KEY_INVALID');
  assert.equal(invalidKey.retryable, false);

  const denied = mapGeminiError(Object.assign(new Error('PERMISSION_DENIED'), { status: 403 }));
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.code, 'PERMISSION_DENIED');
  assert.equal(denied.retryable, false);

  const timeout = mapGeminiError(new Error('MODEL_TIMEOUT'));
  assert.equal(timeout.statusCode, 504);
  assert.equal(timeout.code, 'MODEL_TIMEOUT');
  assert.equal(timeout.retryable, true);

  const unmapped = mapGeminiError(new Error('{"internal_debug_blob":"should_not_leak_to_client"}'));
  assert.equal(unmapped.statusCode, 502);
  assert.equal(unmapped.code, 'AI_GENERATION_FAILED');
  assert.equal(unmapped.retryable, true);
  assert.doesNotMatch(unmapped.message, /internal_debug_blob/);
});

test('normalizeRawDatesheetExtraction preserves uncertainty, derives duration when times are explicit, and builds datesheet intelligence', () => {
  const result = normalizeRawDatesheetExtraction(
    {
      examinationName: '',
      board: 'CBSE',
      classGrade: 'Class 12',
      academicSession: '',
      importantInstructions: ['Bring admit card'],
      metadataUncertain: true,
      metadataUncertaintyReason: 'Top banner clipped.',
      documentReadable: true,
      entries: [
        {
          subject: 'Physics',
          subjectCode: '042',
          date: '2026-02-20',
          rawDateText: '20 Feb 2026',
          weekday: 'Fri',
          startTime: '10:30 AM',
          endTime: '01:30 PM',
          entryType: 'theory',
          isUncertain: false,
        },
        {
          subject: 'Chemistry Practical',
          date: '2026-02-21',
          weekday: 'Sunday', // Intentional mismatch for intelligence check
          entryType: 'practical',
          isUncertain: true,
          uncertaintyReason: 'Timing blurred in corner scan.',
        },
        {
          subject: 'Computer Science',
          subjectCode: '083',
          date: '',
          weekday: '',
          entryType: 'optional',
          isUncertain: true,
          uncertaintyReason: 'Date cut off on right edge.',
        },
      ],
    },
    [{ fileName: 'datesheet.pdf', mimeType: 'application/pdf', sizeBytes: 12000, pageCount: 2 }]
  );

  assert.equal(result.metadata.examName, '');
  assert.equal(result.metadata.isUncertain, true);
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0].weekday, 'Friday');
  assert.equal(result.entries[0].rawTimeText, '10:30 AM - 01:30 PM');
  assert.equal(result.entries[0].durationMinutes, 180);
  assert.equal(result.entries[1].entryType, 'practical');
  assert.equal(result.entries[2].entryType, 'optional');
  assert.equal(result.entries[2].date, '');
  assert.equal(result.entries[2].isUncertain, true);

  assert.ok(result.intelligence);
  assert.equal(result.intelligence.documentReadable, true);
  assert.equal(result.intelligence.numberOfExaminations, 3);
  assert.equal(result.intelligence.firstExam?.subject, 'Physics');
  assert.equal(result.intelligence.lastExam?.subject, 'Chemistry Practical');
  assert.equal(result.intelligence.consecutiveExamPairs.length, 1);
  assert.equal(result.intelligence.weekdayMismatchCount, 1);
  assert.ok(result.intelligence.uncertainCount >= 2);
});

test('analyzeDatesheetDocuments executes full Gemini multimodal extraction on PDF and PNG images cleanly', async () => {
  const capturedCalls: Array<{ model: string; mimeTypes: string[] }> = [];

  const result = await analyzeDatesheetDocuments(
    {
      files: [createValidPngAttachment()],
      studentBoard: 'CBSE',
      studentClassGrade: 'Class 12',
    },
    {
      aiClient: {
        models: {
          generateContent: async (params: any) => {
            const parts = params.contents?.[0]?.parts || [];
            const mimeTypes = parts
              .filter((p: any) => p.inlineData)
              .map((p: any) => p.inlineData.mimeType);
            capturedCalls.push({ model: params.model, mimeTypes });

            assert.ok(params.config?.abortSignal instanceof AbortSignal);
            assert.equal(params.config?.thinkingConfig?.thinkingLevel, 'LOW');

            return {
              text: JSON.stringify({
                examinationName: 'CBSE Senior School Certificate Examination 2026',
                board: 'CBSE',
                classGrade: 'Class 12',
                academicSession: '2025-26',
                importantInstructions: ['Candidates must reach center 30 minutes prior.'],
                metadataUncertain: false,
                documentReadable: true,
                extractionSummary: 'Extracted 2 board papers cleanly.',
                entries: [
                  {
                    subject: 'English Core',
                    subjectCode: '301',
                    date: '2026-02-17',
                    rawDateText: '17.02.2026',
                    weekday: 'Tuesday',
                    startTime: '10:30 AM',
                    endTime: '01:30 PM',
                    durationMinutes: 180,
                    entryType: 'theory',
                    isUncertain: false,
                  },
                  {
                    subject: 'Physics',
                    subjectCode: '042',
                    date: '2026-02-20',
                    rawDateText: '20.02.2026',
                    weekday: 'Friday',
                    startTime: '10:30 AM',
                    endTime: '01:30 PM',
                    durationMinutes: 180,
                    entryType: 'theory',
                    isUncertain: false,
                  },
                ],
              }),
              candidates: [{ finishReason: 'STOP' }],
            } as any;
          },
        },
      },
    }
  );

  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].model, GEMINI_MODEL);
  assert.deepEqual(capturedCalls[0].mimeTypes, ['image/png']);
  assert.equal(result.metadata.examName, 'CBSE Senior School Certificate Examination 2026');
  assert.equal(result.entries.length, 2);
  assert.equal(result.intelligence?.firstExam?.subject, 'English Core');
  assert.equal(result.intelligence?.lastExam?.subject, 'Physics');
});

test('analyzeDatesheetDocuments falls back to fast model on 503 and rejects unreadable, malformed, safety-blocked, or timed-out documents cleanly', async () => {
  // 1. Unreadable document -> 422 UNREADABLE_OR_EMPTY_EXTRACTION
  await assert.rejects(
    () =>
      analyzeDatesheetDocuments(
        { files: [createValidPdfAttachment()] },
        {
          aiClient: {
            models: {
              generateContent: async () =>
                ({
                  text: JSON.stringify({
                    examinationName: '',
                    board: '',
                    classGrade: '',
                    academicSession: '',
                    importantInstructions: [],
                    metadataUncertain: true,
                    documentReadable: false,
                    extractionSummary: 'Uploaded scan is too blurry to read any subject or exam dates.',
                    entries: [],
                  }),
                  candidates: [{ finishReason: 'STOP' }],
                }) as any,
            },
          },
        }
      ),
    (err: any) =>
      err instanceof GeminiServiceError &&
      err.statusCode === 422 &&
      err.code === 'UNREADABLE_OR_EMPTY_EXTRACTION'
  );

  // 2. Malformed JSON -> retries then falls back and surfaces AI_PARSE_ERROR cleanly
  let parseAttempts = 0;
  await assert.rejects(
    () =>
      analyzeDatesheetDocuments(
        { files: [createValidPdfAttachment()] },
        {
          aiClient: {
            models: {
              generateContent: async () => {
                parseAttempts += 1;
                return { text: '{broken-json', candidates: [{ finishReason: 'STOP' }] } as any;
              },
            },
          },
        }
      ),
    (err: any) =>
      err instanceof GeminiServiceError &&
      err.statusCode === 502 &&
      err.code === 'AI_PARSE_ERROR'
  );
  assert.ok(parseAttempts >= 2);

  // 3. 503 on primary -> succeeds via fallback model
  const modelsTried: string[] = [];
  const recovered = await analyzeDatesheetDocuments(
    { files: [createValidPdfAttachment()] },
    {
      aiClient: {
        models: {
          generateContent: async (params: any) => {
            modelsTried.push(params.model);
            if (params.model === GEMINI_MODEL) {
              throw Object.assign(new Error('UNAVAILABLE'), { status: 503 });
            }
            return {
              text: JSON.stringify({
                examinationName: 'ICSE Class 10 2026',
                board: 'ICSE',
                classGrade: 'Class 10',
                academicSession: '2025-26',
                importantInstructions: [],
                metadataUncertain: false,
                documentReadable: true,
                entries: [
                  {
                    subject: 'History & Civics',
                    date: '2026-03-04',
                    weekday: 'Wednesday',
                    entryType: 'theory',
                    isUncertain: false,
                  },
                ],
              }),
              candidates: [{ finishReason: 'STOP' }],
            } as any;
          },
        },
      },
    }
  );
  assert.ok(modelsTried.includes(GEMINI_MODEL));
  assert.ok(modelsTried.includes(GEMINI_FAST_FALLBACK_MODEL));
  assert.equal(recovered.entries[0].subject, 'History & Civics');

  // 4. Safety block -> 400 SAFETY_BLOCKED (non-retryable)
  await assert.rejects(
    () =>
      analyzeDatesheetDocuments(
        { files: [createValidPdfAttachment()] },
        {
          aiClient: {
            models: {
              generateContent: async () =>
                ({
                  text: '',
                  candidates: [{ finishReason: 'SAFETY' }],
                }) as any,
            },
          },
        }
      ),
    (err: any) =>
      err instanceof GeminiServiceError &&
      err.statusCode === 400 &&
      err.code === 'SAFETY_BLOCKED' &&
      err.retryable === false
  );

  // 5. Timeout -> 504 MODEL_TIMEOUT cleanly via AbortSignal race without double-waiting primary model
  const timeoutModelsTried: string[] = [];
  await assert.rejects(
    () =>
      analyzeDatesheetDocuments(
        { files: [createValidPdfAttachment()] },
        {
          timeoutMs: 25,
          aiClient: {
            models: {
              generateContent: (params: any) => {
                timeoutModelsTried.push(params.model);
                return new Promise((resolve) => {
                  setTimeout(() => resolve({ text: '{}' } as any), 250);
                });
              },
            },
          },
        }
      ),
    (err: any) =>
      err instanceof GeminiServiceError &&
      err.statusCode === 504 &&
      err.code === 'MODEL_TIMEOUT'
  );
  assert.equal(timeoutModelsTried.filter((m) => m === GEMINI_MODEL).length, 1);
  assert.ok(timeoutModelsTried.includes(GEMINI_FAST_FALLBACK_MODEL));

  // 6. Upstream backend-to-Gemini network failure -> 502 GEMINI_UPSTREAM_UNREACHABLE
  const upstreamNetworkErr = mapGeminiError(
    Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    })
  );
  assert.equal(upstreamNetworkErr.statusCode, 502);
  assert.equal(upstreamNetworkErr.code, 'GEMINI_UPSTREAM_UNREACHABLE');
  assert.equal(upstreamNetworkErr.retryable, true);
});

test('analyzeDatesheetDocuments streams chunks cleanly via generateContentStream and recovers via fallback on 503', async () => {
  const modelsStreamed: string[] = [];
  const result = await analyzeDatesheetDocuments(
    { files: [createValidPdfAttachment()], studentBoard: 'CBSE', studentClassGrade: 'Class 10' },
    {
      aiClient: {
        models: {
          generateContent: async () => {
            throw new Error('Should prefer generateContentStream when available');
          },
          generateContentStream: async (params: any) => {
            modelsStreamed.push(params.model);
            if (params.model === GEMINI_MODEL) {
              throw Object.assign(new Error('UNAVAILABLE'), { status: 503 });
            }
            const fullJson = JSON.stringify({
              examinationName: 'CBSE Class 10 2026',
              board: 'CBSE',
              classGrade: 'Class 10',
              academicSession: '2025-26',
              importantInstructions: [],
              metadataUncertain: false,
              documentReadable: true,
              entries: [
                {
                  subject: 'Science',
                  subjectCode: '086',
                  date: '2026-02-25',
                  weekday: 'Wednesday',
                  startTime: '10:30 AM',
                  endTime: '01:30 PM',
                  entryType: 'theory',
                  isUncertain: false,
                },
              ],
            });
            const mid = Math.floor(fullJson.length / 2);
            async function* chunks() {
              yield { text: fullJson.slice(0, mid), candidates: [] } as any;
              yield { text: fullJson.slice(mid), candidates: [{ finishReason: 'STOP' }] } as any;
            }
            return chunks() as any;
          },
        },
      },
    }
  );

  assert.deepEqual(modelsStreamed, [GEMINI_MODEL, GEMINI_FAST_FALLBACK_MODEL]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].subject, 'Science');
  assert.equal(result.entries[0].durationMinutes, 180);
});
