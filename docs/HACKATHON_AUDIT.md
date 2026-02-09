# Pakao — Hackathon Audit & Improvement Plan

**Hackathon:** Google DeepMind Gemini 3 Hackathon
**Audit Date:** 2026-02-09
**Codebase:** ~12,000 lines (React 19 + Python FastAPI)

---

## PART 1: CURRENT STATE AUDIT

### 1. What the Project Actually Does Today

Pakao is a **PWA (Progressive Web App)** that acts as a hands-free AI cooking companion. A user can:

1. **Create a recipe** by typing a description ("quick egg breakfast") or pasting a YouTube cooking video URL.
2. **Enter a voice-guided cooking session** where Gemini Live API streams real-time audio instructions step-by-step through a WebSocket, responding to voice commands like "next step," "set timer 5 minutes," or "go to step 3."
3. **Scan ingredients** with their phone camera, get them identified by Gemini Vision, and receive recipe recommendations based on what's available.
4. **Manage a grocery inventory and shopping list**, adding items via text, voice, or photo (receipt/pantry image parsed by Gemini).
5. **Share recipes** via link with OG social-media previews.
6. **Receive push notification meal reminders** at configurable times with recipe suggestions based on current inventory.

The core differentiator is the **real-time voice cooking mode**: a full-duplex audio stream to Gemini Live API with tool-calling for step navigation, timers, video seeking, and heat control — all hands-free while cooking.

---

### 2. Gemini API Usage Map

#### Backend REST Endpoints (server/gemini_api.py)

| Endpoint | Gemini Capability | Input | Output |
|---|---|---|---|
| `POST /api/scan-ingredients` | Vision (image→text) | Base64 JPEG | Comma-separated ingredient list |
| `POST /api/parse-grocery-text` | Structured output | Free-form text | JSON array `[{name, quantity}]` |
| `POST /api/parse-grocery-image` | Vision + structured output | Base64 JPEG | JSON array `[{name, quantity}]` |
| `POST /api/recipe-recommendations` | Structured output | Ingredient list | JSON array `[{id, title, description}]` |
| `POST /api/generate-recipe` | Structured output | Description + dietary constraints | Full recipe JSON |
| `POST /api/youtube-timestamps` | Video understanding (FileData) | YouTube URL | Transcript segments with timestamps |
| `POST /api/recipe-from-youtube` | Structured output | Transcript + constraints | Recipe JSON with per-step timestamps |

#### WebSocket Real-Time (server/gemini_live.py)

| Endpoint | Gemini Capability | Model |
|---|---|---|
| `WS /ws` | Gemini Live API (bidirectional audio + tool calling) | `gemini-2.5-flash-native-audio-preview-12-2025` |

#### Models Used

- **REST:** `gemini-3-flash-preview` (primary) → `gemini-2.5-flash-preview` → `gemini-2.0-flash` → `gemini-1.5-flash`
- **Live/Voice:** `gemini-2.5-flash-native-audio-preview-12-2025`

#### Reasoning vs. Text Generation

| Type | Where | Detail |
|---|---|---|
| **Structured generation** | 6 of 7 REST endpoints | Constrained JSON via `response_mime_type="application/json"` with schemas |
| **Agentic reasoning** | Voice cooking mode | Gemini interprets ambiguous voice, maintains cooking context, selects tools (nextStep, startTimer, goToStep, setTemperature, etc.) |
| **Multimodal understanding** | YouTube timestamps, ingredient scanner | Processes full video files and camera images |

---

### 3. Fake, Placeholder, or Non-Functional Logic

| Item | Status | Detail |
|---|---|---|
| `MOCK_RECIPES` in constants.ts | Template only | One hardcoded recipe used as structural template. Not shown to users. |
| `SHOW_HEAT_UI = false` | Feature disabled | Heat level UI computed but never rendered (gated by hardcoded flag). |
| Scanner → Recipe Save | Partial | Scanned recipes are temp objects; don't auto-persist to Firestore. |
| Curated recipes library | NOT IMPLEMENTED | README #18 lists as future feature. Users start with zero recipes. |
| Step memory/preferences | NOT IMPLEMENTED | README #19 — does not exist in code. |
| Tests | ZERO | No unit, integration, or E2E tests anywhere. |

