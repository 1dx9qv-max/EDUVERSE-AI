import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type http from 'node:http';
import type net from 'node:net';
import { Router, type Request, type Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  canUserAccessRoom,
  canUserModerateRoom,
  canUserPostInRoom,
  createSafeAlias,
  generateInviteCode,
  gradeRoomQuizSubmission,
  isInviteValid,
  moderateStudyContent,
  normalizeInviteCode,
  projectSafeRoomMember,
  sanitizeRoomId,
  sanitizeStudyRoomForMember,
} from '../src/utils/collaborationEngine.ts';
import type {
  StudyRoom,
  StudyRoomGoal,
  StudyRoomInvite,
  StudyRoomMindMap,
  StudyRoomNote,
  StudyRoomQuiz,
  StudyRoomReport,
  StudyRoomReportReason,
} from '../src/types/phase7.ts';
import type { PlatformModerationItem } from '../src/types/phase8.ts';
import { getVerifiedAuth, requireAuth } from './security.ts';
import { verifyFirebaseIdToken } from './firebaseJwt.ts';

interface PersistedStudyStore {
  rooms: Record<string, StudyRoom>;
  invites: Record<string, StudyRoomInvite>;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.resolve(DATA_DIR, 'study_rooms.json');

let store: PersistedStudyStore = loadStore();

function isDemoUid(uid: string | undefined): boolean {
  return Boolean(uid && uid.startsWith('demo-'));
}

function scrubDemoStudyData(rawRooms: Record<string, StudyRoom>, rawInvites: Record<string, StudyRoomInvite>): PersistedStudyStore {
  const cleanRooms: Record<string, StudyRoom> = {};
  for (const [roomId, room] of Object.entries(rawRooms || {})) {
    if (!room || isDemoUid(room.hostUid)) continue;
    cleanRooms[roomId] = {
      ...room,
      members: Array.isArray(room.members) ? room.members.filter((m) => !isDemoUid(m.uid)) : [],
      notes: Array.isArray(room.notes) ? room.notes.filter((n) => !isDemoUid(n.authorUid)) : [],
      goals: Array.isArray(room.goals) ? room.goals.filter((g) => !isDemoUid(g.createdByUid)) : [],
      quizzes: Array.isArray(room.quizzes) ? room.quizzes.filter((q) => !isDemoUid(q.createdByUid)) : [],
      mindMaps: Array.isArray(room.mindMaps) ? room.mindMaps.filter((m) => !isDemoUid(m.sharedByUid)) : [],
    };
  }
  const cleanInvites: Record<string, StudyRoomInvite> = {};
  for (const [code, inv] of Object.entries(rawInvites || {})) {
    if (!inv || isDemoUid(inv.createdByUid) || !cleanRooms[inv.roomId]) continue;
    cleanInvites[code] = inv;
  }
  return { rooms: cleanRooms, invites: cleanInvites };
}

function loadStore(): PersistedStudyStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedStudyStore>;
      const scrubbed = scrubDemoStudyData(
        parsed.rooms && typeof parsed.rooms === 'object' ? parsed.rooms : {},
        parsed.invites && typeof parsed.invites === 'object' ? parsed.invites : {}
      );
      return scrubbed;
    }
  } catch (err) {
    console.warn('[StudyRooms] Failed to load persisted store, initializing clean store:', err);
  }
  return { rooms: {}, invites: {} };
}

function saveStore(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('[StudyRooms] Failed to persist store:', err);
  }
}

interface RoomSubscription {
  ws: WebSocket;
  roomId: string;
  uid: string;
}

const attachedServers = new WeakSet<http.Server>();
const subscriptions = new Set<RoomSubscription>();

function getOnlineUidsForRoom(roomId: string): string[] {
  const uids = new Set<string>();
  for (const sub of subscriptions) {
    if (sub.roomId === roomId && sub.ws.readyState === WebSocket.OPEN) {
      uids.add(sub.uid);
    }
  }
  return Array.from(uids);
}

function sendWsJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoomUpdate(room: StudyRoom, eventLabel = 'room:update'): void {
  const activeSubs: RoomSubscription[] = [];
  for (const sub of subscriptions) {
    if (sub.roomId !== room.id || sub.ws.readyState !== WebSocket.OPEN) continue;
    if (!canUserAccessRoom(room, sub.uid)) {
      sendWsJson(sub.ws, {
        type: 'room:revoked',
        roomId: room.id,
        message: 'Your membership in this study room was revoked by a moderator.',
      });
      subscriptions.delete(sub);
      continue;
    }
    activeSubs.push(sub);
  }
  const onlineUids = getOnlineUidsForRoom(room.id);
  for (const sub of activeSubs) {
    sendWsJson(sub.ws, {
      type: eventLabel,
      room: sanitizeStudyRoomForMember(room, sub.uid),
      onlineUids,
    });
  }
}

