import { getDoc, setDoc, doc, getDocs, collection, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { Recipe, UserPreferences, AppSettings, DEFAULT_APP_SETTINGS, InventoryItem, ShoppingListItem } from '../types';
import {
  getRecipesFromFirestore,
  updateRecipeInFirestore,
  deleteRecipeFromFirestore,
} from './recipeService';
import { getInventoryUpdatesForRecipe } from './shoppingListService';

/** Recipes: users/{userId}/recipes/{recipeId} */
export const getAllRecipes = async (userId: string): Promise<Recipe[]> => {
  return getRecipesFromFirestore(userId);
};

export const updateRecipeInDB = async (userId: string, recipe: Recipe): Promise<void> => {
  await updateRecipeInFirestore(userId, recipe);
};

export const deleteRecipeInDB = async (userId: string, recipeId: string): Promise<void> => {
  await deleteRecipeFromFirestore(userId, recipeId);
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
      likedRecipeIds: Array.isArray(data?.likedRecipeIds) ? data.likedRecipeIds : undefined,
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
  if (prefs.likedRecipeIds !== undefined && Array.isArray(prefs.likedRecipeIds)) {
    data.likedRecipeIds = prefs.likedRecipeIds;
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
      breakfastReminderTime: typeof data?.breakfastReminderTime === 'string' ? data.breakfastReminderTime : DEFAULT_APP_SETTINGS.breakfastReminderTime,
      lunchReminderTime: typeof data?.lunchReminderTime === 'string' ? data.lunchReminderTime : DEFAULT_APP_SETTINGS.lunchReminderTime,
      dinnerReminderTime: typeof data?.dinnerReminderTime === 'string' ? data.dinnerReminderTime : DEFAULT_APP_SETTINGS.dinnerReminderTime,
      fcmToken: typeof data?.fcmToken === 'string' ? data.fcmToken : undefined,
    };
  } catch (err) {
    console.warn('Firestore getAppSettings failed:', err);
    return { ...DEFAULT_APP_SETTINGS };
  }
};

export const saveAppSettings = async (userId: string, settings: AppSettings): Promise<void> => {
  const ref = doc(db, 'users', userId, 'appSettings', 'user');
  const data: Record<string, unknown> = { ...settings };
  if (settings.fcmToken === undefined) delete data.fcmToken;
  await setDoc(ref, data, { merge: true });
};

/** Push subscriptions: pushSubscriptions/{userId} — used by scheduled function to list users to notify. */
const PUSH_SUBSCRIPTIONS_COLLECTION = 'pushSubscriptions';

/** Save FCM token for push notifications (writes appSettings + pushSubscriptions so cron can list subscribers). */
export const saveFcmToken = async (userId: string, fcmToken: string | null): Promise<void> => {
  const appRef = doc(db, 'users', userId, 'appSettings', 'user');
  await setDoc(appRef, { fcmToken: fcmToken ?? null }, { merge: true });
  const pushRef = doc(db, PUSH_SUBSCRIPTIONS_COLLECTION, userId);
  if (fcmToken) {
    await setDoc(pushRef, { fcmToken, updatedAt: new Date().toISOString() }, { merge: true });
  } else {
    await setDoc(pushRef, { fcmToken: null, updatedAt: new Date().toISOString() }, { merge: true });
  }
};

/** Normalize item name for matching (trim, lowercase). */
function normalizeInventoryName(name: string): string {
  return (name ?? '').trim().toLowerCase();
}

/**
 * Merge two quantity strings when same unit (e.g. "2L" + "1L" → "3L", "250g" + "250g" → "500g").
 * If units differ or unparseable, returns "q1, q2" or the single value.
 */
function mergeQuantityStrings(
  q1: string | undefined,
  q2: string | undefined
): string | undefined {
  if (!q1?.trim()) return q2?.trim() || undefined;
  if (!q2?.trim()) return q1.trim() || undefined;
  const parse = (q: string): { num: number; unit: string } | null => {
    const m = q.trim().match(/^(\d+(?:\.\d+)?)\s*(\S*)$/);
    if (!m) return null;
    const num = parseFloat(m[1]);
    const unit = (m[2] ?? '').toLowerCase();
    return { num, unit };
  };
  const a = parse(q1);
  const b = parse(q2);
  if (a && b && a.unit === b.unit) {
    const sum = a.num + b.num;
    return a.unit ? `${sum}${a.unit}` : String(sum);
  }
  return `${q1.trim()}, ${q2.trim()}`;
}

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
  const existing = await getInventory(userId);
  const key = normalizeInventoryName(item.name);
  const match = existing.find((i) => normalizeInventoryName(i.name) === key);
  if (match) {
    const mergedQty = mergeQuantityStrings(match.quantity, item.quantity);
    await updateInventoryItem(userId, match.id, { quantity: mergedQty });
    return { ...match, quantity: mergedQty };
  }
  const colRef = collection(db, 'users', userId, 'inventory');
  const ref = doc(colRef);
  const full: InventoryItem = {
    id: ref.id,
    name: item.name.trim(),
    quantity: item.quantity?.trim() || undefined,
    addedAt: new Date().toISOString(),
  };
  await setDoc(ref, { name: full.name, quantity: full.quantity ?? null, addedAt: full.addedAt });
  return full;
};