---

### 4. End-to-End User Flow

```
Login (Email/Password or Guest)
    ↓
Dietary Survey (one-time, skippable)
    ↓
Home (empty recipe grid)
    ↓
Create Recipe ─────────────────────────────────────────────────
  │                                                            │
  ├─ "From Chat": Type description ──→ POST /api/generate-recipe
  │   (Gemini returns full recipe JSON)    ──→ Save to Firestore
  │
  ├─ "From YouTube": Paste URL ──→ POST /api/youtube-timestamps
  │   (Gemini processes video)      ──→ POST /api/recipe-from-youtube
  │   (Gemini builds recipe)           ──→ Save to Firestore
  │
  └─ "Scan": Camera ──→ POST /api/scan-ingredients
      (Gemini Vision IDs items) ──→ POST /api/recipe-recommendations
      (show suggestions, user picks one)
    ↓
Recipe Detail (view ingredients, steps, share)
    ↓
Recipe Setup (voice-scale servings via Gemini Live WS)
    ↓
Cooking Mode ──→ WS /ws (Gemini Live API)
  │  User speaks: "next step" / "set timer 5 min" / "what temp?"
  │  Gemini responds: Audio + tool calls (nextStep, startTimer, etc.)
  │  YouTube video auto-seeks to current step timestamp
  │  Timer runs with audio alerts
  │  On last step: "Update inventory" subtracts used ingredients
    ↓
Done → Back to Home
```

---

### 5. Third-Party Stack

#### Frontend
| Dependency | Purpose |
|---|---|
| React 19.2.4 | UI framework |
| TypeScript 5.8.2 | Type system |
| Vite 6.2.0 | Build tool |
| Tailwind CSS (CDN) | Styling |
| Firebase SDK 12.8.0 | Auth, Firestore, Storage, FCM |
| vite-plugin-pwa / Workbox | PWA service worker |
| YouTube IFrame API | Embedded video player |
| Web Speech API | Browser-native speech recognition |
| Web Audio API + AudioWorklet | Mic capture & audio playback |

#### Backend
| Dependency | Purpose |
|---|---|
| FastAPI 0.116.1 | Python web framework |
| Uvicorn 0.35.0 | ASGI server |
| google-genai 1.44.0 | Official Gemini Python SDK |
| firebase-admin 7.1.0 | Auth verification, Firestore, FCM |
| PyJWT 2.10.1 | JWT verification |
| websockets 15.0.1 | WebSocket proxy |

#### Infrastructure
| Service | Purpose |
|---|---|
| Netlify | Frontend hosting + cron functions |
| Render | Python backend hosting |
| Firebase | Auth, Firestore, Storage, FCM |
| Google Gemini API | All AI capabilities |

---

### 6. Architectural Weaknesses

- **Zero tests.** No unit, integration, or E2E tests. A demo crash has no safety net.
- **Monolithic App.tsx (~1,600 lines).** All state, routing, view logic in one component. No Context, no state library, pure props drilling.
- **No client-side router.** Hand-rolled via `history.pushState` and popstate listener.
- **Tailwind via CDN.** Entire runtime ships to production; no tree-shaking or purging.
- **Cold start on Render.** Free/starter tier: 30-60s cold starts will break live demos.
- **WebSocket fragility.** No automatic reconnection if connection drops during cooking.
- **No offline AI.** PWA caches shell, but all Gemini calls need network.
- **Empty cold start.** New users see an empty recipe grid — no onboarding content.
- **README exposes WIP items.** Unchecked feature list signals "incomplete" to judges.

---

### 7. Stage One (Pass/Fail) Risk Assessment

