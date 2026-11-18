import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUserAccessRoom,
  canUserModerateRoom,
  canUserPostInRoom,
  computeGroupProgress,
  createSafeAlias,
  generateInviteCode,
  gradeRoomQuizSubmission,
  isInviteValid,
  moderateStudyContent,
  projectSafeRoomMember,
  sanitizeStudyRoomForMember,
} from './collaborationEngine';
import { StudyRoom, StudyRoomInvite } from '../types/phase7';

function buildFixtureRoom(): StudyRoom {
  return {
    id: 'room_101',
    title: 'Class 10 Light & Optics Circle',
    subject: 'Science',
    topic: 'Spherical Mirrors & Lens Formula',
    board: 'CBSE',
    classGrade: 'Class 10',
    hostUid: 'uid_host',
    hostAlias: 'Aarav S.',
    inviteCode: 'OPTICS99',
    isPrivate: true,
    directMessagesDisabled: true,
    isLocked: false,
    maxMembers: 10,
    members: [
      projectSafeRoomMember({
        uid: 'uid_host',
        roomId: 'room_101',
        displayName: 'Aarav Sharma',
        board: 'CBSE',
        classGrade: 'Class 10',
        role: 'host',
      }),
      projectSafeRoomMember({
        uid: 'uid_peer',
        roomId: 'room_101',
        displayName: 'Meera Nair',
        board: 'CBSE',
        classGrade: 'Class 10',
        role: 'member',
      }),
      projectSafeRoomMember({
        uid: 'uid_muted',
        roomId: 'room_101',
        displayName: 'Rohan Verma',
        board: 'CBSE',
        classGrade: 'Class 10',
        role: 'member',
        status: 'muted',
      }),
      projectSafeRoomMember({
        uid: 'uid_removed',
        roomId: 'room_101',
        displayName: 'Removed User',
        board: 'CBSE',
        classGrade: 'Class 10',
        role: 'member',
        status: 'removed',
      }),
    ],
    notes: [
      {
        id: 'note_1',
        roomId: 'room_101',
        authorUid: 'uid_host',
        authorAlias: 'Aarav S.',
        subject: 'Science',
        topic: 'Lens Formula',
        title: 'Sign convention reminder',
        body: 'Always measure distances from the optical center; focal length of convex lens is positive.',
        pinned: true,
        status: 'visible',
        reportCount: 0,
        reportedBy: [],
        createdAt: '2026-11-14T10:00:00.000Z',
        updatedAt: '2026-11-14T10:00:00.000Z',
      },
      {
        id: 'note_hidden',
        roomId: 'room_101',
        authorUid: 'uid_muted',
        authorAlias: 'Rohan V.',
        subject: 'Science',
        topic: 'Off-topic',
        title: 'Hidden spam',
        body: 'Moderated hidden message',
        pinned: false,
        status: 'hidden',
        reportCount: 2,
        reportedBy: ['uid_peer', 'uid_host'],
        createdAt: '2026-11-14T10:05:00.000Z',
        updatedAt: '2026-11-14T10:06:00.000Z',
      },
    ],
    goals: [
      {
        id: 'goal_1',
        roomId: 'room_101',
        title: 'Solve 10 Ray Diagram derivations',
        targetCount: 10,
        currentCount: 5,
        unit: 'problems',
        contributorUids: ['uid_host', 'uid_peer'],
        completed: false,
        createdByUid: 'uid_host',
        createdByAlias: 'Aarav S.',
        updatedAt: '2026-11-14T10:10:00.000Z',
      },
    ],
    quizzes: [
      {
        id: 'quiz_1',
        roomId: 'room_101',
        title: 'Mirror Formula Quick Check',
        subject: 'Science',
        topic: 'Optics',
        createdByUid: 'uid_host',
        createdByAlias: 'Aarav S.',
        questions: [
          {
            id: 'q1',
            prompt: 'Power of a convex lens with f = +0.5 m is:',
            options: ['+2 D', '-2 D', '+0.5 D', '-0.5 D'],
            correctIndex: 0,
            explanation: 'P = 1/f = 1/0.5 = +2 D.',
          },
          {
            id: 'q2',
            prompt: 'Which mirror always forms a virtual, erect and diminished image?',
            options: ['Concave mirror', 'Convex mirror', 'Plane mirror', 'Parabolic mirror'],
            correctIndex: 1,
            explanation: 'Convex mirrors always diverge rays and produce diminished virtual images.',
          },
        ],
        submissions: [
          {
            uid: 'uid_peer',
            alias: 'Meera N.',
            answers: [0, 1],
            score: 2,
            total: 2,
            submittedAt: '2026-11-14T10:20:00.000Z',
          },
        ],
        status: 'active',
        createdAt: '2026-11-14T10:15:00.000Z',
      },
    ],
    mindMaps: [],
    reports: [
      {
        id: 'rep_1',
        roomId: 'room_101',
        targetType: 'note',
        targetId: 'note_hidden',
        targetPreview: 'Hidden spam',
        reporterUid: 'uid_peer',
        reporterAlias: 'Meera N.',
        reason: 'spam-or-offtopic',
        details: 'Off topic content',
        status: 'open',
        createdAt: '2026-11-14T10:06:00.000Z',
      },
    ],
    createdAt: '2026-11-14T09:50:00.000Z',
    updatedAt: '2026-11-14T10:20:00.000Z',
  };
}

