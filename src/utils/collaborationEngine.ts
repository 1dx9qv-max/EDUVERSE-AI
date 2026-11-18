import type {
  GroupProgressSummary,
  StudyRoom,
  StudyRoomGoal,
  StudyRoomInvite,
  StudyRoomMember,
  StudyRoomMemberStatus,
  StudyRoomNote,
  StudyRoomQuiz,
  StudyRoomQuizQuestion,
  StudyRoomRole,
} from '../types/phase7.ts';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const BLOCKED_SAFETY_TERMS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'chutiya',
  'madarchod',
  'behenchod',
  'bhosdike',
  'harami',
  'kamina',
  'idiot',
  'stupid',
  'loser',
  'kill yourself',
  'kys',
  'die ',
  'suicide',
  'nude',
  'porn',
  'sex ',
  'whatsapp me',
  'call me',
  'dm me on',
  'snapchat',
  'telegram',
];

export interface ContentModerationResult {
  allowed: boolean;
  reason?: string;
  code?: 'EMPTY_CONTENT' | 'EXTERNAL_LINK_BLOCKED' | 'PII_BLOCKED' | 'UNSAFE_LANGUAGE';
  sanitizedText: string;
}

export function sanitizeRoomId(raw: string, prefix = 'room'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  if (cleaned) return cleaned;
  return prefix ? `${prefix}_${Date.now()}` : '';
}

