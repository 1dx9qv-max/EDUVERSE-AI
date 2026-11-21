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
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { handleFirestoreError, OperationType } from './firestoreError';
import { UserProfile } from '../types/auth';
import type { ExamActivityItem, SavedDatesheet } from '../types/datesheet';
import { sanitizeDatesheetForStorage } from '../utils/datesheetEngine';
import { sanitizeDocumentId } from '../utils/securityEngine';
import { checkUsernameOnServer } from '../api/client';
import { normalizeUsername, validateUsernameFormat } from '../utils/usernameValidation';

const DATESHEETS_STORAGE_PREFIX = 'eduverse_datesheets_v2_';
const EXAM_ACTIVITIES_STORAGE_PREFIX = 'eduverse_exam_activities_v2_';

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
    // Ignore localStorage quota issues safely
  }
}

export function emitDatesheetDirty(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('eduverse:datesheet-dirty'));
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

// ==========================================
// 2. MODULE 1: EXAM DATESHEET ANALYZER CRUD
// ==========================================
export async function fetchExamDatesheets(userId: string): Promise<SavedDatesheet[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid;
  if (userId && userId !== uid) {
    throw new Error('Unauthorized access to another student’s datesheets.');
  }
  const cacheKey = `${DATESHEETS_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(collection(db, 'exam_datesheets'), where('userId', '==', uid), limit(30));
    const snap = await getDocs(q);
    const list = snap.docs
      .map((d) => d.data() as SavedDatesheet)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    writeCacheList(cacheKey, list);
    return list;
  } catch (error) {
    const cached = readCacheList<SavedDatesheet>(cacheKey);
    if (cached.length > 0) {
      return cached.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    handleFirestoreError(error, OperationType.LIST, 'exam_datesheets');
  }
}

export async function saveExamDatesheet(datesheet: SavedDatesheet): Promise<SavedDatesheet> {
  if (!auth.currentUser) {
    throw new Error('Authentication required to save exam datesheets.');
  }
  const uid = auth.currentUser.uid;
  const sanitized = sanitizeDatesheetForStorage({
    ...datesheet,
    userId: uid,
  });

  const cacheKey = `${DATESHEETS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<SavedDatesheet>(cacheKey);
  const next = [sanitized, ...current.filter((item) => item.id !== sanitized.id)].slice(0, 30);
  writeCacheList(cacheKey, next);

  try {
    await setDoc(doc(db, 'exam_datesheets', sanitized.id), sanitized);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `exam_datesheets/${sanitized.id}`);
  }

  emitDatesheetDirty();
  return sanitized;
}

export async function deleteExamDatesheet(userId: string, datesheetId: string): Promise<void> {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  if (userId && userId !== uid) {
    throw new Error('Unauthorized deletion of another student’s datesheet.');
  }
  const cacheKey = `${DATESHEETS_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<SavedDatesheet>(cacheKey);
  writeCacheList(
    cacheKey,
    current.filter((item) => item.id !== datesheetId)
  );

  try {
    await deleteDoc(doc(db, 'exam_datesheets', datesheetId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `exam_datesheets/${datesheetId}`);
  }

  emitDatesheetDirty();
}

// ==========================================
// 3. EXAM ACTIVITY FEED (TRUTHFUL RECENT ACTIONS)
// ==========================================
export async function fetchExamActivities(userId: string): Promise<ExamActivityItem[]> {
  if (!auth.currentUser) return [];
  const uid = auth.currentUser.uid;
  if (userId && userId !== uid) {
    throw new Error('Unauthorized access to another student’s exam activity.');
  }
  const cacheKey = `${EXAM_ACTIVITIES_STORAGE_PREFIX}${uid}`;

  try {
    const q = query(collection(db, 'exam_activities'), where('userId', '==', uid), limit(25));
    const snap = await getDocs(q);
    const items = snap.docs
      .map((d) => d.data() as ExamActivityItem)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    writeCacheList(cacheKey, items);
    return items;
  } catch (error) {
    const cached = readCacheList<ExamActivityItem>(cacheKey);
    if (cached.length > 0) {
      return cached.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }
    handleFirestoreError(error, OperationType.LIST, 'exam_activities');
  }
}

export async function logExamActivity(
  params: Omit<ExamActivityItem, 'id' | 'userId' | 'timestamp'>
): Promise<ExamActivityItem | null> {
  if (!auth.currentUser) return null;
  const uid = auth.currentUser.uid;
  const item: ExamActivityItem = {
    id: sanitizeDocumentId(`${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, 'eact'),
    userId: uid,
    datesheetId: sanitizeDocumentId(params.datesheetId, 'ds'),
    action: params.action,
    title: String(params.title || 'Datesheet updated').trim().slice(0, 160),
    detail: String(params.detail || '').trim().slice(0, 320),
    timestamp: new Date().toISOString(),
  };

  const cacheKey = `${EXAM_ACTIVITIES_STORAGE_PREFIX}${uid}`;
  const current = readCacheList<ExamActivityItem>(cacheKey);
  writeCacheList(cacheKey, [item, ...current].slice(0, 25));

  try {
    await setDoc(doc(db, 'exam_activities', item.id), item);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `exam_activities/${item.id}`);
  }

  emitDatesheetDirty();
  return item;
}

// ==========================================
// 4. COMPLETE STUDENT ACCOUNT DATA CLEANUP
// ==========================================
export async function deleteAllStudentFirestoreData(
  uid: string,
  username?: string
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('You must be signed in to delete your account.');
  }

  for (const colName of ['exam_datesheets', 'exam_activities']) {
    try {
      const q = query(collection(db, colName), where('userId', '==', uid), limit(100));
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
    } catch {
      // Continue cleanup safely
    }
  }

  if (username) {
    await deleteDoc(doc(db, 'usernames', normalizeUsername(username))).catch(() => {});
  }

  await deleteDoc(doc(db, 'users', uid)).catch(() => {});

  for (const prefix of [DATESHEETS_STORAGE_PREFIX, EXAM_ACTIVITIES_STORAGE_PREFIX]) {
    try {
      localStorage.removeItem(`${prefix}${uid}`);
    } catch {
      // Ignore storage cleanup failures
    }
  }
}
