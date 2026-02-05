# YouTube Timestamp Service

Standalone Node.js service that takes a YouTube URL, uses the Gemini API to generate a summary and timestamped segments, and stores the result locally as JSON. Storage is abstracted so you can switch to Firebase later.

## Setup

1. Copy `.env.example` to `.env` and set your Gemini API key (same as in cookai-assistant):

   ```bash
   cp .env.example .env
   # Edit .env and set GEMINI_API_KEY=your_key
   ```

2. Install dependencies (already done if you ran from project root):

   ```bash
   npm install
   ```

## Usage

```bash
# Pass YouTube URL as argument
node src/index.js "https://www.youtube.com/watch?v=xxxx"

# Or set YOUTUBE_URL
YOUTUBE_URL="https://www.youtube.com/watch?v=xxxx" npm start
```

Output is saved under `data/` as JSON (one file per run). Each file contains `videoUrl`, `summary`, `segments` (array of `{ timestamp, content, speaker? }`), and `createdAt`.

## Later: Firebase

Replace the implementation in `src/storage.js` with Firebase (e.g. Firestore) while keeping the same `save(result)` and `loadByVideoUrl(videoUrl)` interface. No changes needed in `index.js` or `gemini.js`.
