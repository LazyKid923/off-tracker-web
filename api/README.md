# Off Tracker Backend API

Production-style backend API for Off Tracker (normal Node.js backend + PostgreSQL).

## Stack
- Node.js + Express
- PostgreSQL (`pg`)
- Transactional service layer for allocation/edit/undo consistency
- Immutable audit log table (`audit_events`)

## Setup
1. Copy env file:
```bash
cp api/.env.example api/.env
```
2. Configure `DATABASE_URL` and `CORS_ORIGIN`.
3. Install dependencies:
```bash
cd api
npm install
```
4. Run DB migration:
```bash
npm run db:migrate
```
5. Start API:
```bash
npm run dev
```

Default local API URL: `http://localhost:8787/api`

## API Endpoints
- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/personnel`
- `POST /api/personnel`
- `DELETE /api/personnel/:id?deleteData=true|false`
- `GET /api/dashboard?personnelId=...`
- `GET /api/grants?personnelId=...`
- `POST /api/grants`
- `PATCH /api/grants/:grantId`
- `DELETE /api/grants` (body: `{ "ids": ["..."] }`)
- `GET /api/usages?personnelId=...`
- `POST /api/usages`
- `PATCH /api/usages/:usageId`
- `DELETE /api/usages/:usageId/undo`
- `GET /api/calendar?personnelId=...&month=YYYY-MM`
- `GET /api/logs?personnelId=...&action=...&page=1&pageSize=50`

All responses use:
```json
{ "ok": true, "data": {}, "message": "", "errors": [] }
```

## Auth Model (Current)
The API currently reads these headers:
- `x-user-id`
- `x-user-email`
- `x-user-role` (`ADMIN`, `EDITOR`, `VIEWER`)

If omitted, it defaults to a local `ADMIN` context for development.

## Frontend Connection
Set frontend API base to `http://localhost:8787/api`, then call `GET /api/bootstrap` for initial state and use mutation endpoints for changes.

## Deploy On Vercel
You can deploy this backend without Render:

1. Create a Vercel project with **Root Directory** set to `api`.
2. Set environment variables:
   - `DATABASE_URL`
   - `CORS_ORIGIN`
3. Deploy.

This repo includes a Vercel serverless entrypoint:

- [`api/[...route].js`](/Users/zachsu/Downloads/off-tracker-website/api/api/[...route].js)

After deployment, API endpoints are available under:

- `https://<your-api-project>.vercel.app/api/*`
