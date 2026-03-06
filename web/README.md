# Off Tracker Web

## What It Includes
- Dashboard totals (granted, used, remaining)
- Personnel management (add/select/delete with optional cascade)
- Off Grants tab (add/edit/delete)
- Off Usage tab (record/edit/undo with allocation by grant IDs)
- Calendar tab (monthly view, Monday-first, granted/used chips)
- Edit Logs tab (audit snapshots for edit/delete/undo actions)
- Backend-connected persistence (API + PostgreSQL)

## Local Development
1. Start backend API in `api/` (see [`api/README.md`](/Users/zachsu/Downloads/off-tracker-website/api/README.md)).
2. Serve `web/` on port `4173` (or any static host):
```bash
cd web
python3 -m http.server 4173
```
3. Open [http://localhost:4173](http://localhost:4173)

Default frontend API target:
- `http://localhost:8787/api`

To override:
- set `window.OFF_TRACKER_API_BASE` before loading `app.js` in `index.html`.
