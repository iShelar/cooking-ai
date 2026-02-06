import React, { useState } from "react";
import type { UserPreferences } from "../types";
import { DIETARY_OPTIONS, ALLERGY_OPTIONS } from "../types";

interface DietarySurveyProps {
  initialPreferences: UserPreferences | null;
  onSave: (prefs: UserPreferences) => void;
  onSkip: () => void;
}

const DietarySurvey: React.FC<DietarySurveyProps> = ({
  initialPreferences,
  onSave,
  onSkip,
}) => {
  const [dietary, setDietary] = useState<string[]>(
    initialPreferences?.dietary ?? []
  );
  const [allergies, setAllergies] = useState<string[]>(
    initialPreferences?.allergies ?? []
  );
  const [alternativesText, setAlternativesText] = useState(
    (initialPreferences?.alternatives ?? []).join(", ")
  );
  const [saving, setSaving] = useState(false);

  const toggle = (list: string[], value: string, set: (arr: string[]) => void) => {
    if (list.includes(value)) {
      set(list.filter((x) => x !== value));
    } else {
      set([...list, value]);
    }
  };

  const handleSave = () => {
    setSaving(true);
    const alternatives = alternativesText
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    onSave({
      dietary,
      allergies,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      skillLevel: initialPreferences?.skillLevel ?? "Beginner",
    });
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dietary-survey-title"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-stone-200 max-w-sm w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-5 pb-2 flex-shrink-0">
          <h2 id="dietary-survey-title" className="text-base font-bold text-stone-800">
            Quick dietary survey
          </h2>
          <p className="text-sm text-stone-600 mt-1">
            Optional. We’ll use this when generating recipes so they fit your diet. You can change it anytime in Settings.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 space-y-4 py-2">
          <div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
              Dietary preferences
            </p>
            <div className="flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(dietary, opt, setDietary)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    dietary.includes(opt)
                      ? "bg-emerald-600 text-white"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
              Allergies or avoid
            </p>
            <div className="flex flex-wrap gap-2">
              {ALLERGY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(allergies, opt, setAllergies)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    allergies.includes(opt)
                      ? "bg-amber-500 text-white"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="alternatives" className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
              Substitutions (e.g. oat milk for dairy)
            </label>
            <input
              id="alternatives"
              type="text"
              value={alternativesText}
              onChange={(e) => setAlternativesText(e.target.value)}
              placeholder="Comma-separated: oat milk, gluten-free pasta…"
              className="w-full bg-stone-100 rounded-xl py-2.5 px-4 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
        <div className="p-5 pt-3 flex flex-col gap-2 border-t border-stone-100 flex-shrink-0">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            Save preferences
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="w-full py-3 rounded-xl bg-stone-100 text-stone-700 font-medium text-sm hover:bg-stone-200 active:scale-[0.98] transition-transform"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
};

export default DietarySurvey;
