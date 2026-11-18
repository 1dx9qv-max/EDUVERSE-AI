import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  runTransaction,
  query,
  where,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { handleFirestoreError, OperationType } from './firestoreError';
import { UserProfile } from '../types/auth';
import {
  ChapterNode,
  LearningProfile,
  StudyPlan,
  ActivityRecord,
  GuardianLink,
} from '../types/curriculum';
import { DoubtTicket, TeacherSession } from '../types/ai';
import { GeneratedVisualSpec, MindMapDocument } from '../types/phase3';
import {
  FlashcardRecord,
  FlashcardReviewLog,
  PracticeAttemptRecord,
  TopicMasteryRecord,
} from '../types/phase4';
import {
  sanitizeDoubtForStorage,
  sanitizeTeacherSessionForStorage,
} from '../utils/aiValidation';
import { sanitizeMindMapForStorage } from '../utils/mindMapEngine';
import { validateAndSanitizeGeneratedVisual } from '../utils/visualLabEngine';
import {
  buildTopicMasteryId,
  recomputeTopicMastery,
  sanitizeAttemptForStorage,
  sanitizeDocumentId,
  sanitizeTopicMasteryForStorage,
} from '../utils/learningEngine';
import {
  sanitizeFlashcardForStorage,
  sanitizeFlashcardReviewForStorage,
} from '../utils/memoryEngine';
import { ExamAttemptRecord } from '../types/phase5';
import {
  mapExamResultToPracticeAttempts,
  sanitizeExamAttemptForStorage,
} from '../utils/examEngine';
import { VoiceSessionRecord } from '../types/phase6';
import { sanitizeVoiceSessionForStorage } from '../utils/voiceEngine';
import {
  AchievementStateRecord,
  MotivationDashboardState,
  StudyRoom,
  StudyRoomInvite,
} from '../types/phase7';
import {
  buildAchievementStateRecord,
  computeMotivationDashboard,
} from '../utils/motivationEngine';
import {
  DashboardLearningSummary,
  LearningActivityEvent,
  LearningEventType,
  LearningSourceModule,
  LessonProgressRecord,
} from '../types/learning';
import {
  buildDynamicDailyGoals,
  computeChapterProgressList,
  computeDeterministicXpForEvent,
  generateAdaptiveRecommendations,
  getLocalDateKey,
  normalizeSlug,
} from '../utils/recommendationEngine';
import { getCurriculumForStudent } from '../utils/curriculum';
import {
  checkUsernameOnServer,
  fetchMyStudyRooms,
  recordServerLearningEvent,
  syncDashboardLearningSummary,
} from '../api/client';
import { normalizeUsername, validateUsernameFormat } from '../utils/usernameValidation';

const TEACHER_SESSIONS_STORAGE_PREFIX = 'eduverse_teacher_sessions_';
const DOUBTS_STORAGE_PREFIX = 'eduverse_doubts_';
const MINDMAPS_STORAGE_PREFIX = 'eduverse_mindmaps_';
const PRACTICE_ATTEMPTS_STORAGE_PREFIX = 'eduverse_practice_attempts_';
const TOPIC_MASTERY_STORAGE_PREFIX = 'eduverse_topic_mastery_';
const FLASHCARDS_STORAGE_PREFIX = 'eduverse_flashcards_';
const FLASHCARD_REVIEWS_STORAGE_PREFIX = 'eduverse_flashcard_reviews_';
const EXAM_ATTEMPTS_STORAGE_PREFIX = 'eduverse_exam_attempts_';
const VOICE_SESSIONS_STORAGE_PREFIX = 'eduverse_voice_sessions_';
const ACHIEVEMENT_STATE_STORAGE_PREFIX = 'eduverse_achievement_state_';
const LESSON_PROGRESS_STORAGE_PREFIX = 'eduverse_lesson_progress_';
const VERIFIED_EVENTS_STORAGE_PREFIX = 'eduverse_verified_events_';
const VISUALS_STORAGE_PREFIX = 'eduverse_visuals_';

function requireCurrentUid(): string | null {
  return auth.currentUser?.uid || null;
}

function readCacheList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCacheList<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore storage quota issues safely
  }
}

