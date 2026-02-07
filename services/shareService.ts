import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Recipe } from '../types';

const SHARED_RECIPES_COLLECTION = 'sharedRecipes';

/** Generate a short URL-safe token. */
function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  const bytes = new Uint8Array(10);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) result += chars[bytes[i]! % chars.length];
  } else {
    for (let i = 0; i < 10; i++) result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/** Firestore does not allow undefined. Build a recipe object safe for setDoc. */
function recipeToFirestoreSafe(recipe: Recipe): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    difficulty: recipe.difficulty,
    servings: recipe.servings,
    image: recipe.image,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
  };
  if (recipe.calories != null) out.calories = recipe.calories;
  if (recipe.videoUrl != null) out.videoUrl = recipe.videoUrl;
  if (recipe.stepTimestamps != null) out.stepTimestamps = recipe.stepTimestamps;
  if (recipe.videoSegments != null) {
    out.videoSegments = recipe.videoSegments.map((seg) => ({
      timestamp: seg.timestamp,
      content: seg.content,
      ...(seg.speaker != null && { speaker: seg.speaker }),
    }));
  }
  if (recipe.lastPreparedAt != null) out.lastPreparedAt = recipe.lastPreparedAt;
  if (recipe.lastViewedAt != null) out.lastViewedAt = recipe.lastViewedAt;
  return out;
}

/** Snapshot stored in Firestore (recipe + metadata). */
export interface SharedRecipeDoc {
  recipe: Recipe;
  ownerId: string;
  createdAt: string; // ISO
}

/**
 * Create a share for a recipe. Returns the share token (used in URL).
 * Caller must be the recipe owner.
 */
export async function createShare(recipe: Recipe, ownerId: string): Promise<string> {
  const token = generateToken();
  const ref = doc(db, SHARED_RECIPES_COLLECTION, token);
  await setDoc(ref, {
    recipe: recipeToFirestoreSafe(recipe),
    ownerId,
    createdAt: new Date().toISOString(),
  });
  return token;
}

/**
 * Get a shared recipe by token. Returns null if not found or expired.
 */
export async function getSharedRecipe(token: string): Promise<SharedRecipeDoc | null> {
  if (!token.trim()) return null;
  const ref = doc(db, SHARED_RECIPES_COLLECTION, token.trim());
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!data?.recipe || typeof data.ownerId !== 'string') return null;
  return {
    recipe: data.recipe as Recipe,
    ownerId: data.ownerId as string,
    createdAt: (data.createdAt as string) ?? '',
  };
}

/**
 * Delete a share (revoke link). Only the owner should call this.
 */
export async function deleteShare(token: string, userId: string): Promise<void> {
  const ref = doc(db, SHARED_RECIPES_COLLECTION, token);
  const snap = await getDoc(ref);
  if (snap.exists() && (snap.data()?.ownerId === userId)) {
    await deleteDoc(ref);
  }
}
