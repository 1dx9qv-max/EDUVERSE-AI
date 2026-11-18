# EDUVERSE AI - Security Specification (Phases 1–7)

## 1. Data Invariants & Authorization Policies

1. **Identity Binding**: A user document at `/users/{userId}` can only be created and updated if `request.auth.uid == userId`.
2. **Role Immutability & Privileged Roles**:
   - Users cannot promote themselves to `admin` or change their `role` to unauthorized roles.
   - Admin authority is determined strictly via `/admins/{uid}` existence or bootstrapped system admin email (`a40332177@gmail.com`) with `email_verified == true`.
   - Regular users cannot write to `/admins/{uid}`.
3. **Student Personal Data Isolation**:
   - Records in `/learning_profiles/{profileId}`, `/study_plans/{planId}`, `/activities/{activityId}`, `/doubts/{doubtId}`, `/teacher_sessions/{sessionId}`, `/mindmaps/{mindMapId}`, `/practiceRecords/{recordId}`, `/practice_attempts/{attemptId}`, `/topic_mastery/{masteryId}`, `/flashcards/{cardId}`, `/flashcard_reviews/{reviewId}`, `/exam_attempts/{attemptId}`, `/voice_sessions/{sessionId}`, and `/achievement_states/{userId}` can only be read and written by the student owner (`userId == request.auth.uid`) or an administrator.
4. **Guardian Relationship & Permission Gating**:
   - A guardian link at `/guardians/{guardianLinkId}` requires `studentUid` and `guardianUid`.
   - Creation requires `request.auth.uid == incoming().guardianUid` or `request.auth.uid == incoming().studentUid`.
   - A guardian can only read student records if there exists an active verified relationship (`exists(/databases/$(database)/documents/guardians/$(guardianUid + '_' + studentUid)) && get(...).data.status == 'verified'`).
5. **Curriculum Integrity (Anti-Tampering)**:
   - Official records in `/boards`, `/classes`, `/subjects`, and `/syllabus` are public to read for all authenticated users.
   - Writes to `/boards`, `/classes`, `/subjects`, and `/syllabus` are restricted strictly to administrators (`isAdmin()`). Students and untrusted clients cannot invent or corrupt verified syllabus records.
6. **Path Variable Hardening**:
   - All document IDs must conform to `isValidId()` (`^[a-zA-Z0-9_\-]+$`) with length <= 128 characters.
7. **Strict Query Enforcement**:
   - List queries on private collections (`doubts`, `teacher_sessions`, `mindmaps`, `practiceRecords`, `practice_attempts`, `topic_mastery`, `flashcards`, `flashcard_reviews`, `exam_attempts`, `voice_sessions`, `study_plans`, `activities`, `learning_profiles`) must evaluate `resource.data.userId == request.auth.uid` or admin check. No blanket reads.
8. **Document Privacy & Bounded Collections (Phases 2–7)**:
   - Raw uploaded images, handwritten scans, PDF binaries, and raw microphone voice recordings/audio blobs are strictly disallowed from Firestore persistence (`doubts` only allows bounded metadata `attachmentLabel`, and `voice_sessions` persists text transcripts only).
   - `teacher_sessions.messages` is strictly bounded (`<= 40` turns).
   - `mindmaps.nodes` is strictly bounded (`<= 60` nodes, non-empty `>= 1`) and `mindmaps.crossLinks` is bounded (`<= 20`) with immutable `id`/`userId`.
   - `topic_mastery.recurringErrors` (`<= 10`) and `topic_mastery.historySnapshots` (`<= 20`) are strictly bounded with immutable `id`/`userId`.
   - `flashcards` enforces bounded `front` (`<= 800`), `back` (`<= 1400`), `easeFactor` (`>= 1.3 && <= 4.0`), and immutable `id`/`userId`.
   - `exam_attempts` enforces `isOfficialBoardExam == false`, bounded arrays (`questionResults` `1..50`, `topicBreakdown <= 30`, `difficultyBreakdown <= 5`, `mistakeSummary <= 20`, `recommendedRevisionTopics <= 15`), `marksObtained <= totalMarks`, `percentage` `0..100`, and immutable attempts (`allow update: if isAdmin()`).
   - `voice_sessions` enforces strict field allowlisting (`hasOnly`), bounded `turns` (`<= 60`), and immutable `id`/`userId` so no raw voice audio payloads can ever be stored.
