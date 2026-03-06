# Off Tracker React Migration

This is the React + Vite migration shell for Off Tracker while preserving the current feature behavior.

## Run

```bash
cd /Users/zachsu/Downloads/off-tracker-website/react-web
npm install
npm run dev
```

## API Base URL

Set backend URL via env var:

```bash
VITE_OFF_TRACKER_API_BASE=http://localhost:8787/api npm run dev
```

If omitted, it defaults to `http://localhost:8787/api`.

## Notes

- `src/legacyApp.js` is migrated from the existing web app controller to preserve current functionality.
- `src/App.jsx` provides the React page shell and mounts the existing behavior.
- Next phase can convert each tab/modal from imperative DOM rendering into native React components.
