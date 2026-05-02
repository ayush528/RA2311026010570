# Afford Medical Technologies – Backend Assignment

**Roll No:** RA2311026010570  
**Name:** Ayushmaan Krishna  
**Email:** ak4170@srmist.edu.in

---

## Project Structure

```
afford/
├── logging_middleware/             # Logger utility
├── vehicle_maintence_scheduler/    # Vehicle maintenance scheduler
├── notification_app_be/            # Priority inbox implementation
├── notification_system_design.md
├── vehicle_scheduling/             # Output artefacts (JSON + text)
├── postman_screenshots/            # ← Postman API response screenshots (see below)
├── src/server/                     # Express API server
├── .gitignore
└── package.json
```

---

## Postman Screenshots

All Postman API response screenshots live in the **`postman_screenshots/`** directory at the project root.

### What to include

| Screenshot filename | Endpoint captured |
|---|---|
| `01_auth.png` | `POST /evaluation-service/auth` – token response |
| `02_depots.png` | `GET /evaluation-service/depots` – depot list |
| `03_vehicles.png` | `GET /evaluation-service/vehicles` – vehicle task list |
| `04_notifications.png` | `GET /evaluation-service/notifications` – raw notification feed |
| `05_log.png` | `POST /evaluation-service/log` – structured log entry |

### Why this directory

Top-level directories in this repo follow **`snake_case`** (e.g. `vehicle_scheduling/`, `project_details/`).  
`postman_screenshots/` matches that convention and keeps visual evidence separate from source code and generated output.

Each screenshot should capture:
- The full request (method, URL, headers including `Authorization: Bearer <token>`)
- The complete response body and HTTP status code

---

## Running the code

```bash
npm install

# Vehicle maintenance scheduler
npm run vehicle-scheduling

# Priority inbox (notifications)
npm run notifications
```

Output artefacts are written to `vehicle_scheduling/output.json` and `vehicle_scheduling/output.txt`.

---

## Test Process Experience

The evaluation was well-structured and genuinely engaging. Each stage built naturally on the previous one, which made it easy to stay in flow throughout. The problems were interesting enough to think through carefully rather than just pattern-match against standard solutions. Time management was straightforward because each stage had a clear, self-contained scope.

Overall the experience was smooth — the tooling worked, the API was responsive, and the progression from design to implementation to optimisation felt logical.

---

## Sections I Wasn't Able to Understand

No section of the test document was unclear or ambiguous. The requirements were precisely worded, the expected outputs were well-defined, and the evaluation API behaved exactly as described. I did not need to make any assumptions due to missing or contradictory information.
