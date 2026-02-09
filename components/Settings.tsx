import React, { useState, useEffect } from 'react';
import { AppSettings, DEFAULT_APP_SETTINGS, VOICE_LANGUAGE_OPTIONS, type UserPreferences, DIETARY_OPTIONS, ALLERGY_OPTIONS } from '../types';
import { getAppSettings, saveAppSettings, getPreferences, savePreferences } from '../services/dbService';
import { isPushSupported, enablePushNotifications, disablePushNotifications } from '../services/notificationService';

interface SettingsProps {
  userId: string;
  onBack: () => void;
  onSaved?: (settings: AppSettings) => void;
  onPreferencesSaved?: (prefs: UserPreferences) => void;
}

const defaultPrefs: UserPreferences = {
  dietary: [],
  allergies: [],
  skillLevel: 'Beginner',
};

const Settings: React.FC<SettingsProps> = ({ userId, onBack, onSaved, onPreferencesSaved }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [preferences, setPreferences] = useState<UserPreferences>(defaultPrefs);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [alternativesText, setAlternativesText] = useState('');
  const [pushSupported, setPushSupported] = useState<boolean | null>(null);
  const [pushToggling, setPushToggling] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const loadSettings = async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const [stored, prefs] = await Promise.all([
        getAppSettings(userId),
        getPreferences(userId),
      ]);
      setSettings(stored);
      setPreferences(prefs ?? defaultPrefs);
      setAlternativesText((prefs?.alternatives ?? []).join(', '));
    } catch (err) {
      const message = err instanceof Error ? err.message : "We couldn't load your settings. Try again?";
      setLoadError(message);
      setSettings({ ...DEFAULT_APP_SETTINGS });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, [userId]);

  useEffect(() => {
    isPushSupported().then(setPushSupported);
  }, []);

  const saveSettings = async (newSettings: AppSettings) => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await saveAppSettings(userId, newSettings);
      onSaved?.(newSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save. Try again?";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const update = (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  };

  const toggleDietary = (value: string) => {
    const next = preferences.dietary.includes(value)
      ? preferences.dietary.filter((x) => x !== value)
      : [...preferences.dietary, value];
    savePrefs({ ...preferences, dietary: next });
    setPreferences((p) => ({ ...p, dietary: next }));
  };

  const toggleAllergy = (value: string) => {
    const next = preferences.allergies.includes(value)
      ? preferences.allergies.filter((x) => x !== value)
      : [...preferences.allergies, value];
    savePrefs({ ...preferences, allergies: next });
    setPreferences((p) => ({ ...p, allergies: next }));
  };

  const savePrefs = async (prefs: UserPreferences) => {
    try {
      await savePreferences(userId, prefs);
      onPreferencesSaved?.(prefs);
    } catch (_) {}
  };

  const handleAlternativesBlur = () => {
    const alternatives = alternativesText.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    savePrefs({ ...preferences, alternatives: alternatives.length > 0 ? alternatives : undefined });
    setPreferences((p) => ({ ...p, alternatives: alternatives.length > 0 ? alternatives : undefined }));
  };

  const pushEnabled = Boolean(settings.fcmToken?.trim());

  const handlePushToggle = async (enable: boolean) => {
    setPushError(null);
    setPushToggling(true);
    try {
      if (enable) {
        const token = await enablePushNotifications(userId);
        if (token) {
          setSettings((prev) => ({ ...prev, fcmToken: token }));
          onSaved?.({ ...settings, fcmToken: token });
        } else {
          setPushError('Permission denied or could not get token.');
        }
      } else {
        await disablePushNotifications(userId);
        setSettings((prev) => ({ ...prev, fcmToken: undefined }));
        onSaved?.({ ...settings, fcmToken: undefined });
      }
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Could not update notifications.');
    } finally {
      setPushToggling(false);
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
      {loadError && (
        <div className="mx-6 mt-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm flex items-center justify-between gap-4">
          <span>{loadError}</span>
          <button onClick={loadSettings} className="text-red-600 font-semibold text-xs whitespace-nowrap">Retry</button>
        </div>
      )}
      {saveError && (
        <div className="mx-6 mt-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm">
          {saveError}
        </div>
      )}
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
        <span className="min-w-[5rem] text-right text-sm font-medium text-emerald-600">
          {saving ? 'Saving...' : saved ? 'Saved' : '\u00A0'}
        </span>
      </header>

      <div className="px-6 space-y-6">
        <section className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider px-6 py-3 border-b border-stone-100">
            Dietary & preferences
          </h2>
          <p className="px-6 py-2 text-sm text-stone-500">Used when generating recipes from chat or YouTube.</p>
          <div className="px-6 pb-4 space-y-3">
            <p className="text-xs font-medium text-stone-500">Dietary</p>
            <div className="flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleDietary(opt)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    preferences.dietary.includes(opt) ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <p className="text-xs font-medium text-stone-500 pt-2">Allergies / avoid</p>
            <div className="flex flex-wrap gap-2">
              {ALLERGY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleAllergy(opt)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    preferences.allergies.includes(opt) ? 'bg-amber-500 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor="settings-alternatives" className="block text-xs font-medium text-stone-500 mb-1">Substitutions (e.g. oat milk for dairy)</label>
              <input
                id="settings-alternatives"
                type="text"
                value={alternativesText}
                onChange={(e) => setAlternativesText(e.target.value)}
                onBlur={handleAlternativesBlur}
                placeholder="Comma-separated"
                className="w-full bg-stone-100 rounded-xl py-2 px-4 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider px-6 py-3 border-b border-stone-100">
            Cooking
          </h2>
          <div className="divide-y divide-stone-100">
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
            Meal reminders
          </h2>
          <p className="px-6 py-2 text-sm text-stone-500">Reminder times for breakfast, lunch and dinner. Push reminders are sent at these times in your timezone. Set a recipe per meal from the recipe detail page.</p>
          <p className="px-6 py-1 text-xs text-stone-400">Timezone: {settings.timezone}</p>
          <div className="divide-y divide-stone-100">
            <div className="px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="font-medium text-stone-800">Breakfast</p>
                <p className="text-sm text-stone-500">Reminder time</p>
              </div>
              <input
                type="time"
                value={settings.breakfastReminderTime}
                onChange={(e) => update({ breakfastReminderTime: e.target.value })}
                className="bg-stone-100 rounded-xl py-2 px-4 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-auto"
              />
            </div>
            <div className="px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="font-medium text-stone-800">Lunch</p>
                <p className="text-sm text-stone-500">Reminder time</p>
              </div>
              <input
                type="time"
                value={settings.lunchReminderTime}
                onChange={(e) => update({ lunchReminderTime: e.target.value })}
                className="bg-stone-100 rounded-xl py-2 px-4 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-auto"
              />
            </div>
            <div className="px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="font-medium text-stone-800">Dinner</p>
                <p className="text-sm text-stone-500">Reminder time</p>
              </div>
              <input
                type="time"
                value={settings.dinnerReminderTime}
                onChange={(e) => update({ dinnerReminderTime: e.target.value })}
                className="bg-stone-100 rounded-xl py-2 px-4 text-sm font-medium text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 w-full sm:w-auto"
              />
            </div>
          </div>
        </section>

        {pushSupported === true && (
          <section className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
            <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider px-6 py-3 border-b border-stone-100">
              Notifications
            </h2>
            <p className="px-6 py-2 text-sm text-stone-500">Get meal reminders and recipe suggestions even when the app is closed.</p>
            {pushError && (
              <div className="mx-6 mb-2 p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-800 text-sm">{pushError}</div>
            )}
            <div className="divide-y divide-stone-100">
              <label className="px-6 py-4 flex items-center justify-between cursor-pointer gap-4">
                <div>
                  <p className="font-medium text-stone-800">Push notifications</p>
                  <p className="text-sm text-stone-500">Meal reminders and suggestions</p>
                </div>
                <input
                  type="checkbox"
                  checked={pushEnabled}
                  disabled={pushToggling || pushSupported !== true}
                  onChange={(e) => handlePushToggle(e.target.checked)}
                  className="w-11 h-6 rounded-full accent-emerald-500 cursor-pointer flex-shrink-0 disabled:opacity-60"
                />
              </label>
            </div>
          </section>
        )}

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
