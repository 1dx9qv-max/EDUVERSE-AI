import { Router, type Request, type Response } from 'express';
import {
  GeminiServiceError,
  evaluateShortAnswerResponse,
  generateAdaptiveFlashcards,
  generateAdaptivePracticeSet,
  generateErrorRemediation,
  generateExamPaper,
  generateStructuredMindMap,
  isGeminiConfigured,
  runAiTeacherTurn,
  solveSmartDoubt,
  startExamSession,
  submitAndGradeExam,
  synthesizeVoiceSpeech,
  transcribeVoiceAudio,
  runVoiceTeacherTurn,
  generateStudyRoomGroupQuiz,
  generateDynamicVisualExperience,
} from './gemini.ts';
import { createAuthRouter } from './authRoutes.ts';
import { createStudyRoomsRouter } from './studyRooms.ts';
import { createLearningRouter } from './learningRoutes.ts';
import { FEATURE_FLAGS } from '../src/config/featureFlags.ts';
import {
  aiSafetyMiddleware,
  createAiRateLimitMiddleware,
  getSafePublicErrorMessage,
  getVerifiedAuth,
  requireAdmin,
  requireAuth,
} from './security.ts';
import {
  deleteQuestionByAdmin,
  deleteSyllabusNodeByAdmin,
  generateGuardianInviteCode,
  getGuardianStudentSummary,
  getPlatformUsageAnalytics,
  getSecurityPostureChecks,
  getSystemHealthSnapshot,
  listAuditLogsForAdmin,
  listBoardsForAdmin,
  listClassesForAdmin,
  listGuardianLinksForAdmin,
  listGuardianLinksForGuardian,
  listGuardianLinksForStudent,
  listLearningContentForAdmin,
  listModerationQueueForAdmin,
  listQuestionsForAdmin,
  listSubjectsForAdmin,
  listSyllabusNodes,
  listUsersForAdmin,
  requestGuardianLinkWithCode,
  resolveModerationItemByAdmin,
  updateClassByAdmin,
  updateGuardianLinkByStudentOrAdmin,
  updateUserByAdmin,
  upsertBoardByAdmin,
  upsertLearningContentByAdmin,
  upsertQuestionByAdmin,
  upsertSubjectByAdmin,
  upsertSyllabusNodeByAdmin,
  verifySyllabusNodeByAdmin,
} from './adminStore.ts';

export const apiRouter = Router();

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    platform: 'EDUVERSE AI',
    version: '8.0.0',
    geminiConfigured: isGeminiConfigured(),
    voiceLivePath: '/ws/voice-live',
    studyRoomsPath: '/ws/study-rooms',
    timestamp: new Date().toISOString(),
    supportedBoards: ['CBSE', 'CISCE', 'ICSE', 'ISC', 'StateBoard', 'Other'],
    supportedGrades: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'],
  });
});

apiRouter.use('/auth', createAuthRouter());
apiRouter.use('/study-rooms', createStudyRoomsRouter());
apiRouter.use('/learning', createLearningRouter());

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

// ==========================================
// AI ENDPOINTS (RATE-LIMITED & AGE-SAFETY GUARDED)
// ==========================================
const aiRateLimit = createAiRateLimitMiddleware();
apiRouter.use('/ai', requireAuth, aiRateLimit, aiSafetyMiddleware);

apiRouter.post('/ai/teacher', async (req: Request, res: Response) => {
  try {
    const result = await runAiTeacherTurn(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'AI Teacher');
  }
});

