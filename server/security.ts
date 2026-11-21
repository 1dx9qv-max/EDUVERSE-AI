import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../src/types/auth.ts';
import {
  sanitizeClientErrorMessage,
  screenAgeAppropriateContent,
  SlidingWindowRateLimiter,
} from '../src/utils/securityEngine.ts';
import { validateDatesheetUploadBatch } from '../src/utils/datesheetEngine.ts';
import { verifyFirebaseIdToken } from './firebaseJwt.ts';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  getUserAccountForAuth,
  type AccountStatus,
} from './accountStore.ts';

export interface VerifiedRequestAuth {
  authenticated: boolean;
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  verifiedRole: UserRole;
  accountStatus: AccountStatus;
  authSource: 'firebase-jwt';
}

export type AuthenticatedRequest = Request & {
  verifiedAuth?: VerifiedRequestAuth;
};

export function getVerifiedAuth(req: Request): VerifiedRequestAuth | undefined {
  return (req as AuthenticatedRequest).verifiedAuth;
}

export async function resolveVerifiedAuthFromRequest(
  req: Request
): Promise<VerifiedRequestAuth | null> {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const verified = await verifyFirebaseIdToken(token);
  const bootstrapAdmin =
    verified.emailVerified && verified.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL;
  const account = getUserAccountForAuth(verified.uid, {
    email: verified.email,
    displayName: verified.displayName,
    emailVerified: verified.emailVerified,
    bootstrapAdmin,
  });
  const effectiveRole: UserRole = bootstrapAdmin ? 'admin' : account.role;
  return {
    authenticated: true,
    uid: verified.uid,
    email: account.email,
    emailVerified: Boolean(verified.emailVerified || account.emailVerified),
    displayName: account.displayName,
    verifiedRole: effectiveRole,
    accountStatus: account.status,
    authSource: 'firebase-jwt',
  };
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authCtx = await resolveVerifiedAuthFromRequest(req);
    if (!authCtx) {
      res.status(401).json({
        error: 'Authentication is required to access this endpoint.',
        code: 'UNAUTHENTICATED',
        retryable: false,
      });
      return;
    }
    if (authCtx.accountStatus === 'suspended') {
      res.status(403).json({
        error: 'This account is currently suspended.',
        code: 'ACCOUNT_SUSPENDED',
        retryable: false,
      });
      return;
    }
    (req as AuthenticatedRequest).verifiedAuth = authCtx;
    next();
  } catch (err) {
    res.status(401).json({
      error: sanitizeClientErrorMessage(err) || 'Invalid authentication credentials.',
      code: 'INVALID_AUTH_TOKEN',
      retryable: false,
    });
  }
}

const aiLimiter = new SlidingWindowRateLimiter(30, 60_000);

export function resetAiRateLimiterForTests(): void {
  aiLimiter.reset();
}

export function createAiRateLimitMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authCtx =
        getVerifiedAuth(req) ||
        (await resolveVerifiedAuthFromRequest(req).catch(() => null));
      if (!authCtx) {
        res.status(401).json({
          error: 'Authentication is required to access AI endpoints.',
          code: 'UNAUTHENTICATED',
          retryable: false,
        });
        return;
      }
      if (authCtx.accountStatus === 'suspended') {
        res.status(403).json({
          error: 'This account is currently suspended.',
          code: 'ACCOUNT_SUSPENDED',
          retryable: false,
        });
        return;
      }

      const result = aiLimiter.check(authCtx.uid);
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
        res.status(429).json({
          error: `Too many AI requests in a short window. Please wait ${result.retryAfterSeconds}s before retrying.`,
          code: 'AI_RATE_LIMITED',
          retryable: true,
        });
        return;
      }

      (req as AuthenticatedRequest).verifiedAuth = authCtx;
      next();
    } catch (err) {
      res.status(400).json({
        error: sanitizeClientErrorMessage(err),
        code: 'SECURITY_CHECK_FAILED',
        retryable: false,
      });
    }
  };
}

export function aiSafetyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const body = (req.body || {}) as Record<string, unknown>;
  const textFields = [
    body.studentBoard,
    body.studentClassGrade,
    body.notes,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('\n');

  const safety = screenAgeAppropriateContent(textFields);
  if (!safety.safe) {
    res.status(400).json({
      error: safety.reason || 'Request blocked by K-12 student safety policy.',
      code: 'AGE_SAFETY_BLOCKED',
      retryable: false,
    });
    return;
  }

  if (Array.isArray(body.files)) {
    const check = validateDatesheetUploadBatch(
      body.files as Array<{
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        pageCount?: number;
        dataBase64: string;
      }>
    );
    if (!check.valid) {
      res.status(400).json({
        error: check.error || 'Uploaded datesheet file failed security validation.',
        code: 'UNSAFE_ATTACHMENT',
        retryable: false,
      });
      return;
    }
  }

  next();
}

export function getSafePublicErrorMessage(err: unknown): string {
  return sanitizeClientErrorMessage(err);
}
