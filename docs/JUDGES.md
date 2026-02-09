# For judges

Quick instructions to run and demo **CookAI Assistant** for evaluation.

## Prerequisites

- **Node.js** (v18+)
- **Python 3.10+**
- **npm** or **yarn**

## One-command run

From the project root:

```bash
npm install
cd server && pip install -r requirements.txt && cd ..
npm run run
```

This starts **both** the frontend (Vite) and the Python backend in one terminal. You’ll see two processes: `[api]` (backend on port 8080) and `[web]` (frontend).

- **App (HTTPS):** https://localhost:5173  
- **Backend API:** http://localhost:8080  

If the backend isn’t running, the app shows an amber **“Start the backend”** banner at the top; use **Retry** after starting the backend, or use `npm run run` so both are running.

## Environment (required for full demo)

1. **Frontend:** Create `.env.local` in the project root with your Firebase web config:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

2. **Backend:** In `server/` create `.env` with:
   - `GEMINI_API_KEY` — Gemini API key (required for AI features)
   - `FIREBASE_PROJECT_ID` — same as frontend

   For **guest sign-in** and **share preview**: place Firebase service account JSON at `server/serviceAccountKey.json`.

3. **Firestore:** Create a database in Firebase Console and deploy the rules from [firestore.rules](../firestore.rules) so the app can read/write recipes.

## Quick demo flow

1. Open https://localhost:5173 (accept the self-signed cert if prompted).
2. **Sign in:** Use “Continue as guest” or “Sign in with Google” (if configured).
3. **Create a recipe:** Tap the **+** in the bottom bar → **Create from YouTube** (paste a cooking video URL) or **Describe a dish** (chat).
4. **Cooking mode:** Open a recipe → **Prepare** → follow steps with voice and optional video.
5. **Other:** Inventory, scan ingredients, share recipe, Settings (dietary prefs, meal reminders).

## Optional: run frontend and backend separately

- **Frontend only:** `npm run dev`
- **Backend only:** `npm run dev:backend` (from repo root; runs `cd server && python main.py`)

The app proxies `/api` and `/ws` to the backend when both are running.
