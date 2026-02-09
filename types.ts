
/** Video segment from YouTube timestamp service (one per step or transcript chunk). */
export interface VideoTimestampSegment {
  timestamp: string; // MM:SS
  content: string;
  speaker?: string;
}

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
  /** YouTube URL when recipe is created from / linked to a video. */
  videoUrl?: string;
  /** Per-step video timestamps (MM:SS), same length as steps. */
  stepTimestamps?: string[];
  /** Full transcript segments for agent Q&A (e.g. "what happens at 2:30?"). */
  videoSegments?: VideoTimestampSegment[];
  /** When the recipe was last prepared (entered cooking mode). ISO date string. */
  lastPreparedAt?: string;
  /** When the recipe was last viewed (opened detail). ISO date string. */
  lastViewedAt?: string;
  /** Share token this recipe was saved from; used to avoid duplicate when re-saving same share link. */
  sharedFromToken?: string;
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
  /** Free-form substitutions, e.g. "oat milk instead of dairy", "gluten-free pasta" */
  alternatives?: string[];
  skillLevel: 'Beginner' | 'Intermediate' | 'Advanced';
  /** Recipe IDs the user has liked (for suggestions priority). */
  likedRecipeIds?: string[];
}

/** Common options for dietary survey and settings. */
export const DIETARY_OPTIONS = [
  'Vegetarian',
  'Vegan',
  'Gluten-free',
  'Dairy-free',
  'Keto',
  'Low-carb',
  'Halal',
  'Kosher',
  'No pork',
  'Pescatarian',
] as const;

export const ALLERGY_OPTIONS = [
  'Nuts',
  'Peanuts',
  'Shellfish',
  'Eggs',
  'Dairy',
  'Gluten',
  'Soy',
  'Sesame',
  'Other',
] as const;

const DIETARY_SURVEY_STORAGE_KEY = 'cookai_dietary_survey_shown';

export function hasShownDietarySurvey(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(DIETARY_SURVEY_STORAGE_KEY) === '1';
}

export function setDietarySurveyShown(): void {
  try {
    localStorage.setItem(DIETARY_SURVEY_STORAGE_KEY, '1');
  } catch (_) {}
}

/** Single grocery/inventory item for the user's list. */
export interface InventoryItem {
  id: string;
  name: string;
  quantity?: string;
  addedAt: string;
}

/** Item on the user's shopping list (e.g. generated from a recipe). */
export interface ShoppingListItem {
  id: string;
  name: string;
  quantity?: string;
  addedAt: string;
  sourceRecipeId?: string;
  sourceRecipeTitle?: string;
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
  { code: 'ar', label: 'Arabic' },
  { code: 'tr', label: 'Turkish' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ms', label: 'Malay' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'te', label: 'Telugu' },
  { code: 'mr', label: 'Marathi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'gu', label: 'Gujarati' },
  { code: 'kn', label: 'Kannada' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ur', label: 'Urdu' },
];

/** Browser locale (e.g. "en-US", "es-ES") to our voice language option. Uses navigator.language or first of navigator.languages. */
export function getBrowserVoiceLanguage(): VoiceLanguageOption | null {
  if (typeof navigator === 'undefined') return null;
  const locale = (navigator.language || navigator.languages?.[0] || 'en').split('-')[0].toLowerCase();
  return VOICE_LANGUAGE_OPTIONS.find((o) => o.code === locale) ?? null;
}

const LANGUAGE_PROMPT_STORAGE_KEY = 'cookai_voice_language_prompt_shown';

export function hasShownLanguagePrompt(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(LANGUAGE_PROMPT_STORAGE_KEY) === '1';
}

export function setLanguagePromptShown(): void {
  try {
    localStorage.setItem(LANGUAGE_PROMPT_STORAGE_KEY, '1');
  } catch (_) {}
}

const RECIPE_ONBOARDING_TIP_KEY = 'cookai_recipe_onboarding_tip_shown';

export function hasShownRecipeOnboardingTip(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(RECIPE_ONBOARDING_TIP_KEY) === '1';
}

export function setRecipeOnboardingTipShown(): void {
  try {
    localStorage.setItem(RECIPE_ONBOARDING_TIP_KEY, '1');
  } catch (_) {}
}

const ADD_RECIPE_BUTTON_TUTORIAL_KEY = 'cookai_add_recipe_button_tutorial_shown';

export function hasShownAddRecipeButtonTutorial(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(ADD_RECIPE_BUTTON_TUTORIAL_KEY) === '1';
}

export function setAddRecipeButtonTutorialShown(): void {
  try {
    localStorage.setItem(ADD_RECIPE_BUTTON_TUTORIAL_KEY, '1');
  } catch (_) {}
}

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
  /** Meal reminder times (HH:mm, 24h) in user's local timezone. User can change in Settings. */
  breakfastReminderTime: string;
  lunchReminderTime: string;
  dinnerReminderTime: string;
  /** IANA timezone (e.g. "Asia/Kolkata") for meal reminder push notifications. Defaults to browser-detected. */
  timezone: string;
  /** Optional recipe ID for each meal; if set, reminder says "You planned: [title]" and links to that recipe. */
  breakfastRecipeId?: string;
  lunchRecipeId?: string;
  dinnerRecipeId?: string;
  /** FCM token for push notifications (meal/suggestion reminders). Set when user enables notifications. */
  fcmToken?: string;
}

/** Get browser timezone (e.g. "Asia/Kolkata") or "UTC" if unavailable. */
export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  units: 'metric',
  voiceSpeed: 1,
  voiceLanguage: 'en',
  hapticFeedback: true,
  defaultServings: 2,
  timerSound: true,
  breakfastReminderTime: '08:00',
  lunchReminderTime: '13:00',
  dinnerReminderTime: '19:00',
  timezone: 'UTC',
};

export enum AppView {
  Home = 'home',
  Suggestions = 'suggestions',
  RecipeDetail = 'recipe-detail',
  RecipeSetup = 'recipe-setup',
  CookingMode = 'cooking-mode',
  Scanner = 'scanner',
  CreateFromYouTube = 'create-from-youtube',
  CreateFromChat = 'create-from-chat',
  Inventory = 'inventory',
  Profile = 'profile',
  Settings = 'settings',
  /** Viewing a recipe via share link (read-only; may be unauthenticated). */
  SharedRecipe = 'shared-recipe',
}
