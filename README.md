# Health Tracker

A personal health-tracking Progressive Web App (PWA) for Android and iOS — installed from the browser via **Add to Home Screen**, no app stores needed.

## Features

- **Weight & BMI** — log weight, see trends against your healthy BMI range
- **Workouts** — gym sessions (exercises, sets, reps), runs, outdoor sports *(phase 2)*
- **Report vault** — store health checkup PDFs and photos *(phase 3)*
- **Google Drive backup** — data backs up to a visible folder in your own Drive; reinstall + sign in restores everything *(phase 4)*
- **AI insights** — extract key values (glucose, cholesterol, …) from reports, flag out-of-range values, track them over time *(phase 5)*
- **Reminders & AI guidance** — diet and recovery advice grounded in your own data *(phase 6)*

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
