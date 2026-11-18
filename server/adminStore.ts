import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ClassGrade, IndianBoard, UserRole } from '../src/types/auth.ts';
import type { BoardConfig, SyllabusNode } from '../src/types/curriculum.ts';
import type {
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
} from '../src/types/phase8.ts';
import {
  projectGuardianStudentSummary,
  type RawGuardianStudentTelemetry,
} from '../src/utils/securityEngine.ts';
import { getConfiguredFirebaseProjectId } from './firebaseJwt.ts';
import { normalizeUsername, validateUsernameFormat } from '../src/utils/usernameValidation.ts';
import {
  applyAdminModerationToStudyRoom,
  getStudyRoomsAdminSnapshot,
  removeUserFromAllStudyRooms,
} from './studyRooms.ts';
import {
  getVerifiedLearningTelemetryForGuardian,
  purgeUserLearningStore,
} from './learningStore.ts';

export const BOOTSTRAP_ADMIN_EMAIL = 'a40332177@gmail.com';

export interface PlatformClassRecord {
  id: string;
  grade: ClassGrade;
  label: string;
  active: boolean;
  updatedAt: string;
}

export interface PlatformSubjectRecord {
  id: string;
  name: string;
  boardIds: string[];
  grades: ClassGrade[];
  active: boolean;
  updatedAt: string;
}

interface TelemetryCounters {
  aiRequestsTotal: number;
  aiRateLimitBlocks: number;
  aiSafetyBlocks: number;
  endpointStats: Record<string, { count: number; lastCalledAt: string }>;
}

