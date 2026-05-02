# Notification System Design

---

## Stage 1

### Overview

REST API design for a campus notification platform. Students receive real-time updates for **Placements**, **Events**, and **Results**.

### Core Endpoints

#### Get All Notifications for a Student
```
GET /api/v1/notifications
Authorization: Bearer <token>
```
**Query Params:** `?page=1&limit=20&type=Placement&isRead=false`

**Response 200:**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "Placement",
      "message": "TCS hiring drive on 10 May",
      "isRead": false,
      "createdAt": "2026-04-22T17:49:42Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 84 }
}
```

---

#### Get Unread Notification Count
```
GET /api/v1/notifications/unread-count
Authorization: Bearer <token>
```
**Response 200:**
```json
{ "count": 7 }
```

---

#### Mark a Notification as Read
```
PATCH /api/v1/notifications/:id/read
Authorization: Bearer <token>
```
**Response 200:**
```json
{ "id": "uuid", "isRead": true }
```

---

#### Mark All Notifications as Read
```
PATCH /api/v1/notifications/read-all
Authorization: Bearer <token>
```
**Response 200:**
```json
{ "updatedCount": 7 }
```

---

#### Create a Notification (Admin only)
```
POST /api/v1/notifications
Authorization: Bearer <admin-token>
Content-Type: application/json
```
**Request Body:**
```json
{
  "studentIds": ["uuid1", "uuid2"],
  "type": "Placement",
  "message": "Advanced Micro Devices Inc. hiring"
}
```
**Response 201:**
```json
{ "jobId": "bulk-job-uuid", "status": "queued" }
```

---

### Headers (all protected routes)
```
Authorization: Bearer <JWT>
Content-Type: application/json
```

### JSON Schemas

**Notification object:**
```json
{
  "id":        "string (UUID)",
  "studentId": "string (UUID)",
  "type":      "Placement | Result | Event",
  "message":   "string",
  "isRead":    "boolean",
  "createdAt": "string (ISO 8601)"
}
```

### Real-Time Mechanism

Use **Server-Sent Events (SSE)** for real-time push (simpler than WebSockets for unidirectional server→client):

```
GET /api/v1/notifications/stream
Authorization: Bearer <token>
Accept: text/event-stream
```

Server emits:
```
event: notification
data: {"id":"uuid","type":"Placement","message":"...","createdAt":"..."}
```

Fallback: clients poll `GET /api/v1/notifications?isRead=false` every 30 s.

---

## Stage 2

### Database Choice: PostgreSQL

**Reasoning:**
- Notifications have a fixed, well-defined schema → relational model fits naturally.
- Need complex queries (filter by type, order by date, join with students).
- ACID guarantees matter — a notification must not be silently lost.
- PostgreSQL's partial indexes and `ENUM` types directly match the domain.
- At 50k students × 100 notifications = 5M rows — well within PostgreSQL's range with proper indexing.

### Schema

```sql
CREATE TYPE notification_type AS ENUM ('Placement', 'Result', 'Event');