// ==========================================
// 1. USER PROFILES & ATOMIC USERNAME CLAIMS
// ==========================================
export async function fetchUserProfile(uid: string): Promise<UserProfile | null> {
  if (!auth.currentUser) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}`);
  }
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await setDoc(
      doc(db, 'users', profile.uid),
      {
        ...profile,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
  }
}

export async function isUsernameAvailableFirestore(
  rawUsername: string,
  currentUid?: string
): Promise<{ valid: boolean; available: boolean; normalized: string; error?: string }> {
  const format = validateUsernameFormat(rawUsername);
  if (!format.valid) {
    return {
      valid: false,
      available: false,
      normalized: format.normalized,
      error: format.error,
    };
  }

  const uid = currentUid || auth.currentUser?.uid;
  let serverCheck: { valid: boolean; available: boolean; normalized: string; error?: string } | null = null;
  try {
    serverCheck = await checkUsernameOnServer(format.normalized);
    if (!serverCheck.available) {
      return serverCheck;
    }
  } catch {
    // Server check optional when Firestore claim check succeeds
  }

  if (auth.currentUser) {
    try {
      const snap = await getDoc(doc(db, 'usernames', format.normalized));
      if (snap.exists()) {
        const claim = snap.data() as { uid?: string };
        if (claim?.uid && claim.uid !== uid) {
          return {
            valid: true,
            available: false,
            normalized: format.normalized,
            error: `@${format.normalized} is already taken. Please try another username.`,
          };
        }
      }
      return {
        valid: true,
        available: true,
        normalized: format.normalized,
      };
    } catch {
      if (serverCheck) return serverCheck;
    }
  }

  return serverCheck || { valid: true, available: true, normalized: format.normalized };
}

export async function claimUsernameAtomicFirestore(params: {
  uid: string;
  nextUsername: string;
  previousUsername?: string;
  profileUpdates?: Partial<UserProfile>;
}): Promise<string> {
  const uid = requireCurrentUid();
  if (!uid || uid !== params.uid) {
    throw new Error('Authentication required to update username.');
  }

  const check = validateUsernameFormat(params.nextUsername);
  if (!check.valid) {
    throw new Error(check.error || 'Invalid username.');
  }

  const normalizedNext = check.normalized;
  const normalizedPrev = params.previousUsername ? normalizeUsername(params.previousUsername) : undefined;
  const now = new Date().toISOString();

  await runTransaction(db, async (tx) => {
    const nextRef = doc(db, 'usernames', normalizedNext);
    const nextSnap = await tx.get(nextRef);

    if (nextSnap.exists()) {
      const claim = nextSnap.data() as { uid?: string };
      if (claim?.uid && claim.uid !== uid) {
        throw new Error(`@${normalizedNext} is already taken. Please choose another username.`);
      }
    }

    const userRef = doc(db, 'users', uid);
    const userSnap = await tx.get(userRef);

    if (normalizedPrev && normalizedPrev !== normalizedNext) {
      const prevRef = doc(db, 'usernames', normalizedPrev);
      const prevSnap = await tx.get(prevRef);
      if (prevSnap.exists() && (prevSnap.data() as { uid?: string })?.uid === uid) {
        tx.delete(prevRef);
      }
    }

    if (!nextSnap.exists()) {
      tx.set(nextRef, {
        uid,
        username: normalizedNext,
        createdAt: now,
      });
    }

    if (userSnap.exists()) {
      tx.update(userRef, {
        ...(params.profileUpdates || {}),
        username: normalizedNext,
        updatedAt: now,
      });
    } else {
      tx.set(userRef, {
        ...(params.profileUpdates || {}),
        uid,
        username: normalizedNext,
        updatedAt: now,
      });
    }
  });

  return normalizedNext;
}

export async function deleteAllStudentFirestoreData(
  uid: string,
  username?: string
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('You must be signed in to delete your account.');
  }

  const userScopedCollections = [
    'teacher_sessions',
    'doubts',
    'mindmaps',
    'practice_attempts',
    'practiceRecords',
    'topic_mastery',
    'flashcards',
    'flashcard_reviews',
    'exam_attempts',
    'voice_sessions',
    'activities',
    'study_plans',
    'lesson_progress',
    'recommendation_history',
    'daily_goals',
    'visual_explorations',
  ];

  for (const colName of userScopedCollections) {
    try {
      const q = query(collection(db, colName), where('userId', '==', uid), limit(200));
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
    } catch {
      // Continue cleanup across remaining collections
    }
  }

  // Guardian invite codes
  try {
    const qInv = query(collection(db, 'guardian_invite_codes'), where('studentUid', '==', uid), limit(50));
    const snapInv = await getDocs(qInv);
    await Promise.all(snapInv.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  } catch {
    // Continue cleanup
  }

  // Guardian links (as student or guardian)
  try {
    const [qStu, qGdn] = await Promise.all([
      getDocs(query(collection(db, 'guardians'), where('studentUid', '==', uid), limit(50))).catch(() => null),
      getDocs(query(collection(db, 'guardians'), where('guardianUid', '==', uid), limit(50))).catch(() => null),
    ]);
    await Promise.all([
      ...(qStu ? qStu.docs.map((d) => deleteDoc(d.ref).catch(() => {})) : []),
      ...(qGdn ? qGdn.docs.map((d) => deleteDoc(d.ref).catch(() => {})) : []),
    ]);
  } catch {
    // Continue cleanup
  }

  // Study membership index
  try {
    const memSnap = await getDocs(collection(db, 'users', uid, 'study_memberships'));
    await Promise.all(memSnap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  } catch {
    // Continue cleanup
  }

  // Singleton docs owned by uid
  await Promise.all([
    deleteDoc(doc(db, 'learning_profiles', uid)).catch(() => {}),
    deleteDoc(doc(db, 'achievement_states', uid)).catch(() => {}),
  ]);

  if (username) {
    await deleteDoc(doc(db, 'usernames', normalizeUsername(username))).catch(() => {});
  }

  await deleteDoc(doc(db, 'users', uid)).catch(() => {});

  // Clear local caches for uid
  const prefixes = [
    TEACHER_SESSIONS_STORAGE_PREFIX,
    DOUBTS_STORAGE_PREFIX,
    MINDMAPS_STORAGE_PREFIX,
    PRACTICE_ATTEMPTS_STORAGE_PREFIX,
    TOPIC_MASTERY_STORAGE_PREFIX,
    FLASHCARDS_STORAGE_PREFIX,
    FLASHCARD_REVIEWS_STORAGE_PREFIX,
    EXAM_ATTEMPTS_STORAGE_PREFIX,
    VOICE_SESSIONS_STORAGE_PREFIX,
    ACHIEVEMENT_STATE_STORAGE_PREFIX,
    LESSON_PROGRESS_STORAGE_PREFIX,
    VERIFIED_EVENTS_STORAGE_PREFIX,
    VISUALS_STORAGE_PREFIX,
  ];
  for (const prefix of prefixes) {
    try {
      localStorage.removeItem(`${prefix}${uid}`);
    } catch {
      // Ignore storage errors
    }
  }
}

// ==========================================
// 2. LEARNING PROFILES & GOALS
// ==========================================
export async function fetchLearningProfile(userId: string): Promise<LearningProfile | null> {
  if (!auth.currentUser) return null;
  try {
    const snap = await getDoc(doc(db, 'learning_profiles', userId));
    if (snap.exists()) {
      return snap.data() as LearningProfile;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `learning_profiles/${userId}`);
  }
}

export async function saveLearningProfile(profile: LearningProfile): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await setDoc(
      doc(db, 'learning_profiles', profile.userId),
      {
        ...profile,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `learning_profiles/${profile.userId}`);
  }
}

// ==========================================
// 3. STUDY PLANS
// ==========================================
export async function fetchStudyPlans(userId: string): Promise<StudyPlan[]> {
  if (!auth.currentUser) return [];
  try {
    const q = query(
      collection(db, 'study_plans'),
      where('userId', '==', auth.currentUser.uid || userId),
      limit(10)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as StudyPlan);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'study_plans');
  }
}

export async function saveStudyPlan(plan: StudyPlan): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await setDoc(
      doc(db, 'study_plans', plan.id),
      {
        ...plan,
        userId: auth.currentUser.uid,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `study_plans/${plan.id}`);
  }
}

// ==========================================
// 4. STUDENT ACTIVITIES & AUDIT TIMELINE
// ==========================================
export async function fetchActivities(userId: string): Promise<ActivityRecord[]> {
  if (!auth.currentUser) return [];
  try {
    const q = query(
      collection(db, 'activities'),
      where('userId', '==', auth.currentUser.uid || userId),
      limit(20)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ActivityRecord);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'activities');
  }
}

export async function logActivity(activity: ActivityRecord): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await setDoc(doc(db, 'activities', activity.id), {
      ...activity,
      userId: auth.currentUser.uid,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `activities/${activity.id}`);
  }
}

export function emitStatsDirty(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('eduverse:stats-dirty'));
  }
}

// ==========================================
// 5. GUARDIAN LINKS & RELATIONSHIPS
// ==========================================
export async function fetchGuardianLinks(uid: string): Promise<GuardianLink[]> {
  if (!auth.currentUser) return [];
  try {
    const q1 = query(
      collection(db, 'guardians'),
      where('studentUid', '==', auth.currentUser.uid || uid),
      limit(25)
    );
    const snap1 = await getDocs(q1);
    return snap1.docs.map((d) => d.data() as GuardianLink);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'guardians');
  }
}

export async function createGuardianLink(link: GuardianLink): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await setDoc(doc(db, 'guardians', link.id), link);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `guardians/${link.id}`);
  }
}

// ==========================================
// 6. CURRICULUM & VERIFIED SYLLABUS DATA
// ==========================================
export async function fetchVerifiedSyllabus(
  boardId: string,
  classGrade: string,
  subjectId: string
): Promise<ChapterNode[]> {
  if (!auth.currentUser) {
    return [];
  }
  try {
    const q = query(
      collection(db, 'syllabus'),
      where('boardId', '==', boardId),
      where('classGrade', '==', classGrade),
      where('subjectId', '==', subjectId),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ChapterNode);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'syllabus');
  }
}

export async function importVerifiedSyllabusNode(node: ChapterNode): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await setDoc(doc(db, 'syllabus', node.id), node);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `syllabus/${node.id}`);
  }
}

// ==========================================
// 7. PERSONAL AI TEACHER SESSIONS
// ==========================================
export async function fetchTeacherSessions(userId: string): Promise<TeacherSession[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${TEACHER_SESSIONS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(
      collection(db, 'teacher_sessions'),
      where('userId', '==', uid),
      limit(25)
    );
    const snap = await getDocs(q);
    const sessions = snap.docs
      .map((d) => d.data() as TeacherSession)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    writeCacheList(cacheKey, sessions);
    return sessions;
  } catch (error) {
    const cached = readCacheList<TeacherSession>(cacheKey);
    if (cached.length > 0) return cached.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    handleFirestoreError(error, OperationType.LIST, 'teacher_sessions');
  }
}

export async function saveTeacherSession(session: TeacherSession): Promise<TeacherSession> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to save AI Teacher sessions.');
  }
  const uid = auth.currentUser.uid;
  const sanitized = sanitizeTeacherSessionForStorage({
    ...session,
    userId: uid,
    updatedAt: new Date().toISOString(),
  });
  const cacheKey = `${TEACHER_SESSIONS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<TeacherSession>(cacheKey);
  const next = [sanitized, ...current.filter((s) => s.id !== sanitized.id)].slice(0, 25);
  writeCacheList(cacheKey, next);

  try {
    await setDoc(doc(db, 'teacher_sessions', sanitized.id), sanitized, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `teacher_sessions/${sanitized.id}`);
  }
  emitStatsDirty();
  return sanitized;
}

