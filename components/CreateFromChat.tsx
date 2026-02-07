import React, { useState } from "react";
import { generateRecipeFromDescription } from "../services/geminiService";
import { updateRecipeInDB } from "../services/dbService";
import { getRecipeTitleImageDataUrl } from "../constants";
import type { Recipe, UserPreferences } from "../types";

interface CreateFromChatProps {
  userId: string;
  savedPreferences: UserPreferences | null;
  onPreferencesUpdated?: (prefs: UserPreferences) => void;
  onCreated: (recipe: Recipe) => void;
  onCancel: () => void;
}

type Step = "idle" | "creating" | "saving" | "success" | "error";

const CreateFromChat: React.FC<CreateFromChatProps> = ({
  userId,
  savedPreferences,
  onPreferencesUpdated,
  onCreated,
  onCancel,
}) => {
  const [description, setDescription] = useState("");
  /** "use" = use saved preferences for this recipe, "skip" = don't apply any */
  const [dietaryChoice, setDietaryChoice] = useState<"use" | "skip">(
    savedPreferences && (savedPreferences.dietary?.length > 0 || savedPreferences.allergies?.length > 0) ? "use" : "skip"
  );
  /** Extra alternatives just for this recipe (merged with saved when dietaryChoice === "use") */
  const [alternativesForThis, setAlternativesForThis] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isBusy = step !== "idle" && step !== "success" && step !== "error";

  const getMessageForStep = (s: Step): string => {
    switch (s) {
      case "creating":
        return "Creating your recipe…";
      case "saving":
        return "Saving to your collection…";
      case "success":
        return "Recipe created!";
      default:
        return "";
    }
  };

  const handleCreateRecipe = async () => {
    const text = description.trim();
    if (!text) {
      setError("Describe the dish or name the recipe you want to make.");
      setStep("error");
      return;
    }
    setError(null);
    setStep("creating");
    setProgress(20);
    setStatusMessage(getMessageForStep("creating"));

    const options =
      dietaryChoice === "use" && savedPreferences
        ? {
            dietary: savedPreferences.dietary,
            allergies: savedPreferences.allergies,
            alternatives: [
              ...(savedPreferences.alternatives ?? []),
              ...alternativesForThis.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
            ],
          }
        : undefined;

    try {
      const parsed = await generateRecipeFromDescription(text, options);
      setProgress(70);
      setStep("saving");
      setStatusMessage(getMessageForStep("saving"));

      const recipeId = "chat_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
      const difficulty: Recipe["difficulty"] =
        parsed.difficulty === "Hard" || parsed.difficulty === "Medium" ? parsed.difficulty : "Easy";
      const title = String(parsed.title ?? "My recipe");
      const recipe: Recipe = {
        id: recipeId,
        title,
        description: String(parsed.description ?? ""),
        prepTime: String(parsed.prepTime ?? "10 min"),
        cookTime: String(parsed.cookTime ?? "20 min"),
        difficulty,
        servings: 2,
        image: getRecipeTitleImageDataUrl(title),
        ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      };

      await updateRecipeInDB(userId, recipe);
      setProgress(100);
      setStep("success");
      setStatusMessage(getMessageForStep("success"));

      setTimeout(() => {
        onCreated(recipe);
      }, 1200);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Something went wrong. Please try again.";
      setError(message);
      setStep("error");
      setProgress(0);
      setStatusMessage("");
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-[#fcfcf9] p-6 pb-24">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onCancel}
          disabled={isBusy}
          className="p-2 -ml-2 text-stone-500 rounded-xl hover:bg-stone-100 disabled:opacity-50"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-stone-800">Create from description</h1>
        <div className="w-10" />
      </div>

      <p className="text-stone-500 text-sm mb-6">
        Name a dish or describe what you want to cook. We’ll generate a recipe you can prepare and follow in cooking mode—same as with YouTube or the scanner.
      </p>

      {(savedPreferences?.dietary?.length || savedPreferences?.allergies?.length) ? (
        <div className="mb-6 p-4 bg-white rounded-2xl border border-stone-100 shadow-sm space-y-3">
          <p className="text-sm font-medium text-stone-700">Use your saved dietary preferences for this recipe?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDietaryChoice("use")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                dietaryChoice === "use" ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              Use saved
            </button>
            <button
              type="button"
              onClick={() => setDietaryChoice("skip")}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                dietaryChoice === "skip" ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              }`}
            >
              Skip for this recipe
            </button>
          </div>
          {dietaryChoice === "use" && (
            <input
              type="text"
              value={alternativesForThis}
              onChange={(e) => setAlternativesForThis(e.target.value)}
              placeholder="Add alternatives for this recipe (e.g. oat milk, gluten-free pasta)"
              className="w-full bg-stone-100 rounded-xl py-2 px-4 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          )}
        </div>
      ) : null}

      <div className="space-y-4 mb-6">
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            if (error) setError(null);
          }}
          placeholder="e.g. Pasta carbonara, quick egg breakfast, vegetarian curry…"
          disabled={isBusy}
          rows={3}
          className="w-full bg-stone-100 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 resize-none"
        />

        {(step === "creating" || step === "saving") && (
          <div className="space-y-3 p-4 bg-white rounded-2xl border border-stone-100 shadow-sm">
            <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-400 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm font-medium text-stone-700">{statusMessage}</p>
          </div>
        )}

        {step === "success" && (
          <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-emerald-800">Recipe created!</p>
              <p className="text-sm text-emerald-600">Taking you to your new recipe…</p>
            </div>
          </div>
        )}
      </div>

      {error && step === "error" && (
        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm flex gap-3">
          <svg className="w-5 h-5 flex-shrink-0 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <button
        onClick={handleCreateRecipe}
        disabled={isBusy}
        className="w-full py-4 bg-emerald-600 text-white font-black rounded-2xl shadow-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
      >
        {step === "creating" || step === "saving"
          ? statusMessage
          : step === "success"
            ? "Taking you there…"
            : "Create recipe"}
      </button>
    </div>
  );
};

export default CreateFromChat;
