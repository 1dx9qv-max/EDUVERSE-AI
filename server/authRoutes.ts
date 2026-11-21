import { Router, type Request, type Response } from 'express';
import {
  claimUsernameOnServer,
  deleteUserAccountFromServer,
  getUserAccountForAuth,
  isUsernameAvailableOnServer,
  updateOwnProfileOnServer,
} from './accountStore.ts';
import {
  getSafePublicErrorMessage,
  getVerifiedAuth,
  requireAuth,
  resolveVerifiedAuthFromRequest,
} from './security.ts';
import type { AuthCapabilities } from '../src/types/auth.ts';

function getAuthCapabilitiesSnapshot(): AuthCapabilities {
  return {
    googleOAuthReady: true,
    emailPasswordReady: true,
    emailVerificationLinksReady: true,
    passwordResetReady: true,
  };
}

export function createAuthRouter(): Router {
  const router = Router();

  router.get('/capabilities', (_req: Request, res: Response) => {
    res.json(getAuthCapabilitiesSnapshot());
  });

  router.get('/username/check', async (req: Request, res: Response) => {
    const rawUsername = String(req.query.username || '');
    const authCtx = await resolveVerifiedAuthFromRequest(req).catch(() => null);
    const result = isUsernameAvailableOnServer(rawUsername, authCtx?.uid);
    res.json(result);
  });

  router.post('/username/claim', requireAuth, (req: Request, res: Response) => {
    const auth = getVerifiedAuth(req)!;
    const rawUsername = String(req.body?.username || '');
    try {
      const updated = claimUsernameOnServer(auth.uid, rawUsername);
      res.json({ username: updated.username, profile: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'USERNAME_TAKEN') {
        res.status(409).json({
          error: 'That username is already taken. Please pick a different one.',
          code: 'USERNAME_TAKEN',
        });
        return;
      }
      res.status(400).json({
        error: getSafePublicErrorMessage(err) || 'Invalid username format.',
        code: 'INVALID_USERNAME',
      });
    }
  });

  router.get('/profile', requireAuth, (req: Request, res: Response) => {
    const auth = getVerifiedAuth(req)!;
    const profile = getUserAccountForAuth(auth.uid, {
      email: auth.email,
      displayName: auth.displayName,
      emailVerified: auth.emailVerified,
      bootstrapAdmin: auth.verifiedRole === 'admin',
    });
    res.json({ profile });
  });

  const handleProfileUpdate = (req: Request, res: Response) => {
    const auth = getVerifiedAuth(req)!;
    const body = req.body || {};
    try {
      const updated = updateOwnProfileOnServer(auth.uid, {
        displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
        avatarId: typeof body.avatarId === 'string' ? body.avatarId : undefined,
        board: typeof body.board === 'string' ? (body.board as any) : undefined,
        classGrade: typeof body.classGrade === 'string' ? (body.classGrade as any) : undefined,
        state: typeof body.state === 'string' ? body.state : undefined,
        language: typeof body.language === 'string' ? (body.language as any) : undefined,
        onboardingCompleted:
          typeof body.onboardingCompleted === 'boolean' ? body.onboardingCompleted : undefined,
        username: typeof body.username === 'string' ? body.username : undefined,
      });
      res.json({ profile: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'USERNAME_TAKEN') {
        res.status(409).json({
          error: 'That username is already taken. Please choose another.',
          code: 'USERNAME_TAKEN',
        });
        return;
      }
      res.status(400).json({
        error: getSafePublicErrorMessage(err) || 'Unable to update profile.',
        code: 'PROFILE_UPDATE_FAILED',
      });
    }
  };

  router.patch('/profile', requireAuth, handleProfileUpdate);
  router.post('/profile', requireAuth, handleProfileUpdate);
  router.put('/profile', requireAuth, handleProfileUpdate);

  router.delete('/account', requireAuth, async (req: Request, res: Response) => {
    const auth = getVerifiedAuth(req)!;
    try {
      deleteUserAccountFromServer(auth.uid);
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({
        error: getSafePublicErrorMessage(err) || 'Failed to delete account cleanly.',
        code: 'ACCOUNT_DELETION_FAILED',
      });
    }
  });

  return router;
}
