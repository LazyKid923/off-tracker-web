# Off Tracker

Off Tracker is a web app for managing personnel off-days from grant to usage, with balance tracking, calendar visibility, and audit logs.

## What The Website Does

It helps teams:

- Create and manage personnel records.
- Grant off credits (full day or half day) with reasons and metadata.
- Consume off credits while automatically allocating usage against available grants.
- Track remaining balances in real time.
- View usage and grants in a monthly calendar.
- Keep an immutable audit trail of edits, deletes, and undo actions.

## Core Features

### Dashboard
- Shows total granted, total used, and total remaining off for the selected person.
- Quick actions to add a grant, use off, and refresh data.
- Active personnel selector.

### Personnel Management
- Add personnel.
- Select active personnel context for all other tabs.
- Delete personnel with optional cascade behavior for associated data.

### Off Grants
- Create grants with:
  - Granted date
  - Duration (`0.5` or `1.0`)
  - Reason type (`OPS` or `OTHERS`)
  - Optional supporting details (for example weekend duty date/provider fields when relevant)
- Edit existing grants.
- Delete grants.
- Grant status tracking (`UNUSED`, `PARTIAL`, `USED`) driven by allocation state.

### Off Usage
- Record usage with:
  - Intended date
  - Session (`FULL`, `AM`, `PM`)
  - Duration (`0.5` or `1.0`)
  - Optional comments
- Automatic allocation to grants.
- Edit existing usage records.
- Undo usage (soft reversal) without destructive loss of history.

### Calendar
- Monthly calendar view (Monday-first).
- Displays granted and used indicators by date.
- Helps visualize usage patterns and planning.

### Edit Logs (Audit Trail)
- Immutable audit events for important changes (create/edit/delete/undo flows).
- Supports operational traceability and historical review.

### Data Import/Export
- Export current snapshot as JSON from the UI.
- Import is intentionally disabled in backend mode (database/API is source of truth).

## Architecture

- Frontend: static web app in [`web/`](/Users/zachsu/Downloads/off-tracker-website/web)
  - HTML/CSS/Vanilla JS
- Backend API: Node.js + Express in [`api/`](/Users/zachsu/Downloads/off-tracker-website/api)
- Database: PostgreSQL (Supabase recommended for hosted Postgres)
- API contract: JSON envelope
  - `{ "ok": true|false, "data": ..., "message": "...", "errors": [] }`

## API Highlights

Primary routes:

- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/personnel`
- `POST /api/personnel`
- `DELETE /api/personnel/:id?deleteData=true|false`
- `GET /api/dashboard?personnelId=...`
- `GET /api/grants?personnelId=...`
- `POST /api/grants`
- `PATCH /api/grants/:grantId`
- `DELETE /api/grants`
- `GET /api/usages?personnelId=...`
- `POST /api/usages`
- `PATCH /api/usages/:usageId`
- `DELETE /api/usages/:usageId/undo`
- `GET /api/calendar?personnelId=...&month=YYYY-MM`
- `GET /api/logs?personnelId=...&action=...&page=1&pageSize=50`

## Local Development

1. Configure backend environment:

```bash
cp api/.env.example api/.env
```

2. Update `api/.env`:
- `DATABASE_URL=...`
- `CORS_ORIGIN=http://localhost:4173`

3. Install and migrate backend:

```bash
cd api
npm install
npm run db:migrate
npm run dev
```

4. Serve frontend:

```bash
cd ../web
python3 -m http.server 4173
```

5. Open `http://localhost:4173`.

## Deployment (Current Plan)

- Frontend: Vercel (root dir `web`)
- Backend: Render Web Service (root dir `api`)
- Database: Supabase Postgres

Required backend env vars:

- `DATABASE_URL` (Supabase connection string, usually with `sslmode=require`)
- `CORS_ORIGIN` (your Vercel production URL, e.g. `https://<project>.vercel.app`)

Also set frontend API base in [`web/index.html`](/Users/zachsu/Downloads/off-tracker-website/web/index.html) to your Render API URL:

- `window.OFF_TRACKER_API_BASE = 'https://<render-service>.onrender.com/api';`
