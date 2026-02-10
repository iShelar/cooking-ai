# Pakao — System Architecture

## High-Level Overview

```mermaid
graph TB
    subgraph DEVICE["User's Device (Phone / Tablet / Desktop)"]
        subgraph PWA["Pakao PWA — React 19 + TypeScript"]
            RD[Recipe Detail]
            CM[Cooking Mode<br/><i>Voice-Guided</i>]
            IS[Ingredient<br/>Scanner]
            INV[Inventory &<br/>Shopping List]
            RC[Recipe Creation<br/><i>Chat / YouTube</i>]
            SL[Service Layer<br/><code>geminiService · youtubeRecipeService · dbService · authService</code>]

            RD --> SL
            CM --> SL
            IS --> SL
            INV --> SL
            RC --> SL
        end
    end

    subgraph BACKEND["Pakao Backend — Python FastAPI on Google Cloud Run"]
        REST[REST API Router<br/><code>/api/*</code>]
        WSP[WebSocket Proxy<br/><code>/ws</code>]
    end

    subgraph GEMINI["Google Gemini API"]
        GREST["Gemini REST<br/><b>gemini-3-flash-preview</b><br/><i>+ 3 fallback models</i>"]
        GLIVE["Gemini Live API<br/><b>gemini-2.5-flash-native-audio</b><br/><i>Bidirectional Audio + Tools</i>"]
    end

    subgraph FIREBASE["Firebase"]
        AUTH[Auth<br/><i>Email · Anonymous</i>]
        FS[Firestore<br/><i>Recipes · Inventory<br/>Preferences · Shares</i>]
        STOR[Storage<br/><i>Recipe Images</i>]
        FCM[Cloud Messaging<br/><i>Push Notifications</i>]
    end

    SL -->|"HTTPS REST (JSON)"| REST
    SL -->|"WebSocket (PCM Audio)"| WSP
    SL -->|"Firebase SDK (HTTPS)"| AUTH
    SL -->|"Firebase SDK"| FS
    SL -->|"Firebase SDK"| STOR

    REST -->|"google-genai SDK"| GREST
    WSP -->|"Streaming WebSocket"| GLIVE

    BACKEND -.->|"Verify ID Tokens"| AUTH

    style CM fill:#059669,color:#fff,stroke:#047857
    style GLIVE fill:#059669,color:#fff,stroke:#047857
    style WSP fill:#059669,color:#fff,stroke:#047857
    style GREST fill:#1e40af,color:#fff,stroke:#1e3a8a
    style DEVICE fill:#faf8f5,stroke:#d6d3d1,color:#1c1917
    style PWA fill:#fff,stroke:#d6d3d1
    style BACKEND fill:#eff6ff,stroke:#93c5fd
    style GEMINI fill:#f0fdf4,stroke:#86efac
    style FIREBASE fill:#fefce8,stroke:#fde047
```

---

## Voice Cooking Mode — The Core Feature

This is what makes Pakao unique: fully hands-free cooking powered by Gemini Live API.

```mermaid
sequenceDiagram
    actor User as User (in kitchen)
    participant App as Pakao PWA
    participant BE as FastAPI Backend
    participant GL as Gemini Live API

    User->>App: Taps "Start Cooking"
    App->>BE: Opens WebSocket /ws
    BE->>GL: Opens Gemini Live session

    Note over App,GL: SETUP (once per session)
    App->>BE: Setup config
    BE->>GL: model + systemInstruction + tools[]<br/>[nextStep, startTimer, goToStep,<br/>setTemperature, setVideoPlayback,<br/>pauseTimer, finishRecipe ...]<br/>responseModalities: ["AUDIO"]

    rect rgb(240, 253, 244)
        Note over User,GL: VOICE INTERACTION LOOP
        User->>App: Says "next step"
        App->>BE: 16kHz PCM audio frames (20ms chunks)
        BE->>GL: Forward audio stream

        Note right of GL: Gemini understands speech<br/>Decides action<br/>Calls tool
        GL-->>BE: tool_call: nextStep()
        BE-->>App: JSON: {toolCall: nextStep}

        Note left of App: UI immediately:<br/>• Advances step counter<br/>• Seeks YouTube video<br/>  to step's timestamp<br/>• Updates instruction text

        App->>BE: tool_response: {success: true}
        BE->>GL: Forward tool response
        GL-->>BE: Audio PCM (24kHz)
        BE-->>App: Binary audio frames
        App-->>User: Plays: "Okay, now dice the<br/>onions into small cubes"
    end

    rect rgb(239, 246, 255)
        Note over User,GL: TIMER EXAMPLE
        User->>App: Says "set timer 5 minutes"
        App->>BE: PCM audio
        BE->>GL: Forward audio
        GL-->>BE: tool_call: startTimer(5, 0)
        BE-->>App: JSON: {toolCall: startTimer}
        Note left of App: UI shows 05:00 countdown
        GL-->>BE: Audio: "Timer set for 5 minutes"
        BE-->>App: Binary audio
        App-->>User: Plays confirmation audio
    end

    rect rgb(254, 252, 232)
        Note over User,GL: FINISH
        User->>App: Says "I'm done"
        App->>BE: PCM audio
        BE->>GL: Forward audio
        GL-->>BE: tool_call: finishRecipe()
        BE-->>App: JSON: finishRecipe
        Note left of App: Subtracts used ingredients<br/>from inventory in Firestore
    end
```

