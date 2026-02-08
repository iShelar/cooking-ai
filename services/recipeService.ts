import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { Recipe } from '../types';

/**
 * Fetches all recipes for the given user from Firestore.
 * Returns an empty array if the collection is empty or on read failure.
 */
export const getRecipesFromFirestore = async (userId: string): Promise<Recipe[]> => {
  try {
    const recipesRef = collection(db, 'users', userId, 'recipes');
    const snapshot = await getDocs(recipesRef);
    return snapshot.docs.map((d) => fromFirestoreRecipe(d.id, d.data()));
  } catch (err) {
    console.warn('Firestore read failed:', err);
    return [];
  }
};

/**
 * Updates (or creates) a recipe in the user's Firestore collection.
 */
export const updateRecipeInFirestore = async (userId: string, recipe: Recipe): Promise<void> => {
  const docRef = doc(db, 'users', userId, 'recipes', recipe.id);
  await setDoc(docRef, toFirestoreRecipe(recipe), { merge: true });
};

/**
 * Deletes a recipe from the user's Firestore collection.
 */
export const deleteRecipeFromFirestore = async (userId: string, recipeId: string): Promise<void> => {
  const docRef = doc(db, 'users', userId, 'recipes', recipeId);
  await deleteDoc(docRef);
};

function toFirestoreRecipe(r: Recipe): Record<string, unknown> {
  const out: Record<string, unknown> = {
    title: r.title,
    description: r.description,
    prepTime: r.prepTime,
    cookTime: r.cookTime,
    difficulty: r.difficulty,
    servings: r.servings,
    image: r.image,
    ingredients: r.ingredients,
    steps: r.steps,
    calories: r.calories ?? 0,
  };
  if (r.videoUrl != null) out.videoUrl = r.videoUrl;
  if (r.stepTimestamps != null) out.stepTimestamps = r.stepTimestamps;
  if (r.videoSegments != null) out.videoSegments = r.videoSegments;
  if (r.lastPreparedAt != null) out.lastPreparedAt = r.lastPreparedAt;
  if (r.lastViewedAt != null) out.lastViewedAt = r.lastViewedAt;
  if (r.sharedFromToken != null) out.sharedFromToken = r.sharedFromToken;
  return out;
}

function fromFirestoreRecipe(id: string, data: Record<string, unknown>): Recipe {
  const r: Recipe = {
    id,
    title: (data.title as string) ?? '',
    description: (data.description as string) ?? '',
    prepTime: (data.prepTime as string) ?? '',
    cookTime: (data.cookTime as string) ?? '',
    difficulty: (data.difficulty as Recipe['difficulty']) ?? 'Easy',
    servings: (data.servings as number) ?? 0,
    image: (data.image as string) ?? '',
    ingredients: Array.isArray(data.ingredients) ? (data.ingredients as string[]) : [],
    steps: Array.isArray(data.steps) ? (data.steps as string[]) : [],
    calories: (data.calories as number) ?? undefined,
  };
  if (typeof data.videoUrl === 'string') r.videoUrl = data.videoUrl;
  if (Array.isArray(data.stepTimestamps)) r.stepTimestamps = data.stepTimestamps as string[];
  if (Array.isArray(data.videoSegments)) r.videoSegments = data.videoSegments as Recipe['videoSegments'];
  if (typeof data.lastPreparedAt === 'string') r.lastPreparedAt = data.lastPreparedAt;
  if (typeof data.lastViewedAt === 'string') r.lastViewedAt = data.lastViewedAt;
  if (typeof data.sharedFromToken === 'string') r.sharedFromToken = data.sharedFromToken;
  return r;
}
