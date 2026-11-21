export interface MagicByteValidationResult {
  valid: boolean;
  detectedType?: 'image/png' | 'image/jpeg' | 'application/pdf';
  error?: string;
}

/**
 * Validates raw file magic bytes from base64 payload to prevent MIME-type spoofing
 * (e.g., an executable or HTML/script renamed to .png/.jpg/.pdf).
 */
export function validateFileMagicBytes(
  declaredMimeType: string,
  cleanBase64: string
): MagicByteValidationResult {
  const mime = declaredMimeType.trim().toLowerCase();
  const normalized = cleanBase64.replace(/\s+/g, '');
  if (!normalized || normalized.length < 8) {
    return { valid: false, error: 'Uploaded file header is empty or truncated.' };
  }

  let bytes: Uint8Array;
  try {
    const headerSlice = normalized.slice(0, 64);
    if (typeof Buffer !== 'undefined') {
      bytes = Uint8Array.from(Buffer.from(headerSlice, 'base64'));
    } else {
      const bin = atob(headerSlice);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) {
        bytes[i] = bin.charCodeAt(i);
      }
    }
  } catch {
    return { valid: false, error: 'Uploaded file binary header could not be decoded.' };
  }

  if (bytes.length < 4) {
    return { valid: false, error: 'Uploaded file header is too short to verify file signature.' };
  }

  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPdf =
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    (bytes.length < 5 || bytes[4] === 0x2d); // -

  if (mime === 'image/png') {
    return isPng
      ? { valid: true, detectedType: 'image/png' }
      : { valid: false, error: 'File signature mismatch: file claims to be PNG but does not start with PNG magic bytes.' };
  }
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return isJpeg
      ? { valid: true, detectedType: 'image/jpeg' }
      : { valid: false, error: 'File signature mismatch: file claims to be JPEG but lacks JPEG SOI signature.' };
  }
  if (mime === 'application/pdf') {
    return isPdf
      ? { valid: true, detectedType: 'application/pdf' }
      : { valid: false, error: 'File signature mismatch: file claims to be PDF but lacks %PDF- header.' };
  }

  return { valid: false, error: `Unsupported MIME type (${declaredMimeType}). Only PDF, JPG, JPEG, and PNG files are allowed.` };
}

const DANGEROUS_EXTENSIONS = [
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.js',
  '.mjs',
  '.cjs',
  '.html',
  '.htm',
  '.svg',
  '.php',
  '.py',
  '.ps1',
  '.vbs',
  '.dll',
  '.msi',
  '.scr',
];

export function sanitizeUploadedFilename(rawFileName: string): {
  valid: boolean;
  sanitizedName?: string;
  error?: string;
} {
  const trimmed = (rawFileName || '').trim();
  if (!trimmed) {
    return { valid: false, error: 'Uploaded file is missing a valid file name.' };
  }
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    return {
      valid: false,
      error: 'Unsafe file name rejected (path traversal characters are not allowed).',
    };
  }
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return { valid: false, error: 'File name contains invalid control characters.' };
  }
  const lower = trimmed.toLowerCase();
  for (const ext of DANGEROUS_EXTENSIONS) {
    if (lower.endsWith(ext) || lower.includes(`${ext}.`)) {
      return {
        valid: false,
        error: `Dangerous file extension (${ext}) is blocked for student safety.`,
      };
    }
  }
  const sanitizedName = trimmed.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 140);
  if (!sanitizedName) {
    return { valid: false, error: 'Uploaded file name is invalid after sanitization.' };
  }
  return { valid: true, sanitizedName };
}

export function sanitizeDocumentId(rawId: string | undefined, prefix: string): string {
  const clean = (rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 100);
  if (clean && /^[a-zA-Z0-9_-]+$/.test(clean)) {
    return clean;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Strips stack traces, filesystem paths, API keys, and tokens from user-facing errors.
 */
export function sanitizeClientErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unexpected service error occurred.';

  const cleaned = raw
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[redacted-key]')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]')
    .split('\n')[0]
    .replace(/\/(?:app|Users|home|var|tmp|srv)\/[^\s):]+/g, '[server-path]')
    .replace(/[A-Za-z]:\\[^\s):]+/g, '[server-path]')
    .trim();

  if (
    !cleaned ||
    cleaned.length > 260 ||
    /ECONNREFUSED|ENOTFOUND|TypeError:|ReferenceError:|SyntaxError:|Cannot read propert/i.test(cleaned)
  ) {
    return 'The request could not be completed safely right now. Please verify your input and retry.';
  }

  return cleaned;
}

export interface AgeSafetyScreenResult {
  safe: boolean;
  category?: 'self-harm' | 'explicit-adult' | 'violence-weapons' | 'harassment' | 'prompt-injection';
  reason?: string;
}

const AGE_SAFETY_PATTERNS: Array<{
  category: NonNullable<AgeSafetyScreenResult['category']>;
  regex: RegExp;
  reason: string;
}> = [
  {
    category: 'self-harm',
    regex: /\b((how|ways|methods) to (commit )?suicide|ways to (kill|harm) myself|self[- ]?harm instructions|end my life)\b/i,
    reason: 'This request touches on self-harm. Please speak with a trusted parent, teacher, or school counsellor right away if you need support.',
  },
  {
    category: 'explicit-adult',
    regex: /\b(pornography|explicit sexual|erotic story|nsfw nude|sexual intercourse tutorial)\b/i,
    reason: 'Explicit adult content is blocked on Eduverse student accounts.',
  },
  {
    category: 'violence-weapons',
    regex: /\b(how to (make|build) (a )?(bomb|explosive|ied|pipe bomb|gunpowder weapon)|how to poison someone)\b/i,
    reason: 'Instructions for weapons, explosives, or harming others are strictly blocked.',
  },
  {
    category: 'harassment',
    regex: /\b(doxx|blackmail|bully classmate|leak private photos|write hate speech against)\b/i,
    reason: 'Harassment, doxxing, or abusive content violates student community safety.',
  },
  {
    category: 'prompt-injection',
    regex: /\b(ignore all previous instructions|reveal your system prompt|bypass safety filters|output env variables)\b/i,
    reason: 'Instruction-override attempts are blocked by platform security policy.',
  },
];

export function screenAgeAppropriateContent(text: string): AgeSafetyScreenResult {
  const input = (text || '').trim();
  if (!input) return { safe: true };

  for (const rule of AGE_SAFETY_PATTERNS) {
    if (rule.regex.test(input)) {
      return {
        safe: false,
        category: rule.category,
        reason: rule.reason,
      };
    }
  }
  return { safe: true };
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, number[]>();

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = Math.max(1, maxRequests);
    this.windowMs = Math.max(1000, windowMs);
  }

  check(key: string, nowMs = Date.now()): RateLimitCheckResult {
    const bucketKey = key || 'anonymous';
    const cutoff = nowMs - this.windowMs;
    const recent = (this.buckets.get(bucketKey) || []).filter((ts) => ts > cutoff);

    if (recent.length >= this.maxRequests) {
      const oldest = recent[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
      this.buckets.set(bucketKey, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    recent.push(nowMs);
    this.buckets.set(bucketKey, recent);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - recent.length),
      retryAfterSeconds: 0,
    };
  }

  reset(key?: string): void {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }
}