interface GovernanceStoreData {
  users: Record<string, ManagedUserAccount>;
  boards: BoardConfig[];
  classes: PlatformClassRecord[];
  subjects: PlatformSubjectRecord[];
  syllabusNodes: SyllabusNode[];
  questionBank: ManagedQuestionItem[];
  learningContent: LearningContentItem[];
  platformReports: PlatformModerationItem[];
  guardianInviteCodes: Record<string, GuardianInviteCodeRecord>;
  guardianLinks: Record<string, GuardianLinkRecord>;
  auditLogs: AdminAuditLogEntry[];
  telemetry: TelemetryCounters;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.resolve(DATA_DIR, 'platform_governance.json');

function isDemoIdentity(uid?: string, email?: string): boolean {
  if (uid && uid.startsWith('demo-')) return true;
  if (email && email.toLowerCase().endsWith('@eduverse.demo')) return true;
  return false;
}

function createSeedStore(): GovernanceStoreData {
  const now = new Date().toISOString();

  return {
    users: {},
    boards: [
      {
        id: 'CBSE',
        name: 'CBSE',
        fullName: 'Central Board of Secondary Education',
        supportedClasses: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'],
        isVerified: true,
        updatedAt: now,
      },
      {
        id: 'ICSE',
        name: 'ICSE',
        fullName: 'Indian Certificate of Secondary Education (Class 6–10)',
        supportedClasses: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'],
        isVerified: true,
        updatedAt: now,
      },
      {
        id: 'ISC',
        name: 'ISC',
        fullName: 'Indian School Certificate (Class 11–12)',
        supportedClasses: ['Class 11', 'Class 12'],
        isVerified: true,
        updatedAt: now,
      },
      {
        id: 'CISCE',
        name: 'CISCE',
        fullName: 'Council for the Indian School Certificate Examinations',
        supportedClasses: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'],
        isVerified: true,
        updatedAt: now,
      },
      {
        id: 'StateBoard',
        name: 'StateBoard',
        fullName: 'Indian State Secondary & Higher Secondary Boards (SCERT)',
        supportedClasses: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'],
        isVerified: false,
        updatedAt: now,
      },
    ],
    classes: (
      ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'] as ClassGrade[]
    ).map((grade) => ({
      id: grade.toLowerCase().replace(/\s+/g, '-'),
      grade,
      label:
        grade === 'Class 10'
          ? 'Class 10 (Secondary Board)'
          : grade === 'Class 12'
            ? 'Class 12 (Senior Secondary Board)'
            : `${grade} Foundation`,
      active: true,
      updatedAt: now,
    })),
    subjects: [
      {
        id: 'mathematics',
        name: 'Mathematics',
        boardIds: ['CBSE', 'ICSE', 'ISC', 'CISCE', 'StateBoard'],
        grades: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'],
        active: true,
        updatedAt: now,
      },
      {
        id: 'science',
        name: 'Science (Combined NCERT)',
        boardIds: ['CBSE', 'ICSE', 'StateBoard'],
        grades: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'],
        active: true,
        updatedAt: now,
      },
      {
        id: 'physics',
        name: 'Physics',
        boardIds: ['CBSE', 'ICSE', 'ISC', 'CISCE', 'StateBoard'],
        grades: ['Class 9', 'Class 10', 'Class 11', 'Class 12'],
        active: true,
        updatedAt: now,
      },
      {
        id: 'chemistry',
        name: 'Chemistry',
        boardIds: ['CBSE', 'ICSE', 'ISC', 'CISCE', 'StateBoard'],
        grades: ['Class 9', 'Class 10', 'Class 11', 'Class 12'],
        active: true,
        updatedAt: now,
      },
      {
        id: 'biology',
        name: 'Biology',
        boardIds: ['CBSE', 'ICSE', 'ISC', 'CISCE', 'StateBoard'],
        grades: ['Class 9', 'Class 10', 'Class 11', 'Class 12'],
        active: true,
        updatedAt: now,
      },
      {
        id: 'social-science',
        name: 'Social Science & Civics',
        boardIds: ['CBSE', 'ICSE', 'StateBoard'],
        grades: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10'],
        active: true,
        updatedAt: now,
      },
    ],
    syllabusNodes: [
      {
        id: 'cbse-10-sci-ch1',
        boardId: 'CBSE',
        classGrade: 'Class 10',
        subjectId: 'science',
        chapterNumber: 1,
        chapterTitle: 'Chemical Reactions and Equations',
        topics: [
          {
            id: 'top-1',
            title: 'Chemical Equations & Balancing',
            order: 1,
            learningObjectives: [
              {
                id: 'lo-1',
                description: 'Write word equations and skeletal chemical equations',
                bloomLevel: 'Understand',
                isHighYield: true,
              },
              {
                id: 'lo-2',
                description: 'Apply law of conservation of mass to balance equations',
                bloomLevel: 'Apply',
                isHighYield: true,
              },
            ],
          },
          {
            id: 'top-2',
            title: 'Types of Chemical Reactions & Redox',
            order: 2,
            learningObjectives: [
              {
                id: 'lo-3',
                description:
                  'Distinguish combination, decomposition, displacement, and double displacement reactions',
                bloomLevel: 'Analyze',
                isHighYield: true,
              },
            ],
          },
        ],
        isVerified: true,
        verifiedBy: 'National Curriculum Directorate',
        verifiedAt: '2025-01-15T10:00:00.000Z',
        sourceDoc: 'NCERT Rationalized Curriculum Circular 2024-25',
        updatedAt: '2025-01-15T10:00:00.000Z',
      },
      {
        id: 'cbse-10-math-ch1',
        boardId: 'CBSE',
        classGrade: 'Class 10',
        subjectId: 'mathematics',
        chapterNumber: 1,
        chapterTitle: 'Real Numbers',
        topics: [
          {
            id: 'top-m1',
            title: 'The Fundamental Theorem of Arithmetic',
            order: 1,
            learningObjectives: [
              {
                id: 'lo-m1',
                description: 'Express composite integers uniquely as products of primes',
                bloomLevel: 'Understand',
                isHighYield: true,
              },
            ],
          },
          {
            id: 'top-m2',
            title: 'Revisiting Irrational Numbers',
            order: 2,
            learningObjectives: [
              {
                id: 'lo-m2',
                description: 'Prove irrationality of √2, √3, and √5 by contradiction',
                bloomLevel: 'Analyze',
                isHighYield: true,
              },
            ],
          },
        ],
        isVerified: true,
        verifiedBy: 'National Curriculum Directorate',
        verifiedAt: '2025-01-15T10:00:00.000Z',
        sourceDoc: 'CBSE Academic Circular Acad-29/2024',
        updatedAt: '2025-01-15T10:00:00.000Z',
      },
      {
        id: 'state-10-sci-ch1',
        boardId: 'StateBoard',
        classGrade: 'Class 10',
        subjectId: 'science',
        chapterNumber: 1,
        chapterTitle: 'Periodic Classification & Chemical Bonding (State Draft)',
        topics: [
          {
            id: 'top-s1',
            title: 'Dobereiner Triads and Newlands Octaves',
            order: 1,
            learningObjectives: [
              {
                id: 'lo-s1',
                description: 'Analyze early periodic classification models and limitations',
                bloomLevel: 'Understand',
                isHighYield: false,
              },
            ],
          },
        ],
        isVerified: false,
        sourceDoc: 'State SCERT Draft Review 2025',
        updatedAt: '2025-02-01T12:00:00.000Z',
      },
    ],
    questionBank: [
      {
        id: 'qb-cbse10-sci-01',
        boardId: 'CBSE',
        classGrade: 'Class 10',
        subjectId: 'science',
        chapterTitle: 'Chemical Reactions and Equations',
        topic: 'Redox Reactions',
        questionType: 'mcq',
        difficulty: 'intermediate',
        prompt: 'In the reaction CuO + H2 -> Cu + H2O, which substance is reduced?',
        options: ['CuO', 'H2', 'Cu', 'H2O'],
        correctAnswer: 'CuO',
        explanation: 'CuO loses oxygen to form Cu, so CuO undergoes reduction.',
        marks: 1,
        isVerified: true,
      createdBy: BOOTSTRAP_ADMIN_EMAIL,
        updatedAt: now,
      },
      {
        id: 'qb-cbse10-math-01',
        boardId: 'CBSE',
        classGrade: 'Class 10',
        subjectId: 'mathematics',
        chapterTitle: 'Real Numbers',
        topic: 'Fundamental Theorem of Arithmetic',
        questionType: 'numerical',
        difficulty: 'foundation',
        prompt: 'If HCF(306, 657) = 9, find LCM(306, 657).',
        correctAnswer: '22338',
        explanation: 'LCM = (306 × 657) / 9 = 34 × 657 = 22338.',
        marks: 2,
        isVerified: true,
        createdBy: BOOTSTRAP_ADMIN_EMAIL,
        updatedAt: now,
      },
    ],
    learningContent: [
      {
        id: 'lc-cbse10-sci-notes',
        boardId: 'CBSE',
        classGrade: 'Class 10',
        subjectId: 'science',
        chapterTitle: 'Chemical Reactions and Equations',
        contentType: 'formula-sheet',
        title: 'Balancing & Reaction Types Quick Reference',
        summary: 'Concise NCERT summary of exothermic, endothermic, displacement, and redox reactions.',
        body: '1. Conservation of mass requires equal atoms on LHS and RHS.\n2. Oxidation: gain of oxygen / loss of electrons.\n3. Reduction: loss of oxygen / gain of electrons.',
        isVerified: true,
        status: 'published',
        authorName: 'Academic Editorial Team',
        updatedAt: now,
      },
    ],
    platformReports: [],
    guardianInviteCodes: {},
    guardianLinks: {},
    auditLogs: [
      {
        id: 'audit-seed-system',
        actorUid: 'system',
        actorEmail: BOOTSTRAP_ADMIN_EMAIL,
        actorRole: 'admin',
        action: 'SECURITY_BASELINE_VERIFIED',
        targetType: 'security',
        targetId: 'platform-rbac',
        summary: 'Server-side RBAC, Firebase X.509 verification, and AI rate-limiting initialized.',
        createdAt: now,
      },
    ],
    telemetry: {
      aiRequestsTotal: 0,
      aiRateLimitBlocks: 0,
      aiSafetyBlocks: 0,
      endpointStats: {},
    },
  };
}

let store: GovernanceStoreData = loadStore();

function scrubDemoEntriesFromStore(data: GovernanceStoreData): { cleaned: GovernanceStoreData; dirty: boolean } {
  let dirty = false;
  const cleanUsers: Record<string, ManagedUserAccount> = {};
  for (const [uid, account] of Object.entries(data.users || {})) {
    if (!account || isDemoIdentity(uid, account.email)) {
      dirty = true;
      continue;
    }
    cleanUsers[uid] = account;
  }

  const cleanLinks: Record<string, GuardianLinkRecord> = {};
  for (const [id, link] of Object.entries(data.guardianLinks || {})) {
    if (
      !link ||
      isDemoIdentity(link.guardianUid) ||
      isDemoIdentity(link.studentUid) ||
      (link.guardianEmailMasked || '').includes('@eduverse.demo') ||
      link.guardianUid === 'guardian-meera-02'
    ) {
      dirty = true;
      continue;
    }
    cleanLinks[id] = link;
  }

  const cleanInvites: Record<string, GuardianInviteCodeRecord> = {};
  for (const [code, inv] of Object.entries(data.guardianInviteCodes || {})) {
    if (!inv || isDemoIdentity(inv.studentUid)) {
      dirty = true;
      continue;
    }
    cleanInvites[code] = inv;
  }

  const cleanReports = (data.platformReports || []).filter((r) => {
    const isDemo = isDemoIdentity(r.resolvedByUid) || r.id === 'mod-ai-seed-1';
    if (isDemo) dirty = true;
    return !isDemo;
  });

  const cleanLogs = (data.auditLogs || []).filter((log) => {
    const isDemo = isDemoIdentity(log.actorUid, log.actorEmail);
    if (isDemo) dirty = true;
    return !isDemo;
  });

  return {
    dirty,
    cleaned: {
      ...data,
      users: cleanUsers,
      guardianLinks: cleanLinks,
      guardianInviteCodes: cleanInvites,
      platformReports: cleanReports,
      auditLogs: cleanLogs,
    },
  };
}

function loadStore(): GovernanceStoreData {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<GovernanceStoreData>;
      const seed = createSeedStore();
      const candidate: GovernanceStoreData = {
        users: parsed.users || seed.users,
        boards: Array.isArray(parsed.boards) ? parsed.boards : seed.boards,
        classes: Array.isArray(parsed.classes) ? parsed.classes : seed.classes,
        subjects: Array.isArray(parsed.subjects) ? parsed.subjects : seed.subjects,
        syllabusNodes: Array.isArray(parsed.syllabusNodes) ? parsed.syllabusNodes : seed.syllabusNodes,
        questionBank: Array.isArray(parsed.questionBank) ? parsed.questionBank : seed.questionBank,
        learningContent: Array.isArray(parsed.learningContent) ? parsed.learningContent : seed.learningContent,
        platformReports: Array.isArray(parsed.platformReports) ? parsed.platformReports : seed.platformReports,
        guardianInviteCodes: parsed.guardianInviteCodes || seed.guardianInviteCodes,
        guardianLinks: parsed.guardianLinks || seed.guardianLinks,
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : seed.auditLogs,
        telemetry: parsed.telemetry || seed.telemetry,
      };
      const { cleaned, dirty } = scrubDemoEntriesFromStore(candidate);
      if (dirty) {
        saveStoreData(cleaned);
      }
      return cleaned;
    }
  } catch (err) {
    console.warn('[AdminStore] Failed loading persisted store, resetting seed:', err);
  }
  const initial = createSeedStore();
  saveStoreData(initial);
  return initial;
}