export async function deleteTeacherSession(userId: string, sessionId: string): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${TEACHER_SESSIONS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<TeacherSession>(cacheKey);
  writeCacheList(
    cacheKey,
    current.filter((s) => s.id !== sessionId)
  );

  try {
    await deleteDoc(doc(db, 'teacher_sessions', sessionId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `teacher_sessions/${sessionId}`);
  }
}

// ==========================================
// 8. SMART DOUBT SOLVER HISTORY (PRIVACY-SAFE)
// ==========================================
export async function fetchDoubtHistory(userId: string): Promise<DoubtTicket[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${DOUBTS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(collection(db, 'doubts'), where('userId', '==', uid), limit(30));
    const snap = await getDocs(q);
    const tickets = snap.docs
      .map((d) => d.data() as DoubtTicket)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    writeCacheList(cacheKey, tickets);
    return tickets;
  } catch (error) {
    const cached = readCacheList<DoubtTicket>(cacheKey);
    if (cached.length > 0) return cached.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    handleFirestoreError(error, OperationType.LIST, 'doubts');
  }
}

export async function saveDoubtTicket(ticket: DoubtTicket): Promise<DoubtTicket> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to save solved doubts.');
  }
  const uid = auth.currentUser.uid;
  const sanitized = sanitizeDoubtForStorage({
    ...ticket,
    userId: uid,
    updatedAt: new Date().toISOString(),
  });
  const cacheKey = `${DOUBTS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<DoubtTicket>(cacheKey);
  const next = [sanitized, ...current.filter((t) => t.id !== sanitized.id)].slice(0, 30);
  writeCacheList(cacheKey, next);

  try {
    await setDoc(doc(db, 'doubts', sanitized.id), sanitized, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `doubts/${sanitized.id}`);
  }
  emitStatsDirty();
  return sanitized;
}

export async function deleteDoubtTicket(userId: string, doubtId: string): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${DOUBTS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<DoubtTicket>(cacheKey);
  writeCacheList(
    cacheKey,
    current.filter((t) => t.id !== doubtId)
  );

  try {
    await deleteDoc(doc(db, 'doubts', doubtId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `doubts/${doubtId}`);
  }
}

// ==========================================
// 9. INTERACTIVE MIND MAPS
// ==========================================
export async function fetchMindMaps(userId: string): Promise<MindMapDocument[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${MINDMAPS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(collection(db, 'mindmaps'), where('userId', '==', uid), limit(30));
    const snap = await getDocs(q);
    const maps = snap.docs
      .map((d) => d.data() as MindMapDocument)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    writeCacheList(cacheKey, maps);
    return maps;
  } catch (error) {
    const cached = readCacheList<MindMapDocument>(cacheKey);
    if (cached.length > 0) return cached.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    handleFirestoreError(error, OperationType.LIST, 'mindmaps');
  }
}

export async function saveMindMap(mapDoc: MindMapDocument): Promise<MindMapDocument> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to save mind maps.');
  }
  const uid = auth.currentUser.uid;
  const sanitized = sanitizeMindMapForStorage({
    ...mapDoc,
    userId: uid,
    updatedAt: new Date().toISOString(),
  });
  const cacheKey = `${MINDMAPS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<MindMapDocument>(cacheKey);
  const next = [sanitized, ...current.filter((m) => m.id !== sanitized.id)].slice(0, 30);
  writeCacheList(cacheKey, next);

  try {
    await setDoc(doc(db, 'mindmaps', sanitized.id), sanitized, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `mindmaps/${sanitized.id}`);
  }
  emitStatsDirty();
  return sanitized;
}

export async function deleteMindMap(userId: string, mindMapId: string): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${MINDMAPS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<MindMapDocument>(cacheKey);
  writeCacheList(
    cacheKey,
    current.filter((m) => m.id !== mindMapId)
  );

  try {
    await deleteDoc(doc(db, 'mindmaps', mindMapId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `mindmaps/${mindMapId}`);
  }
}

// ==========================================
// 9B. DYNAMIC AI VISUAL LEARNING EXPLORATIONS
// ==========================================
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

export async function fetchVisualExplorations(userId: string): Promise<GeneratedVisualSpec[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${VISUALS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(collection(db, 'visual_explorations'), where('userId', '==', uid), limit(40));
    const snap = await getDocs(q);
    const items = snap.docs
      .map((d) => d.data() as GeneratedVisualSpec)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    writeCacheList(cacheKey, items);
    return items;
  } catch (error) {
    const cached = readCacheList<GeneratedVisualSpec>(cacheKey);
    if (cached.length > 0) return cached.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    handleFirestoreError(error, OperationType.LIST, 'visual_explorations');
  }
}

export async function saveVisualExploration(
  spec: GeneratedVisualSpec
): Promise<GeneratedVisualSpec> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to save visual learning explorations.');
  }
  const uid = auth.currentUser.uid;
  const safeId = sanitizeDocumentId(spec.id, 'vis');
  const now = new Date().toISOString();
  const sanitized = stripUndefinedDeep(
    validateAndSanitizeGeneratedVisual(
      {
        ...spec,
        createdAt: spec.createdAt || now,
        updatedAt: now,
      },
      {
        id: safeId,
        cacheKey: spec.cacheKey,
        userId: uid,
        board: spec.board,
        classGrade: spec.classGrade,
        subject: spec.subject,
        chapter: spec.chapter,
        topic: spec.topic,
        customPrompt: spec.customPrompt,
        language: spec.language,
      }
    )
  );

  const storageKey = `${VISUALS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<GeneratedVisualSpec>(storageKey);
  const next = [sanitized, ...current.filter((v) => v.id !== sanitized.id)].slice(0, 40);
  writeCacheList(storageKey, next);

  try {
    await setDoc(doc(db, 'visual_explorations', sanitized.id), sanitized, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `visual_explorations/${sanitized.id}`);
  }
  emitStatsDirty();
  return sanitized;
}

export async function toggleSaveVisualExploration(
  userId: string,
  visualId: string,
  saved: boolean
): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid || userId;
  const storageKey = `${VISUALS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<GeneratedVisualSpec>(storageKey);
  const now = new Date().toISOString();
  writeCacheList(
    storageKey,
    current.map((v) => (v.id === visualId ? { ...v, saved, updatedAt: now } : v))
  );

  try {
    await setDoc(
      doc(db, 'visual_explorations', visualId),
      { saved, updatedAt: now },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `visual_explorations/${visualId}`);
  }
}

