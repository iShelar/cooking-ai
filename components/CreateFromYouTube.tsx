import React, { useState } from "react";
import {
  fetchTimestampsForUrl,
  getCachedTimestampResult,
  setCachedTimestampResult,
  parseTimestampJson,
  recipeFromTimestampResult,
  type YouTubeTimestampResult,
} from "../services/youtubeRecipeService";
import { updateRecipeInDB } from "../services/dbService";
import type { Recipe } from "../types";

interface CreateFromYouTubeProps {
  userId: string;
  onCreated: (recipe: Recipe) => void;
  onCancel: () => void;
}

const CreateFromYouTube: React.FC<CreateFromYouTubeProps> = ({ userId, onCreated, onCancel }) => {
  const [url, setUrl] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [timestampResult, setTimestampResult] = useState<YouTubeTimestampResult | null>(
    getCachedTimestampResult()
  );
  const [loading, setLoading] = useState<"idle" | "fetch" | "create">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    const u = url.trim();
    if (!u) {
      setError("Enter a YouTube URL");
      return;
    }
    setError(null);
    setLoading("fetch");
    try {
      const result = await fetchTimestampsForUrl(u);
      setTimestampResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch timestamps. Is the timestamp service running? (npm run server in youtube-timestamp-service)");
    } finally {
      setLoading("idle");
    }
  };

  const handlePaste = () => {
    setError(null);
    try {
      const result = parseTimestampJson(pasteText);
      setCachedTimestampResult(result);
      setTimestampResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handleCreateRecipe = async () => {
    if (!timestampResult) {
      setError("Fetch timestamps or paste JSON first.");
      return;
    }
    setError(null);
    setLoading("create");
    try {
      const recipe = await recipeFromTimestampResult(timestampResult);
      await updateRecipeInDB(userId, recipe);
      onCreated(recipe);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create recipe.");
    } finally {
      setLoading("idle");
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-[#fcfcf9] p-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onCancel}
          className="p-2 -ml-2 text-stone-500 rounded-xl hover:bg-stone-100"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-stone-800">Create from YouTube</h1>
        <div className="w-10" />
      </div>

      <p className="text-stone-500 text-sm mb-6">
        Paste a YouTube cooking video URL. We’ll get timestamps and turn it into a recipe with step-by-step video links.
      </p>

      <div className="space-y-4 mb-6">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 bg-stone-100 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            onClick={handleFetch}
            disabled={loading === "fetch"}
            className="px-4 py-3 bg-emerald-600 text-white rounded-xl font-semibold text-sm disabled:opacity-50"
          >
            {loading === "fetch" ? "…" : "Fetch"}
          </button>
        </div>
        <p className="text-stone-400 text-xs">
          Or paste JSON from the timestamp service below and click “Use pasted JSON”.
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder='{"videoUrl": "...", "summary": "...", "segments": [...]}'
          className="w-full h-24 bg-stone-100 rounded-xl p-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          onClick={handlePaste}
          className="w-full py-2 border border-stone-200 rounded-xl text-stone-600 text-sm font-medium"
        >
          Use pasted JSON
        </button>
      </div>

      {timestampResult && (
        <div className="mb-6 p-4 bg-white rounded-2xl border border-stone-100 shadow-sm">
          <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Ready</p>
          <p className="text-stone-700 text-sm line-clamp-2">{timestampResult.summary}</p>
          <p className="text-stone-400 text-xs mt-2">
            {timestampResult.segments.length} segments · {timestampResult.videoUrl.slice(0, 40)}…
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleCreateRecipe}
        disabled={!timestampResult || loading === "create"}
        className="w-full py-4 bg-emerald-600 text-white font-black rounded-2xl shadow-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading === "create" ? "Creating recipe…" : "Create recipe"}
      </button>
    </div>
  );
};

export default CreateFromYouTube;
