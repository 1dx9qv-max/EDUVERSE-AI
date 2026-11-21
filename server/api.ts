import { Router, type Request, type Response } from 'express';
import {
  GeminiServiceError,
  analyzeDatesheetDocuments,
  isGeminiConfigured,
} from './gemini.ts';
import { createAuthRouter } from './authRoutes.ts';
import {
  aiSafetyMiddleware,
  createAiRateLimitMiddleware,
  getSafePublicErrorMessage,
  requireAuth,
} from './security.ts';

export const apiRouter = Router();

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    platform: 'EDUVERSE AI — Exam Preparation & Practice Platform',
    version: '2.0.0',
    geminiConfigured: isGeminiConfigured(),
    timestamp: new Date().toISOString(),
    supportedBoards: ['CBSE', 'CISCE', 'ICSE', 'ISC', 'StateBoard', 'Other'],
    supportedGrades: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'],
  });
});

apiRouter.use('/auth', createAuthRouter());

function handleApiError(res: Response, error: unknown, contextLabel: string): void {
  if (error instanceof GeminiServiceError) {
    console.warn(`[${contextLabel}] GeminiServiceError (${error.statusCode}/${error.code}): ${error.message}`);
    res.status(error.statusCode).json({
      error: getSafePublicErrorMessage(error.message),
      code: error.code,
      retryable: error.retryable,
    });
    return;
  }

  console.error(`[${contextLabel}] Unexpected error:`, error);
  res.status(500).json({
    error: 'Unexpected service error. Please try again cleanly.',
    code: 'INTERNAL_SERVER_ERROR',
    retryable: true,
  });
}

const aiRateLimit = createAiRateLimitMiddleware();

apiRouter.post(
  '/ai/datesheet/analyze',
  requireAuth,
  aiRateLimit,
  aiSafetyMiddleware,
  async (req: Request, res: Response) => {
    try {
      const result = await analyzeDatesheetDocuments(req.body || {});
      res.json(result);
    } catch (error) {
      handleApiError(res, error, 'Datesheet Analyzer');
    }
  }
);

apiRouter.all('/ai/datesheet/analyze', (req: Request, res: Response) => {
  res.setHeader('Allow', 'POST, OPTIONS');
  res.status(405).json({
    error: `Method ${req.method} is not allowed on /api/ai/datesheet/analyze. Use POST.`,
    code: 'METHOD_NOT_ALLOWED',
    retryable: false,
  });
});

apiRouter.use('/ai', requireAuth);

apiRouter.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'API endpoint not found.',
    code: 'NOT_FOUND',
    retryable: false,
  });
});