function broadcastPresence(roomId: string): void {
  const onlineUids = getOnlineUidsForRoom(roomId);
  for (const sub of subscriptions) {
    if (sub.roomId === roomId && sub.ws.readyState === WebSocket.OPEN) {
      sendWsJson(sub.ws, {
        type: 'presence:update',
        roomId,
        onlineUids,
      });
    }
  }
}

export function attachStudyRoomWebSocket(server: http.Server): void {
  if (attachedServers.has(server)) return;
  attachedServers.add(server);

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    const rawUrl = request.url || '';
    const pathname = rawUrl.split('?')[0];
    if (pathname !== '/ws/study-rooms') {
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let activeSub: RoomSubscription | null = null;

    sendWsJson(ws, { type: 'connected', channel: 'study-rooms' });

    ws.on('message', async (raw) => {
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendWsJson(ws, { type: 'error', code: 'INVALID_JSON', message: 'Invalid WebSocket JSON payload.' });
        return;
      }

      if (msg.type === 'subscribe') {
        const roomId = sanitizeRoomId(String(msg.roomId || ''), 'room');
        const idToken = String(msg.idToken || '').trim();
        if (!idToken) {
          sendWsJson(ws, {
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Verified Firebase authentication token is required for Study Room updates.',
          });
          return;
        }

        let verifiedUid = '';
        try {
          const verified = await verifyFirebaseIdToken(idToken);
          verifiedUid = verified.uid;
        } catch {
          sendWsJson(ws, {
            type: 'error',
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired authentication token.',
          });
          return;
        }

        const requestedUid = msg.uid ? sanitizeRoomId(String(msg.uid), 'uid') : verifiedUid;
        if (requestedUid !== verifiedUid) {
          sendWsJson(ws, {
            type: 'error',
            code: 'FORBIDDEN',
            message: 'UID mismatch detected on WebSocket subscription.',
          });
          return;
        }

        const uid = verifiedUid;
        const room = store.rooms[roomId];

        if (!room) {
          sendWsJson(ws, { type: 'error', code: 'NOT_FOUND', message: 'Study room does not exist.' });
          return;
        }
        if (!canUserAccessRoom(room, uid)) {
          sendWsJson(ws, {
            type: 'error',
            code: 'FORBIDDEN',
            message: 'Access denied. Only invited, active members can join this private study room.',
          });
          return;
        }

        if (activeSub) {
          const prevRoomId = activeSub.roomId;
          subscriptions.delete(activeSub);
          broadcastPresence(prevRoomId);
        }

        activeSub = { ws, roomId, uid };
        subscriptions.add(activeSub);

        sendWsJson(ws, {
          type: 'room:state',
          room: sanitizeStudyRoomForMember(room, uid),
          onlineUids: getOnlineUidsForRoom(roomId),
        });
        broadcastPresence(roomId);
      } else if (msg.type === 'ping') {
        sendWsJson(ws, { type: 'pong', timestamp: new Date().toISOString() });
      }
    });

    ws.on('close', () => {
      if (activeSub) {
        const prevRoomId = activeSub.roomId;
        subscriptions.delete(activeSub);
        activeSub = null;
        broadcastPresence(prevRoomId);
      }
    });
  });
}

export function removeUserFromAllStudyRooms(uid: string): void {
  if (!uid) return;
  let dirty = false;

  for (const sub of Array.from(subscriptions)) {
    if (sub.uid === uid) {
      subscriptions.delete(sub);
      try {
        sub.ws.close();
      } catch {
        // Ignore already-closed sockets
      }
    }
  }

  for (const [roomId, room] of Object.entries(store.rooms)) {
    if (room.hostUid === uid) {
      delete store.rooms[roomId];
      for (const [code, inv] of Object.entries(store.invites)) {
        if (inv.roomId === roomId) {
          delete store.invites[code];
        }
      }
      dirty = true;
      continue;
    }

    const hadMember = room.members.some((m) => m.uid === uid);
    if (hadMember) {
      room.members = room.members.filter((m) => m.uid !== uid);
      room.updatedAt = new Date().toISOString();
      dirty = true;
      broadcastRoomUpdate(room, 'room:update');
    }
  }

  if (dirty) {
    saveStore();
  }
}

function createUniqueInvite(room: StudyRoom): StudyRoomInvite {
  let code = generateInviteCode(8);
  while (store.invites[code]) {
    code = generateInviteCode(8);
  }
  const invite: StudyRoomInvite = {
    code,
    roomId: room.id,
    roomTitle: room.title,
    subject: room.subject,
    board: room.board,
    classGrade: room.classGrade,
    createdByUid: room.hostUid,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    maxUses: room.maxMembers,
    usesCount: 0,
    revoked: false,
  };
  store.invites[code] = invite;
  return invite;
}