export async function deleteVisualExploration(userId: string, visualId: string): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid || userId;
  const storageKey = `${VISUALS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<GeneratedVisualSpec>(storageKey);
  writeCacheList(
    storageKey,
    current.filter((v) => v.id !== visualId)
  );

  try {
    await deleteDoc(doc(db, 'visual_explorations', visualId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `visual_explorations/${visualId}`);
  }
}

// ==========================================
// 10. PHASE 4: ADAPTIVE PRACTICE ATTEMPTS
// ==========================================
export async function fetchPracticeAttempts(userId: string): Promise<PracticeAttemptRecord[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${PRACTICE_ATTEMPTS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(
      collection(db, 'practice_attempts'),
      where('userId', '==', uid),
      limit(120)
    );
    const snap = await getDocs(q);
    const items = snap.docs
      .map((d) => d.data() as PracticeAttemptRecord)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    writeCacheList(cacheKey, items);
    return items;
  } catch (error) {
    const cached = readCacheList<PracticeAttemptRecord>(cacheKey);
    if (cached.length > 0) return cached.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    handleFirestoreError(error, OperationType.LIST, 'practice_attempts');
  }
}

export async function savePracticeAttempt(
  attempt: PracticeAttemptRecord
): Promise<PracticeAttemptRecord> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to save practice attempts.');
  }
  const uid = auth.currentUser.uid;
  const sanitized = sanitizeAttemptForStorage({
    ...attempt,
    userId: uid,
  });

  const cacheKey = `${PRACTICE_ATTEMPTS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<PracticeAttemptRecord>(cacheKey);
  const next = [sanitized, ...current.filter((item) => item.id !== sanitized.id)].slice(0, 120);
  writeCacheList(cacheKey, next);

  try {
    await setDoc(doc(db, 'practice_attempts', sanitized.id), sanitized);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `practice_attempts/${sanitized.id}`);
  }
  emitStatsDirty();
  return sanitized;
}

export async function savePracticeSummaryRecord(params: {
  userId: string;
  subject: string;
  topic: string;
  score: number;
  totalQuestions: number;
  timeSpentSeconds: number;
}): Promise<void> {
  if (!auth.currentUser) return;
  const effectiveUid = auth.currentUser.uid;
  const id = sanitizeDocumentId(`${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, 'pr');
  const accuracyRate =
    params.totalQuestions > 0
      ? Number(((params.score / params.totalQuestions) * 100).toFixed(1))
      : 0;

  try {
    await setDoc(doc(db, 'practiceRecords', id), {
      id,
      userId: effectiveUid,
      subject: params.subject.slice(0, 80),
      topic: params.topic.slice(0, 120),
      score: Math.max(0, Math.round(params.score)),
      totalQuestions: Math.max(1, Math.round(params.totalQuestions)),
      accuracyRate,
      timeSpentSeconds: Math.max(0, Math.round(params.timeSpentSeconds)),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `practiceRecords/${id}`);
  }
}

// ==========================================
// 11. PHASE 4: TOPIC MASTERY ANALYTICS
// ==========================================
export async function fetchTopicMasteryList(userId: string): Promise<TopicMasteryRecord[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${TOPIC_MASTERY_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(collection(db, 'topic_mastery'), where('userId', '==', uid), limit(80));
    const snap = await getDocs(q);
    const items = snap.docs
      .map((d) => d.data() as TopicMasteryRecord)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    writeCacheList(cacheKey, items);
    return items;
  } catch (error) {
    const cached = readCacheList<TopicMasteryRecord>(cacheKey);
    if (cached.length > 0) return cached.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    handleFirestoreError(error, OperationType.LIST, 'topic_mastery');
  }
}

export async function saveTopicMastery(mastery: TopicMasteryRecord): Promise<TopicMasteryRecord> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to update topic mastery.');
  }
  const uid = auth.currentUser.uid;
  const sanitized = sanitizeTopicMasteryForStorage({
    ...mastery,
    userId: uid,
  });

  const cacheKey = `${TOPIC_MASTERY_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<TopicMasteryRecord>(cacheKey);
  const next = [sanitized, ...current.filter((m) => m.id !== sanitized.id)].slice(0, 80);
  writeCacheList(cacheKey, next);

  try {
    await setDoc(doc(db, 'topic_mastery', sanitized.id), sanitized);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `topic_mastery/${sanitized.id}`);
  }
  return sanitized;
}

// ==========================================
// 12. PHASE 4: SPACED REPETITION FLASHCARDS
// ==========================================
export async function fetchFlashcards(userId: string): Promise<FlashcardRecord[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${FLASHCARDS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(collection(db, 'flashcards'), where('userId', '==', uid), limit(150));
    const snap = await getDocs(q);
    const items = snap.docs
      .map((d) => d.data() as FlashcardRecord)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    writeCacheList(cacheKey, items);
    return items;
  } catch (error) {
    const cached = readCacheList<FlashcardRecord>(cacheKey);
    if (cached.length > 0) return cached.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    handleFirestoreError(error, OperationType.LIST, 'flashcards');
  }
}

export async function saveFlashcard(card: FlashcardRecord): Promise<FlashcardRecord> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to save flashcards.');
  }
  const uid = auth.currentUser.uid;
  const sanitized = sanitizeFlashcardForStorage({
    ...card,
    userId: uid,
    updatedAt: new Date().toISOString(),
  });

  const cacheKey = `${FLASHCARDS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<FlashcardRecord>(cacheKey);
  const next = [sanitized, ...current.filter((c) => c.id !== sanitized.id)].slice(0, 150);
  writeCacheList(cacheKey, next);

  try {
    await setDoc(doc(db, 'flashcards', sanitized.id), sanitized);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `flashcards/${sanitized.id}`);
  }
  return sanitized;
}

export async function saveFlashcardsBatch(cards: FlashcardRecord[]): Promise<FlashcardRecord[]> {
  const saved: FlashcardRecord[] = [];
  for (const card of cards) {
    saved.push(await saveFlashcard(card));
  }
  return saved;
}

export async function deleteFlashcard(userId: string, cardId: string): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${FLASHCARDS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<FlashcardRecord>(cacheKey);
  writeCacheList(
    cacheKey,
    current.filter((c) => c.id !== cardId)
  );

  try {
    await deleteDoc(doc(db, 'flashcards', cardId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `flashcards/${cardId}`);
  }
}

export async function fetchFlashcardReviews(userId: string): Promise<FlashcardReviewLog[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${FLASHCARD_REVIEWS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(
      collection(db, 'flashcard_reviews'),
      where('userId', '==', uid),
      limit(80)
    );
    const snap = await getDocs(q);
    const items = snap.docs
      .map((d) => d.data() as FlashcardReviewLog)
      .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
    writeCacheList(cacheKey, items);
    return items;
  } catch (error) {
    const cached = readCacheList<FlashcardReviewLog>(cacheKey);
    if (cached.length > 0) return cached.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
    handleFirestoreError(error, OperationType.LIST, 'flashcard_reviews');
  }
}

export async function saveFlashcardReview(review: FlashcardReviewLog): Promise<FlashcardReviewLog> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to log flashcard reviews.');
  }
  const uid = auth.currentUser.uid;
  const sanitized = sanitizeFlashcardReviewForStorage({
    ...review,
    userId: uid,
  });

  const cacheKey = `${FLASHCARD_REVIEWS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<FlashcardReviewLog>(cacheKey);
  const next = [sanitized, ...current.filter((r) => r.id !== sanitized.id)].slice(0, 80);
  writeCacheList(cacheKey, next);

  try {
    await setDoc(doc(db, 'flashcard_reviews', sanitized.id), sanitized);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `flashcard_reviews/${sanitized.id}`);
  }
  emitStatsDirty();
  return sanitized;
}

