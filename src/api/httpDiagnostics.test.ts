import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AiApiClientError,
  executeResilientFetch,
  parseErrorResponse,
  resolveApiUrl,
} from './httpDiagnostics.ts';

test('resolveApiUrl ignores ais-dev and ais-pre preview origins on production domains cleanly', () => {
  assert.equal(
    resolveApiUrl('/api/ai/datesheet/analyze', {
      apiBaseUrl: 'https://ais-pre-abc-123.asia-southeast1.run.app',
      currentOrigin: 'https://eduverse.pages.dev',
      currentHostname: 'eduverse.pages.dev',
    }),
    '/api/ai/datesheet/analyze'
  );

  assert.equal(
    resolveApiUrl('/api/ai/datesheet/analyze', {
      apiBaseUrl: 'https://ais-dev-abc-123.asia-southeast1.run.app/api',
      currentOrigin: 'https://eduverse.pages.dev',
      currentHostname: 'eduverse.pages.dev',
    }),
    '/api/ai/datesheet/analyze'
  );

  assert.equal(
    resolveApiUrl('/api/ai/datesheet/analyze', {
      apiBaseUrl: 'https://api.eduverse.example.com/api',
      currentOrigin: 'https://eduverse.pages.dev',
      currentHostname: 'eduverse.pages.dev',
    }),
    'https://api.eduverse.example.com/api/ai/datesheet/analyze'
  );
});

test('executeResilientFetch falls back to same-origin /api/* when cross-origin API base fails but /api/health succeeds', async () => {
  const requestedUrls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.startsWith('https://stale-backend.example.com/')) {
      throw new TypeError('Failed to fetch');
    }
    if (url === '/api/health') {
      return new Response(JSON.stringify({ status: 'healthy' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/api/ai/datesheet/analyze') {
      return new Response(JSON.stringify({ metadata: { examName: 'Board 2026' }, entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  };

  const res = await executeResilientFetch(
    '/api/ai/datesheet/analyze',
    { method: 'POST', body: '{}' },
    {
      fetchImpl: fakeFetch,
      apiBaseUrl: 'https://stale-backend.example.com',
      currentOrigin: 'https://eduverse.pages.dev',
      currentHostname: 'eduverse.pages.dev',
      isOnline: true,
    }
  );

  assert.equal(res.status, 200);
  assert.deepEqual(requestedUrls, [
    'https://stale-backend.example.com/api/ai/datesheet/analyze',
    '/api/health',
    '/api/ai/datesheet/analyze',
  ]);
});

test('executeResilientFetch distinguishes offline, client timeout, preview auth redirect, dropped connections, and unreachable servers', async () => {
  // 1. Offline
  await assert.rejects(
    () =>
      executeResilientFetch('/api/ai/datesheet/analyze', {}, { isOnline: false }),
    (err: any) => err instanceof AiApiClientError && err.code === 'OFFLINE'
  );

  // 2. Client Timeout
  await assert.rejects(
    () =>
      executeResilientFetch(
        '/api/ai/datesheet/analyze',
        {},
        {
          timeoutMs: 15,
          isOnline: true,
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            }),
        }
      ),
    (err: any) => err instanceof AiApiClientError && err.code === 'CLIENT_TIMEOUT' && err.statusCode === 504
  );

  // 3. Preview auth redirect on /api/health
  await assert.rejects(
    () =>
      executeResilientFetch(
        '/api/ai/datesheet/analyze',
        { method: 'POST' },
        {
          isOnline: true,
          currentOrigin: 'https://ais-dev-demo.run.app',
          currentHostname: 'ais-dev-demo.run.app',
          fetchImpl: async (input) => {
            if (String(input) === '/api/health') {
              return new Response('', { status: 302 });
            }
            throw new TypeError('Failed to fetch');
          },
        }
      ),
    (err: any) => err instanceof AiApiClientError && err.code === 'PREVIEW_AUTH_EXPIRED'
  );

  // 4. Connection dropped mid-POST while /api/health is OK
  await assert.rejects(
    () =>
      executeResilientFetch(
        '/api/ai/datesheet/analyze',
        { method: 'POST' },
        {
          isOnline: true,
          currentOrigin: 'https://eduverse.pages.dev',
          currentHostname: 'eduverse.pages.dev',
          fetchImpl: async (input) => {
            if (String(input) === '/api/health') {
              return new Response(JSON.stringify({ status: 'healthy' }), { status: 200 });
            }
            throw new TypeError('Failed to fetch');
          },
        }
      ),
    (err: any) => err instanceof AiApiClientError && err.code === 'CONNECTION_DROPPED'
  );

  // 5. Server unreachable
  await assert.rejects(
    () =>
      executeResilientFetch(
        '/api/ai/datesheet/analyze',
        { method: 'POST' },
        {
          isOnline: true,
          currentOrigin: 'http://localhost:3000',
          currentHostname: 'localhost',
          fetchImpl: async () => {
            throw new TypeError('Failed to fetch');
          },
        }
      ),
    (err: any) => err instanceof AiApiClientError && err.code === 'SERVER_UNREACHABLE'
  );
});

test('parseErrorResponse distinguishes non-JSON proxy HTML errors and structured Gemini JSON errors cleanly', async () => {
  const htmlProxyErr = await parseErrorResponse(
    new Response('<html><body>504 Gateway Time-out</body></html>', {
      status: 504,
      headers: { 'Content-Type': 'text/html' },
    })
  );
  assert.equal(htmlProxyErr.statusCode, 504);
  assert.equal(htmlProxyErr.code, 'UPSTREAM_HTTP_504');
  assert.equal(htmlProxyErr.retryable, true);
  assert.match(htmlProxyErr.message, /non-JSON response/i);

  const geminiJsonErr = await parseErrorResponse(
    new Response(
      JSON.stringify({
        error: 'The AI model is experiencing temporary high demand right now.',
        code: 'MODEL_OVERLOADED',
        retryable: true,
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  );
  assert.equal(geminiJsonErr.statusCode, 503);
  assert.equal(geminiJsonErr.code, 'MODEL_OVERLOADED');
  assert.equal(geminiJsonErr.retryable, true);
});