9. **Private Study Rooms, Room-Scoped Access & Child Safety (Phase 7)**:
   - Rooms at `/study_rooms/{roomId}` must enforce `isPrivate == true` and `directMessagesDisabled == true`. Public room directory scraping (`allow list` across all rooms) is strictly forbidden; `/study_rooms` list only returns rooms where `hostUid == request.auth.uid`, and `/study_room_invites/{inviteCode}` prohibits `list` entirely (`isAdmin()` only).
   - Subcollections `/study_rooms/{roomId}/members/{memberUid}`, `/notes/{noteId}`, `/goals/{goalId}`, `/quizzes/{quizId}`, and `/mindmaps/{mapId}` are accessible strictly to verified active non-removed room members (`exists(.../members/$(request.auth.uid))` with `status != 'removed'`). Muted members cannot post new notes, goals, quizzes, or mind maps.
   - Student private profiles (`/users/{uid}`) remain strictly private: `members/{memberUid}` explicitly allowlists only safe classroom metadata (`uid`, `alias`, `avatarInitial`, `role`, `board`, `classGrade`, `status`, `contributionsCount`, `quizPoints`, `joinedAt`, `lastActiveAt`) — `email`, phone, photoURL, and state/PII are rejected.
   - Peer reporting (`/study_rooms/{roomId}/reports/{reportId}`) allows members to file reports, while moderation actions (hiding notes, resolving reports, muting/removing members, locking rooms) are restricted strictly to room `host`/`moderator` or platform `admin`.
   - `/achievement_states/{userId}` enforces bounded healthy daily rewards (`todayXpEarned <= 300`, `todayEstimatedMinutes <= 720`) so unhealthy binge/screen-time farming cannot inflate verified daily XP or streaks.

## 2. The "Dirty Dozen" + Phase 7 Malicious Payloads Tested

1. **Self-Escalation**: Student sending `{ "role": "admin" }` during onboarding or `{ "role": "host" }` when joining a study room.
2. **Ghost Admin Write**: Unauthenticated or non-admin writing to `/admins/{uid}`.
3. **Syllabus Pollution**: Student sending custom chapter to `/syllabus/{id}` with `isVerified: true`.
4. **Cross-Student Plan & Exam Scraping**: Student querying `/study_plans`, `/exam_attempts`, `/study_rooms`, or `/study_room_invites` without authorized ownership/membership.
5. **Unverified Guardian Snooping**: Unverified guardian attempting to read `/activities`, `/exam_attempts/{attemptId}`, or `/achievement_states/{userId}` of a student.
6. **Learning Profile & Achievement Hijacking**: User writing to `/learning_profiles/{victim_uid}` or `/achievement_states/{victim_uid}` where `request.auth.uid != victim_uid`.
7. **ID Traversal Poisoning**: Injecting path with directory traversal like `/boards/../../users` or oversized `exam_attempts`/`study_rooms` IDs.
8. **Board Master Record Alteration & Fake Board Exam Claim**: Attempting to set `isVerified: true` on an unverified custom board by non-admin, or `isOfficialBoardExam: true` on `/exam_attempts/{attemptId}`.
9. **Score, Activity & Healthy XP Spoofing**: Student sending `update` to `/exam_attempts/{attemptId}` to inflate `marksObtained`, or writing `todayXpEarned: 5000` / `isPrivate: false` / `directMessagesDisabled: false`.
10. **Shadow Key & PII Injection**: Sending ghost fields `{ "fileData": "<base64>", "isVip": true }` or `{ "email": "victim@school.in", "phone": "9876543210" }` into `/study_rooms/{roomId}/members/{uid}`.
11. **Session, Attempt & Study Room Hijacking**: Non-member attempting to read/write `/study_rooms/{roomId}/notes/{noteId}` or muted/removed member attempting to bypass moderation locks or dismiss a report against themselves.
12. **Unverified Email Claim**: Calling admin operations with `request.auth.token.email_verified == false`.


