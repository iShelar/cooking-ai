import { GoogleGenAI, Type } from "@google/genai";

const PROMPT = `Process this video and generate a detailed transcription with timestamps.

Requirements:
1. Provide a brief summary of the entire video at the beginning.
2. For each segment, provide:
   - timestamp: in MM:SS format (e.g. "00:00", "01:23")
   - content: the spoken text or main point of that segment
   - speaker: if you can identify distinct speakers, label them (e.g. "Speaker 1", "Host"); otherwise omit.
3. Order segments by time.`;

function normalizeYouTubeUrl(url) {
  const u = new URL(url.trim());
  if (!["youtube.com", "www.youtube.com", "youtu.be"].includes(u.hostname.replace(/^www\./, ""))) {
    throw new Error("Invalid YouTube URL");
  }
  const id = u.hostname === "youtu.be" ? u.pathname.slice(1).split("/")[0] : u.searchParams.get("v");
  if (!id) throw new Error("Missing video ID");
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * Calls Gemini with YouTube URL; returns { videoUrl, summary, segments, createdAt }.
 */
export async function getTimestampsFromYouTube(videoUrl) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in .env");

  const normalizedUrl = normalizeYouTubeUrl(videoUrl);
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: {
      parts: [
        { fileData: { fileUri: normalizedUrl, mimeType: "video/mp4" } },
        { text: PROMPT },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING, description: "Brief summary of the video." },
          segments: {
            type: Type.ARRAY,
            description: "List of segments with timestamp and content.",
            items: {
              type: Type.OBJECT,
              properties: {
                timestamp: { type: Type.STRING },
                content: { type: Type.STRING },
                speaker: { type: Type.STRING },
              },
              required: ["timestamp", "content"],
            },
          },
        },
        required: ["summary", "segments"],
      },
    },
  });

  const raw = response.text ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned invalid JSON for timestamps.");
  }

  const segments = (parsed.segments ?? []).map((s) => ({
    timestamp: String(s.timestamp ?? ""),
    content: String(s.content ?? ""),
    ...(s.speaker != null && s.speaker !== "" && { speaker: String(s.speaker) }),
  }));

  return {
    videoUrl: normalizedUrl,
    summary: String(parsed.summary ?? ""),
    segments,
    createdAt: new Date().toISOString(),
  };
}
