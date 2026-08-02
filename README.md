# Health Tracker

A personal health-tracking Progressive Web App (PWA) for Android and iOS — installed from the browser via **Add to Home Screen**, no app stores needed.

## Features

- **Weight & BMI** — log weight, see trends against your healthy BMI range
- **Workouts** — gym sessions (exercises, sets, reps, weights), runs, walks, outdoor sports; weekly stats + streak
- **Report vault** — store health checkup PDFs and photos, searchable, viewable offline
- **Google Drive backup** — everything backs up to a visible "Health Tracker Data" folder in your own Drive; reinstall + sign in restores it all
- **AI reads your reports** — extracts values (glucose, cholesterol, thyroid, …), converts units, flags out-of-range results against the lab's own printed ranges, and charts trends — every value is human-reviewed before saving
- **Reminders** — due list, snooze, app badge, one-tap "add to phone calendar" for real alarms
- **Health chat** — diet & recovery advice grounded in your own data ("did chest today — what should I eat?"), with tell-it-your-workout logging
- **Export** — one ZIP with all data + report files, any time

Setup instructions: see [SETUP.md](SETUP.md).

## Privacy model

- All data lives **on your device** (IndexedDB), backed up only to **your own Google Drive**.
- AI API keys are entered in Settings, stored only on-device, and sent only to the provider you chose (OpenAI / Gemini / Anthropic — switchable in the UI).
- No custom backend. The app is a fully static site.
- Not medical advice: the app provides general wellness information only.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build
```

## Deployment

Pushed to `main` → GitHub Actions builds and deploys to GitHub Pages (see `.github/workflows/deploy.yml`). The workflow sets `BASE_PATH` to the repo name automatically.

## Stack

React 19 · TypeScript · Vite · vite-plugin-pwa · Dexie (IndexedDB) · Recharts · Tailwind CSS · react-router (hash routing) · Zod
