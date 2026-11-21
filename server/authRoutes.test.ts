import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createAuthRouter } from './authRoutes.ts';
import { apiRouter } from './api.ts';
import { onRequest, resetEdgeRateLimiterForTests } from '../functions/api/[[path]].ts';
import workerEntry from '../worker.ts';

function startTestServer(mountFullApi = false): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  if (mountFullApi) {
    app.use('/api', apiRouter);
  } else {
    app.use('/api/auth', createAuthRouter());
  }

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function toBase64Url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function createTestSignedFirebaseJwt(projectId: string, uid = 'student_uid_test_1'): Promise<{
  token: string;
  jwk: JsonWebKey & { kid: string; kty: string };
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const kid = `test_kid_${Date.now()}`;
  const publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey;
  const nowSec = Math.floor(Date.now() / 1000);

  const headerB64 = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payloadB64 = toBase64Url(
    JSON.stringify({
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: uid,
      user_id: uid,
      email: 'student@example.com',
      email_verified: true,
      name: 'Aarav Sharma',
      iat: nowSec - 10,
      exp: nowSec + 3600,
    })
  );

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, signingInput);
  const sigB64 = toBase64Url(new Uint8Array(sigBuf));

  return {
    token: `${headerB64}.${payloadB64}.${sigB64}`,
    jwk: {
      ...publicJwk,
      kty: publicJwk.kty || 'RSA',
      kid,
      alg: 'RS256',
      use: 'sig',
    },
  };
}