test('createSafeAlias never exposes emails and strips full surname to initial', () => {
  assert.equal(createSafeAlias('Aarav Sharma', 'u1'), 'Aarav S.');
  assert.equal(createSafeAlias('student.secret@gmail.com', 'u2'), 'student.secret');
  assert.equal(createSafeAlias('', 'abc123xyz'), 'Scholar 3XYZ');
});

test('projectSafeRoomMember excludes private PII keys', () => {
  const member = projectSafeRoomMember({
    uid: 'uid_1',
    roomId: 'room_1',
    displayName: 'Ananya Iyer',
    board: 'ISC',
    classGrade: 'Class 12',
    role: 'member',
  }) as unknown as Record<string, unknown>;

  assert.equal(member.alias, 'Ananya I.');
  assert.equal('email' in member, false);
  assert.equal('phone' in member, false);
  assert.equal('photoURL' in member, false);
  assert.equal('state' in member, false);
});

test('moderateStudyContent blocks external links, emails, phone numbers, and profanity', () => {
  assert.equal(moderateStudyContent('Join https://t.me/fakegroup now').allowed, false);
  assert.equal(moderateStudyContent('Contact me at test.user@gmail.com').allowed, false);
  assert.equal(moderateStudyContent('Call 9876543210 for notes').allowed, false);
  assert.equal(moderateStudyContent('You are an idiot').allowed, false);
  assert.equal(
    moderateStudyContent('Remember: P = 1 / f in metres gives lens power in dioptres.').allowed,
    true
  );
});

test('invite validation checks revocation, expiry, and usage limits', () => {
  const code = generateInviteCode(8);
  assert.equal(code.length, 8);

  const validInvite: StudyRoomInvite = {
    code,
    roomId: 'room_101',
    roomTitle: 'Optics Circle',
    subject: 'Science',
    board: 'CBSE',
    classGrade: 'Class 10',
    createdByUid: 'uid_host',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    maxUses: 5,
    usesCount: 1,
    revoked: false,
  };
  assert.equal(isInviteValid(validInvite).valid, true);
  assert.equal(isInviteValid({ ...validInvite, revoked: true }).valid, false);
  assert.equal(isInviteValid({ ...validInvite, usesCount: 5 }).valid, false);
  assert.equal(
    isInviteValid({ ...validInvite, expiresAt: new Date(Date.now() - 1000).toISOString() }).valid,
    false
  );
});

test('room access, posting, moderation, and sanitization isolate non-members, muted, and removed peers', () => {
  const room = buildFixtureRoom();

  assert.equal(canUserAccessRoom(room, 'uid_host'), true);
  assert.equal(canUserAccessRoom(room, 'uid_peer'), true);
  assert.equal(canUserAccessRoom(room, 'uid_removed'), false);
  assert.equal(canUserAccessRoom(room, 'uid_stranger'), false);

  assert.equal(canUserModerateRoom(room, 'uid_host'), true);
  assert.equal(canUserModerateRoom(room, 'uid_peer'), false);

  assert.equal(canUserPostInRoom(room, 'uid_peer').allowed, true);
  assert.equal(canUserPostInRoom(room, 'uid_muted').allowed, false);
  assert.equal(canUserPostInRoom(room, 'uid_stranger').allowed, false);

  // Regular member view hides invite code, hidden notes, and removed members
  const peerView = sanitizeStudyRoomForMember(room, 'uid_peer');
  assert.equal(peerView.inviteCode, 'INVITE-ONLY');
  assert.equal(peerView.notes.length, 1);
  assert.equal(peerView.members.some((m) => m.uid === 'uid_removed'), false);

  // Host view retains invite code and moderation visibility
  const hostView = sanitizeStudyRoomForMember(room, 'uid_host');
  assert.equal(hostView.inviteCode, 'OPTICS99');
  assert.equal(hostView.notes.length, 2);
});

test('group quiz grading and progress calculation compute accurate collaborative metrics', () => {
  const room = buildFixtureRoom();
  const graded = gradeRoomQuizSubmission(room.quizzes[0], [0, 0]);
  assert.equal(graded.score, 1);
  assert.equal(graded.total, 2);
  assert.equal(graded.percentage, 50);

  const progress = computeGroupProgress(room);
  assert.equal(progress.totalNotesVisible, 1);
  assert.equal(progress.goalCompletionPercent, 50);
  assert.equal(progress.averageQuizAccuracy, 100);
  assert.equal(progress.activeContributorsCount, 2);
  assert.equal(progress.openReportsCount, 1);
});
