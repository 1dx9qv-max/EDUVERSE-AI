import {
  AiApiErrorPayload,
  SmartDoubtResponse,
  SolveDoubtRequestPayload,
  TeacherRequestPayload,
  TeacherStructuredResponse,
} from '../types/ai';
import {
  GeneratedVisualSpec,
  MindMapGenerateRequest,
  MindMapGenerateResponse,
  VisualGenerateRequest,
} from '../types/phase3';
import {
  FlashcardGenerateRequest,
  FlashcardGenerateResponse,
  PracticeGenerateRequest,
  PracticeGenerateResponse,
  RemediateRequest,
  RemediateResponse,
  ShortAnswerEvaluateRequest,
  ShortAnswerEvaluateResponse,
} from '../types/phase4';
import {
  ExamGenerateRequest,
  ExamPaper,
  ExamStartRequest,
  ExamStartResponse,
  ExamSubmitRequest,
  ExamSubmitResponse,
} from '../types/phase5';
import {
  VoiceTranscribeRequestPayload,
  VoiceTranscribeResponsePayload,
  VoiceTtsRequestPayload,
  VoiceTtsResponsePayload,
  VoiceTurnRequestPayload,
  VoiceTurnResponsePayload,
} from '../types/phase6';
import { auth } from '../lib/firebase';
import { FEATURE_FLAGS } from '../config/featureFlags';
import { AuthCapabilities, ClassGrade, IndianBoard, UserProfile, UserRole } from '../types/auth';
import { BoardConfig, SyllabusNode } from '../types/curriculum';
import {
  StudyRoom,
  StudyRoomInvite,
  StudyRoomMindMapNode,
  StudyRoomQuizQuestion,
  StudyRoomReportReason,
  StudyRoomReportTargetType,
} from '../types/phase7';
import {
  AccountStatus,
  AdminAuditLogEntry,
  GuardianInviteCodeRecord,
  GuardianLinkRecord,
  GuardianPermissions,
  GuardianStudentSummary,
  LearningContentItem,
  ManagedQuestionItem,
  ManagedUserAccount,
  PlatformModerationItem,
  PlatformUsageAnalytics,
  SecurityPostureCheck,
  SystemHealthSnapshot,
} from '../types/phase8';
import {
  AdaptivePracticeRecommendation,
  DashboardLearningSummary,
  LearningActivityEvent,
  LearningEventType,
  LearningSourceModule,
  RecommendationHistoryEntry,
  RecommendationReasonCode,
} from '../types/learning';

export async function getFirebaseIdToken(): Promise<string | null> {
  if (!auth.currentUser) return null;
  try {
    const token = await auth.currentUser.getIdToken();
    return token || null;
  } catch {
    return null;
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getFirebaseIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...authHeaders,
    },
  });
}

export interface HealthStatus {
  status: string;
  platform: string;
  version: string;
  geminiConfigured: boolean;
  voiceLivePath?: string;
  timestamp: string;
  supportedBoards: string[];
  supportedGrades: string[];
}

export class AiApiClientError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;

  constructor(statusCode: number, code: string, message: string, retryable = false) {
    super(message);
    this.name = 'AiApiClientError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
  }
}

async function parseErrorResponse(res: Response): Promise<AiApiClientError> {
  let data: Partial<AiApiErrorPayload> = {};
  try {
    data = await res.json();
  } catch {
    // Non-JSON response body
  }
  const message =
    data.error ||
    (res.status === 413
      ? 'Uploaded file exceeds server upload limit. Please keep files under 4 MB.'
      : `AI service error (HTTP ${res.status}). Please retry.`);
  return new AiApiClientError(
    res.status,
    data.code || `HTTP_${res.status}`,
    message,
    Boolean(data.retryable ?? res.status >= 500)
  );
}

export async function checkBackendHealth(): Promise<HealthStatus> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`Health check failed with status: ${res.status}`);
  }
  return res.json();
}

export async function fetchAuthCapabilities(): Promise<AuthCapabilities> {
  const res = await fetch('/api/auth/capabilities');
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return res.json();
}

export async function checkUsernameOnServer(username: string): Promise<{
  valid: boolean;
  available: boolean;
  normalized: string;
  error?: string;
}> {
  const res = await authFetch(
    `/api/auth/username/check?username=${encodeURIComponent(username)}`
  );
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return res.json();
}