describe('Auth Profile and /api/ai/datesheet/analyze Routing (Express + Cloudflare Edge + Worker)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetEdgeRateLimiterForTests();
  });

  it('supports POST, PATCH, PUT, and OPTIONS on /api/auth/profile without returning 405', async () => {
    const { server, baseUrl } = await startTestServer(false);
    try {
      const preflight = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://eduverse.pages.dev',
          'Access-Control-Request-Method': 'POST',
        },
      });
      assert.equal(preflight.status, 204);

      for (const method of ['POST', 'PATCH', 'PUT'] as const) {
        const res = await fetch(`${baseUrl}/api/auth/profile`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ onboardingCompleted: true }),
        });
        assert.notEqual(res.status, 405);
        assert.equal(res.status, 401);
        const body = (await res.json()) as { code?: string };
        assert.equal(body.code, 'UNAUTHENTICATED');
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('routes Express POST /api/ai/datesheet/analyze cleanly and rejects non-POST methods with JSON 405', async () => {
    const { server, baseUrl } = await startTestServer(true);
    try {
      const getMethodRes = await fetch(`${baseUrl}/api/ai/datesheet/analyze`, { method: 'GET' });
      assert.equal(getMethodRes.status, 405);
      assert.equal(getMethodRes.headers.get('allow'), 'POST, OPTIONS');
      const getJson = (await getMethodRes.json()) as { code?: string };
      assert.equal(getJson.code, 'METHOD_NOT_ALLOWED');

      const validPdfB64 = Buffer.from('%PDF-1.5\n1 0 obj << /Type /Page >> endobj').toString('base64');
      const postUnauth = await fetch(`${baseUrl}/api/ai/datesheet/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [
            {
              fileName: 'datesheet.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 64,
              dataBase64: validPdfB64,
            },
          ],
        }),
      });
      assert.notEqual(postUnauth.status, 405);
      assert.equal(postUnauth.status, 401);

      const badTokenRes = await fetch(`${baseUrl}/api/ai/datesheet/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid.jwt.token',
        },
        body: JSON.stringify({ files: [] }),
      });
      assert.equal(badTokenRes.status, 401);

      // Obsolete endpoints cleanly removed -> 401 / 404
      const legacyRes = await fetch(`${baseUrl}/api/ai/teacher`, { method: 'POST' });
      assert.equal(legacyRes.status, 401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('executes POST /api/ai/datesheet/analyze on Cloudflare Edge + Worker with auth, magic-byte validation, and Gemini fallback', async () => {
    const projectId = 'decent-web-s46tg';
    const { token, jwk } = await createTestSignedFirebaseJwt(projectId);
    const geminiModelsCalled: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('https://www.googleapis.com/service_account/v1/jwk/')) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' },
        });
      }

      if (url.includes('generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent')) {
        geminiModelsCalled.push('gemini-4-hydrogen');
        const reqHeaders = new Headers(init?.headers);
        assert.equal(reqHeaders.get('x-goog-api-key'), 'test-gemini-key');
        return new Response(JSON.stringify({ error: { code: 503, message: 'High demand' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.includes('generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent')) {
        geminiModelsCalled.push('gemini-3.1-flash-lite');
        const payload = {
          examinationName: 'CBSE Class 10 Board Exam 2026',
          board: 'CBSE',
          classGrade: 'Class 10',
          academicSession: '2025-26',
          importantInstructions: ['Report 30 minutes early'],
          metadataUncertain: false,
          entries: [
            {
              subject: 'Mathematics Standard',
              subjectCode: '041',
              date: '2026-03-10',
              rawDateText: '10 March 2026',
              weekday: 'Tuesday',
              startTime: '10:30 AM',
              endTime: '01:30 PM',
              rawTimeText: '10:30 AM - 01:30 PM',
              durationMinutes: 180,
              entryType: 'theory',
              isUncertain: false,
            },
          ],
        };
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'internal reasoning...', thought: true },
                    { text: JSON.stringify(payload) },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return originalFetch(input, init);
    }) as typeof fetch;

    const validPdfB64 = Buffer.from('%PDF-1.5\n1 0 obj << /Type /Page >> endobj').toString('base64');
    const validBody = {
      studentBoard: 'CBSE',
      studentClassGrade: 'Class 10',
      files: [
        {
          fileName: 'cbse_2026.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 64,
          dataBase64: validPdfB64,
        },
      ],
    };

    // 1. Wrong HTTP method returns 405
    const getRes = await onRequest({
      request: new Request('https://eduverse.pages.dev/api/ai/datesheet/analyze', { method: 'GET' }),
      env: { GEMINI_API_KEY: 'test-gemini-key' },
    });
    assert.equal(getRes.status, 405);
    assert.equal(getRes.headers.get('allow'), 'POST, OPTIONS');

    // 2. Spoofed file signature returns 400
    const spoofRes = await onRequest({
      request: new Request('https://eduverse.pages.dev/api/ai/datesheet/analyze', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          files: [
            {
              fileName: 'datesheet.png',
              mimeType: 'image/png',
              sizeBytes: 32,
              dataBase64: Buffer.from('<html>not png</html>').toString('base64'),
            },
          ],
        }),
      }),
      env: { GEMINI_API_KEY: 'test-gemini-key' },
    });
    assert.equal(spoofRes.status, 400);

    // 3. Valid PDF routed through Worker -> 200 with model fallback
    const workerRes = await workerEntry.fetch(
      new Request('https://eduverse.workers.dev/api/ai/datesheet/analyze', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(validBody),
      }),
      { GEMINI_API_KEY: 'test-gemini-key' }
    );
    assert.equal(workerRes.status, 200);
    const json = (await workerRes.json()) as {
      metadata?: { examName?: string };
      entries?: Array<{ subject?: string; date?: string }>;
    };
    assert.equal(json.metadata?.examName, 'CBSE Class 10 Board Exam 2026');
    assert.equal(json.entries?.[0]?.subject, 'Mathematics Standard');
    assert.deepEqual(geminiModelsCalled, ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
  });

  it('enforces per-UID sliding-window rate limiting (429 AI_RATE_LIMITED) on /api/ai/datesheet/analyze', async () => {
    const projectId = 'decent-web-s46tg';
    const { token, jwk } = await createTestSignedFirebaseJwt(projectId, 'rate_limit_uid_1');

    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://www.googleapis.com/service_account/v1/jwk/')) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' },
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    }) as typeof fetch;

    for (let i = 0; i < 30; i += 1) {
      const res = await onRequest({
        request: new Request('https://eduverse.pages.dev/api/ai/datesheet/analyze', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ files: [] }),
        }),
        env: { GEMINI_API_KEY: 'test-gemini-key' },
      });
      assert.equal(res.status, 400); // Valid auth & passes limiter -> fails empty files validation
    }

    const throttled = await onRequest({
      request: new Request('https://eduverse.pages.dev/api/ai/datesheet/analyze', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ files: [] }),
      }),
      env: { GEMINI_API_KEY: 'test-gemini-key' },
    });
    assert.equal(throttled.status, 429);
    assert.ok(throttled.headers.get('retry-after'));
    const body = (await throttled.json()) as { code?: string; retryable?: boolean };
    assert.equal(body.code, 'AI_RATE_LIMITED');
    assert.equal(body.retryable, true);
  });
});