export function getStudyRoomsAdminSnapshot(): {
  activeRoomsCount: number;
  reports: PlatformModerationItem[];
  roomsByMemberCount: (uid: string) => number;
} {
  const rooms = Object.values(store.rooms);
  const reports: PlatformModerationItem[] = [];
  for (const room of rooms) {
    for (const r of room.reports || []) {
      reports.push({
        id: r.id,
        source: 'study-room',
        roomId: room.id,
        roomTitle: room.title,
        targetType: r.targetType,
        targetId: r.targetId,
        targetPreview: r.targetPreview,
        reporterAlias: r.reporterAlias,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt,
        resolvedByUid: r.resolvedByUid,
        resolvedAt: r.resolvedAt,
      });
    }
  }
  return {
    activeRoomsCount: rooms.length,
    reports,
    roomsByMemberCount: (uid: string) =>
      rooms.filter((rm) => canUserAccessRoom(rm, uid)).length,
  };
}

export function applyAdminModerationToStudyRoom(
  roomId: string,
  reportId: string,
  decision: 'action-taken' | 'dismissed',
  adminUid: string
): boolean {
  const room = store.rooms[roomId];
  if (!room) return false;
  const rep = room.reports.find((r) => r.id === reportId);
  if (!rep) return false;
  const now = new Date().toISOString();
  rep.status = decision;
  rep.resolvedByUid = adminUid;
  rep.resolvedAt = now;
  if (decision === 'action-taken') {
    if (rep.targetType === 'note') {
      const note = room.notes.find((n) => n.id === rep.targetId);
      if (note) {
        note.status = 'hidden';
        note.updatedAt = now;
      }
    } else if (rep.targetType === 'member') {
      const member = room.members.find((m) => m.uid === rep.targetId);
      if (member && member.uid !== room.hostUid) {
        member.status = 'muted';
        member.lastActiveAt = now;
      }
    }
  }
  room.updatedAt = now;
  saveStore();
  broadcastRoomUpdate(room, 'room:update');
  return true;
}