function saveStoreData(target = store): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(target, null, 2), 'utf8');
  } catch (err) {
    console.warn('[AdminStore] Failed persisting governance store:', err);
  }
}

export function reloadAdminStoreForTest(): void {
  store = loadStore();
}

export function maskEmailForPrivacy(email: string): string {
  const parts = (email || '').split('@');
  if (parts.length !== 2) return 'protected@eduverse';
  const local = parts[0];
  return `${local.slice(0, 1)}***@${parts[1]}`;
}

export function appendAuditLog(entry: Omit<AdminAuditLogEntry, 'id' | 'createdAt'>): AdminAuditLogEntry {
  const full: AdminAuditLogEntry = {
    ...entry,
    id: `audit_${crypto.randomBytes(5).toString('hex')}`,
    createdAt: new Date().toISOString(),
  };
  store.auditLogs.unshift(full);
  store.auditLogs = store.auditLogs.slice(0, 250);
  saveStoreData();
  return full;
}

export function recordAiRequestMetric(endpoint: string): void {
  store.telemetry.aiRequestsTotal += 1;
  store.telemetry.endpointStats[endpoint] = {
    count: (store.telemetry.endpointStats[endpoint]?.count || 0) + 1,
    lastCalledAt: new Date().toISOString(),
  };
  saveStoreData();
}

export function recordAiRateLimitBlock(): void {
  store.telemetry.aiRateLimitBlocks += 1;
  saveStoreData();
}