---

## Recipe Creation Flows

### Flow A: Create from Text Description

```mermaid
flowchart LR
    A["User types:<br/><i>'quick egg breakfast'</i>"] --> B["POST /api/generate-recipe<br/><code>{description, dietary, allergies}</code>"]
    B --> C["<b>Gemini 3 Flash</b><br/>Structured JSON output<br/>with response_schema"]
    C --> D["Recipe JSON<br/><code>{title, ingredients[],<br/>steps[], prepTime, ...}</code>"]
    D --> E["Save to<br/>Firestore"]
    E --> F["Navigate to<br/>Recipe Detail"]

    style C fill:#059669,color:#fff,stroke:#047857
```

### Flow B: Create from YouTube Video (2-step)

```mermaid
flowchart TB
    A["User pastes YouTube URL"] --> B

    subgraph STEP1["Step 1: Video Understanding"]
        B["POST /api/youtube-timestamps<br/><code>{url}</code>"] --> C["<b>Gemini 3 Flash</b><br/>Processes actual video<br/>via FileData"]
        C --> D["Timestamped transcript<br/><code>[{00:00, 'Today we make...'},<br/>{01:30, 'Dice the onions...'},<br/>{03:45, 'Add the garlic...'}]</code>"]
    end

    D --> E

    subgraph STEP2["Step 2: Recipe Extraction"]
        E["POST /api/recipe-from-youtube<br/><code>{segments, dietary}</code>"] --> F["<b>Gemini 3 Flash</b><br/>Builds recipe with<br/>exact MM:SS timestamps"]
        F --> G["Recipe + stepTimestamps<br/><code>steps: [{instruction, timestamp}]</code>"]
    end

    G --> H["Save to Firestore<br/><i>videoUrl + stepTimestamps</i>"] --> I["Cooking Mode syncs<br/>YouTube video to each step"]

    style C fill:#059669,color:#fff,stroke:#047857
    style F fill:#059669,color:#fff,stroke:#047857
    style I fill:#059669,color:#fff,stroke:#047857
```

### Flow C: Ingredient Scanner

```mermaid
flowchart LR
    A["Point camera<br/>at fridge"] --> B["Capture JPEG<br/>(base64)"]
    B --> C["POST /api/scan-ingredients"]
    C --> D["<b>Gemini Vision</b><br/><i>Identify items</i>"]
    D --> E["tomatoes, eggs,<br/>basil, mozzarella"]
    E --> F["POST /api/recipe-<br/>recommendations"]
    F --> G["<b>Gemini 3 Flash</b>"]
    G --> H["Caprese Salad<br/>Shakshuka<br/>Bruschetta"]
    H --> I["User picks one<br/>→ Cooking Mode"]

    style D fill:#059669,color:#fff,stroke:#047857
    style G fill:#059669,color:#fff,stroke:#047857
```

---

## All 8 Gemini Integration Points

```mermaid
graph LR
    subgraph REST["REST API — gemini-3-flash-preview"]
        R1["1. Scan Ingredients<br/><i>Vision: Image → ingredients</i>"]
        R2["2. Parse Grocery Text<br/><i>Structured: Text → items[]</i>"]
        R3["3. Parse Grocery Image<br/><i>Vision+Structured: Image → items[]</i>"]
        R4["4. Recipe Recommendations<br/><i>Structured: Ingredients → recipes[]</i>"]
        R5["5. Generate Recipe<br/><i>Structured: Description → recipe</i>"]
        R6["6. YouTube Timestamps<br/><i>Video: Video → transcript</i>"]
        R7["7. Recipe from YouTube<br/><i>Structured: Transcript → recipe</i>"]
    end

    subgraph LIVE["Live API — gemini-2.5-flash-native-audio"]
        R8["8. Voice Cooking (WebSocket)<br/><i>Audio+Tools: Voice ↔ AI cooking</i><br/>12 tool declarations<br/>28 languages<br/>Bidirectional streaming"]
    end

    style REST fill:#eff6ff,stroke:#93c5fd
    style LIVE fill:#f0fdf4,stroke:#86efac
    style R8 fill:#059669,color:#fff,stroke:#047857
```

---

## Model Fallback Strategy

```mermaid
flowchart TD
    A[Request arrives] --> B{"gemini-3-flash-preview"}
    B -->|Success| Z[Return response]
    B -->|"429 Rate Limit"| ERR["Return 429 immediately<br/><i>Never retry rate limits</i>"]
    B -->|"Model error"| C{"gemini-2.5-flash-preview"}
    C -->|Success| Z
    C -->|"Model error"| D{"gemini-2.0-flash"}
    D -->|Success| Z
    D -->|"Model error"| E{"gemini-1.5-flash"}
    E -->|Success| Z
    E -->|"All failed"| F[Return error to client]

    style B fill:#059669,color:#fff
    style C fill:#0d9488,color:#fff
    style D fill:#0891b2,color:#fff
    style E fill:#6366f1,color:#fff
    style ERR fill:#ef4444,color:#fff
```