CREATE TABLE students (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    email      TEXT UNIQUE NOT NULL,
    roll_no    TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    type        notification_type NOT NULL,
    message     TEXT NOT NULL,
    is_read     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Core access pattern: unread notifications per student, newest first
CREATE INDEX idx_notifications_student_unread
    ON notifications (student_id, is_read, created_at DESC)
    WHERE is_read = false;

-- Efficient type filtering
CREATE INDEX idx_notifications_type ON notifications (type, created_at DESC);
```

### REST API Queries

**GET /notifications (paginated):**
```sql
SELECT id, type, message, is_read, created_at
FROM notifications
WHERE student_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;
```

**GET /notifications/unread-count:**
```sql
SELECT COUNT(*) FROM notifications
WHERE student_id = $1 AND is_read = false;
```

**PATCH /notifications/:id/read:**
```sql
UPDATE notifications
SET is_read = true
WHERE id = $1 AND student_id = $2
RETURNING id, is_read;
```

**PATCH /notifications/read-all:**
```sql
UPDATE notifications
SET is_read = true
WHERE student_id = $1 AND is_read = false;
```

### Scaling Problems as Data Volume Grows

| Problem | Root Cause | Solution |
|---------|-----------|---------|
| Slow unread queries | Full table scan on large `notifications` | Partial index `WHERE is_read = false` (index shrinks as messages are read) |
| Bulk insert bottleneck | 50k rows in one transaction | Batch inserts via message queue |
| `COUNT(*)` slow | Counts all rows | Cache count in Redis, invalidate on insert/read |
| Storage bloat | Old read notifications pile up | Archive rows older than 90 days to cold storage |
| Hotspot on popular student | Many joins on same student_id | Read replicas + connection pooling (PgBouncer) |

---

## Stage 3

### Original Query Analysis

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

**Why it's slow:**
1. `SELECT *` fetches all columns including large `message` text — unnecessary I/O.
2. No composite index on `(studentID, isRead, createdAt)` — full table scan on 5M rows.
3. `ORDER BY createdAt DESC` with no index forces an in-memory sort of all matching rows.
4. Estimated cost: O(n) scan + O(k log k) sort where n = total rows, k = unread for student.

**Optimised query:**
```sql
SELECT id, type, message, is_read, created_at
FROM notifications
WHERE student_id = $1
  AND is_read = false
ORDER BY created_at DESC
LIMIT 50;  -- pagination: no unbounded result set
```

**Required index:**
```sql
CREATE INDEX idx_notifications_student_unread
    ON notifications (student_id, is_read, created_at DESC)
    WHERE is_read = false;
```

With this partial index, the query becomes an index-only scan — O(log n + k) where k is the result count.

---

### Should You Index Every Column?

**No.** Indexing every column is counter-productive:

- Each index is a separate B-tree maintained on every `INSERT`, `UPDATE`, `DELETE`.
- With 5M notifications and frequent writes, blanket indexing increases write latency significantly.
- PostgreSQL's query planner may choose a suboptimal index if many exist.
- Only index columns that appear in `WHERE`, `ORDER BY`, or `JOIN` clauses of actual hot queries.

**Rule:** index selectively based on query patterns, not defensively on all columns.

---

### Query: Students with Placement notification in the last 7 days

```sql
SELECT DISTINCT s.id, s.name, s.email
FROM students s
JOIN notifications n ON n.student_id = s.id
WHERE n.type = 'Placement'
  AND n.created_at >= now() - INTERVAL '7 days';
```

**Supporting index:**
```sql
CREATE INDEX idx_notifications_type_created
    ON notifications (type, created_at DESC);
```

---

## Stage 4

### Problem
Notifications fetched on every page load → DB hit per request → DB overwhelmed at 50k concurrent students.

### Solution: Redis Cache

**Strategy: Cache-aside per student**

```
On GET /notifications:
  1. key = "notifs:{studentId}:unread"
  2. Check Redis → cache hit → return immediately
  3. Cache miss → query Postgres → store in Redis (TTL = 60s) → return
```

**On new notification created:**
```
  DEL "notifs:{studentId}:unread"   ← invalidate, next read re-populates
```

**On notification marked read:**
```
  DEL "notifs:{studentId}:unread"
```

### Tradeoffs

| Strategy | Pro | Con |
|----------|-----|-----|
| Cache-aside (chosen) | Simple, cache only what's needed | Slight stale window (≤ TTL) |
| Write-through | Always consistent | All writes go to cache even for inactive students |
| Read-through | Transparent to app | More complex library setup |
| Pub/Sub invalidation | Near real-time consistency | Extra infrastructure complexity |

**TTL recommendation:** 60 seconds for unread count, 30 seconds for notification list. Stale window is acceptable for a campus notification system.

---

## Stage 5

### Problem with original `notify_all`

```python
function notify_all(student_ids: array, message: string):
    for student_id in student_ids:
        send_email(student_id, message)   # calls Email API
        save_to_db(student_id, message)   # DB insert
        push_to_app(student_id, message)
```

**Shortcomings:**
1. **Not atomic** — `send_email` succeeded for 200 students, then failed. The remaining 49,800 never got the email, but some may have gotten a DB entry → inconsistent state.
2. **Synchronous loop** — 50k iterations, each with 3 I/O calls = extremely slow (minutes).
3. **No retry** — a transient email API failure silently drops notifications.
4. **No progress tracking** — no way to resume from failure point.
5. **Email and DB tightly coupled** — one failure blocks the other.

### Redesigned Approach

**Decouple using a message queue (BullMQ / RabbitMQ):**

```typescript
// Admin triggers bulk job
async function notify_all(student_ids: string[], message: string): Promise<void> {
  const jobId = uuid();
  await db.insert("bulk_jobs", { id: jobId, total: student_ids.length, status: "queued" });

  const BATCH_SIZE = 500;
  for (let i = 0; i < student_ids.length; i += BATCH_SIZE) {
    const batch = student_ids.slice(i, i + BATCH_SIZE);
    await notificationQueue.add("send-batch", { jobId, batch, message });
  }
}

// Worker (runs independently, N parallel instances)
notificationQueue.process("send-batch", async (job) => {
  const { jobId, batch, message } = job.data;

  // 1. Save to DB first (idempotent with ON CONFLICT DO NOTHING)
  await db.bulkInsert(
    "notifications",
    batch.map((sid) => ({ student_id: sid, message, type: "Placement" }))
  );

  // 2. Send emails (retried independently on failure)
  await Promise.allSettled(batch.map((sid) => emailService.send(sid, message)));

  // 3. Push in-app
  await Promise.allSettled(batch.map((sid) => pushService.notify(sid, message)));
});
```

**Should DB insert and email happen together?**
No. They have different failure modes and retry semantics:
- DB insert: idempotent, fast, should happen first (source of truth).
- Email: external API, slow, may fail transiently — retry separately with exponential backoff.
- Coupling them means a transient email failure rolls back a successful DB insert, creating a false negative.

---

## Stage 6

### Priority Inbox Implementation

See code: `src/notifications/priority-inbox.ts`

**Scoring formula:**
```
score = typeWeight × 10^12 + timestamp_ms
```

- Type weights: Placement=3, Result=2, Event=1
- Type dominates; within same type, more recent wins.
- Min-heap of size N maintains top N efficiently as new notifications arrive.

**Maintaining top N as new notifications stream in:**

Use a min-heap of size N:
- If heap size < N → push new notification.
- Else if new notification score > heap minimum → pop min, push new.
- Result: O(log N) per insertion, O(N log N) total.

This is O(M log N) for M total notifications — far better than sorting all M notifications O(M log M) when M >> N.
