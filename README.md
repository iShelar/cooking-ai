<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

**Built for the Google DeepMind Gemini 3 Hackathon**

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1q4PwPz4BX_IElsBhDK1tstYNzl75BJIm

**→ For judges:** See **[docs/JUDGES.md](docs/JUDGES.md)** for one-command run and quick demo steps.

## Run Locally

**Prerequisites:**  Node.js, Python 3.10+

1. Install dependencies:
   ```bash
   npm install
   cd server && pip install -r requirements.txt && cd ..
   ```
2. Set the Firebase config vars in [.env.local](.env.local)
3. **Firestore (recipes):** In [Firebase Console](https://console.firebase.google.com) → your project → **Build** → **Firestore Database**:
   - Click **Create database** if you haven't already (start in test mode).
   - Open the **Rules** tab and paste the contents of [firestore.rules](firestore.rules), then **Publish**. This allows the app to read/write the `recipes` collection.
4. Run the app (frontend + backend in one terminal):
   ```bash
   npm run run
   ```
   Or run separately: `npm run dev` (frontend) and `npm run dev:backend` (Python backend).

### Python backend

All AI endpoints, voice proxy, share preview, YouTube timestamp extraction, and guest sign-in are handled by the Python backend. It runs at `http://localhost:8080`. The Vite dev server proxies `/api`, `/ws`, and `/share` to it automatically.

**Configuration:** Create `server/.env` with:
- `GEMINI_API_KEY` — your Gemini API key
- `FIREBASE_PROJECT_ID` — your Firebase project ID (for auth token verification)
- Place your Firebase service account JSON at `server/serviceAccountKey.json` (for guest tokens and share preview Firestore access)

### Anonymous / guest login

- **Continue as guest** on the login screen signs in with Firebase Anonymous Auth (no backend needed). Each device gets its own persistent UID; data is per device.
- **Same ID for everyone (shared guest):** The Python backend exposes `GET /api/guest-token`, which returns `{ "token": "<customToken>" }`. It uses the Firebase service account key at `server/serviceAccountKey.json`. Firestore rules must allow read/write for `users/guest/...` when `request.auth.uid == 'guest'`.

### Create recipe from YouTube

**Create from YouTube** (turn a cooking video into a recipe you can follow step-by-step with the video) is handled by the Python backend endpoint `POST /api/youtube-timestamps`. No separate service is needed — just make sure the backend is running.

## Share recipe

From a recipe's detail screen, tap **Share** (icon in the header). The app creates a link and copies it to the clipboard. Anyone with the link can open the recipe (read-only) and, if signed in, tap **Save to my recipes** to add a copy to their collection. Shared data is stored in the `sharedRecipes` Firestore collection (see [firestore.rules](firestore.rules)). The Python backend serves Open Graph meta tags at `/share/{token}` for social-media previews and redirects human visitors to the SPA.

## Push notifications (meal reminders)

Users can enable **push notifications** in **Settings → Notifications** to receive meal reminders and recipe suggestions when the app is closed.

**Setup:**

1. **Firebase Cloud Messaging (FCM):** In [Firebase Console](https://console.firebase.google.com) → your project → **Project settings** → **Cloud Messaging** → **Web Push certificates**, generate a key pair and copy the key.
2. **Env:** In `.env.local` add:
   - `VITE_FIREBASE_VAPID_KEY=<your Web Push key>`
   (Use the same `VITE_FIREBASE_*` vars as the app so `public/firebase-messaging-sw.js` is generated with your config.)
3. **Build:** Run `yarn build` (or `npm run build`). The `prebuild` step generates `public/firebase-messaging-sw.js` from your Firebase env vars.
4. **Netlify (scheduled function):** Set `FIREBASE_SERVICE_ACCOUNT_JSON` in the Netlify dashboard (same as for share links). The `meal-reminder` function runs every 15 minutes (UTC) and sends a push to users whose current time is within their breakfast/lunch/dinner reminder window (Settings → Meal reminders). The notification includes up to 2 suggested recipe names based on their inventory.
5. **Firestore rules:** Deploy [firestore.rules](firestore.rules) so the `pushSubscriptions` collection allows each user to read/write only their own document.

Reminder times are configurable in **Settings → Meal reminders**. Notifications are only sent when the user has enabled push and their FCM token is stored.

## PWA (Progressive Web App)

The app is set up as a PWA so users can install it on their phone or desktop (Add to Home Screen / Install app).

- **Icons:** PWA icons are generated from `public/favicon.svg`. To regenerate after changing the favicon, run:
  ```bash
  yarn run generate-pwa-icons
  ```
- **Install:** Deploy over **HTTPS**; then users can install via the browser's install prompt or menu.
- **Offline:** The app shell and static assets are cached. Auth and live data (Firebase, Gemini) still require a connection.

## Features

- **Create recipes** — From a text description (chat) or a YouTube cooking video URL; Gemini generates the recipe and (for YouTube) timestamped steps so the video syncs in cooking mode.
- **Voice cooking mode** — Hands-free session over WebSocket: say "next step," "set timer 5 minutes," "go to step 3," or control the recipe video; Gemini Live responds with audio and tool calls for navigation, timers, and playback.
- **Recipe setup** — Voice-guided scaling of servings via Gemini Live before you start cooking.
- **Ingredient scanner** — Camera scan or photo of receipt/pantry; Gemini Vision identifies items; get recipe recommendations from your inventory.
- **Inventory & shopping list** — Add items by text, voice, or parsed image; subtract used ingredients when you finish a recipe.
- **Dietary preferences** — Optional one-time survey and **Settings → Dietary & preferences**; use (or skip) when creating recipes from chat or YouTube.
- **Share recipes** — Share link with Open Graph previews; recipients can open and save to their collection.
- **Push notifications** — Meal reminders at configurable times with recipe suggestions based on current inventory.
- **PWA** — Install on phone or desktop; offline caching for the app shell.
- **Voice language** — Choose response language in Settings for cooking mode.
- **Recipe images** — When a recipe has no image, Gemini generates one and it’s stored in Firebase Storage.
