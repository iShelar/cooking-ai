import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { Recipe } from '../types';
import { MOCK_RECIPES } from '../constants';

/**
 * Seeds sample recipes for this user if their recipes collection is empty.
 */
const seedRecipesIfEmpty = async (userId: string): Promise<boolean> => {
  try {
    const recipesRef = collection(db, 'users', userId, 'recipes');
    const snapshot = await getDocs(recipesRef);
    if (snapshot.size > 0) return true;

    const batch = writeBatch(db);
    for (const recipe of MOCK_RECIPES) {
      const docRef = doc(db, 'users', userId, 'recipes', recipe.id);
      batch.set(docRef, toFirestoreRecipe(recipe));
    }
    await batch.commit();
    return true;
  } catch (err) {
    console.warn('Firestore seed failed (enable Firestore and set rules):', err);
    return false;
  }
};

/**
 * Fetches all recipes for the given user from Firestore.
 * Seeds sample recipes if the user's collection is empty.
 * On failure, returns sample recipes locally.
 */
export const getRecipesFromFirestore = async (userId: string): Promise<Recipe[]> => {
  try {
    await seedRecipesIfEmpty(userId);
    const recipesRef = collection(db, 'users', userId, 'recipes');
    const snapshot = await getDocs(recipesRef);
    return snapshot.docs.map((d) => fromFirestoreRecipe(d.id, d.data()));
  } catch (err) {
    console.warn(
      'Firestore read failed. Using local sample recipes.',
      err
    );
    return [...MOCK_RECIPES];
  }
};

/**
 * Updates (or creates) a recipe in the user's Firestore collection.
 */
export const updateRecipeInFirestore = async (userId: string, recipe: Recipe): Promise<void> => {
  const docRef = doc(db, 'users', userId, 'recipes', recipe.id);
  await setDoc(docRef, toFirestoreRecipe(recipe), { merge: true });
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
  return r;
}
