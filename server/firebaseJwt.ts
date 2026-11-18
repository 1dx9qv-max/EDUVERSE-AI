import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface VerifiedFirebaseTokenPayload {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  issuedAt: number;
  expiresAt: number;
}

const GOOGLE_X509_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: Record<string, string> = {};
let certsExpireAtMs = 0;

export function getConfiguredFirebaseProjectId(): string {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (typeof parsed?.projectId === 'string' && parsed.projectId.trim()) {
        return parsed.projectId.trim();
      }
    }
  } catch {
    // Fallback below
  }
  return (process.env.FIREBASE_PROJECT_ID || 'decent-web-s46tg').trim();
}

async function fetchGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (now < certsExpireAtMs && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }

  const res = await fetch(GOOGLE_X509_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Unable to fetch Google public X.509 certs (HTTP ${res.status})`);
  }

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlSeconds = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;

  const certs = (await res.json()) as Record<string, string>;
  cachedCerts = certs;
  certsExpireAtMs = now + Math.max(60, ttlSeconds) * 1000;
  return certs;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const raw = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(raw) as T;
}

/**
 * Cryptographically verifies a Firebase ID Token (RS256) against Google's official X.509 certificates.
 * Checks algorithm, key ID, RSA signature, audience (projectId), issuer, expiration, and subject.
 */
export async function verifyFirebaseIdToken(
  idToken: string
): Promise<VerifiedFirebaseTokenPayload> {
  const parts = (idToken || '').trim().split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = decodeBase64UrlJson<Record<string, any>>(payloadB64);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported Firebase token signing algorithm or missing key ID.');
  }

  const certs = await fetchGooglePublicCerts();
  let certPem = certs[header.kid];
  if (!certPem) {
    // Force refresh once in case keys rotated
    certsExpireAtMs = 0;
    const refreshed = await fetchGooglePublicCerts();
    certPem = refreshed[header.kid];
  }
  if (!certPem) {
    throw new Error('Firebase signing certificate key ID not found.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const sigNorm = sigB64.replace(/-/g, '+').replace(/_/g, '/');
  const sigPadded = sigNorm + '='.repeat((4 - (sigNorm.length % 4)) % 4);
  const sigBytes = Buffer.from(sigPadded, 'base64');

  const isSignatureValid = verifier.verify(certPem, sigBytes);
  if (!isSignatureValid) {
    throw new Error('Firebase ID token RSA signature verification failed.');
  }

  const projectId = getConfiguredFirebaseProjectId();
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
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}