export function recordAiSafetyFlag(endpoint: string, preview: string, category: string, actorAlias: string): void {
  store.telemetry.aiSafetyBlocks += 1;
  const item: PlatformModerationItem = {
    id: `mod_ai_${crypto.randomBytes(5).toString('hex')}`,
    source: 'ai-safety',
    targetType: 'ai-prompt',
    targetId: endpoint,
    targetPreview: preview.slice(0, 140),
    reporterAlias: actorAlias || 'Automated Safety Filter',
    reason: category,
    details: `Blocked on ${endpoint}`,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  store.platformReports.unshift(item);
  store.platformReports = store.platformReports.slice(0, 150);
  saveStoreData();
}

export function getUserAccountForAuth(
  uid: string,
  defaults?: {
    email?: string;
    displayName?: string;
    emailVerified?: boolean;
    authProvider?: string;
    bootstrapAdmin?: boolean;
  }
): ManagedUserAccount {
  const existing = store.users[uid];
  if (existing) {
    let changed = false;
    if (defaults?.email && existing.email !== defaults.email) {
      existing.email = defaults.email;
      changed = true;
    }
    if (defaults?.emailVerified && !existing.emailVerified) {
      existing.emailVerified = true;
      changed = true;
    }
    if (defaults?.authProvider && !existing.authProvider) {
      existing.authProvider = defaults.authProvider;
      changed = true;
    }
    if (defaults?.bootstrapAdmin && existing.role !== 'admin') {
      existing.role = 'admin';
      changed = true;
    }
    if (defaults?.displayName && existing.displayName === 'Eduverse Student') {
      existing.displayName = defaults.displayName;
      changed = true;
    }
    if (changed) {
      existing.updatedAt = new Date().toISOString();
      saveStoreData();
    }
    return existing;
  }

  const role: UserRole =
    defaults?.bootstrapAdmin || defaults?.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
      ? 'admin'
      : 'student';
  const now = new Date().toISOString();
  const created: ManagedUserAccount = {
    uid,
    email: defaults?.email || '',
    emailVerified: Boolean(defaults?.emailVerified),
    authProvider: defaults?.authProvider,
    displayName: defaults?.displayName?.trim() || 'Eduverse Student',
    role,
    board: 'CBSE',
    classGrade: 'Class 10',
    state: 'Delhi (NCT)',
    language: 'English',
    status: 'active',
    onboardingCompleted: false,
    verifiedXp: 0,
    streakDays: 0,
    createdAt: now,
    updatedAt: now,
  };
  store.users[uid] = created;
  saveStoreData();
  return created;
}

export function isUsernameAvailableOnServer(
  rawUsername: string,
  currentUid?: string
): { valid: boolean; available: boolean; normalized: string; error?: string } {
  const check = validateUsernameFormat(rawUsername);
  if (!check.valid) {
    return {
      valid: false,
      available: false,
      normalized: check.normalized,
      error: check.error,
    };
  }

  const conflict = Object.values(store.users).find(
    (u) => u.uid !== currentUid && normalizeUsername(u.username || '') === check.normalized
  );

  if (conflict) {
    return {
      valid: true,
      available: false,
      normalized: check.normalized,
      error: `@${check.normalized} is already taken. Please try another username.`,
    };
  }

  return {
    valid: true,
    available: true,
    normalized: check.normalized,
  };
}

export function claimUsernameOnServer(uid: string, rawUsername: string): ManagedUserAccount {
  const user = store.users[uid];
  if (!user) throw new Error('USER_NOT_FOUND');

  const check = isUsernameAvailableOnServer(rawUsername, uid);
  if (!check.valid) {
    throw new Error(check.error || 'INVALID_USERNAME');
  }
  if (!check.available) {
    throw new Error('USERNAME_TAKEN');
  }

  user.username = check.normalized;
  user.updatedAt = new Date().toISOString();
  saveStoreData();
  return user;
}

export function updateOwnProfileOnServer(
  uid: string,
  updates: {
    displayName?: string;
    avatarId?: string;
    board?: IndianBoard;
    classGrade?: ClassGrade;
    state?: string;
    language?: string;
    onboardingCompleted?: boolean;
    username?: string;
  }
): ManagedUserAccount {
  const user = store.users[uid];
  if (!user) throw new Error('USER_NOT_FOUND');

  if (typeof updates.username === 'string' && updates.username.trim()) {
    const check = isUsernameAvailableOnServer(updates.username, uid);
    if (!check.valid) {
      throw new Error(check.error || 'INVALID_USERNAME');
    }
    if (!check.available) {
      throw new Error('USERNAME_TAKEN');
    }
    user.username = check.normalized;
  }

  if (typeof updates.displayName === 'string' && updates.displayName.trim()) {
    user.displayName = updates.displayName.trim().slice(0, 80);
  }
  if (typeof updates.avatarId === 'string' && updates.avatarId.trim()) {
    user.avatarId = updates.avatarId.trim().slice(0, 48);
  }
  if (typeof updates.board === 'string' && updates.board.trim()) {
    user.board = updates.board as IndianBoard;
  }
  if (typeof updates.classGrade === 'string' && updates.classGrade.trim()) {
    user.classGrade = updates.classGrade as ClassGrade;
  }
  if (typeof updates.state === 'string') {
    user.state = updates.state.trim().slice(0, 64);
  }
  if (typeof updates.language === 'string' && updates.language.trim()) {
    user.language = updates.language.trim().slice(0, 32);
  }
  if (typeof updates.onboardingCompleted === 'boolean') {
    user.onboardingCompleted = updates.onboardingCompleted;
  }

  user.updatedAt = new Date().toISOString();
  saveStoreData();
  return user;
}

export function updateUserLearningMetricsOnServer(
  uid: string,
  metrics: { verifiedXp: number; streakDays: number }
): void {
  const user = store.users[uid];
  if (!user) return;
  const nextXp = Math.max(0, Math.round(metrics.verifiedXp));
  const nextStreak = Math.max(0, Math.round(metrics.streakDays));
  if (user.verifiedXp !== nextXp || user.streakDays !== nextStreak) {
    user.verifiedXp = nextXp;
    user.streakDays = nextStreak;
    user.updatedAt = new Date().toISOString();
    saveStoreData();
  }
}

export function deleteUserAccountFromServer(uid: string): void {
  const existing = store.users[uid];
  delete store.users[uid];

  for (const [linkId, link] of Object.entries(store.guardianLinks)) {
    if (link.studentUid === uid || link.guardianUid === uid) {
      delete store.guardianLinks[linkId];
    }
  }
  for (const [code, inv] of Object.entries(store.guardianInviteCodes)) {
    if (inv.studentUid === uid) {
      delete store.guardianInviteCodes[code];
    }
  }

  removeUserFromAllStudyRooms(uid);
  purgeUserLearningStore(uid);

  appendAuditLog({
    actorUid: uid,
    actorEmail: maskEmailForPrivacy(existing?.email || ''),
    actorRole: existing?.role || 'student',
    action: 'USER_ACCOUNT_DELETED',
    targetType: 'user',
    targetId: uid,
    summary: 'User initiated complete account deletion and server profile purge.',
  });
}

export function listUsersForAdmin(): ManagedUserAccount[] {
  return Object.values(store.users).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function updateUserByAdmin(
  actor: { uid: string; email: string; role: UserRole },
  targetUid: string,
  updates: { role?: UserRole; status?: AccountStatus; board?: IndianBoard; classGrade?: ClassGrade }
): ManagedUserAccount {
  const user = store.users[targetUid];
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }
  if (targetUid === actor.uid && updates.status === 'suspended') {
    throw new Error('CANNOT_SUSPEND_SELF');
  }

  const prevRole = user.role;
  const prevStatus = user.status;
  if (updates.role) user.role = updates.role;
  if (updates.status) user.status = updates.status;
  if (updates.board) user.board = updates.board;
  if (updates.classGrade) user.classGrade = updates.classGrade;
  user.updatedAt = new Date().toISOString();
  saveStoreData();

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'USER_GOVERNANCE_UPDATED',
    targetType: 'user',
    targetId: targetUid,
    summary: `Updated ${user.displayName}: role ${prevRole}->${user.role}, status ${prevStatus}->${user.status}.`,
  });

  return user;
}

