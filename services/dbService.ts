import { getDoc, setDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import { Recipe, UserPreferences, AppSettings, DEFAULT_APP_SETTINGS } from '../types';
import {
  getRecipesFromFirestore,
  updateRecipeInFirestore,
} from './recipeService';

/** Recipes: users/{userId}/recipes/{recipeId} */
export const getAllRecipes = async (userId: string): Promise<Recipe[]> => {
  return getRecipesFromFirestore(userId);
};

export const updateRecipeInDB = async (userId: string, recipe: Recipe): Promise<void> => {
  await updateRecipeInFirestore(userId, recipe);
};

/** User preferences: users/{userId}/preferences (single doc) */
export const getPreferences = async (userId: string): Promise<UserPreferences | null> => {
  try {
    const ref = doc(db, 'users', userId, 'preferences', 'user');
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      dietary: Array.isArray(data?.dietary) ? data.dietary : [],
      allergies: Array.isArray(data?.allergies) ? data.allergies : [],
      skillLevel: (data?.skillLevel as UserPreferences['skillLevel']) ?? 'Beginner',
    };
  } catch (err) {
    console.warn('Firestore getPreferences failed:', err);
    return null;
  }
};

export const savePreferences = async (userId: string, prefs: UserPreferences): Promise<void> => {
  const ref = doc(db, 'users', userId, 'preferences', 'user');
  await setDoc(ref, prefs, { merge: true });
};

/** App settings: users/{userId}/appSettings (single doc) */
export const getAppSettings = async (userId: string): Promise<AppSettings> => {
  try {
    const ref = doc(db, 'users', userId, 'appSettings', 'user');
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ...DEFAULT_APP_SETTINGS };
    const data = snap.data();
    return {
      ...DEFAULT_APP_SETTINGS,
      units: (data?.units as AppSettings['units']) ?? DEFAULT_APP_SETTINGS.units,
      voiceSpeed: typeof data?.voiceSpeed === 'number' ? data.voiceSpeed : DEFAULT_APP_SETTINGS.voiceSpeed,
      voiceLanguage: typeof data?.voiceLanguage === 'string' ? data.voiceLanguage : DEFAULT_APP_SETTINGS.voiceLanguage,
      hapticFeedback: typeof data?.hapticFeedback === 'boolean' ? data.hapticFeedback : DEFAULT_APP_SETTINGS.hapticFeedback,
      defaultServings: typeof data?.defaultServings === 'number' ? data.defaultServings : DEFAULT_APP_SETTINGS.defaultServings,
      timerSound: typeof data?.timerSound === 'boolean' ? data.timerSound : DEFAULT_APP_SETTINGS.timerSound,
    };
  } catch (err) {
    console.warn('Firestore getAppSettings failed:', err);
    return { ...DEFAULT_APP_SETTINGS };
  }
};

export const saveAppSettings = async (userId: string, settings: AppSettings): Promise<void> => {
  const ref = doc(db, 'users', userId, 'appSettings', 'user');
  await setDoc(ref, settings, { merge: true });
};
