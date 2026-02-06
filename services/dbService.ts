import { getDoc, setDoc, doc, getDocs, collection, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { Recipe, UserPreferences, AppSettings, DEFAULT_APP_SETTINGS, InventoryItem, ShoppingListItem } from '../types';
import {
  getRecipesFromFirestore,
  updateRecipeInFirestore,
} from './recipeService';
import { getInventoryIdsToSubtractForRecipe } from './shoppingListService';

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
      alternatives: Array.isArray(data?.alternatives) ? data.alternatives : undefined,
      skillLevel: (data?.skillLevel as UserPreferences['skillLevel']) ?? 'Beginner',
    };
  } catch (err) {
    console.warn('Firestore getPreferences failed:', err);
    return null;
  }
};

export const savePreferences = async (userId: string, prefs: UserPreferences): Promise<void> => {
  const ref = doc(db, 'users', userId, 'preferences', 'user');
  // Firestore does not allow undefined; omit undefined fields.
  const data: Record<string, unknown> = {
    dietary: prefs.dietary,
    allergies: prefs.allergies,
    skillLevel: prefs.skillLevel,
  };
  if (prefs.alternatives !== undefined && prefs.alternatives !== null) {
    data.alternatives = prefs.alternatives;
  }
  await setDoc(ref, data, { merge: true });
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

/** Inventory: users/{userId}/inventory/{itemId} */
export const getInventory = async (userId: string): Promise<InventoryItem[]> => {
  try {
    const ref = collection(db, 'users', userId, 'inventory');
    const snapshot = await getDocs(ref);
    return snapshot.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: (data.name as string) ?? '',
        quantity: typeof data.quantity === 'string' ? data.quantity : undefined,
        addedAt: (data.addedAt as string) ?? new Date().toISOString(),
      };
    });
  } catch (err) {
    console.warn('Firestore getInventory failed:', err);
    return [];
  }
};

export const addInventoryItem = async (userId: string, item: Omit<InventoryItem, 'id' | 'addedAt'>): Promise<InventoryItem> => {
  const colRef = collection(db, 'users', userId, 'inventory');
  const ref = doc(colRef);
  const full: InventoryItem = {
    id: ref.id,
    name: item.name,
    quantity: item.quantity,
    addedAt: new Date().toISOString(),
  };
  await setDoc(ref, { name: full.name, quantity: full.quantity ?? null, addedAt: full.addedAt });
  return full;
};

export const addInventoryItems = async (userId: string, items: Omit<InventoryItem, 'id' | 'addedAt'>[]): Promise<InventoryItem[]> => {
  const added: InventoryItem[] = [];
  for (const item of items) {
    const full = await addInventoryItem(userId, item);
    added.push(full);
  }
  return added;
};

export const removeInventoryItem = async (userId: string, itemId: string): Promise<void> => {
  const ref = doc(db, 'users', userId, 'inventory', itemId);
  await deleteDoc(ref);
};

export const updateInventoryItem = async (userId: string, itemId: string, updates: { quantity?: string }): Promise<void> => {
  const ref = doc(db, 'users', userId, 'inventory', itemId);
  await updateDoc(ref, updates as Record<string, unknown>);
};

/**
 * When the user has finished cooking the recipe, subtract used ingredients from inventory.
 * Matches each recipe ingredient to one inventory item by name and removes that item.
 */
export const subtractRecipeIngredientsFromInventory = async (userId: string, recipe: Recipe): Promise<void> => {
  const inventory = await getInventory(userId);
  const idsToRemove = getInventoryIdsToSubtractForRecipe(recipe, inventory);
  for (const itemId of idsToRemove) {
    await removeInventoryItem(userId, itemId);
  }
};

/** Shopping list: users/{userId}/shoppingList/{itemId} */
export const getShoppingList = async (userId: string): Promise<ShoppingListItem[]> => {
  try {
    const ref = collection(db, 'users', userId, 'shoppingList');
    const snapshot = await getDocs(ref);
    return snapshot.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: (data.name as string) ?? '',
        quantity: typeof data.quantity === 'string' ? data.quantity : undefined,
        addedAt: (data.addedAt as string) ?? new Date().toISOString(),
        sourceRecipeId: typeof data.sourceRecipeId === 'string' ? data.sourceRecipeId : undefined,
        sourceRecipeTitle: typeof data.sourceRecipeTitle === 'string' ? data.sourceRecipeTitle : undefined,
      };
    });
  } catch (err) {
    console.warn('Firestore getShoppingList failed:', err);
    return [];
  }
};

export const addShoppingListItem = async (
  userId: string,
  item: Omit<ShoppingListItem, 'id' | 'addedAt'>
): Promise<ShoppingListItem> => {
  const colRef = collection(db, 'users', userId, 'shoppingList');
  const ref = doc(colRef);
  const full: ShoppingListItem = {
    id: ref.id,
    name: item.name,
    quantity: item.quantity,
    addedAt: new Date().toISOString(),
    sourceRecipeId: item.sourceRecipeId,
    sourceRecipeTitle: item.sourceRecipeTitle,
  };
  await setDoc(ref, {
    name: full.name,
    quantity: full.quantity ?? null,
    addedAt: full.addedAt,
    sourceRecipeId: full.sourceRecipeId ?? null,
    sourceRecipeTitle: full.sourceRecipeTitle ?? null,
  });
  return full;
};

export const addShoppingListItems = async (
  userId: string,
  items: Omit<ShoppingListItem, 'id' | 'addedAt'>[]
): Promise<ShoppingListItem[]> => {
  const added: ShoppingListItem[] = [];
  for (const item of items) {
    const full = await addShoppingListItem(userId, item);
    added.push(full);
  }
  return added;
};

export const removeShoppingListItem = async (userId: string, itemId: string): Promise<void> => {
  const ref = doc(db, 'users', userId, 'shoppingList', itemId);
  await deleteDoc(ref);
};