| Criterion | Status | Risk |
|---|---|---|
| Uses Gemini API | **PASS** | 8 distinct integration points |
| Gemini 3 specifically | **PASS** | `gemini-3-flash-preview` is primary model |
| Working demo | **MODERATE RISK** | Render cold start may stall demo |
| Non-trivial Gemini use | **PASS** | Real-time voice + video + vision + tools |
| Actually functional | **PASS** | All endpoints real, no mocked production paths |
| Originality | **PASS** | Voice cooking + YouTube sync is novel |

**Primary Stage One risk:** Backend cold start on Render could make the demo appear broken.

---

### 8. Judge's One-Paragraph Summary

Pakao is a full-stack PWA that uses Gemini as a real-time hands-free cooking companion. Users create recipes from text descriptions or YouTube videos (using Gemini's video understanding to extract timestamped steps), then enter a voice-guided cooking mode powered by Gemini Live API over WebSocket — where they can say "next step," "set timer 5 minutes," or ask questions, and the AI responds with audio while simultaneously controlling the UI via tool calls (step navigation, timer, embedded YouTube seeking). It also uses Gemini Vision for ingredient scanning and grocery receipt parsing. The app includes inventory management, shopping lists, recipe sharing with OG previews, and push notification meal reminders. It's a well-scoped, genuinely functional application with strong multimodal Gemini integration, though it lacks tests, has a monolithic frontend architecture, and carries demo reliability risk from its Render-hosted backend.

---

### 9. Current Scores (1–5)

| Dimension | Score | Rationale |
|---|---|---|
| **Technical Execution** | **4/5** | 8 real Gemini integrations, real-time audio + tool calling, structured output, fallback chain, auth, rate limiting. -1 for zero tests, monolith, no WS reconnection. |
| **Innovation / Wow Factor** | **4/5** | Voice cooking + live YouTube sync is compelling. Tool-calling during audio is a strong demo moment. Not entirely novel but differentiated execution. |
| **Potential Impact** | **3/5** | Real problem, clear audience, but narrow vertical. Inventory + reminders add utility. Limited by always-online requirement. |
| **Presentation Readiness** | **3/5** | Deployed and functional. No demo video, no pitch deck, no landing page. Render cold start risk. Empty grid on first load. WIP items visible in README. |

---

## PART 2: IMPROVEMENTS TO WIN

### Priority Tiers

- **P0 — Demo Killers** (fix before submission or lose)
- **P1 — Score Multipliers** (biggest ROI for judge impression)
- **P2 — Polish** (differentiates top-3 from top-10)
- **P3 — Nice-to-have** (only if time permits)

---

### P0 — FIX THESE OR LOSE

#### 1. Eliminate Render Cold Start

**Problem:** Judges open your app, hit "Create Recipe," and wait 45 seconds staring at a spinner. They move on.

**Fix options (pick one):**
- **Option A (best):** Move backend to **Google Cloud Run** with `min-instances: 1`. Costs ~$5/month, zero cold starts. Also aligns with the "Google ecosystem" narrative for a Google hackathon.
- **Option B (free):** Add a cron health-check ping every 5 minutes via Netlify scheduled function or UptimeRobot to keep Render warm.
- **Option C (fastest):** Before submission, manually hit the health endpoint every few minutes during judging window.

**Files:** `netlify.toml` (redirect target), `server/main.py` (health endpoint already exists)

#### 2. Seed Onboarding Recipes

**Problem:** Judges log in and see an empty grid. They don't know what the app does. They have to figure out how to create a recipe before they can try the cooking mode — the actual wow feature.

**Fix:** Pre-seed 3-4 curated recipes on first login (detect empty collection). Include:
- 1 YouTube-sourced recipe (with video URL + timestamps, so cooking mode auto-syncs video)
- 1 chat-generated recipe (simple, 5 steps)
- 1 recipe with an image from Unsplash

This means a judge can tap a recipe → Start Cooking **within 10 seconds** of logging in.

**Files:** `App.tsx` (add seed logic after auth), `constants.ts` (add seed recipe data), `services/dbService.ts` (add `seedDefaultRecipes()`)

#### 3. Clean the README

**Problem:** README still shows unchecked items (#8, #18, #19, #21) and HTML comments for completed features. Judges read READMEs. "Features to be added" screams incomplete.

**Fix:** Remove the entire "Features to be added" section. Replace with a clean "Features" list of what actually works. Add a 1-line "Built for the Google DeepMind Gemini 3 Hackathon" badge.

**Files:** `README.md`

---

### P1 — SCORE MULTIPLIERS

#### 4. Record a 90-Second Demo Video

**Why:** Judges evaluate 50-200 projects. Most won't clone and run yours. A video is your real submission.

**Script:**
1. (0:00-0:10) Open app, show pre-seeded recipes
2. (0:10-0:25) Paste YouTube URL → watch recipe get created with timestamped steps
3. (0:25-0:40) Tap "Start Cooking" → voice says "next step" → AI responds with audio, video seeks to right timestamp
4. (0:40-0:55) Say "set timer 3 minutes" → timer appears. Say "what temperature?" → AI answers.
5. (0:55-1:10) Show ingredient scanner: point at fridge, get identified items, get recipe suggestions
6. (1:10-1:25) Show inventory auto-deduction after cooking. Show push notification.
7. (1:25-1:30) End card: "Pakao — Hands-free cooking powered by Gemini"

**Deliverable:** Upload to YouTube, embed in README, link in hackathon submission.

#### 5. Enable the Heat Level UI

**Problem:** You already built the heat suggestion feature. It's computed, sent to the client, and the rendering code exists. It's disabled by a single boolean.

**Fix:** Change `SHOW_HEAT_UI` from `false` to `true` in `CookingMode.tsx` (line ~96). That's it. Free feature.

**File:** `components/CookingMode.tsx`

#### 6. Add WebSocket Auto-Reconnect

**Problem:** If the WebSocket drops mid-cooking (network blip, Render restart), the cooking session dies silently. During a demo, this is catastrophic.

**Fix:** On WebSocket `onclose`/`onerror`, show a toast "Reconnecting..." and attempt reconnect with exponential backoff (1s, 2s, 4s, max 3 attempts). On reconnect, re-send the setup message and current step context.

**Files:** `components/CookingMode.tsx`, `components/RecipeSetup.tsx`

#### 7. Add a "Gemini 3" Badge/Callout in the UI

**Why:** Judges scanning your app should immediately see you're using Gemini 3. Don't make them guess.

**Fix:** Add a small "Powered by Gemini 3" badge in the footer or a subtle chip in cooking mode. When a recipe is generated, show "Generated with Gemini 3 Flash" briefly.

**Files:** `App.tsx` (footer), `components/CreateFromChat.tsx` (generation result)

#### 8. Write a Hackathon-Optimized README

Replace the current setup-focused README with a judge-focused README:

```
# Pakao — Hands-Free AI Cooking Assistant
> Built for Google DeepMind Gemini 3 Hackathon

[90-second Demo Video](link)

## What it does
One paragraph.

## How Gemini powers it
Table of 8 integration points (copy from audit).

## Architecture
Simple diagram: Browser ↔ FastAPI ↔ Gemini API / Gemini Live

## Try it
Link to deployed app.

## Tech stack
Bullet list.
```

No setup instructions in the hero section. Move setup to a collapsible `<details>` block.

**File:** `README.md`

---

### P2 — POLISH (Top-3 Differentiators)

#### 9. Gemini 3 as Primary Model Everywhere

**Current state:** REST uses `gemini-3-flash-preview` (good). Live voice uses `gemini-2.5-flash-native-audio-preview`.

**Fix:** If Gemini 3 has a native audio model available, switch to it. If not, document clearly why 2.5 is used for voice (native audio support). Judges may check.

**File:** `server/gemini_live.py`

#### 10. Add Thinking/Reasoning Visibility

**Why:** Judges want to see Gemini *reasoning*, not just generating. Show it.

**Fix:** In cooking mode, when Gemini makes a tool call, briefly show a "thinking" indicator: "AI is deciding: navigate to step 4..." before the action executes. This makes the agentic reasoning visible. Use the `inputTranscription`/`outputTranscription` events already flowing through the WebSocket.

**Files:** `components/CookingMode.tsx`

#### 11. Persist Scanner Results

**Problem:** Ingredient scanner results are ephemeral. Scanned ingredients don't save to inventory.

**Fix:** After scanning, add a "Save to Inventory" button that calls `addInventoryItems()`. Two lines of wiring.

**Files:** `components/IngredientScanner.tsx`, wire to `services/dbService.ts`

#### 12. Add Error Recovery UX

**Current:** API errors show raw messages. Rate limits show a generic toast.

**Fix:**
- On rate limit: show a countdown timer ("Try again in 60s") instead of a static message.
- On Gemini failure: show "Retrying with backup model..." to demonstrate the fallback chain to judges.
- On network error in cooking mode: "Lost connection — your recipe progress is saved."

**Files:** `services/apiClient.ts`, `components/CookingMode.tsx`

---

### P3 — NICE TO HAVE

#### 13. Add Minimal Tests

Even 5-10 tests signal engineering maturity:
- 1 test: `geminiService.ts` API client handles 429 correctly
- 1 test: `youtubeRecipeService.ts` cache hit/miss
- 1 test: `suggestionsService.ts` sorts by inventory match
- 1 test: Firestore rules allow/deny correctly

**Framework:** Vitest (already Vite-based, zero config).

#### 14. Install Tailwind Properly

Replace CDN script tag with `npm install tailwindcss @tailwindcss/vite`. Adds tree-shaking, reduces bundle, shows engineering rigor.

#### 15. Add a Splash/Loading Screen

While Firebase Auth initializes and backend warms up, show an animated Pakao logo instead of a blank screen or spinner. First impressions matter.

#### 16. Multi-Language Demo Clip

The app already supports 28 voice languages. Record a 15-second clip of the cooking assistant speaking Hindi or Spanish during a cooking session. International appeal = judge attention.

---

### Projected Scores After P0 + P1 Improvements

| Dimension | Before | After | Delta |
|---|---|---|---|
| **Technical Execution** | 4/5 | **4.5/5** | +0.5 (reconnect, heat UI, error recovery) |
| **Innovation / Wow Factor** | 4/5 | **4.5/5** | +0.5 (visible reasoning, heat UI, polished demo) |
| **Potential Impact** | 3/5 | **3.5/5** | +0.5 (onboarding recipes, scanner→inventory) |
| **Presentation Readiness** | 3/5 | **5/5** | +2.0 (demo video, clean README, no cold start, seeded data) |

**The single highest-ROI action is recording a 90-second demo video.** Most hackathon winners are decided by the video, not the code.

---

### Implementation Priority Order

If you have limited time, do these in this exact order:

| # | Task | Time Est. | Impact |
|---|---|---|---|
| 1 | Seed onboarding recipes | 30 min | Fixes empty-grid problem |
| 2 | Keep backend warm (cron ping) | 15 min | Fixes cold start |
| 3 | Enable `SHOW_HEAT_UI = true` | 1 min | Free feature unlock |
| 4 | Clean README | 30 min | Removes "incomplete" signal |
| 5 | Record demo video | 60 min | Biggest single ROI |
| 6 | Add "Powered by Gemini 3" badge | 10 min | Judge recognition |
| 7 | WebSocket auto-reconnect | 45 min | Demo reliability |
| 8 | Add reasoning visibility | 30 min | Shows agentic behavior |
| 9 | Persist scanner → inventory | 15 min | Completes a broken flow |
| 10 | Hackathon-optimized README | 30 min | Judge-first presentation |

**Total for items 1-6:** ~2.5 hours for maximum impact.
