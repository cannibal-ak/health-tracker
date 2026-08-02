# One-time setup guide

The app is fully built. Three short setup steps put it on your phone with Google Drive backup. Claude can walk you through each one live — just say "let's do the setup".

## Step 1 — Put the app online (GitHub, ~5 min)

The app needs a free web address so your phone can install it.

1. Create a free account at **github.com** (or sign in).
2. Install the GitHub CLI: `brew install gh`, then run `gh auth login` and follow the browser prompts.
3. Tell Claude — it will create the repository, push the code, and enable GitHub Pages automatically. Your app will be at `https://<your-username>.github.io/<repo-name>/`.

## Step 2 — Enable Google Drive backup (~10 min, free)

This lets the app back up to a **"Health Tracker Data"** folder in your own Google Drive, so a new or reset phone can restore everything.

1. Go to **console.cloud.google.com** and sign in with your Google account.
2. Create a project (name it "Health Tracker").
3. In the search bar, find **"Google Drive API"** → click **Enable**.
4. Go to **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create
   - App name "Health Tracker", pick your email in both email fields → Save through the remaining screens
   - Under **Test users**, click **Add users** and add your own Gmail address. (Testing mode is fine forever — the app is only for you.)
5. Go to **APIs & Services → Credentials** → **Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins — add both:
     - `https://<your-username>.github.io`
     - `http://localhost:5173`
   - Click Create and copy the **Client ID** (looks like `1234…apps.googleusercontent.com`).
6. Give the Client ID to Claude — it goes into `src/config.ts` (it's a public identifier, not a secret) and the app redeploys.

## Step 3 — On your phone (~2 min)

1. Open the app's web address in **Safari** (iPhone) or **Chrome** (Android).
2. iPhone: tap **Share → Add to Home Screen → Add**. Android: menu (⋮) → **Install app**.
3. Open the app **from the home screen icon** (important — the browser tab keeps separate data).
4. In **Settings** inside the app:
   - Tap **Connect Google Drive** and sign in — if you've used the app before, your data restores automatically.
   - Under **AI assistant**, pick your provider (you have OpenAI and Gemini keys), paste the key, and tap **Save & verify**.

That's it. Everything else — weight, workouts, reports, AI reading, reminders, chat — works immediately.

## Costs

- GitHub Pages, Google Cloud project, Drive storage (your existing quota): **free**
- AI usage: pay-per-use on your own OpenAI/Gemini/Anthropic key — reading one report or one chat message costs a fraction of a cent on the default models.

## Privacy recap

- Health data: on your phone + your own Google Drive. Nowhere else.
- API keys: only on your phone. Excluded from every backup and export by construction.
- Report contents are sent to your chosen AI provider **only** when you tap "✨ AI" or send a chat message.