export async function fetchServerProfile(): Promise<UserProfile> {
  const res = await authFetch('/api/auth/profile');
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  const data = await res.json();
  return data.profile;
}

export async function updateServerProfile(
  updates: Partial<UserProfile>
): Promise<UserProfile> {
  const res = await authFetch('/api/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  const data = await res.json();
  return data.profile;
}

export async function deleteAccountOnServer(): Promise<{
  deleted: boolean;
}> {
  const res = await authFetch('/api/auth/account', {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return res.json();
}

export async function sendTeacherMessage(
  payload: TeacherRequestPayload
): Promise<TeacherStructuredResponse> {
  const res = await authFetch('/api/ai/teacher', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function solveSmartDoubt(
  payload: SolveDoubtRequestPayload
): Promise<SmartDoubtResponse> {
  const res = await authFetch('/api/ai/solve-doubt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function generateMindMap(
  payload: MindMapGenerateRequest
): Promise<MindMapGenerateResponse> {
  const res = await authFetch('/api/ai/mindmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function generateVisualLabExperience(
  payload: VisualGenerateRequest
): Promise<GeneratedVisualSpec> {
  if (!FEATURE_FLAGS.visualLearningEnabled) {
    throw new AiApiClientError(
      503,
      'FEATURE_DISABLED',
      'Visual Learning is temporarily disabled and currently under development.',
      false
    );
  }
  const res = await authFetch('/api/ai/visual-lab/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function generateAdaptivePractice(
  payload: PracticeGenerateRequest
): Promise<PracticeGenerateResponse> {
  const res = await authFetch('/api/ai/practice/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function evaluateShortAnswer(
  payload: ShortAnswerEvaluateRequest
): Promise<ShortAnswerEvaluateResponse> {
  const res = await authFetch('/api/ai/practice/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function fetchErrorRemediation(
  payload: RemediateRequest
): Promise<RemediateResponse> {
  const res = await authFetch('/api/ai/remediate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function generateFlashcards(
  payload: FlashcardGenerateRequest
): Promise<FlashcardGenerateResponse> {
  const res = await authFetch('/api/ai/flashcards/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function generateExamPaper(
  payload: ExamGenerateRequest
): Promise<ExamPaper> {
  const res = await authFetch('/api/ai/exam/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function startExamSession(
  payload: ExamStartRequest
): Promise<ExamStartResponse> {
  const res = await authFetch('/api/ai/exam/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function submitExamAnswers(
  payload: ExamSubmitRequest & { userId?: string }
): Promise<ExamSubmitResponse> {
  const res = await authFetch('/api/ai/exam/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function transcribeVoiceClip(
  payload: VoiceTranscribeRequestPayload
): Promise<VoiceTranscribeResponsePayload> {
  const res = await authFetch('/api/ai/voice/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function sendVoiceTeacherTurn(
  payload: VoiceTurnRequestPayload
): Promise<VoiceTurnResponsePayload> {
  const attempt = async () =>
    authFetch('/api/ai/voice/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  let res = await attempt();
  if (!res.ok && (res.status === 429 || res.status >= 502)) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    res = await attempt();
  }

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

export async function generateVoiceSpeech(
  payload: VoiceTtsRequestPayload
): Promise<VoiceTtsResponsePayload> {
  const res = await authFetch('/api/ai/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return res.json();
}

// ==========================================
// PHASE 7: PRIVATE STUDY ROOMS & GROUP QUIZZES
// ==========================================

export async function fetchMyStudyRooms(uid: string): Promise<StudyRoom[]> {
  const res = await authFetch(`/api/study-rooms/mine?uid=${encodeURIComponent(uid)}`);
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return Array.isArray(data.rooms) ? data.rooms : [];
}

export async function createPrivateStudyRoom(payload: {
  uid: string;
  displayName: string;
  board: string;
  classGrade: string;
  subject: string;
  title: string;
  topic: string;
  maxMembers?: number;
}): Promise<{ room: StudyRoom; invite: StudyRoomInvite }> {
  const res = await authFetch('/api/study-rooms/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function joinStudyRoomByInvite(payload: {
  inviteCode: string;
  uid: string;
  displayName: string;
  board: string;
  classGrade: string;
}): Promise<{ room: StudyRoom }> {
  const res = await authFetch('/api/study-rooms/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function fetchStudyRoomDetail(
  roomId: string,
  uid: string
): Promise<{ room: StudyRoom; onlineUids: string[] }> {
  const res = await authFetch(
    `/api/study-rooms/${encodeURIComponent(roomId)}?uid=${encodeURIComponent(uid)}`
  );
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function postStudyRoomNote(
  roomId: string,
  payload: { uid: string; title: string; body: string; topic?: string }
): Promise<{ room: StudyRoom }> {
  const res = await authFetch(`/api/study-rooms/${encodeURIComponent(roomId)}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function createStudyRoomGoal(
  roomId: string,
  payload: { uid: string; title: string; targetCount: number; unit: string }
): Promise<{ room: StudyRoom }> {
  const res = await authFetch(`/api/study-rooms/${encodeURIComponent(roomId)}/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function incrementStudyRoomGoal(
  roomId: string,
  goalId: string,
  uid: string
): Promise<{ room: StudyRoom }> {
  const res = await authFetch(
    `/api/study-rooms/${encodeURIComponent(roomId)}/goals/${encodeURIComponent(goalId)}/increment`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    }
  );
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function generateAiRoomQuiz(payload: {
  subject: string;
  topic: string;
  board: string;
  classGrade: string;
  count?: number;
}): Promise<{ title: string; questions: StudyRoomQuizQuestion[] }> {
  const res = await authFetch('/api/ai/study-room/quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function createStudyRoomQuiz(
  roomId: string,
  payload: {
    uid: string;
    title: string;
    subject: string;
    topic: string;
    questions: Array<{
      prompt: string;
      options: string[];
      correctIndex: number;
      explanation?: string;
    }>;
  }
): Promise<{ room: StudyRoom }> {
  const res = await authFetch(`/api/study-rooms/${encodeURIComponent(roomId)}/quizzes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function submitStudyRoomQuiz(
  roomId: string,
  quizId: string,
  payload: { uid: string; answers: number[] }
): Promise<{ room: StudyRoom }> {
  const res = await authFetch(
    `/api/study-rooms/${encodeURIComponent(roomId)}/quizzes/${encodeURIComponent(quizId)}/submit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function shareStudyRoomMindMap(
  roomId: string,
  payload: {
    uid: string;
    sourceMindMapId?: string;
    title: string;
    subject: string;
    topic: string;
    nodes: StudyRoomMindMapNode[];
  }
): Promise<{ room: StudyRoom }> {
  const res = await authFetch(`/api/study-rooms/${encodeURIComponent(roomId)}/mindmaps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function endorseStudyRoomMindMap(
  roomId: string,
  mapId: string,
  uid: string
): Promise<{ room: StudyRoom }> {
  const res = await authFetch(
    `/api/study-rooms/${encodeURIComponent(roomId)}/mindmaps/${encodeURIComponent(mapId)}/endorse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    }
  );
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function reportStudyRoomItem(
  roomId: string,
  payload: {
    uid: string;
    targetType: StudyRoomReportTargetType;
    targetId: string;
    targetPreview: string;
    reason: StudyRoomReportReason;
    details?: string;
  }
): Promise<{ room: StudyRoom }> {
  const res = await authFetch(`/api/study-rooms/${encodeURIComponent(roomId)}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function moderateStudyRoom(
  roomId: string,
  payload: {
    uid: string;
    action:
      | 'hide-note'
      | 'restore-note'
      | 'toggle-pin-note'
      | 'resolve-report'
      | 'dismiss-report'
      | 'mute-member'
      | 'unmute-member'
      | 'remove-member'
      | 'toggle-lock'
      | 'rotate-invite';
    targetId?: string;
  }
): Promise<{ room: StudyRoom }> {
  const res = await authFetch(`/api/study-rooms/${encodeURIComponent(roomId)}/moderate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

// ==========================================
// PHASE 8: ADMIN GOVERNANCE & GUARDIAN PORTAL
// ==========================================

export async function fetchAdminOverview(): Promise<{
  analytics: PlatformUsageAnalytics;
  health: SystemHealthSnapshot;
  securityChecks: SecurityPostureCheck[];
}> {
  const res = await authFetch('/api/admin/overview');
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function fetchAdminUsers(): Promise<ManagedUserAccount[]> {
  const res = await authFetch('/api/admin/users');
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return Array.isArray(data.users) ? data.users : [];
}

export async function updateAdminUser(
  uid: string,
  updates: { role?: UserRole; status?: AccountStatus; board?: IndianBoard; classGrade?: ClassGrade }
): Promise<ManagedUserAccount> {
  const res = await authFetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.user;
}

export interface AdminClassItem {
  id: string;
  grade: ClassGrade;
  label: string;
  active: boolean;
  updatedAt: string;
}

export interface AdminSubjectItem {
  id: string;
  name: string;
  boardIds: string[];
  grades: ClassGrade[];
  active: boolean;
  updatedAt: string;
}

export async function fetchAdminCurriculum(): Promise<{
  boards: BoardConfig[];
  classes: AdminClassItem[];
  subjects: AdminSubjectItem[];
  syllabusNodes: SyllabusNode[];
}> {
  const res = await authFetch('/api/admin/curriculum');
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function saveAdminBoard(payload: {
  id?: string;
  name: string;
  fullName: string;
  supportedClasses: ClassGrade[];
  isVerified: boolean;
}): Promise<BoardConfig> {
  const res = await authFetch('/api/admin/boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.board;
}

export async function updateAdminClass(
  classId: string,
  updates: { label?: string; active?: boolean }
): Promise<AdminClassItem> {
  const res = await authFetch(`/api/admin/classes/${encodeURIComponent(classId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.classRecord;
}

export async function saveAdminSubject(payload: {
  id?: string;
  name: string;
  boardIds: string[];
  grades: ClassGrade[];
  active: boolean;
}): Promise<AdminSubjectItem> {
  const res = await authFetch('/api/admin/subjects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.subject;
}

export async function saveAdminSyllabusNode(payload: Partial<SyllabusNode>): Promise<SyllabusNode> {
  const res = await authFetch('/api/admin/syllabus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.syllabusNode;
}

export async function verifyAdminSyllabusNode(nodeId: string, isVerified: boolean): Promise<SyllabusNode> {
  const res = await authFetch(`/api/admin/syllabus/${encodeURIComponent(nodeId)}/verify`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isVerified }),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.syllabusNode;
}

export async function deleteAdminSyllabusNode(nodeId: string): Promise<void> {
  const res = await authFetch(`/api/admin/syllabus/${encodeURIComponent(nodeId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw await parseErrorResponse(res);
}

export async function fetchAdminQuestions(): Promise<ManagedQuestionItem[]> {
  const res = await authFetch('/api/admin/questions');
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return Array.isArray(data.questions) ? data.questions : [];
}

export async function saveAdminQuestion(
  payload: Omit<ManagedQuestionItem, 'id' | 'createdBy' | 'updatedAt'> & { id?: string }
): Promise<ManagedQuestionItem> {
  const res = await authFetch('/api/admin/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.question;
}

export async function deleteAdminQuestion(questionId: string): Promise<void> {
  const res = await authFetch(`/api/admin/questions/${encodeURIComponent(questionId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw await parseErrorResponse(res);
}

export async function fetchAdminContent(): Promise<LearningContentItem[]> {
  const res = await authFetch('/api/admin/content');
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return Array.isArray(data.content) ? data.content : [];
}

export async function saveAdminContent(
  payload: Omit<LearningContentItem, 'id' | 'authorName' | 'updatedAt'> & { id?: string }
): Promise<LearningContentItem> {
  const res = await authFetch('/api/admin/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.item;
}

export async function fetchAdminModeration(): Promise<PlatformModerationItem[]> {
  const res = await authFetch('/api/admin/moderation');
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return Array.isArray(data.reports) ? data.reports : [];
}

export async function resolveAdminModeration(
  reportId: string,
  payload: { source: 'study-room' | 'ai-safety' | 'platform'; roomId?: string; decision: 'action-taken' | 'dismissed' }
): Promise<PlatformModerationItem[]> {
  const res = await authFetch(`/api/admin/moderation/${encodeURIComponent(reportId)}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return Array.isArray(data.reports) ? data.reports : [];
}

export async function fetchAdminGuardians(): Promise<GuardianLinkRecord[]> {
  const res = await authFetch('/api/admin/guardians');
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return Array.isArray(data.links) ? data.links : [];
}

export async function updateAdminGuardianLink(
  linkId: string,
  updates: { status?: 'verified' | 'revoked'; permissions?: Partial<GuardianPermissions> }
): Promise<GuardianLinkRecord> {
  const res = await authFetch(`/api/admin/guardians/${encodeURIComponent(linkId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.link;
}

export async function fetchAdminAuditLogs(): Promise<AdminAuditLogEntry[]> {
  const res = await authFetch('/api/admin/audit-logs');
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return Array.isArray(data.logs) ? data.logs : [];
}

export async function fetchGuardianLinks(): Promise<{
  asGuardian: GuardianLinkRecord[];
  asStudent: GuardianLinkRecord[];
  allAdmin?: GuardianLinkRecord[];
}> {
  const res = await authFetch('/api/guardian/links');
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function generateStudentGuardianCode(): Promise<GuardianInviteCodeRecord> {
  const res = await authFetch('/api/guardian/invite-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.invite;
}

export async function requestGuardianLink(payload: {
  code: string;
  relationship: 'parent' | 'guardian' | 'mentor';
}): Promise<GuardianLinkRecord> {
  const res = await authFetch('/api/guardian/request-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.link;
}

export async function updateGuardianLink(
  linkId: string,
  updates: { status?: 'verified' | 'revoked'; permissions?: Partial<GuardianPermissions> }
): Promise<GuardianLinkRecord> {
  const res = await authFetch(`/api/guardian/links/${encodeURIComponent(linkId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.link;
}

export async function fetchGuardianStudentSummary(
  studentUid: string
): Promise<GuardianStudentSummary> {
  const res = await authFetch(`/api/guardian/student/${encodeURIComponent(studentUid)}/summary`);
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.summary;
}

// ==========================================
// VERIFIED LEARNING INTEGRITY & DYNAMIC RECOMMENDATIONS API
// ==========================================
export interface DashboardLearningSyncRequest {
  board?: IndianBoard;
  classGrade?: ClassGrade;
  subjects?: string[];
  learningGoals?: string[];
  preferredPace?: 'steady' | 'accelerated' | 'revision-focus';
  localDateKey?: string;
  timezone?: string;
  refresh?: boolean;
  currentRecIds?: string[];
  domainSnapshot?: Record<string, unknown>;
}

export async function syncDashboardLearningSummary(
  payload: DashboardLearningSyncRequest
): Promise<DashboardLearningSummary> {
  const res = await authFetch('/api/learning/dashboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = await res.json();
  return data.summary;
}

export interface RecordLearningEventPayload {
  eventType: LearningEventType;
  subject: string;
  chapter?: string;
  topic?: string;
  objectiveId?: string;
  sourceModule: LearningSourceModule;
  idempotencyKey?: string;
  isCorrect?: boolean;
  scoreRatio?: number;
  errorTag?: string;
  difficulty?: string;
  localDateKey?: string;
  timezone?: string;
  title?: string;
  description?: string;
  recId?: string;
  timestamp?: string;
}

export async function recordServerLearningEvent(
  payload: RecordLearningEventPayload
): Promise<{
  recorded: boolean;
  duplicate: boolean;
  xpAwarded: number;
  event?: LearningActivityEvent;
  verifiedXp: number;
  todayXp: number;
  streakDays: number;
}> {
  const res = await authFetch('/api/learning/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function refreshServerRecommendations(
  payload: DashboardLearningSyncRequest
): Promise<{
  recommendations: AdaptivePracticeRecommendation[];
  refreshCount: number;
}> {
  const res = await authFetch('/api/learning/recommendations/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}

export async function submitRecommendationAction(
  recId: string,
  action: 'skipped' | 'started' | 'completed',
  meta?: {
    subject?: string;
    chapter?: string;
    topic?: string;
    category?: RecommendationReasonCode;
  },
  context?: DashboardLearningSyncRequest
): Promise<{
  historyEntry: RecommendationHistoryEntry;
  recommendations: AdaptivePracticeRecommendation[];
}> {
  const res = await authFetch(`/api/learning/recommendations/${encodeURIComponent(recId)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, meta, context }),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  return res.json();
}
