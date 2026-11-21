# EDUVERSE AI — Exam Preparation & Practice Platform Security Specification

## 1. Active Collections & Ownership Invariants

1. **Global Default Deny**:
   - Every undefined Firestore path is denied (`match /{document=**} { allow read, write: if false; }`).
2. **Student Profile Isolation (`/users/{userId}`)**:
   - Readable and writable strictly by the authenticated owner (`request.auth.uid == userId`).
   - Strict field allowlisting via `hasAll` and `hasOnly`.
   - `uid` and `createdAt` are immutable once created.
   - `role` is restricted (`student` on create unless an admin record exists; immutable on update so users can never self-escalate).
3. **Atomic Unique Username Registry (`/usernames/{username}`)**:
   - Normalized lowercase handle (`^[a-z][a-z0-9_]{2,23}$`).
   - Single-document `get` lookup allowed only for authenticated users to check availability; `list` enumeration is disabled (`allow list: if false`).
   - `create` requires `incoming().uid == request.auth.uid` and `incoming().username == username`.
   - `update` is disabled (`false`); username changes release the old claim (`delete` where `existing().uid == request.auth.uid`) and create the new claim atomically in a Firestore transaction.
4. **Exam Datesheets (`/exam_datesheets/{datesheetId}`)**:
   - Strictly scoped to the owning student (`userId == request.auth.uid`).
   - `list` queries MUST filter by `resource.data.userId == request.auth.uid`.
   - Stores structured extracted/confirmed datesheet metadata and exam entries ONLY — raw PDF or image binaries (`dataBase64`) are never stored in Firestore.
   - Bounded structures (`entries.size() <= 60`, `sourceFiles.size() <= 10`, `importantInstructions.size() <= 25`), validated `status` (`draft` | `confirmed`), and immutable `id`, `userId`, and `createdAt`.
5. **Exam Datesheet Activity Feed (`/exam_activities/{activityId}`)**:
   - Strictly scoped to the owning student (`userId == request.auth.uid`).
   - Append-only event records (`analyzed`, `saved_draft`, `confirmed`, `updated`, `deleted`) with `allow update: if false`, `allow delete` strictly by owner for account deletion cleanup, and bounded string lengths.
6. **Administrator Lookup (`/admins/{uid}`)**:
   - Strictly read-only for the authenticated user checking their own UID (`request.auth.uid == uid`); client writes are completely blocked (`false`).

## 2. Prevented Attack Vectors

- **Role Self-Escalation**: Writing `{ role: "admin" }` on `/users/{uid}` create or update is rejected by rules.
- **Cross-Student Datesheet Scraping**: Unscoped `getDocs(collection(db, "exam_datesheets"))` without `where("userId", "==", request.auth.uid)` is rejected by `allow list`.
- **Username Enumeration & Hijacking**: Listing `/usernames` is denied, and deleting or overwriting another student's `/usernames/{handle}` fails `existing().uid == request.auth.uid`.
- **Oversized Binary Storage in Firestore**: Raw uploaded PDFs/images stay transient in memory for `/api/ai/datesheet/analyze` only; Firestore `exam_datesheets` strictly rejects arbitrary unallowlisted fields.
- **Document ID Traversal**: All path IDs enforce `isValidId` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
