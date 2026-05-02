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
| Slow unread queries | Full table scan on large `notifications` | Partial index `WHERE is_read = false` (shrinks as messages are read) |
| Bulk insert bottleneck | 50k rows in one transaction | Batch inserts via message queue |
| `COUNT(*)` slow | Counts all rows | Cache count in Redis, invalidate on insert/read |
| Storage bloat | Old read notifications pile up | Archive rows older than 90 days to cold storage |
| Hotspot on popular student | Many joins on same student_id | Read replicas + connection pooling (PgBouncer) |