---

## Data Model (Firestore)

```mermaid
graph TB
    subgraph FS["Firestore"]
        subgraph USERS["users / {userId}"]
            RECIPES["recipes / {recipeId}<br/><code>title · description · ingredients[]<br/>steps[] · stepTimestamps[]?<br/>videoUrl? · videoSegments[]?<br/>prepTime · cookTime · difficulty<br/>servings · image<br/>lastPreparedAt? · lastViewedAt?</code>"]
            INVENTORY["inventory / {itemId}<br/><code>name · quantity? · addedAt</code>"]
            SHOPPING["shoppingList / {itemId}<br/><code>name · quantity? · addedAt<br/>sourceRecipeId? · sourceRecipeTitle?</code>"]
            PREFS["preferences <i>(single doc)</i><br/><code>dietary[] · allergies[]<br/>alternatives[] · skillLevel</code>"]
            SETTINGS["settings <i>(single doc)</i><br/><code>units · voiceSpeed · voiceLanguage<br/>hapticFeedback · defaultServings<br/>timerSound · reminderTimes · fcmToken?</code>"]
        end

        SHARED["sharedRecipes / {token}<br/><code>ownerId · recipe{...} · sharedAt</code>"]
        PUSH["pushSubscriptions / {userId}<br/><code>fcmToken · updatedAt</code>"]
    end

    style USERS fill:#fff,stroke:#d6d3d1
    style FS fill:#fefce8,stroke:#fde047
```

---

## Deployment Architecture

```mermaid
graph LR
    subgraph NETLIFY["Netlify (Frontend)"]
        CDN["Static PWA<br/><i>React build · CDN-served</i>"]
        CRON["Cron Function<br/><i>Meal reminders (every 15 min)</i>"]
    end

    subgraph GCR["Google Cloud Run (Backend)"]
        API["Python FastAPI<br/><code>/api/* · /ws · /share/*</code><br/><i>min-instances: 1 (zero cold starts)</i>"]
    end

    subgraph GEMINI["Google Gemini API"]
        GREST["REST: gemini-3-flash"]
        GLIVE["Live: gemini-2.5-flash<br/>-native-audio"]
    end

    subgraph FB["Firebase"]
        AUTH["Auth"]
        STORE["Firestore"]
        STORAGE["Storage"]
        FCMS["Cloud Messaging"]
    end

    CDN -->|"proxy /api, /share"| API
    CDN -->|"proxy /ws"| API
    API --> GREST
    API --> GLIVE
    API -.->|"verify tokens"| AUTH
    CDN --> AUTH
    CDN --> STORE
    CDN --> STORAGE
    CRON --> FCMS
    CRON --> STORE

    style GCR fill:#eff6ff,stroke:#93c5fd
    style GEMINI fill:#f0fdf4,stroke:#86efac
    style NETLIFY fill:#faf8f5,stroke:#d6d3d1
    style FB fill:#fefce8,stroke:#fde047
```

---

## Security Model

```mermaid
sequenceDiagram
    participant B as Browser (PWA)
    participant BE as FastAPI Backend
    participant FA as Firebase Auth
    participant G as Gemini API

    B->>FA: Sign in (email / anonymous)
    FA-->>B: Firebase ID Token (JWT)

    B->>BE: API request<br/>Authorization: Bearer {token}
    BE->>FA: Verify ID token (firebase-admin)
    FA-->>BE: uid, email, claims

    BE->>G: Call Gemini API<br/>(server-side key, never in client)
    G-->>BE: AI response
    BE-->>B: JSON response

    Note over B,FA: Firestore direct access<br/>Rules enforce: auth.uid == userId<br/>sharedRecipes: public read, auth write
```

---

## Tech Stack Summary

| Layer | Technology | Role |
|-------|-----------|------|
| **Frontend** | React 19 · TypeScript · Vite | PWA UI |
| **Styling** | Tailwind CSS | Responsive design |
| **Backend** | Python FastAPI · Uvicorn | API + WebSocket proxy |
| **AI (REST)** | Gemini 3 Flash (google-genai SDK) | Recipe gen, vision, video |
| **AI (Voice)** | Gemini Live API (WebSocket) | Real-time audio + tool calling |
| **Auth** | Firebase Auth | Email + anonymous sign-in |
| **Database** | Firebase Firestore | Recipes, inventory, settings |
| **Storage** | Firebase Storage | Recipe images |
| **Push** | Firebase Cloud Messaging | Meal reminders |
| **Frontend Host** | Netlify (CDN) | Static PWA + cron functions |
| **Backend Host** | Google Cloud Run | Zero cold-start API |
| **Audio** | Web Audio API + AudioWorklet | Mic capture + playback |
