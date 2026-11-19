import firebaseConfig from '../../firebase-applet-config.json';

export interface PagesEnv {
  BACKEND_URL?: string;
  API_ORIGIN?: string;
  VITE_API_BASE_URL?: string;
  FIREBASE_PROJECT_ID?: string;
  GEMINI_API_KEY?: string;
}

export interface PagesEventContext {
  request: Request;
  env: PagesEnv;
  params: { path?: string | string[] };
}

interface GoogleJwk {
  kty: string;
  alg?: string;
  use?: string;
  kid: string;
  n: string;
  e: string;
}

const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_account/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedJwks: GoogleJwk[] = [];
let jwksExpiresAtMs = 0;

function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get('origin');
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Credentials', 'true');
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return headers;
}

function jsonResponse(
  request: Request,
  body: unknown,
  status = 200
): Response {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function base64UrlToUint8Array(segment: string): Uint8Array {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const bytes = base64UrlToUint8Array(segment);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

async function fetchGoogleJwks(): Promise<GoogleJwk[]> {
  const now = Date.now();
  if (now < jwksExpiresAtMs && cachedJwks.length > 0) {
    return cachedJwks;
  }

  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) {
    throw new Error(`Unable to fetch Google JWKS (HTTP ${res.status})`);
  }

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  const data = (await res.json()) as { keys?: GoogleJwk[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  cachedJwks = keys;
  jwksExpiresAtMs = now + Math.max(60, ttlSeconds) * 1000;
  return keys;
}

interface VerifiedEdgeFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
}

async function verifyFirebaseJwtEdge(
  token: string,
  projectId: string
): Promise<VerifiedEdgeFirebaseUser> {
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = decodeBase64UrlJson<Record<string, unknown>>(payloadB64);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported Firebase token signing algorithm or missing key ID.');
  }

  let keys = await fetchGoogleJwks();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    jwksExpiresAtMs = 0;
    keys = await fetchGoogleJwks();
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) {
    throw new Error('Firebase signing key ID not found.');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlToUint8Array(sigB64);
  const sigBuffer = signatureBytes.buffer.slice(
    signatureBytes.byteOffset,
    signatureBytes.byteOffset + signatureBytes.byteLength
  ) as ArrayBuffer;
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    sigBuffer,
    signingInput
  );
  if (!valid) {
    throw new Error('Firebase ID token RSA signature verification failed.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) {
    throw new Error('Firebase ID token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Firebase ID token issuer mismatch.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Firebase ID token has expired.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Firebase ID token issued-at timestamp is invalid.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new Error('Firebase ID token subject (uid) is missing or invalid.');
  }

  return {
    uid: payload.sub.trim(),
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '',
    emailVerified: payload.email_verified === true,
    displayName:
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : 'Eduverse Scholar',
  };
}

function validateUsernameEdge(raw: string): {
  valid: boolean;
  available: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { valid: false, available: false, normalized, error: 'Username is required.' };
  }
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(normalized)) {
    return {
      valid: false,
      available: false,
      normalized,
      error:
        'Username must be 3–24 characters, start with a letter, and use only lowercase letters, numbers, or underscores.',
    };
  }
  const reserved = new Set(['admin', 'administrator', 'root', 'support', 'eduverse', 'system', 'mod', 'moderator']);
  if (reserved.has(normalized)) {
    return {
      valid: false,
      available: false,
      normalized,
      error: 'That username is reserved.',
    };
  }
  return { valid: true, available: true, normalized };
}