apiRouter.post('/ai/solve-doubt', async (req: Request, res: Response) => {
  try {
    const result = await solveSmartDoubt(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Smart Doubt Solver');
  }
});

apiRouter.post('/ai/mindmap', async (req: Request, res: Response) => {
  try {
    const result = await generateStructuredMindMap(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Mind Map Generator');
  }
});

apiRouter.post('/ai/practice/generate', async (req: Request, res: Response) => {
  try {
    const result = await generateAdaptivePracticeSet(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Adaptive Practice Generator');
  }
});

apiRouter.post('/ai/practice/evaluate', async (req: Request, res: Response) => {
  try {
    const result = await evaluateShortAnswerResponse(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Short Answer Evaluator');
  }
});

apiRouter.post('/ai/remediate', async (req: Request, res: Response) => {
  try {
    const result = await generateErrorRemediation(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Learning Remediation');
  }
});

apiRouter.post('/ai/flashcards/generate', async (req: Request, res: Response) => {
  try {
    const result = await generateAdaptiveFlashcards(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Flashcard Generator');
  }
});

apiRouter.post('/ai/exam/generate', async (req: Request, res: Response) => {
  try {
    const result = await generateExamPaper(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Exam Paper Generator');
  }
});

apiRouter.post('/ai/exam/start', (req: Request, res: Response) => {
  try {
    const result = startExamSession(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Exam Session Start');
  }
});

apiRouter.post('/ai/exam/submit', async (req: Request, res: Response) => {
  try {
    const result = await submitAndGradeExam(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Exam Submission & Grading');
  }
});

apiRouter.post('/ai/voice/transcribe', async (req: Request, res: Response) => {
  try {
    const result = await transcribeVoiceAudio(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Voice Speech Transcription');
  }
});

apiRouter.post('/ai/voice/turn', async (req: Request, res: Response) => {
  try {
    const result = await runVoiceTeacherTurn(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Voice Classroom Teacher');
  }
});

apiRouter.post('/ai/voice/tts', async (req: Request, res: Response) => {
  try {
    const result = await synthesizeVoiceSpeech(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Voice Speech Synthesis');
  }
});

apiRouter.post('/ai/study-room/quiz', async (req: Request, res: Response) => {
  try {
    const result = await generateStudyRoomGroupQuiz(req.body || {});
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'Study Room Group Quiz');
  }
});

apiRouter.post('/ai/visual-lab/generate', async (req: Request, res: Response) => {
  if (!FEATURE_FLAGS.visualLearningEnabled) {
    res.status(503).json({
      error: 'Visual Learning is temporarily disabled and currently under development.',
      code: 'FEATURE_DISABLED',
      retryable: false,
    });
    return;
  }
  try {
    const auth = getVerifiedAuth(req)!;
    const result = await generateDynamicVisualExperience(req.body || {}, auth.uid);
    res.json(result);
  } catch (error) {
    handleApiError(res, error, 'AI Visual Lab Generator');
  }
});

// ==========================================
// PHASE 8: ADMIN GOVERNANCE API (STRICT SERVER RBAC)
// ==========================================
const adminRouter = Router();
adminRouter.use(requireAdmin);

function getAdminActor(req: Request) {
  const auth = getVerifiedAuth(req)!;
  return {
    uid: auth.uid,
    email: auth.email,
    role: auth.verifiedRole,
    displayName: auth.displayName,
  };
}

adminRouter.get('/overview', (_req: Request, res: Response) => {
  res.json({
    analytics: getPlatformUsageAnalytics(),
    health: getSystemHealthSnapshot(isGeminiConfigured()),
    securityChecks: getSecurityPostureChecks(),
  });
});

adminRouter.get('/users', (_req: Request, res: Response) => {
  res.json({ users: listUsersForAdmin() });
});

adminRouter.patch('/users/:uid', (req: Request, res: Response) => {
  const targetUid = String(req.params.uid || '').trim();
  const body = req.body || {};
  const allowedRoles = ['student', 'teacher', 'guardian', 'admin'];
  const allowedStatuses = ['active', 'suspended'];

  try {
    const updated = updateUserByAdmin(getAdminActor(req), targetUid, {
      role: allowedRoles.includes(body.role) ? body.role : undefined,
      status: allowedStatuses.includes(body.status) ? body.status : undefined,
      board: typeof body.board === 'string' ? (body.board as any) : undefined,
      classGrade: typeof body.classGrade === 'string' ? (body.classGrade as any) : undefined,
    });
    res.json({ user: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'USER_NOT_FOUND') {
      res.status(404).json({ error: 'User account not found.', code: 'USER_NOT_FOUND' });
      return;
    }
    if (msg === 'CANNOT_SUSPEND_SELF') {
      res.status(400).json({ error: 'Administrators cannot suspend their own active session.', code: 'CANNOT_SUSPEND_SELF' });
      return;
    }
    res.status(400).json({ error: getSafePublicErrorMessage(err), code: 'USER_UPDATE_FAILED' });
  }
});

adminRouter.get('/curriculum', (_req: Request, res: Response) => {
  res.json({
    boards: listBoardsForAdmin(),
    classes: listClassesForAdmin(),
    subjects: listSubjectsForAdmin(),
    syllabusNodes: listSyllabusNodes(),
  });
});

adminRouter.post('/boards', (req: Request, res: Response) => {
  const body = req.body || {};
  if (!body.name || typeof body.name !== 'string') {
    res.status(400).json({ error: 'Board name is required.', code: 'VALIDATION_ERROR' });
    return;
  }
  const board = upsertBoardByAdmin(getAdminActor(req), {
    id: String(body.id || body.name),
    name: body.name,
    fullName: String(body.fullName || body.name),
    supportedClasses: Array.isArray(body.supportedClasses) ? body.supportedClasses : ['Class 10'],
    isVerified: Boolean(body.isVerified),
  });
  res.status(201).json({ board });
});

adminRouter.patch('/classes/:id', (req: Request, res: Response) => {
  try {
    const updated = updateClassByAdmin(getAdminActor(req), String(req.params.id || ''), {
      label: typeof req.body?.label === 'string' ? req.body.label : undefined,
      active: typeof req.body?.active === 'boolean' ? req.body.active : undefined,
    });
    res.json({ classRecord: updated });
  } catch {
    res.status(404).json({ error: 'Class record not found.', code: 'CLASS_NOT_FOUND' });
  }
});

adminRouter.post('/subjects', (req: Request, res: Response) => {
  const body = req.body || {};
  if (!body.name || typeof body.name !== 'string') {
    res.status(400).json({ error: 'Subject name is required.', code: 'VALIDATION_ERROR' });
    return;
  }
  const subject = upsertSubjectByAdmin(getAdminActor(req), {
    id: typeof body.id === 'string' ? body.id : undefined,
    name: body.name,
    boardIds: Array.isArray(body.boardIds) ? body.boardIds : ['CBSE'],
    grades: Array.isArray(body.grades) ? body.grades : ['Class 10'],
    active: body.active !== false,
  });
  res.status(201).json({ subject });
});

adminRouter.post('/syllabus', (req: Request, res: Response) => {
  const body = req.body || {};
  if (!body.chapterTitle || typeof body.chapterTitle !== 'string') {
    res.status(400).json({ error: 'Chapter title is required.', code: 'VALIDATION_ERROR' });
    return;
  }
  const saved = upsertSyllabusNodeByAdmin(getAdminActor(req), {
    id: String(body.id || ''),
    boardId: String(body.boardId || 'CBSE'),
    classGrade: (body.classGrade || 'Class 10') as any,
    subjectId: String(body.subjectId || 'science'),
    chapterNumber: Math.max(1, Number(body.chapterNumber) || 1),
    chapterTitle: body.chapterTitle,
    topics: Array.isArray(body.topics) ? body.topics : [],
    isVerified: Boolean(body.isVerified),
    sourceDoc: String(body.sourceDoc || 'Curriculum Draft'),
    updatedAt: new Date().toISOString(),
  });
  res.status(201).json({ syllabusNode: saved });
});

adminRouter.patch('/syllabus/:id/verify', (req: Request, res: Response) => {
  try {
    const node = verifySyllabusNodeByAdmin(
      getAdminActor(req),
      String(req.params.id || ''),
      req.body?.isVerified !== false
    );
    res.json({ syllabusNode: node });
  } catch {
    res.status(404).json({ error: 'Syllabus node not found.', code: 'SYLLABUS_NOT_FOUND' });
  }
});

adminRouter.delete('/syllabus/:id', (req: Request, res: Response) => {
  try {
    deleteSyllabusNodeByAdmin(getAdminActor(req), String(req.params.id || ''));
    res.json({ deleted: true });
  } catch {
    res.status(404).json({ error: 'Syllabus node not found.', code: 'SYLLABUS_NOT_FOUND' });
  }
});

adminRouter.get('/questions', (_req: Request, res: Response) => {
  res.json({ questions: listQuestionsForAdmin() });
});

adminRouter.post('/questions', (req: Request, res: Response) => {
  const body = req.body || {};
  if (!body.prompt || typeof body.prompt !== 'string' || !body.correctAnswer) {
    res.status(400).json({ error: 'Question prompt and correct answer are required.', code: 'VALIDATION_ERROR' });
    return;
  }
  const question = upsertQuestionByAdmin(getAdminActor(req), {
    id: typeof body.id === 'string' ? body.id : undefined,
    boardId: String(body.boardId || 'CBSE'),
    classGrade: (body.classGrade || 'Class 10') as any,
    subjectId: String(body.subjectId || 'science'),
    chapterTitle: String(body.chapterTitle || 'General Chapter'),
    topic: String(body.topic || 'Core Concept'),
    questionType: body.questionType || 'mcq',
    difficulty: body.difficulty || 'intermediate',
    prompt: body.prompt,
    options: Array.isArray(body.options) ? body.options.slice(0, 6) : undefined,
    correctAnswer: String(body.correctAnswer),
    explanation: String(body.explanation || 'Refer to verified chapter solution.'),
    marks: Math.max(1, Math.min(10, Number(body.marks) || 1)),
    isVerified: Boolean(body.isVerified),
  });
  res.status(201).json({ question });
});

adminRouter.delete('/questions/:id', (req: Request, res: Response) => {
  try {
    deleteQuestionByAdmin(getAdminActor(req), String(req.params.id || ''));
    res.json({ deleted: true });
  } catch {
    res.status(404).json({ error: 'Question item not found.', code: 'QUESTION_NOT_FOUND' });
  }
});

adminRouter.get('/content', (_req: Request, res: Response) => {
  res.json({ content: listLearningContentForAdmin() });
});

adminRouter.post('/content', (req: Request, res: Response) => {
  const body = req.body || {};
  if (!body.title || !body.body) {
    res.status(400).json({ error: 'Content title and body are required.', code: 'VALIDATION_ERROR' });
    return;
  }
  const item = upsertLearningContentByAdmin(getAdminActor(req), {
    id: typeof body.id === 'string' ? body.id : undefined,
    boardId: String(body.boardId || 'CBSE'),
    classGrade: (body.classGrade || 'Class 10') as any,
    subjectId: String(body.subjectId || 'science'),
    chapterTitle: String(body.chapterTitle || 'Core Chapter'),
    contentType: body.contentType || 'concept-guide',
    title: String(body.title),
    summary: String(body.summary || body.title),
    body: String(body.body),
    isVerified: Boolean(body.isVerified),
    status: ['published', 'draft', 'archived'].includes(body.status) ? body.status : 'published',
  });
  res.status(201).json({ item });
});

adminRouter.get('/moderation', (_req: Request, res: Response) => {
  res.json({ reports: listModerationQueueForAdmin() });
});

adminRouter.post('/moderation/:reportId/resolve', (req: Request, res: Response) => {
  const body = req.body || {};
  const decision = body.decision === 'dismissed' ? 'dismissed' : 'action-taken';
  const source = body.source === 'study-room' || body.source === 'ai-safety' ? body.source : 'platform';
  try {
    resolveModerationItemByAdmin(getAdminActor(req), {
      reportId: String(req.params.reportId || ''),
      source,
      roomId: typeof body.roomId === 'string' ? body.roomId : undefined,
      decision,
    });
    res.json({ resolved: true, reports: listModerationQueueForAdmin() });
  } catch {
    res.status(404).json({ error: 'Moderation report not found.', code: 'MODERATION_ITEM_NOT_FOUND' });
  }
});

adminRouter.get('/guardians', (_req: Request, res: Response) => {
  res.json({ links: listGuardianLinksForAdmin() });
});

adminRouter.patch('/guardians/:linkId', (req: Request, res: Response) => {
  try {
    const link = updateGuardianLinkByStudentOrAdmin(
      getAdminActor(req),
      String(req.params.linkId || ''),
      {
        status: req.body?.status,
        permissions: req.body?.permissions,
      }
    );
    res.json({ link });
  } catch {
    res.status(404).json({ error: 'Guardian link not found.', code: 'GUARDIAN_LINK_NOT_FOUND' });
  }
});

adminRouter.get('/audit-logs', (_req: Request, res: Response) => {
  res.json({ logs: listAuditLogsForAdmin() });
});

apiRouter.use('/admin', adminRouter);

// ==========================================
// PHASE 8: GUARDIAN & STUDENT PRIVACY PORTAL API
// ==========================================
const guardianRouter = Router();
guardianRouter.use(requireAuth);

guardianRouter.get('/links', (req: Request, res: Response) => {
  const auth = getVerifiedAuth(req)!;
  if (auth.verifiedRole === 'admin') {
    res.json({
      asGuardian: listGuardianLinksForGuardian(auth.uid),
      asStudent: listGuardianLinksForStudent(auth.uid),
      allAdmin: listGuardianLinksForAdmin(),
    });
    return;
  }
  res.json({
    asGuardian: listGuardianLinksForGuardian(auth.uid),
    asStudent: listGuardianLinksForStudent(auth.uid),
  });
});

guardianRouter.post('/invite-code', (req: Request, res: Response) => {
  const auth = getVerifiedAuth(req)!;
  if (auth.verifiedRole !== 'student' && auth.verifiedRole !== 'admin') {
    res.status(403).json({
      error: 'Only student accounts can generate guardian verification invite codes.',
      code: 'STUDENT_ONLY',
    });
    return;
  }
  const invite = generateGuardianInviteCode(auth.uid);
  res.status(201).json({ invite });
});

guardianRouter.post('/request-link', (req: Request, res: Response) => {
  const auth = getVerifiedAuth(req)!;
  if (auth.verifiedRole !== 'guardian' && auth.verifiedRole !== 'admin') {
    res.status(403).json({
      error: 'Switch to a Guardian account to redeem a student verification code.',
      code: 'GUARDIAN_ROLE_REQUIRED',
    });
    return;
  }
  const body = req.body || {};
  const code = String(body.code || '').trim();
  const relationship = ['parent', 'guardian', 'mentor'].includes(body.relationship)
    ? body.relationship
    : 'parent';

  if (!code) {
    res.status(400).json({ error: 'Student verification code is required.', code: 'MISSING_CODE' });
    return;
  }

  try {
    const link = requestGuardianLinkWithCode({
      guardianUid: auth.uid,
      guardianName: auth.displayName,
      guardianEmail: auth.email,
      code,
      relationship,
    });
    res.status(201).json({ link });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'INVALID_INVITE_CODE' || msg === 'EXPIRED_INVITE_CODE') {
      res.status(400).json({ error: 'Verification code is invalid, already used, or expired.', code: msg });
      return;
    }
    if (msg === 'CANNOT_LINK_SELF') {
      res.status(400).json({ error: 'You cannot link your own account as your guardian.', code: msg });
      return;
    }
    res.status(400).json({ error: getSafePublicErrorMessage(err), code: 'LINK_REQUEST_FAILED' });
  }
});

guardianRouter.patch('/links/:linkId', (req: Request, res: Response) => {
  const auth = getVerifiedAuth(req)!;
  const body = req.body || {};
  try {
    const link = updateGuardianLinkByStudentOrAdmin(
      { uid: auth.uid, email: auth.email, role: auth.verifiedRole },
      String(req.params.linkId || ''),
      {
        status: body.status === 'verified' || body.status === 'revoked' ? body.status : undefined,
        permissions: body.permissions && typeof body.permissions === 'object' ? body.permissions : undefined,
      }
    );
    res.json({ link });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'FORBIDDEN_GUARDIAN_MUTATION') {
      res.status(403).json({
        error: 'Only the student themselves (or an administrator) can verify a guardian link or update privacy permissions.',
        code: 'FORBIDDEN_GUARDIAN_MUTATION',
      });
      return;
    }
    res.status(404).json({ error: 'Guardian link not found.', code: 'GUARDIAN_LINK_NOT_FOUND' });
  }
});

guardianRouter.get('/student/:studentUid/summary', (req: Request, res: Response) => {
  const auth = getVerifiedAuth(req)!;
  const studentUid = String(req.params.studentUid || '').trim();
  try {
    const summary = getGuardianStudentSummary(auth.uid, studentUid);
    res.json({ summary });
  } catch {
    res.status(403).json({
      error: 'No authorized guardian link exists for this student.',
      code: 'GUARDIAN_ACCESS_DENIED',
    });
  }
});

apiRouter.use('/guardian', guardianRouter);

apiRouter.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'API endpoint not found.',
    code: 'NOT_FOUND',
    retryable: false,
  });
});