export async function logLearningActivitySafe(
  activity: Omit<ActivityRecord, 'id' | 'timestamp'>
): Promise<void> {
  if (!auth.currentUser) return;
  const id = sanitizeDocumentId(`${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, 'act');
  try {
    await setDoc(doc(db, 'activities', id), {
      id,
      userId: auth.currentUser.uid,
      type: activity.type,
      title: activity.title.slice(0, 200),
      description: activity.description.slice(0, 1000),
      subjectId: activity.subjectId?.slice(0, 64) || 'general',
      xpEarned: Math.max(0, Math.round(activity.xpEarned || 0)),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `activities/${id}`);
  }
}

// ==========================================
// 13. PHASE 5: EXAM SIMULATOR ATTEMPTS
// ==========================================
export async function fetchExamAttempts(userId: string): Promise<ExamAttemptRecord[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${EXAM_ATTEMPTS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(collection(db, 'exam_attempts'), where('userId', '==', uid), limit(40));
    const snap = await getDocs(q);
    const items = snap.docs
      .map((d) => d.data() as ExamAttemptRecord)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    writeCacheList(cacheKey, items);
    return items;
  } catch (error) {
    const cached = readCacheList<ExamAttemptRecord>(cacheKey);
    if (cached.length > 0) return cached.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    handleFirestoreError(error, OperationType.LIST, 'exam_attempts');
  }
}

export async function saveExamAttempt(attempt: ExamAttemptRecord): Promise<ExamAttemptRecord> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to save exam attempts.');
  }
  const uid = auth.currentUser.uid;
  const sanitized = sanitizeExamAttemptForStorage({
    ...attempt,
    userId: uid,
  });

  const cacheKey = `${EXAM_ATTEMPTS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<ExamAttemptRecord>(cacheKey);
  const next = [sanitized, ...current.filter((item) => item.id !== sanitized.id)].slice(0, 40);
  writeCacheList(cacheKey, next);

  try {
    await setDoc(doc(db, 'exam_attempts', sanitized.id), sanitized);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `exam_attempts/${sanitized.id}`);
  }
  emitStatsDirty();
  return sanitized;
}

export async function deleteExamAttempt(userId: string, attemptId: string): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${EXAM_ATTEMPTS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<ExamAttemptRecord>(cacheKey);
  writeCacheList(
    cacheKey,
    current.filter((item) => item.id !== attemptId)
  );

  try {
    await deleteDoc(doc(db, 'exam_attempts', attemptId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `exam_attempts/${attemptId}`);
  }
}

export async function syncExamResultToLearningIntelligence(
  attempt: ExamAttemptRecord
): Promise<void> {
  if (!auth.currentUser) return;
  const effectiveUid = auth.currentUser.uid;
  const attemptedQuestionIds = new Set(
    attempt.questionResults.filter((q) => q.isAttempted).map((q) => q.questionId)
  );

  const mappedAttempts = mapExamResultToPracticeAttempts({
    ...attempt,
    userId: effectiveUid,
  }).filter((item) => Boolean(item.questionId && attemptedQuestionIds.has(item.questionId)));

  if (mappedAttempts.length === 0) return;

  const [existingAttempts, existingMasteryList] = await Promise.all([
    fetchPracticeAttempts(effectiveUid).catch(() => []),
    fetchTopicMasteryList(effectiveUid).catch(() => []),
  ]);

  const existingIds = new Set(existingAttempts.map((a) => a.id));
  const newlyAdded: PracticeAttemptRecord[] = [];
  for (const rec of mappedAttempts) {
    if (!existingIds.has(rec.id)) {
      const saved = await savePracticeAttempt(rec);
      newlyAdded.push(saved);
    }
  }

  if (newlyAdded.length === 0) return;

  const combinedAttempts = [...newlyAdded, ...existingAttempts];
  const masteryById = new Map(existingMasteryList.map((m) => [m.id, m]));
  const touchedTopics = new Map<string, { subject: string; chapter: string; topic: string }>();

  for (const item of newlyAdded) {
    const mId = buildTopicMasteryId(effectiveUid, item.subject, item.topic);
    if (!touchedTopics.has(mId)) {
      touchedTopics.set(mId, {
        subject: item.subject,
        chapter: item.chapter || attempt.chapter || attempt.subject,
        topic: item.topic,
      });
    }
  }

  for (const [mId, info] of touchedTopics.entries()) {
    const topicAttempts = combinedAttempts.filter(
      (a) =>
        a.subject.trim().toLowerCase() === info.subject.trim().toLowerCase() &&
        a.topic.trim().toLowerCase() === info.topic.trim().toLowerCase()
    );
    const updatedMastery = recomputeTopicMastery({
      existing: masteryById.get(mId),
      userId: effectiveUid,
      subject: info.subject,
      chapter: info.chapter,
      topic: info.topic,
      allTopicAttempts: topicAttempts,
    });
    await saveTopicMastery(updatedMastery);
  }

  await savePracticeSummaryRecord({
    userId: effectiveUid,
    subject: attempt.subject,
    topic: attempt.paperTitle,
    score: Math.round(attempt.marksObtained),
    totalQuestions: Math.max(1, Math.round(attempt.totalMarks)),
    timeSpentSeconds: attempt.elapsedSeconds,
  }).catch(() => {});
}

// ==========================================
// 14. PHASE 6: VOICE CLASSROOM TRANSCRIPTS (TEXT-ONLY)
// ==========================================
export async function fetchVoiceSessions(userId: string): Promise<VoiceSessionRecord[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${VOICE_SESSIONS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(collection(db, 'voice_sessions'), where('userId', '==', uid), limit(30));
    const snap = await getDocs(q);
    const items = snap.docs
      .map((d) => d.data() as VoiceSessionRecord)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    writeCacheList(cacheKey, items);
    return items;
  } catch (error) {
    const cached = readCacheList<VoiceSessionRecord>(cacheKey);
    if (cached.length > 0) return cached.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    handleFirestoreError(error, OperationType.LIST, 'voice_sessions');
  }
}

export async function saveVoiceSession(session: VoiceSessionRecord): Promise<VoiceSessionRecord> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to save voice classroom transcripts.');
  }
  const uid = auth.currentUser.uid;
  const sanitized = sanitizeVoiceSessionForStorage({
    ...session,
    userId: uid,
    updatedAt: new Date().toISOString(),
  });

  const cacheKey = `${VOICE_SESSIONS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<VoiceSessionRecord>(cacheKey);
  const next = [sanitized, ...current.filter((item) => item.id !== sanitized.id)].slice(0, 30);
  writeCacheList(cacheKey, next);

  try {
    await setDoc(doc(db, 'voice_sessions', sanitized.id), sanitized);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `voice_sessions/${sanitized.id}`);
  }
  emitStatsDirty();
  return sanitized;
}

export async function deleteVoiceSession(userId: string, sessionId: string): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${VOICE_SESSIONS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<VoiceSessionRecord>(cacheKey);
  writeCacheList(
    cacheKey,
    current.filter((item) => item.id !== sessionId)
  );

  try {
    await deleteDoc(doc(db, 'voice_sessions', sessionId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `voice_sessions/${sessionId}`);
  }
}

// ==========================================
// 15. PHASE 7: STUDY ROOMS FIRESTORE MIRROR & ONSNAPSHOT
// ==========================================
export async function syncStudyRoomCreationToFirestore(
  room: StudyRoom,
  invite: StudyRoomInvite
): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  try {
    await setDoc(doc(db, 'study_rooms', room.id), {
      id: room.id,
      title: room.title.slice(0, 120),
      subject: room.subject.slice(0, 80),
      topic: room.topic.slice(0, 140),
      board: room.board.slice(0, 32),
      classGrade: room.classGrade.slice(0, 30),
      hostUid: uid,
      hostAlias: room.hostAlias.slice(0, 60),
      inviteCode: room.inviteCode.slice(0, 24),
      isPrivate: true,
      directMessagesDisabled: true,
      isLocked: room.isLocked,
      maxMembers: room.maxMembers,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    });
    const hostMember = room.members.find((m) => m.uid === uid) || room.members[0];
    if (hostMember) {
      await setDoc(doc(db, 'study_rooms', room.id, 'members', uid), {
        ...hostMember,
        uid,
      });
    }
    await setDoc(doc(db, 'users', uid, 'study_memberships', room.id), {
      roomId: room.id,
      roomTitle: room.title.slice(0, 120),
      subject: room.subject.slice(0, 80),
      role: 'host',
      joinedAt: room.createdAt,
    });
    await setDoc(doc(db, 'study_room_invites', invite.code), {
      ...invite,
      createdByUid: uid,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `study_rooms/${room.id}`);
  }
}

export async function syncStudyRoomJoinToFirestore(room: StudyRoom): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  const member = room.members.find((m) => m.uid === uid);
  if (!member) return;
  try {
    await setDoc(doc(db, 'study_rooms', room.id, 'members', uid), {
      ...member,
      uid,
    });
    await setDoc(doc(db, 'users', uid, 'study_memberships', room.id), {
      roomId: room.id,
      roomTitle: room.title.slice(0, 120),
      subject: room.subject.slice(0, 80),
      role: member.role,
      joinedAt: member.joinedAt,
    });
  } catch (error) {
    console.warn(`[StudyRooms] Firestore join mirror skipped for study_rooms/${room.id}:`, error);
  }
}

export function subscribeStudyRoomMetadata(
  roomId: string,
  onMetaUpdate: (meta: Partial<StudyRoom>) => void
): () => void {
  if (!auth.currentUser || !roomId) {
    return () => {};
  }
  const path = `study_rooms/${roomId}`;
  return onSnapshot(
    doc(db, 'study_rooms', roomId),
    (snap) => {
      if (snap.exists()) {
        onMetaUpdate(snap.data() as Partial<StudyRoom>);
      }
    },
    (error) => {
      console.warn(`[StudyRooms] Firestore snapshot skipped for ${path}:`, error?.message || error);
    }
  );
}

// ==========================================
// 16. PHASE 7: VERIFIED LEARNING MOTIVATION & ACHIEVEMENTS
// ==========================================
export async function fetchAchievementState(
  userId: string
): Promise<AchievementStateRecord | null> {
  if (!auth.currentUser) return null;
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${ACHIEVEMENT_STATE_STORAGE_PREFIX}${uid}`;

  try {
    const snap = await getDoc(doc(db, 'achievement_states', uid));
    if (snap.exists()) {
      const data = snap.data() as AchievementStateRecord;
      localStorage.setItem(cacheKey, JSON.stringify(data));
      return data;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `achievement_states/${uid}`);
  }
}