export async function onRequest(context: PagesEventContext): Promise<Response> {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  const reqUrl = new URL(request.url);
  const backendOrigin = (
    env.BACKEND_URL ||
    env.API_ORIGIN ||
    env.VITE_API_BASE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');

  // If a Node/Cloud Run backend origin is configured, forward all /api/* traffic transparently
  if (backendOrigin && backendOrigin !== reqUrl.origin) {
    const targetUrl = `${backendOrigin}${reqUrl.pathname}${reqUrl.search}`;
    const proxyHeaders = new Headers();
    const forwardHeaderNames = ['authorization', 'content-type', 'accept'];
    for (const name of forwardHeaderNames) {
      const value = request.headers.get(name);
      if (value) proxyHeaders.set(name, value);
    }

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: hasBody ? await request.arrayBuffer() : undefined,
    });

    const respHeaders = corsHeaders(request);
    const upstreamType = upstream.headers.get('content-type');
    if (upstreamType) respHeaders.set('Content-Type', upstreamType);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  }

  const subpath = reqUrl.pathname.replace(/^\/api\/?/, '');
  const projectId = (env.FIREBASE_PROJECT_ID || firebaseConfig.projectId || 'decent-web-s46tg').trim();

  if (subpath === 'health' && request.method === 'GET') {
    return jsonResponse(request, {
      status: 'healthy',
      platform: 'EDUVERSE AI',
      version: '8.0.0',
      runtime: 'cloudflare-pages',
      geminiConfigured: Boolean(env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
      supportedBoards: ['CBSE', 'CISCE', 'ICSE', 'ISC', 'StateBoard', 'Other'],
      supportedGrades: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'],
    });
  }

  if (subpath === 'auth/capabilities' && request.method === 'GET') {
    return jsonResponse(request, {
      googleOAuthReady: true,
      emailPasswordReady: true,
      emailVerificationLinksReady: true,
      passwordResetReady: true,
    });
  }

  if (subpath === 'auth/username/check' && request.method === 'GET') {
    const rawUsername = reqUrl.searchParams.get('username') || '';
    return jsonResponse(request, validateUsernameEdge(rawUsername));
  }

  if (subpath === 'auth/profile') {
    if (!['GET', 'POST', 'PATCH', 'PUT'].includes(request.method)) {
      return jsonResponse(
        request,
        { error: `Method ${request.method} not allowed.`, code: 'METHOD_NOT_ALLOWED', retryable: false },
        405
      );
    }

    const authHeader = (request.headers.get('authorization') || '').trim();
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse(
        request,
        {
          error: 'Authentication is required to access this endpoint.',
          code: 'UNAUTHENTICATED',
          retryable: false,
        },
        401
      );
    }

    let verifiedUser: VerifiedEdgeFirebaseUser;
    try {
      verifiedUser = await verifyFirebaseJwtEdge(authHeader.slice(7), projectId);
    } catch (err) {
      return jsonResponse(
        request,
        {
          error: err instanceof Error ? err.message : 'Invalid authentication credentials.',
          code: 'INVALID_AUTH_TOKEN',
          retryable: false,
        },
        401
      );
    }

    let body: Record<string, unknown> = {};
    if (request.method !== 'GET') {
      try {
        const parsed = await request.json();
        if (parsed && typeof parsed === 'object') {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        return jsonResponse(
          request,
          { error: 'Invalid JSON request body.', code: 'INVALID_JSON', retryable: false },
          400
        );
      }
    }

    const usernameResult =
      typeof body.username === 'string' && body.username.trim()
        ? validateUsernameEdge(body.username)
        : null;
    if (usernameResult && !usernameResult.valid) {
      return jsonResponse(
        request,
        {
          error: usernameResult.error || 'Invalid username format.',
          code: 'INVALID_USERNAME',
          retryable: false,
        },
        400
      );
    }

    const now = new Date().toISOString();
    const isBootstrapAdmin =
      verifiedUser.emailVerified && verifiedUser.email === 'a40332177@gmail.com';

    return jsonResponse(request, {
      profile: {
        uid: verifiedUser.uid,
        email: verifiedUser.email,
        emailVerified: verifiedUser.emailVerified,
        displayName:
          typeof body.displayName === 'string' && body.displayName.trim()
            ? body.displayName.trim().slice(0, 100)
            : verifiedUser.displayName,
        username: usernameResult?.normalized,
        avatarId: typeof body.avatarId === 'string' ? body.avatarId : 'aurora-indigo',
        role: isBootstrapAdmin ? 'admin' : 'student',
        board: typeof body.board === 'string' ? body.board : 'CBSE',
        classGrade: typeof body.classGrade === 'string' ? body.classGrade : 'Class 10',
        state: typeof body.state === 'string' ? body.state : 'Delhi (NCT)',
        language: typeof body.language === 'string' ? body.language : 'English',
        onboardingCompleted:
          typeof body.onboardingCompleted === 'boolean' ? body.onboardingCompleted : false,
        updatedAt: now,
      },
    });
  }

  return jsonResponse(
    request,
    {
      error:
        'Backend API origin (BACKEND_URL) is not configured for this Cloudflare Pages deployment. Set BACKEND_URL in Cloudflare Pages settings to proxy full Node/AI endpoints.',
      code: 'BACKEND_URL_NOT_CONFIGURED',
      retryable: false,
    },
    503
  );
}
