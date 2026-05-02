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