export function createStudyRoomsRouter(): Router {
  const router = Router();

  // Require verified Firebase JWT on all private study-room endpoints
  router.use(requireAuth);
  router.use((req, res, next) => {
    const verified = getVerifiedAuth(req);
    if (!verified) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' });
      return;
    }
    const claimedUid = sanitizeRoomId(
      String(req.query.uid || (req.body && req.body.uid) || ''),
      ''
    );
    if (claimedUid && claimedUid !== verified.uid) {
      res.status(403).json({
        error: 'UID mismatch: cannot act on behalf of another student.',
        code: 'UID_SPOOF_BLOCKED',
      });
      return;
    }
    next();
  });

  // List ONLY rooms the requesting user belongs to (never exposes a public directory)
  router.get('/mine', (req: Request, res: Response) => {
    const uid = sanitizeRoomId(String(req.query.uid || ''), '');
    if (!uid) {
      res.status(400).json({ error: 'User ID is required.', code: 'MISSING_UID' });
      return;
    }

    const memberRooms = Object.values(store.rooms)
      .filter((room) => canUserAccessRoom(room, uid))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((room) => sanitizeStudyRoomForMember(room, uid));

    res.json({ rooms: memberRooms });
  });

  // Create a new private invitation-only study room
  router.post('/create', (req: Request, res: Response) => {
    const body = req.body || {};
    const uid = sanitizeRoomId(String(body.uid || ''), '');
    const displayName = String(body.displayName || '').trim();
    const board = String(body.board || 'CBSE').trim().slice(0, 32);
    const classGrade = String(body.classGrade || 'Class 10').trim().slice(0, 30);
    const subject = String(body.subject || 'Science').trim().slice(0, 80);
    const maxMembers = Math.min(25, Math.max(2, Number(body.maxMembers) || 12));

    if (!uid) {
      res.status(400).json({ error: 'Authenticated student UID is required.', code: 'MISSING_UID' });
      return;
    }

    const titleCheck = moderateStudyContent(String(body.title || ''), 120);
    if (!titleCheck.allowed) {
      res.status(400).json({ error: titleCheck.reason, code: titleCheck.code });
      return;
    }
    const topicCheck = moderateStudyContent(String(body.topic || subject), 140);
    if (!topicCheck.allowed) {
      res.status(400).json({ error: topicCheck.reason, code: topicCheck.code });
      return;
    }

    const now = new Date().toISOString();
    const roomId = `pod_${crypto.randomBytes(5).toString('hex')}`;
    const hostAlias = createSafeAlias(displayName, uid);
    const hostMember = projectSafeRoomMember({
      uid,
      roomId,
      displayName,
      board,
      classGrade,
      role: 'host',
      status: 'active',
      joinedAt: now,
      lastActiveAt: now,
    });

    const room: StudyRoom = {
      id: roomId,
      title: titleCheck.sanitizedText,
      subject,
      topic: topicCheck.sanitizedText,
      board,
      classGrade,
      hostUid: uid,
      hostAlias,
      inviteCode: '',
      isPrivate: true,
      directMessagesDisabled: true,
      isLocked: false,
      maxMembers,
      members: [hostMember],
      notes: [],
      goals: [],
      quizzes: [],
      mindMaps: [],
      reports: [],
      createdAt: now,
      updatedAt: now,
    };

    const invite = createUniqueInvite(room);
    room.inviteCode = invite.code;
    store.rooms[room.id] = room;
    saveStore();

    res.status(201).json({
      room: sanitizeStudyRoomForMember(room, uid),
      invite,
    });
  });

  // Join a private study room via valid invite code
  router.post('/join', (req: Request, res: Response) => {
    const body = req.body || {};
    const code = normalizeInviteCode(String(body.inviteCode || ''));
    const uid = sanitizeRoomId(String(body.uid || ''), '');
    const displayName = String(body.displayName || '').trim();
    const board = String(body.board || 'CBSE').trim().slice(0, 32);
    const classGrade = String(body.classGrade || 'Class 10').trim().slice(0, 30);

    if (!uid || !code) {
      res.status(400).json({ error: 'Invite code and student ID are required.', code: 'VALIDATION_ERROR' });
      return;
    }

    const invite = store.invites[code];
    const inviteStatus = isInviteValid(invite);
    if (!inviteStatus.valid || !invite) {
      res.status(403).json({
        error: inviteStatus.reason || 'Invalid or unauthorized invite code.',
        code: 'INVALID_INVITE',
      });
      return;
    }

    const room = store.rooms[invite.roomId];
    if (!room) {
      res.status(404).json({ error: 'Study room no longer exists.', code: 'ROOM_NOT_FOUND' });
      return;
    }

    const existingMember = room.members.find((m) => m.uid === uid);
    if (existingMember?.status === 'removed') {
      res.status(403).json({
        error: 'You were removed from this study room by a moderator and cannot rejoin with this invite.',
        code: 'REMOVED_FROM_ROOM',
      });
      return;
    }

    if (!existingMember) {
      const activeCount = room.members.filter((m) => m.status !== 'removed').length;
      if (activeCount >= room.maxMembers) {
        res.status(403).json({
          error: `This private study pod is full (${room.maxMembers} members max).`,
          code: 'ROOM_FULL',
        });
        return;
      }

      const now = new Date().toISOString();
      const member = projectSafeRoomMember({
        uid,
        roomId: room.id,
        displayName,
        board,
        classGrade,
        role: 'member',
        status: 'active',
        joinedAt: now,
        lastActiveAt: now,
      });
      room.members.push(member);
      room.updatedAt = now;
      invite.usesCount += 1;
      saveStore();
      broadcastRoomUpdate(room, 'room:update');
    }

    res.json({ room: sanitizeStudyRoomForMember(room, uid) });
  });

  // Fetch room details (strict membership check)
  router.get('/:roomId', (req: Request, res: Response) => {
    const roomId = sanitizeRoomId(String(req.params.roomId || ''), '');
    const uid = sanitizeRoomId(String(req.query.uid || ''), '');
    const room = store.rooms[roomId];

    if (!room) {
      res.status(404).json({ error: 'Study room not found.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    if (!canUserAccessRoom(room, uid)) {
      res.status(403).json({
        error: 'Access denied. Only invited members of this study pod can view its contents.',
        code: 'FORBIDDEN',
      });
      return;
    }

    res.json({
      room: sanitizeStudyRoomForMember(room, uid),
      onlineUids: getOnlineUidsForRoom(room.id),
    });
  });

  // Add shared note (moderated & age-safe)
  router.post('/:roomId/notes', (req: Request, res: Response) => {
    const roomId = sanitizeRoomId(String(req.params.roomId || ''), '');
    const body = req.body || {};
    const uid = sanitizeRoomId(String(body.uid || ''), '');
    const room = store.rooms[roomId];

    if (!room) {
      res.status(404).json({ error: 'Study room not found.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    const postAccess = canUserPostInRoom(room, uid);
    if (!postAccess.allowed) {
      res.status(403).json({ error: postAccess.reason, code: 'FORBIDDEN' });
      return;
    }

    const titleCheck = moderateStudyContent(String(body.title || ''), 160);
    if (!titleCheck.allowed) {
      res.status(400).json({ error: titleCheck.reason, code: titleCheck.code });
      return;
    }
    const bodyCheck = moderateStudyContent(String(body.body || ''), 2000);
    if (!bodyCheck.allowed) {
      res.status(400).json({ error: bodyCheck.reason, code: bodyCheck.code });
      return;
    }
    const topicText = String(body.topic || room.topic).trim().slice(0, 140);
    const topicCheck = moderateStudyContent(topicText, 140);
    if (!topicCheck.allowed) {
      res.status(400).json({ error: topicCheck.reason, code: topicCheck.code });
      return;
    }

    const member = room.members.find((m) => m.uid === uid)!;
    const now = new Date().toISOString();
    const note: StudyRoomNote = {
      id: `note_${crypto.randomBytes(5).toString('hex')}`,
      roomId: room.id,
      authorUid: uid,
      authorAlias: member.alias,
      subject: room.subject,
      topic: topicCheck.sanitizedText,
      title: titleCheck.sanitizedText,
      body: bodyCheck.sanitizedText,
      pinned: false,
      status: 'visible',
      reportCount: 0,
      reportedBy: [],
      createdAt: now,
      updatedAt: now,
    };

    room.notes.unshift(note);
    room.notes = room.notes.slice(0, 60);
    member.contributionsCount += 1;
    member.lastActiveAt = now;
    room.updatedAt = now;
    saveStore();
    broadcastRoomUpdate(room, 'room:update');

    res.status(201).json({ note, room: sanitizeStudyRoomForMember(room, uid) });
  });

  // Add collaborative goal
  router.post('/:roomId/goals', (req: Request, res: Response) => {
    const roomId = sanitizeRoomId(String(req.params.roomId || ''), '');
    const body = req.body || {};
    const uid = sanitizeRoomId(String(body.uid || ''), '');
    const room = store.rooms[roomId];

    if (!room) {
      res.status(404).json({ error: 'Study room not found.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    const postAccess = canUserPostInRoom(room, uid);
    if (!postAccess.allowed) {
      res.status(403).json({ error: postAccess.reason, code: 'FORBIDDEN' });
      return;
    }

    const titleCheck = moderateStudyContent(String(body.title || ''), 160);
    if (!titleCheck.allowed) {
      res.status(400).json({ error: titleCheck.reason, code: titleCheck.code });
      return;
    }
    const unitCheck = moderateStudyContent(String(body.unit || 'topics'), 40);
    if (!unitCheck.allowed) {
      res.status(400).json({ error: unitCheck.reason, code: unitCheck.code });
      return;
    }

    const targetCount = Math.min(500, Math.max(1, Math.round(Number(body.targetCount) || 5)));
    const member = room.members.find((m) => m.uid === uid)!;
    const now = new Date().toISOString();
    const goal: StudyRoomGoal = {
      id: `goal_${crypto.randomBytes(5).toString('hex')}`,
      roomId: room.id,
      title: titleCheck.sanitizedText,
      targetCount,
      currentCount: 0,
      unit: unitCheck.sanitizedText,
      contributorUids: [uid],
      completed: false,
      createdByUid: uid,
      createdByAlias: member.alias,
      updatedAt: now,
    };

    room.goals.unshift(goal);
    room.goals = room.goals.slice(0, 30);
    member.contributionsCount += 1;
    member.lastActiveAt = now;
    room.updatedAt = now;
    saveStore();
    broadcastRoomUpdate(room, 'room:update');

    res.status(201).json({ goal, room: sanitizeStudyRoomForMember(room, uid) });
  });

  // Increment collaborative goal progress
  router.post('/:roomId/goals/:goalId/increment', (req: Request, res: Response) => {
    const roomId = sanitizeRoomId(String(req.params.roomId || ''), '');
    const goalId = sanitizeRoomId(String(req.params.goalId || ''), '');
    const uid = sanitizeRoomId(String((req.body || {}).uid || ''), '');
    const room = store.rooms[roomId];

    if (!room) {
      res.status(404).json({ error: 'Study room not found.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    const postAccess = canUserPostInRoom(room, uid);
    if (!postAccess.allowed) {
      res.status(403).json({ error: postAccess.reason, code: 'FORBIDDEN' });
      return;
    }

    const goal = room.goals.find((g) => g.id === goalId);
    if (!goal) {
      res.status(404).json({ error: 'Goal not found.', code: 'GOAL_NOT_FOUND' });
      return;
    }

    const now = new Date().toISOString();
    goal.currentCount = Math.min(goal.targetCount, goal.currentCount + 1);
    goal.completed = goal.currentCount >= goal.targetCount;
    if (!goal.contributorUids.includes(uid)) {
      goal.contributorUids.push(uid);
    }
    goal.updatedAt = now;

    const member = room.members.find((m) => m.uid === uid)!;
    member.contributionsCount += 1;
    member.lastActiveAt = now;
    room.updatedAt = now;
    saveStore();
    broadcastRoomUpdate(room, 'room:update');

    res.json({ goal, room: sanitizeStudyRoomForMember(room, uid) });
  });

  // Create group quiz
  router.post('/:roomId/quizzes', (req: Request, res: Response) => {
    const roomId = sanitizeRoomId(String(req.params.roomId || ''), '');
    const body = req.body || {};
    const uid = sanitizeRoomId(String(body.uid || ''), '');
    const room = store.rooms[roomId];

    if (!room) {
      res.status(404).json({ error: 'Study room not found.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    const postAccess = canUserPostInRoom(room, uid);
    if (!postAccess.allowed) {
      res.status(403).json({ error: postAccess.reason, code: 'FORBIDDEN' });
      return;
    }

    const titleCheck = moderateStudyContent(String(body.title || ''), 160);
    if (!titleCheck.allowed) {
      res.status(400).json({ error: titleCheck.reason, code: titleCheck.code });
      return;
    }
    const rawQuestions = Array.isArray(body.questions) ? body.questions.slice(0, 10) : [];
    if (rawQuestions.length === 0) {
      res.status(400).json({ error: 'At least 1 question is required.', code: 'EMPTY_QUESTIONS' });
      return;
    }

    const validatedQuestions = [];
    for (let i = 0; i < rawQuestions.length; i++) {
      const q = rawQuestions[i] || {};
      const pCheck = moderateStudyContent(String(q.prompt || ''), 400);
      if (!pCheck.allowed) {
        res.status(400).json({ error: pCheck.reason, code: pCheck.code });
        return;
      }
      const optsRaw = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
      if (optsRaw.length < 2) {
        res.status(400).json({ error: 'Each quiz question needs at least 2 options.', code: 'VALIDATION_ERROR' });
        return;
      }
      const cleanOpts: string[] = [];
      for (const opt of optsRaw) {
        const oCheck = moderateStudyContent(String(opt || ''), 180);
        if (!oCheck.allowed) {
          res.status(400).json({ error: oCheck.reason, code: oCheck.code });
          return;
        }
        cleanOpts.push(oCheck.sanitizedText);
      }
      const correctIndex =
        typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex < cleanOpts.length
          ? Math.floor(q.correctIndex)
          : 0;
      const expCheck = q.explanation
        ? moderateStudyContent(String(q.explanation), 350)
        : { allowed: true, sanitizedText: 'Concept review item.' };
      validatedQuestions.push({
        id: `rq_${Date.now()}_${i}`,
        prompt: pCheck.sanitizedText,
        options: cleanOpts,
        correctIndex,
        explanation: expCheck.allowed ? expCheck.sanitizedText : 'Concept review item.',
      });
    }

    const member = room.members.find((m) => m.uid === uid)!;
    const now = new Date().toISOString();
    const quiz: StudyRoomQuiz = {
      id: `quiz_${crypto.randomBytes(5).toString('hex')}`,
      roomId: room.id,
      title: titleCheck.sanitizedText,
      subject: String(body.subject || room.subject).slice(0, 80),
      topic: String(body.topic || room.topic).slice(0, 140),
      createdByUid: uid,
      createdByAlias: member.alias,
      questions: validatedQuestions,
      submissions: [],
      status: 'active',
      createdAt: now,
    };

    room.quizzes.unshift(quiz);
    room.quizzes = room.quizzes.slice(0, 20);
    member.contributionsCount += 1;
    member.lastActiveAt = now;
    room.updatedAt = now;
    saveStore();
    broadcastRoomUpdate(room, 'room:update');

    res.status(201).json({ quiz, room: sanitizeStudyRoomForMember(room, uid) });
  });

  // Submit group quiz answers
  router.post('/:roomId/quizzes/:quizId/submit', (req: Request, res: Response) => {
    const roomId = sanitizeRoomId(String(req.params.roomId || ''), '');
    const quizId = sanitizeRoomId(String(req.params.quizId || ''), '');
    const body = req.body || {};
    const uid = sanitizeRoomId(String(body.uid || ''), '');
    const answers = Array.isArray(body.answers) ? body.answers.map(Number) : [];
    const room = store.rooms[roomId];

    if (!room) {
      res.status(404).json({ error: 'Study room not found.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    if (!canUserAccessRoom(room, uid)) {
      res.status(403).json({ error: 'Only active room members can participate in this quiz.', code: 'FORBIDDEN' });
      return;
    }

    const quiz = room.quizzes.find((q) => q.id === quizId);
    if (!quiz) {
      res.status(404).json({ error: 'Quiz not found.', code: 'QUIZ_NOT_FOUND' });
      return;
    }

    const member = room.members.find((m) => m.uid === uid);
    if (member?.status === 'muted') {
      res.status(403).json({
        error: 'Your participation is currently muted by the room moderator.',
        code: 'FORBIDDEN',
      });
      return;
    }
    const participantAlias = member?.alias || room.hostAlias;
    const graded = gradeRoomQuizSubmission(quiz, answers);
    const now = new Date().toISOString();
    const submission = {
      uid,
      alias: participantAlias,
      answers,
      score: graded.score,
      total: graded.total,
      submittedAt: now,
    };

    const prevSub = quiz.submissions.find((s) => s.uid === uid);
    if (prevSub) {
      if (member) {
        member.quizPoints = Math.max(0, member.quizPoints - prevSub.score * 10 + graded.score * 10);
      }
      quiz.submissions = quiz.submissions.map((s) => (s.uid === uid ? submission : s));
    } else {
      if (member) {
        member.quizPoints += graded.score * 10;
      }
      quiz.submissions.push(submission);
    }

    if (member) member.lastActiveAt = now;
    room.updatedAt = now;
    saveStore();
    broadcastRoomUpdate(room, 'room:update');

    res.json({ submission, graded, room: sanitizeStudyRoomForMember(room, uid) });
  });

  // Share a mind map inside the study room
  router.post('/:roomId/mindmaps', (req: Request, res: Response) => {
    const roomId = sanitizeRoomId(String(req.params.roomId || ''), '');
    const body = req.body || {};
    const uid = sanitizeRoomId(String(body.uid || ''), '');
    const room = store.rooms[roomId];

    if (!room) {
      res.status(404).json({ error: 'Study room not found.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    const postAccess = canUserPostInRoom(room, uid);
    if (!postAccess.allowed) {
      res.status(403).json({ error: postAccess.reason, code: 'FORBIDDEN' });
      return;
    }

    const titleCheck = moderateStudyContent(String(body.title || ''), 160);
    if (!titleCheck.allowed) {
      res.status(400).json({ error: titleCheck.reason, code: titleCheck.code });
      return;
    }
    const rawNodes = Array.isArray(body.nodes) ? body.nodes.slice(0, 40) : [];
    if (rawNodes.length === 0) {
      res.status(400).json({ error: 'Mind map must contain at least 1 concept node.', code: 'EMPTY_MINDMAP' });
      return;
    }

    const cleanNodes = [];
    for (const n of rawNodes) {
      const labelCheck = moderateStudyContent(String(n?.label || ''), 120);
      if (!labelCheck.allowed) {
        res.status(400).json({ error: labelCheck.reason, code: labelCheck.code });
        return;
      }
      cleanNodes.push({
        id: String(n.id || `n_${cleanNodes.length}`),
        label: labelCheck.sanitizedText,
        parentId: n.parentId ? String(n.parentId) : null,
        summary: n.summary ? String(n.summary).slice(0, 220) : undefined,
      });
    }

    const member = room.members.find((m) => m.uid === uid)!;
    const now = new Date().toISOString();
    const sharedMap: StudyRoomMindMap = {
      id: `rmap_${crypto.randomBytes(5).toString('hex')}`,
      roomId: room.id,
      sourceMindMapId: body.sourceMindMapId ? String(body.sourceMindMapId).slice(0, 128) : undefined,
      title: titleCheck.sanitizedText,
      subject: String(body.subject || room.subject).slice(0, 80),
      topic: String(body.topic || room.topic).slice(0, 140),
      sharedByUid: uid,
      sharedByAlias: member.alias,
      nodes: cleanNodes,
      endorsements: [uid],
      createdAt: now,
    };

    room.mindMaps.unshift(sharedMap);
    room.mindMaps = room.mindMaps.slice(0, 20);
    member.contributionsCount += 1;
    member.lastActiveAt = now;
    room.updatedAt = now;
    saveStore();
    broadcastRoomUpdate(room, 'room:update');

    res.status(201).json({ mindMap: sharedMap, room: sanitizeStudyRoomForMember(room, uid) });
  });

  // Endorse a shared mind map
  router.post('/:roomId/mindmaps/:mapId/endorse', (req: Request, res: Response) => {
    const roomId = sanitizeRoomId(String(req.params.roomId || ''), '');
    const mapId = sanitizeRoomId(String(req.params.mapId || ''), '');
    const uid = sanitizeRoomId(String((req.body || {}).uid || ''), '');
    const room = store.rooms[roomId];

    if (!room) {
      res.status(404).json({ error: 'Study room not found.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    if (!canUserAccessRoom(room, uid)) {
      res.status(403).json({ error: 'Only room members can endorse shared mind maps.', code: 'FORBIDDEN' });
      return;
    }

    const map = room.mindMaps.find((m) => m.id === mapId);
    if (!map) {
      res.status(404).json({ error: 'Shared mind map not found.', code: 'NOT_FOUND' });
      return;
    }

    if (map.endorsements.includes(uid)) {
      map.endorsements = map.endorsements.filter((id) => id !== uid);
    } else {
      map.endorsements.push(uid);
    }
    room.updatedAt = new Date().toISOString();
    saveStore();
    broadcastRoomUpdate(room, 'room:update');

    res.json({ room: sanitizeStudyRoomForMember(room, uid) });
  });

  // Submit peer report for safety / moderation
  router.post('/:roomId/reports', (req: Request, res: Response) => {
    const roomId = sanitizeRoomId(String(req.params.roomId || ''), '');
    const body = req.body || {};
    const uid = sanitizeRoomId(String(body.uid || ''), '');
    const room = store.rooms[roomId];

    if (!room) {
      res.status(404).json({ error: 'Study room not found.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    if (!canUserAccessRoom(room, uid)) {
      res.status(403).json({ error: 'Only active members can file safety reports.', code: 'FORBIDDEN' });
      return;
    }

    const targetType = ['note', 'goal', 'quiz', 'member'].includes(body.targetType)
      ? body.targetType
      : 'note';
    const targetId = sanitizeRoomId(String(body.targetId || ''), 'target');
    const reason: StudyRoomReportReason = [
      'spam-or-offtopic',
      'inappropriate-language',
      'personal-info-shared',
      'external-link',
      'harassment',
    ].includes(body.reason)
      ? body.reason
      : 'spam-or-offtopic';

    const member = room.members.find((m) => m.uid === uid);
    const now = new Date().toISOString();
    const report: StudyRoomReport = {
      id: `rep_${crypto.randomBytes(5).toString('hex')}`,
      roomId: room.id,
      targetType,
      targetId,
      targetPreview: String(body.targetPreview || '').slice(0, 200),
      reporterUid: uid,
      reporterAlias: member?.alias || room.hostAlias,
      reason,
      details: String(body.details || '').slice(0, 500),
      status: 'open',
      createdAt: now,
    };

    room.reports.unshift(report);
    room.reports = room.reports.slice(0, 50);

    if (targetType === 'note') {
      const note = room.notes.find((n) => n.id === targetId);
      if (note && !note.reportedBy.includes(uid)) {
        note.reportedBy.push(uid);
        note.reportCount = note.reportedBy.length;
        note.status = note.reportCount >= 2 ? 'hidden' : 'flagged';
        note.updatedAt = now;
      }
    }

    room.updatedAt = now;
    saveStore();
    broadcastRoomUpdate(room, 'room:update');

    res.status(201).json({ report, room: sanitizeStudyRoomForMember(room, uid) });
  });

  // Moderator / Host actions
  router.post('/:roomId/moderate', (req: Request, res: Response) => {
    const roomId = sanitizeRoomId(String(req.params.roomId || ''), '');
    const body = req.body || {};
    const uid = sanitizeRoomId(String(body.uid || ''), '');
    const action = String(body.action || '');
    const targetId = String(body.targetId || '');
    const room = store.rooms[roomId];

    if (!room) {
      res.status(404).json({ error: 'Study room not found.', code: 'ROOM_NOT_FOUND' });
      return;
    }
    if (!canUserModerateRoom(room, uid)) {
      res.status(403).json({
        error: 'Moderator or host privileges required to perform moderation actions.',
        code: 'MODERATOR_REQUIRED',
      });
      return;
    }

    const now = new Date().toISOString();

    if (action === 'hide-note' || action === 'restore-note' || action === 'toggle-pin-note') {
      const note = room.notes.find((n) => n.id === targetId);
      if (note) {
        if (action === 'hide-note') note.status = 'hidden';
        if (action === 'restore-note') note.status = 'visible';
        if (action === 'toggle-pin-note') note.pinned = !note.pinned;
        note.updatedAt = now;
      }
    } else if (action === 'resolve-report' || action === 'dismiss-report') {
      const rep = room.reports.find((r) => r.id === targetId);
      if (rep) {
        rep.status = action === 'resolve-report' ? 'action-taken' : 'dismissed';
        rep.resolvedByUid = uid;
        rep.resolvedAt = now;
        if (action === 'resolve-report' && rep.targetType === 'note') {
          const note = room.notes.find((n) => n.id === rep.targetId);
          if (note) {
            note.status = 'hidden';
            note.updatedAt = now;
          }
        } else if (action === 'resolve-report' && rep.targetType === 'member') {
          const targetMember = room.members.find((m) => m.uid === rep.targetId);
          if (targetMember && targetMember.uid !== room.hostUid && targetMember.status === 'active') {
            targetMember.status = 'muted';
            targetMember.lastActiveAt = now;
          }
        }
      }
    } else if (action === 'mute-member' || action === 'unmute-member' || action === 'remove-member') {
      const targetMember = room.members.find((m) => m.uid === targetId);
      if (targetMember && targetMember.uid !== room.hostUid) {
        if (action === 'mute-member') targetMember.status = 'muted';
        if (action === 'unmute-member') targetMember.status = 'active';
        if (action === 'remove-member') targetMember.status = 'removed';
        targetMember.lastActiveAt = now;
      }
    } else if (action === 'toggle-lock') {
      room.isLocked = !room.isLocked;
    } else if (action === 'rotate-invite') {
      if (room.inviteCode && store.invites[room.inviteCode]) {
        store.invites[room.inviteCode].revoked = true;
      }
      const nextInvite = createUniqueInvite(room);
      room.inviteCode = nextInvite.code;
    } else {
      res.status(400).json({ error: 'Unknown moderation action.', code: 'INVALID_ACTION' });
      return;
    }

    room.updatedAt = now;
    saveStore();
    broadcastRoomUpdate(room, 'room:update');

    res.json({ room: sanitizeStudyRoomForMember(room, uid) });
  });

  return router;
}