export async function saveAchievementState(state: AchievementStateRecord): Promise<void> {
  if (!auth.currentUser) return;
  const effectiveUid = auth.currentUser.uid;
  const payload: AchievementStateRecord = {
    ...state,
    userId: effectiveUid,
  };
  const cacheKey = `${ACHIEVEMENT_STATE_STORAGE_PREFIX}${effectiveUid}`;
  try {
    localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }

  try {
    await setDoc(doc(db, 'achievement_states', effectiveUid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `achievement_states/${effectiveUid}`);
  }
}

export async function fetchLessonProgress(userId: string): Promise<LessonProgressRecord[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid || userId;
  const cacheKey = `${LESSON_PROGRESS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(collection(db, 'lesson_progress'), where('userId', '==', uid), limit(100));
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => {
      const raw = d.data() as Record<string, unknown>;
      return {
        id: String(raw.id || d.id),
        uid: String(raw.userId || uid),
        subject: String(raw.subject || ''),
        chapter: String(raw.chapter || ''),
        topic: String(raw.topic || ''),
        status: raw.status === 'completed' ? 'completed' : 'started',
        startedAt: String(raw.startedAt || ''),
        completedAt: raw.completedAt ? String(raw.completedAt) : undefined,
        lastSourceModule: String(raw.lastSourceModule || 'ai-teacher'),
      } as LessonProgressRecord;
    });
    writeCacheList(cacheKey, items);
    return items;
  } catch (error) {
    const cached = readCacheList<LessonProgressRecord>(cacheKey);
    if (cached.length > 0) return cached;
    console.warn('[LessonProgress] Read deferred:', error);
    return [];
  }
}

export async function saveLessonProgressRecord(params: {
  subject: string;
  chapter: string;
  topic: string;
  status: 'started' | 'completed';
  sourceModule: LearningSourceModule;
}): Promise<LessonProgressRecord | null> {
  if (!auth.currentUser) return null;
  const uid = auth.currentUser.uid;
  const now = new Date().toISOString();
  const docId = sanitizeDocumentId(
    `${uid.slice(0, 16)}_${normalizeSlug(params.subject).slice(0, 20)}_${normalizeSlug(params.topic || params.chapter).slice(0, 32)}`,
    'lp'
  );
  const cacheKey = `${LESSON_PROGRESS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<LessonProgressRecord>(cacheKey);
  const existing = current.find((item) => item.id === docId);

  const nextStatus: 'started' | 'completed' =
    params.status === 'completed' || existing?.status === 'completed'
      ? 'completed'
      : 'started';

  const record: LessonProgressRecord = {
    id: docId,
    uid,
    subject: params.subject.trim().slice(0, 80) || 'General',
    chapter: (params.chapter || params.subject).trim().slice(0, 160),
    topic: (params.topic || params.chapter || params.subject).trim().slice(0, 160),
    status: nextStatus,
    startedAt: existing?.startedAt || now,
    completedAt:
      nextStatus === 'completed' ? existing?.completedAt || now : existing?.completedAt,
    lastSourceModule: params.sourceModule,
  };

  const nextCache = [record, ...current.filter((i) => i.id !== docId)].slice(0, 100);
  writeCacheList(cacheKey, nextCache);

  const firestorePayload: Record<string, unknown> = {
    id: record.id,
    userId: uid,
    subject: record.subject,
    chapter: record.chapter,
    topic: record.topic,
    status: record.status,
    lastSourceModule: record.lastSourceModule,
    startedAt: record.startedAt,
  };
  if (record.completedAt) {
    firestorePayload.completedAt = record.completedAt;
  }

  try {
    await setDoc(doc(db, 'lesson_progress', docId), firestorePayload, { merge: true });
  } catch (error) {
    console.warn('[LessonProgress] Firestore sync warning:', error);
  }
  return record;
}

export async function dispatchVerifiedLearningEvent(input: {
  eventType: LearningEventType;
  subject: string;
  chapter?: string;
  topic?: string;
  objectiveId?: string;
  sourceModule: LearningSourceModule;
  idempotencyKey: string;
  isCorrect?: boolean;
  scoreRatio?: number;
  errorTag?: string;
  difficulty?: string;
  title?: string;
  description?: string;
  recId?: string;
}): Promise<{ recorded: boolean; duplicate: boolean; xpAwarded: number }> {
  if (!auth.currentUser) {
    return { recorded: false, duplicate: false, xpAwarded: 0 };
  }
  const uid = auth.currentUser.uid;
  const nowIso = new Date().toISOString();
  const timezone =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      : 'UTC';
  const localDateKey = getLocalDateKey(nowIso, timezone);

  // Sync lesson_progress immediately if this is a lesson lifecycle event
  if (
    input.eventType === 'lesson_started' ||
    input.eventType === 'lesson_completed' ||
    input.eventType === 'topic_completed'
  ) {
    await saveLessonProgressRecord({
      subject: input.subject,
      chapter: input.chapter || input.topic || input.subject,
      topic: input.topic || input.chapter || input.subject,
      status: input.eventType === 'lesson_started' ? 'started' : 'completed',
      sourceModule: input.sourceModule,
    }).catch(() => {});
  }

  let serverResult: { recorded: boolean; duplicate: boolean; xpAwarded: number } | null = null;
  try {
    serverResult = await recordServerLearningEvent({
      ...input,
      localDateKey,
      timezone,
      timestamp: nowIso,
    });
  } catch (err) {
    console.warn('[VerifiedLearningEvent] Server event recording fallback:', err);
  }

  const eventsCacheKey = `${VERIFIED_EVENTS_STORAGE_PREFIX}${uid}`;
  const cachedEvents = readCacheList<LearningActivityEvent>(eventsCacheKey);
  const alreadyCached = cachedEvents.some((e) => e.idempotencyKey === input.idempotencyKey);

  if (serverResult?.duplicate || (!serverResult && alreadyCached)) {
    emitStatsDirty();
    return { recorded: false, duplicate: true, xpAwarded: 0 };
  }

  const xpAwarded =
    serverResult?.xpAwarded ??
    computeDeterministicXpForEvent(input.eventType, {
      isCorrect: input.isCorrect,
      scoreRatio: input.scoreRatio,
    });

  const storedEvent: LearningActivityEvent = {
    id: sanitizeDocumentId(input.idempotencyKey, 'ev'),
    uid,
    eventType: input.eventType,
    subject: input.subject.slice(0, 80),
    chapter: input.chapter?.slice(0, 160),
    topic: input.topic?.slice(0, 160),
    objectiveId: input.objectiveId?.slice(0, 80),
    sourceModule: input.sourceModule,
    idempotencyKey: input.idempotencyKey.slice(0, 160),
    xpAwarded,
    isCorrect: input.isCorrect,
    scoreRatio: input.scoreRatio,
    errorTag: input.errorTag,
    difficulty: input.difficulty,
    localDateKey,
    timezone,
    title: (input.title || `${input.subject}: ${input.topic || input.eventType}`).slice(0, 200),
    description: input.description?.slice(0, 400),
    timestamp: nowIso,
  };

  writeCacheList(
    eventsCacheKey,
    [storedEvent, ...cachedEvents.filter((e) => e.idempotencyKey !== storedEvent.idempotencyKey)].slice(0, 200)
  );

  // Also persist normalized ActivityRecord in Firestore so returning sessions reload cleanly
  if (
    input.eventType === 'lesson_started' ||
    input.eventType === 'lesson_completed' ||
    input.eventType === 'topic_completed' ||
    input.eventType === 'study_goal_completed'
  ) {
    const actId = sanitizeDocumentId(input.idempotencyKey, 'act');
    const firestoreActivity: Record<string, unknown> = {
      id: actId,
      userId: uid,
      type: input.eventType,
      title: storedEvent.title,
      description: storedEvent.description || '',
      subjectId: storedEvent.subject,
      chapter: storedEvent.chapter || '',
      topic: storedEvent.topic || '',
      sourceModule: storedEvent.sourceModule,
      idempotencyKey: storedEvent.idempotencyKey,
      localDateKey,
      xpEarned: xpAwarded,
      timestamp: nowIso,
    };
    await setDoc(doc(db, 'activities', actId), firestoreActivity, { merge: true }).catch(() => {});
  }

  emitStatsDirty();
  return {
    recorded: true,
    duplicate: false,
    xpAwarded,
  };
}

export async function loadVerifiedMotivationDashboard(
  userId: string
): Promise<MotivationDashboardState> {
  if (!auth.currentUser) {
    return computeMotivationDashboard({
      userId,
      practiceAttempts: [],
      topicMastery: [],
      flashcards: [],
      flashcardReviews: [],
      examAttempts: [],
      voiceSessions: [],
      doubts: [],
      mindMaps: [],
      teacherSessions: [],
      studyRooms: [],
      activities: [],
      verifiedEvents: [],
      lessonProgress: [],
      persistedState: null,
    });
  }

  const uid = auth.currentUser.uid;
  const [
    practiceAttempts,
    topicMastery,
    flashcards,
    flashcardReviews,
    examAttempts,
    voiceSessions,
    doubts,
    mindMaps,
    teacherSessions,
    studyRooms,
    activities,
    lessonProgress,
    persistedState,
  ] = await Promise.all([
    fetchPracticeAttempts(uid).catch(() => []),
    fetchTopicMasteryList(uid).catch(() => []),
    fetchFlashcards(uid).catch(() => []),
    fetchFlashcardReviews(uid).catch(() => []),
    fetchExamAttempts(uid).catch(() => []),
    fetchVoiceSessions(uid).catch(() => []),
    fetchDoubtHistory(uid).catch(() => []),
    fetchMindMaps(uid).catch(() => []),
    fetchTeacherSessions(uid).catch(() => []),
    fetchMyStudyRooms(uid).catch(() => [] as StudyRoom[]),
    fetchActivities(uid).catch(() => []),
    fetchLessonProgress(uid).catch(() => []),
    fetchAchievementState(uid).catch(() => null),
  ]);

  const cachedEvents = readCacheList<LearningActivityEvent>(`${VERIFIED_EVENTS_STORAGE_PREFIX}${uid}`);
  const mergedEventsByKey = new Map<string, LearningActivityEvent>();
  for (const ev of cachedEvents) {
    mergedEventsByKey.set(ev.idempotencyKey, ev);
  }
  for (const act of activities as Array<ActivityRecord & Partial<LearningActivityEvent>>) {
    if (act.idempotencyKey && !mergedEventsByKey.has(act.idempotencyKey)) {
      mergedEventsByKey.set(act.idempotencyKey, {
        id: act.id,
        uid,
        eventType: (act.type as LearningEventType) || 'lesson_completed',
        subject: act.subjectId || 'General',
        chapter: act.chapter,
        topic: act.topic,
        sourceModule: (act.sourceModule as LearningSourceModule) || 'ai-teacher',
        idempotencyKey: act.idempotencyKey,
        xpAwarded: act.xpEarned || 0,
        localDateKey: act.localDateKey || getLocalDateKey(act.timestamp),
        title: act.title,
        description: act.description,
        timestamp: act.timestamp,
      });
    }
  }

  const dashboard = computeMotivationDashboard({
    userId: uid,
    practiceAttempts,
    topicMastery,
    flashcards,
    flashcardReviews,
    examAttempts,
    voiceSessions,
    doubts,
    mindMaps,
    teacherSessions,
    studyRooms,
    activities,
    verifiedEvents: Array.from(mergedEventsByKey.values()),
    lessonProgress,
    persistedState,
  });

  const record = buildAchievementStateRecord(uid, dashboard);
  await saveAchievementState(record).catch(() => {});

  return dashboard;
}

export async function loadDynamicDashboardSummary(
  user: UserProfile,
  options?: { refresh?: boolean; currentRecIds?: string[] }
): Promise<{
  summary: DashboardLearningSummary;
  recentDoubts: DoubtTicket[];
  dueFlashcards: FlashcardRecord[];
  topicMastery: TopicMasteryRecord[];
  practiceAttempts: PracticeAttemptRecord[];
  examAttempts: ExamAttemptRecord[];
}> {
  const uid = auth.currentUser?.uid || user.uid;
  const timezone =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      : 'UTC';
  const localDateKey = getLocalDateKey(new Date(), timezone);

  const [
    practiceAttempts,
    topicMastery,
    flashcards,
    flashcardReviews,
    examAttempts,
    doubts,
    mindMaps,
    teacherSessions,
    voiceSessions,
    lessonProgress,
    learningProfile,
  ] = await Promise.all([
    fetchPracticeAttempts(uid).catch(() => []),
    fetchTopicMasteryList(uid).catch(() => []),
    fetchFlashcards(uid).catch(() => []),
    fetchFlashcardReviews(uid).catch(() => []),
    fetchExamAttempts(uid).catch(() => []),
    fetchDoubtHistory(uid).catch(() => []),
    fetchMindMaps(uid).catch(() => []),
    fetchTeacherSessions(uid).catch(() => []),
    fetchVoiceSessions(uid).catch(() => []),
    fetchLessonProgress(uid).catch(() => []),
    fetchLearningProfile(uid).catch(() => null),
  ]);

  const nowIso = new Date().toISOString();
  const dueFlashcards = flashcards.filter((fc) => fc.dueDate <= nowIso);

  const domainSnapshot = {
    practiceAttempts,
    topicMastery,
    flashcards,
    flashcardReviews,
    examAttempts,
    doubts,
    mindMaps,
    teacherSessions,
    voiceSessions,
    lessonProgress,
  };

  try {
    const summary = await syncDashboardLearningSummary({
      board: user.board,
      classGrade: user.classGrade,
      subjects: user.subjects || [],
      learningGoals: user.learningGoals || [],
      preferredPace: learningProfile?.preferredPace || 'steady',
      localDateKey,
      timezone,
      refresh: options?.refresh,
      currentRecIds: options?.currentRecIds,
      domainSnapshot,
    });

    return {
      summary,
      recentDoubts: doubts,
      dueFlashcards,
      topicMastery,
      practiceAttempts,
      examAttempts,
    };
  } catch (err) {
    console.warn('[Dashboard] Falling back to local deterministic learning engine:', err);
    const cachedEvents = readCacheList<LearningActivityEvent>(`${VERIFIED_EVENTS_STORAGE_PREFIX}${uid}`);
    const curriculum = getCurriculumForStudent(user.board, user.classGrade, user.subjects || []);
    const chapterProgress = computeChapterProgressList({
      curriculum,
      lessonProgress,
      verifiedEvents: cachedEvents,
      topicMastery,
    });
    const motivation = computeMotivationDashboard({
      userId: uid,
      practiceAttempts,
      topicMastery,
      flashcards,
      flashcardReviews,
      examAttempts,
      voiceSessions,
      doubts,
      mindMaps,
      teacherSessions,
      studyRooms: [],
      activities: [],
      verifiedEvents: cachedEvents,
      lessonProgress,
    });
    const todayEvents = cachedEvents.filter((e) => e.localDateKey === localDateKey);
    const dailyGoals = buildDynamicDailyGoals({
      uid,
      board: user.board,
      classGrade: user.classGrade,
      subjects: user.subjects || [],
      learningGoals: user.learningGoals || [],
      curriculum,
      chapterProgress,
      topicMastery,
      dueFlashcards,
      todayEvents,
      localDateKey,
    });
    const recommendations = generateAdaptiveRecommendations({
      board: user.board,
      classGrade: user.classGrade,
      enrolledSubjects: user.subjects || [],
      curriculum,
      chapterProgress,
      topicMastery,
      practiceAttempts,
      flashcards,
      history: {},
      nowIso,
      count: 4,
      excludeRecIds: options?.refresh ? options.currentRecIds : undefined,
      learningPace: learningProfile?.preferredPace || 'steady',
    });

    return {
      summary: {
        uid,
        localDateKey,
        timezone,
        verifiedXp: motivation.totalVerifiedXp,
        todayXp: motivation.todayXpEarned,
        streakDays: motivation.streakDays,
        longestStreakDays: motivation.streakDays,
        totalCompletedActivities: cachedEvents.length + practiceAttempts.length + doubts.length,
        todayCompletedActivities: 0,
        chapterProgress,
        dailyGoals,
        recommendations,
        recommendationRefreshCount: 0,
        lastUpdatedAt: nowIso,
      },
      recentDoubts: doubts,
      dueFlashcards,
      topicMastery,
      practiceAttempts,
      examAttempts,
    };
  }
}