export const addInventoryItems = async (userId: string, items: Omit<InventoryItem, 'id' | 'addedAt'>[]): Promise<InventoryItem[]> => {
  let current = await getInventory(userId);
  const result: InventoryItem[] = [];
  for (const item of items) {
    const key = normalizeInventoryName(item.name);
    const match = current.find((i) => normalizeInventoryName(i.name) === key);
    if (match) {
      const mergedQty = mergeQuantityStrings(match.quantity, item.quantity);
      await updateInventoryItem(userId, match.id, { quantity: mergedQty });
      const updated = { ...match, quantity: mergedQty };
      result.push(updated);
      current = current.map((i) => (i.id === match.id ? updated : i));
    } else {
      const full = await addInventoryItem(userId, { name: item.name, quantity: item.quantity });
      result.push(full);
      current = [...current, full];
    }
  }
  return result;
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
 * When the user has finished cooking the recipe, subtract used ingredient quantities from inventory.
 * Reduces each matched item's quantity by the amount used; removes the item if quantity goes to zero or below.
 */
export const subtractRecipeIngredientsFromInventory = async (userId: string, recipe: Recipe): Promise<void> => {
  const inventory = await getInventory(userId);
  const updates = getInventoryUpdatesForRecipe(recipe, inventory);
  for (const { itemId, newQuantity } of updates) {
    if (newQuantity === null) {
      await removeInventoryItem(userId, itemId);
    } else {
      await updateInventoryItem(userId, itemId, { quantity: newQuantity });
    }
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

export const updateShoppingListItem = async (
  userId: string,
  itemId: string,
  updates: { quantity?: string }
): Promise<void> => {
  const ref = doc(db, 'users', userId, 'shoppingList', itemId);
  await updateDoc(ref, updates as Record<string, unknown>);
};

export const addShoppingListItem = async (
  userId: string,
  item: Omit<ShoppingListItem, 'id' | 'addedAt'>
): Promise<ShoppingListItem> => {
  const existing = await getShoppingList(userId);
  const key = normalizeInventoryName(item.name);
  const matches = existing.filter((i) => normalizeInventoryName(i.name) === key);
  if (matches.length > 0) {
    const keep = matches[0];
    let mergedQty = mergeQuantityStrings(keep.quantity, item.quantity);
    for (let i = 1; i < matches.length; i++) {
      mergedQty = mergeQuantityStrings(mergedQty, matches[i].quantity);
    }
    await updateShoppingListItem(userId, keep.id, { quantity: mergedQty });
    for (let i = 1; i < matches.length; i++) {
      await removeShoppingListItem(userId, matches[i].id);
    }
    return { ...keep, quantity: mergedQty };
  }
  const colRef = collection(db, 'users', userId, 'shoppingList');
  const ref = doc(colRef);
  const full: ShoppingListItem = {
    id: ref.id,
    name: (item.name ?? '').trim(),
    quantity: item.quantity?.trim() || undefined,
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
  let current = await getShoppingList(userId);
  const result: ShoppingListItem[] = [];
  for (const item of items) {
    const key = normalizeInventoryName(item.name);
    const matches = current.filter((i) => normalizeInventoryName(i.name) === key);
    if (matches.length > 0) {
      const keep = matches[0];
      let mergedQty = mergeQuantityStrings(keep.quantity, item.quantity);
      for (let i = 1; i < matches.length; i++) {
        mergedQty = mergeQuantityStrings(mergedQty, matches[i].quantity);
      }
      await updateShoppingListItem(userId, keep.id, { quantity: mergedQty });
      for (let i = 1; i < matches.length; i++) {
        await removeShoppingListItem(userId, matches[i].id);
      }
      const updated = { ...keep, quantity: mergedQty };
      result.push(updated);
      current = current.filter((i) => normalizeInventoryName(i.name) !== key).concat([updated]);
    } else {
      const full = await addShoppingListItem(userId, item);
      result.push(full);
      current = [...current, full];
    }
  }
  return result;
};

export const removeShoppingListItem = async (userId: string, itemId: string): Promise<void> => {
  const ref = doc(db, 'users', userId, 'shoppingList', itemId);
  await deleteDoc(ref);
};