export function listBoardsForAdmin(): BoardConfig[] {
  return store.boards;
}

export function upsertBoardByAdmin(
  actor: { uid: string; email: string; role: UserRole },
  input: { id: string; name: string; fullName: string; supportedClasses: ClassGrade[]; isVerified: boolean }
): BoardConfig {
  const cleanId = input.id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || `Board_${Date.now()}`;
  const now = new Date().toISOString();
  const idx = store.boards.findIndex((b) => b.id.toLowerCase() === cleanId.toLowerCase());
  const next: BoardConfig = {
    id: cleanId,
    name: input.name.trim().slice(0, 40) || cleanId,
    fullName: input.fullName.trim().slice(0, 140) || cleanId,
    supportedClasses: input.supportedClasses.length > 0 ? input.supportedClasses : ['Class 10'],
    isVerified: Boolean(input.isVerified),
    updatedAt: now,
  };
  if (idx >= 0) store.boards[idx] = next;
  else store.boards.unshift(next);
  saveStoreData();

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: idx >= 0 ? 'BOARD_UPDATED' : 'BOARD_CREATED',
    targetType: 'board',
    targetId: next.id,
    summary: `${idx >= 0 ? 'Updated' : 'Added'} board ${next.name} (verified=${next.isVerified}).`,
  });

  return next;
}

export function listClassesForAdmin(): PlatformClassRecord[] {
  return store.classes;
}

export function updateClassByAdmin(
  actor: { uid: string; email: string; role: UserRole },
  classId: string,
  updates: { label?: string; active?: boolean }
): PlatformClassRecord {
  const item = store.classes.find((c) => c.id === classId);
  if (!item) throw new Error('CLASS_NOT_FOUND');
  if (typeof updates.label === 'string' && updates.label.trim()) item.label = updates.label.trim().slice(0, 80);
  if (typeof updates.active === 'boolean') item.active = updates.active;
  item.updatedAt = new Date().toISOString();
  saveStoreData();

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'CLASS_UPDATED',
    targetType: 'class',
    targetId: classId,
    summary: `Updated ${item.grade} (${item.label}, active=${item.active}).`,
  });

  return item;
}

export function listSubjectsForAdmin(): PlatformSubjectRecord[] {
  return store.subjects;
}

export function upsertSubjectByAdmin(
  actor: { uid: string; email: string; role: UserRole },
  input: { id?: string; name: string; boardIds: string[]; grades: ClassGrade[]; active: boolean }
): PlatformSubjectRecord {
  const cleanId =
    (input.id || input.name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || `subj-${Date.now()}`;
  const now = new Date().toISOString();
  const idx = store.subjects.findIndex((s) => s.id === cleanId);
  const next: PlatformSubjectRecord = {
    id: cleanId,
    name: input.name.trim().slice(0, 80),
    boardIds: input.boardIds.length > 0 ? input.boardIds : ['CBSE'],
    grades: input.grades.length > 0 ? input.grades : ['Class 10'],
    active: input.active,
    updatedAt: now,
  };
  if (idx >= 0) store.subjects[idx] = next;
  else store.subjects.unshift(next);
  saveStoreData();

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: idx >= 0 ? 'SUBJECT_UPDATED' : 'SUBJECT_CREATED',
    targetType: 'subject',
    targetId: next.id,
    summary: `${idx >= 0 ? 'Updated' : 'Created'} subject ${next.name} (active=${next.active}).`,
  });

  return next;
}

export function listSyllabusNodes(): SyllabusNode[] {
  return store.syllabusNodes;
}

