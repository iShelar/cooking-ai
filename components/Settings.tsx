import React, { useState, useEffect } from 'react';
import { AppSettings, DEFAULT_APP_SETTINGS, VOICE_LANGUAGE_OPTIONS } from '../types';
import { getAppSettings, saveAppSettings } from '../services/dbService';

interface SettingsProps {
  userId: string;
  onBack: () => void;
  onSaved?: (settings: AppSettings) => void;
}

const Settings: React.FC<SettingsProps> = ({ userId, onBack, onSaved }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const stored = await getAppSettings(userId);
        setSettings(stored);
      } catch {
        setSettings({ ...DEFAULT_APP_SETTINGS });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userId]);

  const update = (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await saveAppSettings(userId, settings);
      onSaved?.(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // could show toast
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fcfcf9] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fcfcf9] pb-24">
      <header className="px-6 pt-8 pb-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-xl text-stone-600 hover:bg-stone-100"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold text-stone-800 tracking-tight">Settings</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-emerald-600 font-semibold text-sm disabled:opacity-50"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
        </button>
      </header>

      <div className="px-6 space-y-6">
        <section className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider px-6 py-3 border-b border-stone-100">
            Cooking
          </h2>
          <div className="divide-y divide-stone-100">
            <div className="px-6 py-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-stone-800">Units</p>
                <p className="text-sm text-stone-500">Temperature and volume in recipes</p>
              </div>
              <select
                value={settings.units}
                onChange={(e) => update({ units: e.target.value as 'metric' | 'imperial' })}
                className="bg-stone-100 rounded-xl py-2 px-4 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="metric">Metric (°C, ml)</option>
                <option value="imperial">Imperial (°F, cups)</option>
              </select>
            </div>
            <div className="px-6 py-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-stone-800">Default servings</p>
                <p className="text-sm text-stone-500">When starting a new recipe</p>
              </div>
              <select
                value={settings.defaultServings}
                onChange={(e) => update({ defaultServings: Number(e.target.value) })}
                className="bg-stone-100 rounded-xl py-2 px-4 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {[1, 2, 3, 4, 6, 8].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider px-6 py-3 border-b border-stone-100">
            Voice assistant
          </h2>
          <div className="divide-y divide-stone-100">
            <div className="px-6 py-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-stone-800">Voice language</p>
                <p className="text-sm text-stone-500">Language for AI voice responses</p>
              </div>
              <select
                value={settings.voiceLanguage}
                onChange={(e) => update({ voiceLanguage: e.target.value })}
                className="bg-stone-100 rounded-xl py-2 px-4 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {VOICE_LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="px-6 py-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-stone-800">Voice speed</p>
                <p className="text-sm text-stone-500">Playback speed of AI responses</p>
              </div>
              <select
                value={String(settings.voiceSpeed)}
                onChange={(e) => update({ voiceSpeed: Number(e.target.value) })}
                className="bg-stone-100 rounded-xl py-2 px-4 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="0.8">Slower</option>
                <option value="1">Normal</option>
                <option value="1.2">Faster</option>
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider px-6 py-3 border-b border-stone-100">
            Feedback
          </h2>
          <div className="divide-y divide-stone-100">
            <label className="px-6 py-4 flex items-center justify-between cursor-pointer gap-4">
              <div>
                <p className="font-medium text-stone-800">Haptic feedback</p>
                <p className="text-sm text-stone-500">Vibration on step and timer actions</p>
              </div>
              <input
                type="checkbox"
                checked={settings.hapticFeedback}
                onChange={(e) => update({ hapticFeedback: e.target.checked })}
                className="w-11 h-6 rounded-full accent-emerald-500 cursor-pointer flex-shrink-0"
              />
            </label>
            <label className="px-6 py-4 flex items-center justify-between cursor-pointer gap-4">
              <div>
                <p className="font-medium text-stone-800">Timer sound</p>
                <p className="text-sm text-stone-500">Sound when timer finishes</p>
              </div>
              <input
                type="checkbox"
                checked={settings.timerSound}
                onChange={(e) => update({ timerSound: e.target.checked })}
                className="w-11 h-6 rounded-full accent-emerald-500 cursor-pointer flex-shrink-0"
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Settings;
