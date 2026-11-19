import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createAuthRouter } from './authRoutes.ts';
import { onRequest } from '../functions/api/[[path]].ts';

function startTestAuthServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
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
  app.use('/api/auth', createAuthRouter());

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

describe('Onboarding & Auth Profile Routing (Express + Cloudflare Pages)', () => {
  it('supports POST, PATCH, PUT, and OPTIONS on /api/auth/profile without returning 405', async () => {
    const { server, baseUrl } = await startTestAuthServer();
    try {
      const preflight = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://eduverse.pages.dev',
          'Access-Control-Request-Method': 'POST',
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(
        preflight.headers.get('access-control-allow-origin'),
        'https://eduverse.pages.dev'
      );

      for (const method of ['POST', 'PATCH', 'PUT'] as const) {
        const res = await fetch(`${baseUrl}/api/auth/profile`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ onboardingCompleted: true }),
        });
        assert.notEqual(res.status, 405, `${method} must not return 405 Method Not Allowed`);
        assert.equal(res.status, 401);
        const body = (await res.json()) as { code?: string };
        assert.equal(body.code, 'UNAUTHENTICATED');
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('handles Cloudflare Pages Function /api/auth/profile cleanly in standalone mode and proxy mode', async () => {
    // 1. Standalone Cloudflare Pages mode (no BACKEND_URL configured)
    const optionsRes = await onRequest({
      request: new Request('https://eduverse.pages.dev/api/auth/profile', {
        method: 'OPTIONS',
        headers: { origin: 'https://eduverse.pages.dev' },
      }),
      env: {},
      params: { path: ['auth', 'profile'] },
    });
    assert.equal(optionsRes.status, 204);

    for (const method of ['POST', 'PATCH', 'PUT'] as const) {
      const unauthRes = await onRequest({
        request: new Request('https://eduverse.pages.dev/api/auth/profile', {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ onboardingCompleted: true }),
        }),
        env: {},
        params: { path: ['auth', 'profile'] },
      });
      assert.notEqual(unauthRes.status, 405);
      assert.equal(unauthRes.status, 401);
      const data = (await unauthRes.json()) as { code?: string };
      assert.equal(data.code, 'UNAUTHENTICATED');
    }

    const healthRes = await onRequest({
      request: new Request('https://eduverse.pages.dev/api/health', { method: 'GET' }),
      env: {},
      params: { path: ['health'] },
    });
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { status?: string; runtime?: string };
    assert.equal(healthJson.status, 'healthy');
    assert.equal(healthJson.runtime, 'cloudflare-pages');

    // 2. Proxy mode (BACKEND_URL points to Node Express server)
    const { server, baseUrl } = await startTestAuthServer();
    try {
      const proxied = await onRequest({
        request: new Request('https://eduverse.pages.dev/api/auth/profile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ onboardingCompleted: true }),
        }),
        env: { BACKEND_URL: baseUrl },
        params: { path: ['auth', 'profile'] },
      });
      assert.notEqual(proxied.status, 405);
      assert.equal(proxied.status, 401);
      const proxiedJson = (await proxied.json()) as { code?: string };
      assert.equal(proxiedJson.code, 'UNAUTHENTICATED');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