export function upsertSyllabusNodeByAdmin(
  actor: { uid: string; email: string; role: UserRole; displayName: string },
  node: SyllabusNode
): SyllabusNode {
  const now = new Date().toISOString();
  const cleanId =
    (node.id || `syl-${node.boardId}-${node.classGrade}-${Date.now()}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .slice(0, 96);
  const idx = store.syllabusNodes.findIndex((s) => s.id === cleanId);
  const saved: SyllabusNode = {
    ...node,
    id: cleanId,
    chapterTitle: node.chapterTitle.trim().slice(0, 140),
    verifiedBy: node.isVerified ? node.verifiedBy || `${actor.displayName} (Verified Staff)` : undefined,
    verifiedAt: node.isVerified ? node.verifiedAt || now : undefined,
    updatedAt: now,
  };
  if (idx >= 0) store.syllabusNodes[idx] = saved;
  else store.syllabusNodes.unshift(saved);
  saveStoreData();

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: idx >= 0 ? 'SYLLABUS_UPDATED' : 'SYLLABUS_CREATED',
    targetType: 'syllabus',
    targetId: saved.id,
    summary: `${saved.boardId} ${saved.classGrade} Ch.${saved.chapterNumber}: ${saved.chapterTitle} (verified=${saved.isVerified}).`,
  });

  return saved;
}

export function verifySyllabusNodeByAdmin(
  actor: { uid: string; email: string; role: UserRole; displayName: string },
  nodeId: string,
  isVerified: boolean
): SyllabusNode {
  const node = store.syllabusNodes.find((s) => s.id === nodeId);
  if (!node) throw new Error('SYLLABUS_NOT_FOUND');
  const now = new Date().toISOString();
  node.isVerified = isVerified;
  node.verifiedBy = isVerified ? `${actor.displayName} (Authorized Staff)` : undefined;
  node.verifiedAt = isVerified ? now : undefined;
  node.updatedAt = now;
  saveStoreData();

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: isVerified ? 'SYLLABUS_VERIFIED' : 'SYLLABUS_REVERTED_DRAFT',
    targetType: 'syllabus',
    targetId: nodeId,
    summary: `Marked "${node.chapterTitle}" (${node.boardId} ${node.classGrade}) as ${isVerified ? 'Official Verified' : 'Draft'}.`,
  });

  return node;
}

export function deleteSyllabusNodeByAdmin(
  actor: { uid: string; email: string; role: UserRole },
  nodeId: string
): void {
  const idx = store.syllabusNodes.findIndex((s) => s.id === nodeId);
  if (idx < 0) throw new Error('SYLLABUS_NOT_FOUND');
  const [removed] = store.syllabusNodes.splice(idx, 1);
  saveStoreData();

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'SYLLABUS_DELETED',
    targetType: 'syllabus',
    targetId: nodeId,
    summary: `Removed syllabus chapter "${removed.chapterTitle}" (${removed.boardId} ${removed.classGrade}).`,
  });
}

export function listQuestionsForAdmin(): ManagedQuestionItem[] {
  return store.questionBank;
}

export function upsertQuestionByAdmin(
  actor: { uid: string; email: string; role: UserRole },
  input: Omit<ManagedQuestionItem, 'id' | 'createdBy' | 'updatedAt'> & { id?: string }
): ManagedQuestionItem {
  const now = new Date().toISOString();
  const id = (input.id || `qb_${crypto.randomBytes(4).toString('hex')}`).slice(0, 64);
  const idx = store.questionBank.findIndex((q) => q.id === id);
  const item: ManagedQuestionItem = {
    ...input,
    id,
    prompt: input.prompt.trim().slice(0, 1200),
    correctAnswer: input.correctAnswer.trim().slice(0, 500),
    explanation: input.explanation.trim().slice(0, 1000),
    createdBy: idx >= 0 ? store.questionBank[idx].createdBy : actor.email,
    updatedAt: now,
  };
  if (idx >= 0) store.questionBank[idx] = item;
  else store.questionBank.unshift(item);
  saveStoreData();

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: idx >= 0 ? 'QUESTION_UPDATED' : 'QUESTION_CREATED',
    targetType: 'question',
    targetId: item.id,
    summary: `${item.boardId} ${item.classGrade} (${item.questionType}): ${item.prompt.slice(0, 65)}...`,
  });

  return item;
}

export function deleteQuestionByAdmin(
  actor: { uid: string; email: string; role: UserRole },
  questionId: string
): void {
  const idx = store.questionBank.findIndex((q) => q.id === questionId);
  if (idx < 0) throw new Error('QUESTION_NOT_FOUND');
  store.questionBank.splice(idx, 1);
  saveStoreData();

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: 'QUESTION_DELETED',
    targetType: 'question',
    targetId: questionId,
    summary: `Deleted question bank item ${questionId}.`,
  });
}

export function listLearningContentForAdmin(): LearningContentItem[] {
  return store.learningContent;
}

export function upsertLearningContentByAdmin(
  actor: { uid: string; email: string; role: UserRole; displayName: string },
  input: Omit<LearningContentItem, 'id' | 'authorName' | 'updatedAt'> & { id?: string }
): LearningContentItem {
  const now = new Date().toISOString();
  const id = (input.id || `lc_${crypto.randomBytes(4).toString('hex')}`).slice(0, 64);
  const idx = store.learningContent.findIndex((c) => c.id === id);
  const saved: LearningContentItem = {
    ...input,
    id,
    title: input.title.trim().slice(0, 140),
    summary: input.summary.trim().slice(0, 400),
    body: input.body.trim().slice(0, 4000),
    authorName: idx >= 0 ? store.learningContent[idx].authorName : actor.displayName,
    updatedAt: now,
  };
  if (idx >= 0) store.learningContent[idx] = saved;
  else store.learningContent.unshift(saved);
  saveStoreData();

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: idx >= 0 ? 'CONTENT_UPDATED' : 'CONTENT_CREATED',
    targetType: 'content',
    targetId: saved.id,
    summary: `${saved.status.toUpperCase()} content "${saved.title}" (${saved.boardId} ${saved.classGrade}).`,
  });

  return saved;
}

export function listModerationQueueForAdmin(): PlatformModerationItem[] {
  const studySnap = getStudyRoomsAdminSnapshot();
  const merged: PlatformModerationItem[] = [...studySnap.reports, ...store.platformReports];
  return merged.sort((a, b) => {
    if (a.status === 'open' && b.status !== 'open') return -1;
    if (a.status !== 'open' && b.status === 'open') return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function resolveModerationItemByAdmin(
  actor: { uid: string; email: string; role: UserRole },
  input: { reportId: string; source: 'study-room' | 'ai-safety' | 'platform'; roomId?: string; decision: 'action-taken' | 'dismissed' }
): void {
  if (input.source === 'study-room' && input.roomId) {
    const ok = applyAdminModerationToStudyRoom(
      input.roomId,
      input.reportId,
      input.decision,
      actor.uid
    );
    if (!ok) throw new Error('MODERATION_ITEM_NOT_FOUND');
  } else {
    const item = store.platformReports.find((r) => r.id === input.reportId);
    if (!item) throw new Error('MODERATION_ITEM_NOT_FOUND');
    item.status = input.decision;
    item.resolvedByUid = actor.uid;
    item.resolvedAt = new Date().toISOString();
    saveStoreData();
  }

  appendAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: input.decision === 'action-taken' ? 'MODERATION_ACTION_TAKEN' : 'MODERATION_DISMISSED',
    targetType: 'moderation',
    targetId: input.reportId,
    summary: `Resolved ${input.source} moderation report ${input.reportId} (${input.decision}).`,
  });
}

export function listAuditLogsForAdmin(): AdminAuditLogEntry[] {
  return store.auditLogs;
}

export function getPlatformUsageAnalytics(): PlatformUsageAnalytics {
  const users = Object.values(store.users);
  const activeUsersByRole: Record<UserRole, number> = {
    student: 0,
    teacher: 0,
    guardian: 0,
    admin: 0,
  };
  let suspendedUsersCount = 0;
  for (const u of users) {
    if (u.status === 'suspended') suspendedUsersCount += 1;
    else activeUsersByRole[u.role] = (activeUsersByRole[u.role] || 0) + 1;
  }

  const studySnap = getStudyRoomsAdminSnapshot();
  const openReports = listModerationQueueForAdmin().filter((r) => r.status === 'open').length;

  return {
    totalUsers: users.length,
    activeUsersByRole,
    suspendedUsersCount,
    verifiedBoardsCount: store.boards.filter((b) => b.isVerified).length,
    classesCount: store.classes.filter((c) => c.active).length,
    subjectsCount: store.subjects.filter((s) => s.active).length,
    verifiedSyllabusCount: store.syllabusNodes.filter((s) => s.isVerified).length,
    pendingSyllabusCount: store.syllabusNodes.filter((s) => !s.isVerified).length,
    questionBankCount: store.questionBank.length,
    publishedContentCount: store.learningContent.filter((c) => c.status === 'published').length,
    openModerationReports: openReports,
    activeStudyRooms: studySnap.activeRoomsCount,
    verifiedGuardianLinks: Object.values(store.guardianLinks).filter((l) => l.status === 'verified').length,
    aiRequestsTotal: store.telemetry.aiRequestsTotal,
    aiRateLimitBlocks: store.telemetry.aiRateLimitBlocks,
    aiSafetyBlocks: store.telemetry.aiSafetyBlocks,
    recentAiEndpoints: Object.entries(store.telemetry.endpointStats)
      .map(([endpoint, val]) => ({ endpoint, count: val.count, lastCalledAt: val.lastCalledAt }))
      .sort((a, b) => b.lastCalledAt.localeCompare(a.lastCalledAt))
      .slice(0, 8),
  };
}

export function getSystemHealthSnapshot(geminiConfigured: boolean): SystemHealthSnapshot {
  const mem = process.memoryUsage();
  const studySnap = getStudyRoomsAdminSnapshot();
  return {
    status: 'healthy',
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(mem.rss / (1024 * 1024)),
    memoryHeapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    geminiConfigured,
    firebaseProjectId: getConfiguredFirebaseProjectId(),
    authVerificationMode: 'firebase-x509-jwt',
    rateLimiterActive: true,
    wsStudyRoomsPath: '/ws/study-rooms',
    wsVoiceLivePath: '/ws/voice-live',
    activeStudyRoomsCount: studySnap.activeRoomsCount,
    timestamp: new Date().toISOString(),
  };
}

export function getSecurityPostureChecks(): SecurityPostureCheck[] {
  return [
    {
      id: 'sec-rbac',
      control: 'Server-Side RBAC & Zero Frontend Role Trust',
      status: 'enforced',
      detail: 'API middleware resolves roles from verified Firebase ID tokens and server user records; client role headers/payloads are never trusted.',
    },
    {
      id: 'sec-firestore',
      control: 'Firestore Hardened Security Rules',
      status: 'enforced',
      detail: 'Default-deny catch-all, email_verified gates on mutations, admin isolation, guardian pending-only creation, permission-gated student telemetry, and immutable audit logs.',
    },
    {
      id: 'sec-ratelimit',
      control: 'Sliding-Window Rate Limiting on /api/ai/*',
      status: 'enforced',
      detail: 'Protects expensive Gemini teacher, solver, exam, practice, and voice endpoints against burst abuse.',
    },
    {
      id: 'sec-uploads',
      control: 'Magic-Byte & Filename Upload Validation',
      status: 'enforced',
      detail: 'Verifies PNG/JPEG/WEBP/PDF binary headers, enforces <= 4 MB limit, and strips path traversal / dangerous extensions.',
    },
    {
      id: 'sec-safety',
      control: 'K-12 Age-Appropriate AI Safety Screening & Gemini SafetySettings',
      status: 'enforced',
      detail: 'Pre-screens prompts and configures Gemini BLOCK_LOW_AND_ABOVE safety thresholds.',
    },
    {
      id: 'sec-jwt',
      control: 'Cryptographic Firebase X.509 RSA JWT Verification',
      status: 'enforced',
      detail: 'Every protected API request verifies RS256 Firebase ID tokens against Google public X.509 certificates without requiring static service-account JSON keys.',
    },
  ];
}

// ==========================================
// GUARDIAN VERIFICATION & PRIVACY CONTROLS
// ==========================================

export function listGuardianLinksForAdmin(): GuardianLinkRecord[] {
  return Object.values(store.guardianLinks).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listGuardianLinksForStudent(studentUid: string): GuardianLinkRecord[] {
  return Object.values(store.guardianLinks)
    .filter((l) => l.studentUid === studentUid)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listGuardianLinksForGuardian(guardianUid: string): GuardianLinkRecord[] {
  return Object.values(store.guardianLinks)
    .filter((l) => l.guardianUid === guardianUid)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function generateGuardianInviteCode(studentUid: string): GuardianInviteCodeRecord {
  const student = getUserAccountForAuth(studentUid);
  const code = `GDN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const record: GuardianInviteCodeRecord = {
    code,
    studentUid: student.uid,
    studentDisplayName: student.displayName,
    studentBoard: student.board,
    studentClassGrade: student.classGrade,
    createdAt: now.toISOString(),
    expiresAt,
    used: false,
  };
  store.guardianInviteCodes[code] = record;
  saveStoreData();
  return record;
}

export function requestGuardianLinkWithCode(input: {
  guardianUid: string;
  guardianName: string;
  guardianEmail: string;
  code: string;
  relationship: 'parent' | 'guardian' | 'mentor';
}): GuardianLinkRecord {
  const cleanCode = input.code.trim().toUpperCase();
  const invite = store.guardianInviteCodes[cleanCode];
  if (!invite) {
    throw new Error('INVALID_INVITE_CODE');
  }
  if (invite.used || Date.parse(invite.expiresAt) < Date.now()) {
    throw new Error('EXPIRED_INVITE_CODE');
  }
  if (invite.studentUid === input.guardianUid) {
    throw new Error('CANNOT_LINK_SELF');
  }

  const linkId = `${input.guardianUid}_${invite.studentUid}`;
  const now = new Date().toISOString();

  // SECURITY INVARIANT: Guardians can ONLY create a 'pending' link.
  // Only the student (or admin) can approve & set status = 'verified'.
  const link: GuardianLinkRecord = {
    id: linkId,
    guardianUid: input.guardianUid,
    guardianName: input.guardianName.trim().slice(0, 80) || 'Verified Guardian',
    guardianEmailMasked: maskEmailForPrivacy(input.guardianEmail),
    studentUid: invite.studentUid,
    studentDisplayName: invite.studentDisplayName,
    studentBoard: invite.studentBoard,
    studentClassGrade: invite.studentClassGrade,
    relationship: input.relationship,
    status: 'pending',
    permissions: {
      canViewProgress: true,
      canViewGoals: true,
      canViewAssessments: false,
      canReceiveAlerts: true,
    },
    createdAt: now,
    updatedAt: now,
  };

  invite.used = true;
  store.guardianLinks[linkId] = link;
  saveStoreData();
  return link;
}

export function updateGuardianLinkByStudentOrAdmin(
  actor: { uid: string; email: string; role: UserRole },
  linkId: string,
  updates: { status?: 'verified' | 'revoked'; permissions?: Partial<GuardianPermissions> }
): GuardianLinkRecord {
  const link = store.guardianLinks[linkId];
  if (!link) throw new Error('GUARDIAN_LINK_NOT_FOUND');

  // Strict authorization: ONLY the linked student or an admin may verify/revoke/modify permissions!
  const isLinkedStudent = actor.uid === link.studentUid;
  const isAdmin = actor.role === 'admin';
  if (!isLinkedStudent && !isAdmin) {
    throw new Error('FORBIDDEN_GUARDIAN_MUTATION');
  }

  const now = new Date().toISOString();
  if (updates.status === 'verified' || updates.status === 'revoked') {
    link.status = updates.status;
    if (updates.status === 'verified') {
      link.verifiedAt = now;
    }
  }
  if (updates.permissions) {
    link.permissions = {
      canViewProgress:
        typeof updates.permissions.canViewProgress === 'boolean'
          ? updates.permissions.canViewProgress
          : link.permissions.canViewProgress,
      canViewGoals:
        typeof updates.permissions.canViewGoals === 'boolean'
          ? updates.permissions.canViewGoals
          : link.permissions.canViewGoals,
      canViewAssessments:
        typeof updates.permissions.canViewAssessments === 'boolean'
          ? updates.permissions.canViewAssessments
          : link.permissions.canViewAssessments,
      canReceiveAlerts:
        typeof updates.permissions.canReceiveAlerts === 'boolean'
          ? updates.permissions.canReceiveAlerts
          : link.permissions.canReceiveAlerts,
    };
  }
  link.updatedAt = now;
  saveStoreData();

  if (isAdmin) {
    appendAuditLog({
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'GUARDIAN_LINK_ADMIN_UPDATED',
      targetType: 'guardian',
      targetId: linkId,
      summary: `Admin updated link ${linkId} -> status=${link.status}.`,
    });
  }

  return link;
}

function getStudentTelemetryForGuardian(studentUid: string): RawGuardianStudentTelemetry {
  const account = getUserAccountForAuth(studentUid);
  const telemetry = getVerifiedLearningTelemetryForGuardian(studentUid);

  return {
    studentDisplayName: account.displayName,
    board: account.board,
    classGrade: account.classGrade,
    language: account.language || 'English',
    progressSummary: {
      streakDays: telemetry.streakDays,
      totalVerifiedXp: telemetry.totalVerifiedXp,
      todayXpEarned: telemetry.todayXpEarned,
      todayXpCap: 300,
      todayEstimatedMinutes: telemetry.todayEstimatedMinutes,
      masteredTopicsCount: telemetry.masteredTopicsCount,
      developingTopicsCount: telemetry.developingTopicsCount,
      needsRevisionTopics: telemetry.needsRevisionTopics,
      strongTopics: telemetry.strongTopics,
    },
    goalsOverview: {
      learningGoals: telemetry.learningGoals,
      dailyGoalsCompleted: telemetry.dailyGoals.filter((g) => g.completed).length,
      dailyGoalsTotal: telemetry.dailyGoals.length,
      dailyGoals: telemetry.dailyGoals,
    },
    assessmentsSummary: {
      recentExamsCount: 0,
      averagePercentage: 0,
      recentExams: [],
    },
  };
}

export function getGuardianStudentSummary(
  guardianUid: string,
  studentUid: string
): GuardianStudentSummary {
  const linkId = `${guardianUid}_${studentUid}`;
  const link = store.guardianLinks[linkId];
  if (!link) {
    throw new Error('GUARDIAN_LINK_NOT_FOUND');
  }
  const raw = getStudentTelemetryForGuardian(studentUid);
  return projectGuardianStudentSummary(raw, link);
}
