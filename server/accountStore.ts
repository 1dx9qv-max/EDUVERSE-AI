import fs from 'node:fs';
import path from 'node:path';
import type { ClassGrade, IndianBoard, PreferredLanguage, UserProfile, UserRole } from '../src/types/auth.ts';
import {
  DEFAULT_AVATAR_ID,
  normalizeUsername,
  validateUsernameFormat,
} from '../src/utils/usernameValidation.ts';

export const BOOTSTRAP_ADMIN_EMAIL = 'a40332177@gmail.com';

export type AccountStatus = 'active' | 'suspended';

export interface StoredAccountRecord extends UserProfile {
  status: AccountStatus;
}

interface AccountStoreData {
  users: Record<string, StoredAccountRecord>;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.resolve(DATA_DIR, 'user_accounts.json');

let memoryCache: AccountStoreData | null = null;

function readStore(): AccountStoreData {
  if (memoryCache) return memoryCache;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as AccountStoreData;
      if (parsed && parsed.users && typeof parsed.users === 'object') {
        memoryCache = parsed;
        return memoryCache;
      }
    }
  } catch {
    // Initialize fresh store if unreadable
  }
  memoryCache = { users: {} };
  return memoryCache;
}

function writeStore(data: AccountStoreData): void {
  memoryCache = data;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Safe fallback if running in a read-only container
  }
}

export function getUserAccountForAuth(
  uid: string,
  claims: {
    email?: string;
    displayName?: string;
    emailVerified?: boolean;
    bootstrapAdmin?: boolean;
  }
): StoredAccountRecord {
  const store = readStore();
  const existing = store.users[uid];
  const now = new Date().toISOString();

  if (existing) {
    let changed = false;
    if (claims.email && claims.email !== existing.email) {
      existing.email = claims.email;
      changed = true;
    }
    if (claims.emailVerified && !existing.emailVerified) {
      existing.emailVerified = true;
      changed = true;
    }
    if (claims.bootstrapAdmin && existing.role !== 'admin') {
      existing.role = 'admin';
      changed = true;
    }
    if (changed) {
      existing.updatedAt = now;
      writeStore(store);
    }
    return existing;
  }

  const created: StoredAccountRecord = {
    uid,
    email: claims.email || '',
    emailVerified: Boolean(claims.emailVerified),
    displayName: claims.displayName?.trim() || claims.email?.split('@')[0] || 'Eduverse Student',
    avatarId: DEFAULT_AVATAR_ID,
    role: claims.bootstrapAdmin ? 'admin' : 'student',
    status: 'active',
    board: 'CBSE',
    classGrade: 'Class 10',
    state: 'Delhi (NCT)',
    language: 'English',
    subjects: [],
    learningGoals: [],
    onboardingCompleted: false,
    createdAt: now,
    updatedAt: now,
  };
  store.users[uid] = created;
  writeStore(store);
  return created;
}

export function isUsernameAvailableOnServer(
  rawUsername: string,
  currentUid?: string
): { valid: boolean; available: boolean; normalized: string; error?: string } {
  const format = validateUsernameFormat(rawUsername);
  if (!format.valid) {
    return {
      valid: false,
      available: false,
      normalized: format.normalized,
      error: format.error,
    };
  }

  const store = readStore();
  for (const [uid, account] of Object.entries(store.users)) {
    if (
      uid !== currentUid &&
      account.username &&
      normalizeUsername(account.username) === format.normalized
    ) {
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
}

export function claimUsernameOnServer(uid: string, rawUsername: string): StoredAccountRecord {
  const availability = isUsernameAvailableOnServer(rawUsername, uid);
  if (!availability.valid) {
    throw new Error(availability.error || 'Invalid username format.');
  }
  if (!availability.available) {
    throw new Error('USERNAME_TAKEN');
  }

  const store = readStore();
  const existing = store.users[uid] || getUserAccountForAuth(uid, {});
  existing.username = availability.normalized;
  existing.updatedAt = new Date().toISOString();
  store.users[uid] = existing;
  writeStore(store);
  return existing;
}

export function updateOwnProfileOnServer(
  uid: string,
  updates: {
    displayName?: string;
    avatarId?: string;
    board?: IndianBoard;
    classGrade?: ClassGrade;
    state?: string;
    language?: PreferredLanguage;
    onboardingCompleted?: boolean;
    username?: string;
  }
): StoredAccountRecord {
  const store = readStore();
  const existing = store.users[uid] || getUserAccountForAuth(uid, {});

  if (typeof updates.username === 'string' && updates.username.trim()) {
    const check = isUsernameAvailableOnServer(updates.username, uid);
    if (!check.valid) {
      throw new Error(check.error || 'Invalid username format.');
    }
    if (!check.available) {
      throw new Error('USERNAME_TAKEN');
    }
    existing.username = check.normalized;
  }

  if (typeof updates.displayName === 'string' && updates.displayName.trim()) {
    existing.displayName = updates.displayName.trim().slice(0, 100);
  }
  if (typeof updates.avatarId === 'string' && updates.avatarId.trim()) {
    existing.avatarId = updates.avatarId.trim().slice(0, 64);
  }
  if (updates.board) existing.board = updates.board;
  if (updates.classGrade) existing.classGrade = updates.classGrade;
  if (typeof updates.state === 'string' && updates.state.trim()) {
    existing.state = updates.state.trim().slice(0, 80);
  }
  if (updates.language) existing.language = updates.language;
  if (typeof updates.onboardingCompleted === 'boolean') {
    existing.onboardingCompleted = updates.onboardingCompleted;
  }

  existing.updatedAt = new Date().toISOString();
  store.users[uid] = existing;
  writeStore(store);
  return existing;
}

export function deleteUserAccountFromServer(uid: string): void {
  const store = readStore();
  if (store.users[uid]) {
    delete store.users[uid];
    writeStore(store);
  }
}
