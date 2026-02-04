
export interface Recipe {
  id: string;
  title: string;
  description: string;
  prepTime: string;
  cookTime: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  servings: number;
  image: string;
  ingredients: string[];
  steps: string[];
  calories?: number;
}

export interface Ingredient {
  id: string;
  name: string;
  quantity: string;
  unit: string;
}

export interface UserPreferences {
  dietary: string[];
  allergies: string[];
  skillLevel: 'Beginner' | 'Intermediate' | 'Advanced';
}

/** Voice language option for Settings dropdown. */
export interface VoiceLanguageOption {
  code: string;
  label: string;
}

/** Supported voice response languages (code used in settings, label for system instruction). */
export const VOICE_LANGUAGE_OPTIONS: VoiceLanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'sv', label: 'Swedish' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'te', label: 'Telugu' },
  { code: 'mr', label: 'Marathi' },
  { code: 'kn', label: 'Kannada' },
];

/** App-wide settings used to make the app adaptive (units, voice, defaults). */
export interface AppSettings {
  /** Temperature and volume: metric (°C, ml) vs imperial (°F, cups). */
  units: 'metric' | 'imperial';
  /** AI voice playback speed (0.8 = slower, 1 = normal, 1.2 = faster). */
  voiceSpeed: number;
  /** Voice response language code (e.g. 'en', 'es'). */
  voiceLanguage: string;
  /** Haptic feedback on timer/step actions. */
  hapticFeedback: boolean;
  /** Default number of servings when starting a recipe. */
  defaultServings: number;
  /** Play sound for timer finish. */
  timerSound: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  units: 'metric',
  voiceSpeed: 1,
  voiceLanguage: 'en',
  hapticFeedback: true,
  defaultServings: 2,
  timerSound: true,
};

export enum AppView {
  Home = 'home',
  RecipeDetail = 'recipe-detail',
  RecipeSetup = 'recipe-setup',
  CookingMode = 'cooking-mode',
  Scanner = 'scanner',
  Inventory = 'inventory',
  Profile = 'profile',
  Settings = 'settings',
}
