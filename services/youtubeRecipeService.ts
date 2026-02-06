import { Type } from "@google/genai";
import { getGeminiInstance } from "./geminiService";
import { DEFAULT_RECIPE_IMAGE } from "../constants";
import type { Recipe, VideoTimestampSegment } from "../types";

const TIMESTAMP_CACHE_KEY = "cookai_yt_timestamps_cache";

export interface YouTubeTimestampResult {
  videoUrl: string;
  summary: string;
  segments: { timestamp: string; content: string; speaker?: string }[];
  createdAt: string;
}

const getTimestampServiceUrl = () =>
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_TIMESTAMP_SERVICE_URL) ||
  "http://localhost:3001";

/** Fetch timestamps from the Node service; cache result in localStorage. */
export async function fetchTimestampsForUrl(videoUrl: string): Promise<YouTubeTimestampResult> {
  const url = videoUrl.trim();
  const base = getTimestampServiceUrl();
  const res = await fetch(`${base}/timestamps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Timestamp service error: ${res.status}`);
  }
  const result = (await res.json()) as YouTubeTimestampResult;
  setCachedTimestampResult(result);
  return result;
}

/** Cache one timestamp result in localStorage (for paste/import and reuse). */
export function setCachedTimestampResult(result: YouTubeTimestampResult): void {
  try {
    localStorage.setItem(TIMESTAMP_CACHE_KEY, JSON.stringify(result));
  } catch (_) {}
}

/** Get the last cached timestamp result (e.g. after paste or fetch). */
export function getCachedTimestampResult(): YouTubeTimestampResult | null {
  try {
    const raw = localStorage.getItem(TIMESTAMP_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as YouTubeTimestampResult;
  } catch {
    return null;
  }
}

/** Parse pasted JSON into YouTubeTimestampResult; throws if invalid. */
export function parseTimestampJson(jsonString: string): YouTubeTimestampResult {
  const data = JSON.parse(jsonString) as Record<string, unknown>;
  if (!data || typeof data.videoUrl !== "string" || !Array.isArray(data.segments)) {
    throw new Error("Invalid timestamp JSON: need videoUrl and segments array.");
  }
  const result: YouTubeTimestampResult = {
    videoUrl: data.videoUrl,
    summary: typeof data.summary === "string" ? data.summary : "",
    segments: data.segments.map((s: any) => ({
      timestamp: String(s.timestamp ?? ""),
      content: String(s.content ?? ""),
      ...(s.speaker != null && { speaker: String(s.speaker) }),
    })),
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
  };
  return result;
}

/** Options to adapt the recipe to the user's diet. */
export interface RecipeGenerationOptions {
  dietary?: string[];
  allergies?: string[];
  alternatives?: string[];
}

/** Build a Recipe from a timestamp result using Gemini; each step has a timestamp from the transcript. */
export async function recipeFromTimestampResult(
  result: YouTubeTimestampResult,
  options?: RecipeGenerationOptions
): Promise<Recipe> {
  const ai = getGeminiInstance();
  const segmentSummary = result.segments
    .map((s) => `[${s.timestamp}] ${s.content}`)
    .join("\n");

  let constraints = "";
  if (options?.dietary?.length || options?.allergies?.length || options?.alternatives?.length) {
    const parts: string[] = [];
    if (options.dietary?.length) parts.push(`Dietary: ${options.dietary.join(", ")}. Adapt the recipe to respect these.`);
    if (options.allergies?.length) parts.push(`Strictly avoid (allergies): ${options.allergies.join(", ")}. Do not include these.`);
    if (options.alternatives?.length) parts.push(`Use these substitutions where applicable: ${options.alternatives.join("; ")}.`);
    constraints = `\n\nImportant: ${parts.join(" ")}`;
  }

  const prompt = `You are given a video transcript with timestamps. Create a single recipe.${constraints}

Video summary: ${result.summary}

Transcript segments (each line is "[MM:SS] content"):
${segmentSummary}

Return a JSON object with:
- title: short recipe title
- description: 1-2 sentence description
- prepTime: e.g. "10 min"
- cookTime: e.g. "15 min"
- difficulty: one of "Easy", "Medium", "Hard"
- ingredients: array of strings (e.g. "2 eggs", "1 cup spinach")
- steps: array of objects. Each object has:
  - instruction: one short, clear cooking instruction (what to do in this step)
  - timestamp: the EXACT MM:SS string from ONE of the transcript lines above that corresponds to when this step happens. Pick the segment where the chef actually does or introduces this action. Use the timestamp verbatim (e.g. "01:29", "02:04"). This is critical so the video and recipe stay in sync.

Create one step per main action. Each step's timestamp must come from the transcript. Order steps by the order of their timestamps.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          prepTime: { type: Type.STRING },
          cookTime: { type: Type.STRING },
          difficulty: { type: Type.STRING },
          ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                instruction: { type: Type.STRING },
                timestamp: { type: Type.STRING },
              },
              required: ["instruction", "timestamp"],
            },
          },
        },
        required: ["title", "description", "prepTime", "cookTime", "difficulty", "ingredients", "steps"],
      },
    },
  });

  const raw = response.text ?? "{}";
  let parsed: {
    title?: string;
    description?: string;
    prepTime?: string;
    cookTime?: string;
    difficulty?: string;
    ingredients?: string[];
    steps?: { instruction?: string; timestamp?: string }[];
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned invalid JSON for recipe.");
  }

  const stepsWithTime = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps: string[] = stepsWithTime.map((s) => String(s.instruction ?? "").trim() || "Next step");
  const stepTimestamps: string[] = stepsWithTime.map((s) => {
    const t = String(s.timestamp ?? "").trim();
    return t || "00:00";
  });
  const segments = result.segments;
  const videoSegments: VideoTimestampSegment[] = segments.map((s) => ({
    timestamp: s.timestamp,
    content: s.content,
    ...(s.speaker && { speaker: s.speaker }),
  }));

  const recipeId = "yt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
  const videoId = result.videoUrl.includes("v=")
    ? result.videoUrl.split("v=")[1]?.split("&")[0]
    : "";
  const thumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : "";

  return {
    id: recipeId,
    title: String(parsed.title ?? "Recipe from video"),
    description: String(parsed.description ?? result.summary.slice(0, 200)),
    prepTime: String(parsed.prepTime ?? "10 min"),
    cookTime: String(parsed.cookTime ?? "20 min"),
    difficulty:
      parsed.difficulty === "Hard" || parsed.difficulty === "Medium" ? parsed.difficulty : "Easy",
    servings: 2,
    image: thumbnail || DEFAULT_RECIPE_IMAGE,
    ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
    steps,
    videoUrl: result.videoUrl,
    stepTimestamps,
    videoSegments,
  };
}
