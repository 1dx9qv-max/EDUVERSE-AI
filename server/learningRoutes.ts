import { Router, type Request, type Response } from 'express';
import { getSafePublicErrorMessage, getVerifiedAuth, requireAuth } from './security.ts';
import {
  getDashboardLearningSummaryFromServer,
  recordLearningEventOnServer,
  recordRecommendationActionOnServer,
} from './learningStore.ts';
import { updateUserLearningMetricsOnServer } from './adminStore.ts';

export function createLearningRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/dashboard', (req: Request, res: Response) => {
    const auth = getVerifiedAuth(req)!;
    try {
      const body = req.body || {};
      const summary = getDashboardLearningSummaryFromServer(auth.uid, {
        board: body.board,
        classGrade: body.classGrade,
        subjects: Array.isArray(body.subjects) ? body.subjects : undefined,
        learningGoals: Array.isArray(body.learningGoals) ? body.learningGoals : undefined,
        preferredPace: body.preferredPace,
        localDateKey: typeof body.localDateKey === 'string' ? body.localDateKey : undefined,
        timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
        refresh: Boolean(body.refresh),
        currentRecIds: Array.isArray(body.currentRecIds) ? body.currentRecIds : undefined,
        domainSnapshot: body.domainSnapshot && typeof body.domainSnapshot === 'object'
          ? body.domainSnapshot
          : undefined,
      });

      updateUserLearningMetricsOnServer(auth.uid, {
        verifiedXp: summary.verifiedXp,
        streakDays: summary.streakDays,
      });

      res.json({ summary });
    } catch (err) {
      res.status(400).json({
        error: getSafePublicErrorMessage(err) || 'Failed to compute learning dashboard.',
        code: 'DASHBOARD_SYNC_FAILED',
      });
    }
  });

  router.post('/events', (req: Request, res: Response) => {
    const auth = getVerifiedAuth(req)!;
    const body = req.body || {};
    try {
      const result = recordLearningEventOnServer(auth.uid, {
        eventType: body.eventType,
        subject: body.subject,
        chapter: body.chapter,
        topic: body.topic,
        objectiveId: body.objectiveId,
        sourceModule: body.sourceModule,
        idempotencyKey: body.idempotencyKey,
        isCorrect: typeof body.isCorrect === 'boolean' ? body.isCorrect : undefined,
        scoreRatio: typeof body.scoreRatio === 'number' ? body.scoreRatio : undefined,
        errorTag: body.errorTag,
        difficulty: body.difficulty,
        localDateKey: typeof body.localDateKey === 'string' ? body.localDateKey : undefined,
        timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
        title: body.title,
        description: body.description,
        recId: body.recId,
        timestamp: body.timestamp,
      });

      updateUserLearningMetricsOnServer(auth.uid, {
        verifiedXp: result.verifiedXp,
        streakDays: result.streakDays,
      });

      res.status(result.recorded ? 201 : 200).json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'INVALID_LEARNING_EVENT_TYPE') {
        res.status(400).json({ error: 'Unsupported learning event type.', code: msg });
        return;
      }
      res.status(400).json({
        error: getSafePublicErrorMessage(err) || 'Failed to record learning activity.',
        code: 'LEARNING_EVENT_FAILED',
      });
    }
  });

  router.post('/recommendations/refresh', (req: Request, res: Response) => {
    const auth = getVerifiedAuth(req)!;
    const body = req.body || {};
    try {
      const summary = getDashboardLearningSummaryFromServer(auth.uid, {
        board: body.board,
        classGrade: body.classGrade,
        subjects: Array.isArray(body.subjects) ? body.subjects : undefined,
        learningGoals: Array.isArray(body.learningGoals) ? body.learningGoals : undefined,
        preferredPace: body.preferredPace,
        localDateKey: typeof body.localDateKey === 'string' ? body.localDateKey : undefined,
        timezone: typeof body.timezone === 'string' ? body.timezone : undefined,
        refresh: true,
        currentRecIds: Array.isArray(body.currentRecIds) ? body.currentRecIds : undefined,
        domainSnapshot: body.domainSnapshot,
      });

      res.json({
        recommendations: summary.recommendations,
        refreshCount: summary.recommendationRefreshCount,
      });
    } catch (err) {
      res.status(400).json({
        error: getSafePublicErrorMessage(err) || 'Failed to refresh recommendations.',
        code: 'RECOMMENDATION_REFRESH_FAILED',
      });
    }
  });

  router.post('/recommendations/:recId/action', (req: Request, res: Response) => {
    const auth = getVerifiedAuth(req)!;
    const recId = String(req.params.recId || '').trim();
    const body = req.body || {};
    const action = body.action;

    if (!recId || (action !== 'skipped' && action !== 'started' && action !== 'completed')) {
      res.status(400).json({
        error: 'Valid recommendation ID and action (skipped | started | completed) are required.',
        code: 'INVALID_RECOMMENDATION_ACTION',
      });
      return;
    }

    try {
      const result = recordRecommendationActionOnServer(
        auth.uid,
        recId,
        action,
        body.meta,
        body.context
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({
        error: getSafePublicErrorMessage(err) || 'Failed to update recommendation.',
        code: 'RECOMMENDATION_ACTION_FAILED',
      });
    }
  });

  return router;
}