export function createSafeAlias(displayName: string, uid: string): string {
  const raw = String(displayName || '').trim();
  // Never expose an email address as an alias
  const withoutEmail = raw.includes('@') ? raw.split('@')[0] : raw;
  const cleaned = withoutEmail.replace(/[^a-zA-Z0-9 ._-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return `Scholar ${String(uid || '0000').slice(-4).toUpperCase()}`;
  }
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 28);
  }
  const first = parts[0].slice(0, 20);
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first} ${lastInitial}.`.slice(0, 40);
}

export function projectSafeRoomMember(params: {
  uid: string;
  roomId: string;
  displayName: string;
  board: string;
  classGrade: string;
  role: StudyRoomRole;
  status?: StudyRoomMemberStatus;
  contributionsCount?: number;
  quizPoints?: number;
  joinedAt?: string;
  lastActiveAt?: string;
}): StudyRoomMember {
  const now = new Date().toISOString();
  const alias = createSafeAlias(params.displayName, params.uid);
  return {
    uid: sanitizeRoomId(params.uid, 'user'),
    roomId: sanitizeRoomId(params.roomId, 'room'),
    alias,
    avatarInitial: (alias.charAt(0) || 'S').toUpperCase(),
    role: params.role,
    board: String(params.board || 'CBSE').slice(0, 32),
    classGrade: String(params.classGrade || 'Class 10').slice(0, 30),
    status: params.status || 'active',
    contributionsCount: Math.max(0, Math.round(params.contributionsCount || 0)),
    quizPoints: Math.max(0, Math.round(params.quizPoints || 0)),
    joinedAt: params.joinedAt || now,
    lastActiveAt: params.lastActiveAt || now,
  };
}

export function generateInviteCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * INVITE_ALPHABET.length);
    code += INVITE_ALPHABET[idx];
  }
  return code;
}

export function normalizeInviteCode(code: string): string {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 24);
}

export function isInviteValid(invite: StudyRoomInvite | null | undefined, nowMs = Date.now()): {
  valid: boolean;
  reason?: string;
} {
  if (!invite) {
    return { valid: false, reason: 'Invite code not found.' };
  }
  if (invite.revoked) {
    return { valid: false, reason: 'This invite code has been revoked by the room host.' };
  }
  const expiresMs = Date.parse(invite.expiresAt);
  if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    return { valid: false, reason: 'This invite code has expired. Ask the host for a fresh code.' };
  }
  if (invite.usesCount >= invite.maxUses) {
    return { valid: false, reason: 'This invite code has reached its maximum member uses.' };
  }
  return { valid: true };
}

export function moderateStudyContent(rawText: string, maxLength = 1800): ContentModerationResult {
  const trimmed = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!trimmed) {
    return {
      allowed: false,
      code: 'EMPTY_CONTENT',
      reason: 'Content cannot be empty.',
      sanitizedText: '',
    };
  }

  const bounded = trimmed.slice(0, maxLength);
  const lower = bounded.toLowerCase();

  // 1. Block external URLs and messaging invites (child safety guardrail)
  const urlPattern = /(https?:\/\/|www\.|t\.me\/|wa\.me\/|discord\.gg\/|\b[a-z0-9-]{2,}\.(com|in|org|net|io|co|me|xyz|ly)\b)/i;
  if (urlPattern.test(bounded)) {
    return {
      allowed: false,
      code: 'EXTERNAL_LINK_BLOCKED',
      reason: 'External links and social/messaging URLs are blocked in student study rooms for safety.',
      sanitizedText: bounded,
    };
  }

  // 2. Block email addresses
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
  if (emailPattern.test(bounded)) {
    return {
      allowed: false,
      code: 'PII_BLOCKED',
      reason: 'Sharing email addresses in study rooms is blocked to protect student privacy.',
      sanitizedText: bounded,
    };
  }

  // 3. Block 10-digit phone numbers (Indian mobile or formatted phone)
  const phonePattern = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/;
  if (phonePattern.test(bounded)) {
    return {
      allowed: false,
      code: 'PII_BLOCKED',
      reason: 'Sharing phone numbers or contact details in study rooms is blocked to protect student privacy.',
      sanitizedText: bounded,
    };
  }

  // 4. Block abusive, bullying, or unsafe terms
  for (const term of BLOCKED_SAFETY_TERMS) {
    if (lower.includes(term)) {
      return {
        allowed: false,
        code: 'UNSAFE_LANGUAGE',
        reason: 'Please keep study room messages respectful, age-appropriate, and academic.',
        sanitizedText: bounded,
      };
    }
  }

  return {
    allowed: true,
    sanitizedText: bounded,
  };
}

export function getRoomMember(room: StudyRoom, uid: string): StudyRoomMember | undefined {
  return room.members.find((m) => m.uid === uid);
}

export function canUserAccessRoom(room: StudyRoom, uid: string): boolean {
  if (!uid) return false;
  if (room.hostUid === uid) return true;
  const member = getRoomMember(room, uid);
  return Boolean(member && member.status !== 'removed');
}

export function canUserModerateRoom(room: StudyRoom, uid: string): boolean {
  if (!uid) return false;
  if (room.hostUid === uid) return true;
  const member = getRoomMember(room, uid);
  return Boolean(
    member &&
      member.status === 'active' &&
      (member.role === 'host' || member.role === 'moderator')
  );
}

export function canUserPostInRoom(room: StudyRoom, uid: string): {
  allowed: boolean;
  reason?: string;
} {
  if (!uid) {
    return { allowed: false, reason: 'Authentication required.' };
  }
  const member = getRoomMember(room, uid);
  if (!member || member.status === 'removed') {
    return { allowed: false, reason: 'Only verified room members can contribute here.' };
  }
  if (member.status === 'muted') {
    return { allowed: false, reason: 'Your posting permission is currently muted by the room moderator.' };
  }
  if (room.isLocked && !canUserModerateRoom(room, uid)) {
    return { allowed: false, reason: 'This room is temporarily locked by the host (read-only mode).' };
  }
  return { allowed: true };
}

export function gradeRoomQuizSubmission(
  quiz: StudyRoomQuiz,
  answers: number[]
): {
  score: number;
  total: number;
  percentage: number;
  results: Array<{ questionId: string; isCorrect: boolean; selectedIndex: number; correctIndex: number }>;
} {
  const total = quiz.questions.length;
  let score = 0;
  const results = quiz.questions.map((q: StudyRoomQuizQuestion, idx: number) => {
    const selectedIndex = typeof answers[idx] === 'number' ? answers[idx] : -1;
    const isCorrect = selectedIndex === q.correctIndex;
    if (isCorrect) score += 1;
    return {
      questionId: q.id,
      isCorrect,
      selectedIndex,
      correctIndex: q.correctIndex,
    };
  });
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
  return { score, total, percentage, results };
}

export function computeGroupProgress(room: StudyRoom): GroupProgressSummary {
  const visibleNotes = room.notes.filter((n: StudyRoomNote) => n.status !== 'hidden');
  const totalGoals = room.goals.length;
  const completedGoals = room.goals.filter((g: StudyRoomGoal) => g.completed || g.currentCount >= g.targetCount).length;

  let goalCompletionPercent = 0;
  if (totalGoals > 0) {
    const ratios = room.goals.map((g: StudyRoomGoal) =>
      Math.min(1, g.targetCount > 0 ? g.currentCount / g.targetCount : 0)
    );
    goalCompletionPercent = Math.round(
      (ratios.reduce((sum, r) => sum + r, 0) / totalGoals) * 100
    );
  }

  let totalSubmissions = 0;
  let accuracySum = 0;
  for (const quiz of room.quizzes) {
    for (const sub of quiz.submissions) {
      totalSubmissions += 1;
      accuracySum += sub.total > 0 ? (sub.score / sub.total) * 100 : 0;
    }
  }

  const contributorUids = new Set<string>();
  for (const n of visibleNotes) contributorUids.add(n.authorUid);
  for (const g of room.goals) {
    contributorUids.add(g.createdByUid);
    for (const uid of g.contributorUids) contributorUids.add(uid);
  }
  for (const q of room.quizzes) {
    contributorUids.add(q.createdByUid);
    for (const s of q.submissions) contributorUids.add(s.uid);
  }
  for (const m of room.mindMaps) contributorUids.add(m.sharedByUid);

  const openReportsCount = room.reports.filter((r) => r.status === 'open').length;

  return {
    totalNotesVisible: visibleNotes.length,
    totalGoals,
    completedGoals,
    goalCompletionPercent,
    totalQuizzes: room.quizzes.length,
    totalQuizSubmissions: totalSubmissions,
    averageQuizAccuracy: totalSubmissions > 0 ? Math.round(accuracySum / totalSubmissions) : 0,
    sharedMindMapsCount: room.mindMaps.length,
    activeContributorsCount: contributorUids.size,
    openReportsCount,
  };
}

export function sanitizeStudyRoomForMember(room: StudyRoom, viewerUid: string): StudyRoom {
  const isMod = canUserModerateRoom(room, viewerUid);
  return {
    ...room,
    isPrivate: true,
    directMessagesDisabled: true,
    inviteCode: isMod ? room.inviteCode : 'INVITE-ONLY',
    members: room.members
      .filter((m) => m.status !== 'removed' || isMod)
      .map((m) => ({
        uid: m.uid,
        roomId: m.roomId,
        alias: m.alias,
        avatarInitial: m.avatarInitial,
        role: m.role,
        board: m.board,
        classGrade: m.classGrade,
        status: m.status,
        contributionsCount: m.contributionsCount,
        quizPoints: m.quizPoints,
        joinedAt: m.joinedAt,
        lastActiveAt: m.lastActiveAt,
      })),
    notes: isMod ? room.notes : room.notes.filter((n) => n.status !== 'hidden'),
    reports: isMod
      ? room.reports
      : room.reports.filter((r) => r.reporterUid === viewerUid),
  };
}
