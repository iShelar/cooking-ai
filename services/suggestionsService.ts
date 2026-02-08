import type { Recipe } from '../types';
import type { InventoryItem } from '../types';
import { getMissingIngredientsForRecipe } from './shoppingListService';

/** Number of recipe ingredients that are in inventory. */
function countIngredientsInInventory(recipe: Recipe, inventory: InventoryItem[]): number {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients.filter((i): i is string => typeof i === 'string' && i.trim()) : [];
  if (ingredients.length === 0) return 0;
  const missing = getMissingIngredientsForRecipe(recipe, inventory).length;
  return ingredients.length - missing;
}

/** At least 2 ingredients must be in inventory so we don't suggest almost every recipe (e.g. just salt/water). */
const MIN_INGREDIENTS_IN_INVENTORY = 2;

/**
 * Suggestions for you — based on your inventory and preferences:
 * - When you have inventory: only recipes that use at least one ingredient you have (your added recipes that match your pantry).
 * - Order: liked > cooked > added; within each, recipes you can make more of (fewer missing ingredients) come first.
 * - If you like a suggestion, it’s saved to your likes and future suggestions will favor similar (inventory-based) recipes.
 */
export function getSuggestedRecipes(
  recipes: Recipe[],
  likedRecipeIds: string[] = [],
  inventory?: InventoryItem[]
): Recipe[] {
  const likedSet = new Set(likedRecipeIds);
  const byId = new Map(recipes.map((r) => [r.id, r]));

  // Only suggest when user has inventory; only recipes with at least 2 ingredients in pantry. Otherwise return none (don't show all recipes).
  const candidateRecipes =
    inventory && inventory.length > 0
      ? recipes.filter((r) => countIngredientsInInventory(r, inventory) >= MIN_INGREDIENTS_IN_INVENTORY)
      : [];

  const liked: Recipe[] = [];
  for (const id of likedRecipeIds) {
    const r = byId.get(id);
    if (r && candidateRecipes.some((c) => c.id === r.id)) liked.push(r);
  }

  const cooked = candidateRecipes.filter((r) => !likedSet.has(r.id) && r.lastPreparedAt);
  const added = candidateRecipes.filter((r) => !likedSet.has(r.id) && !r.lastPreparedAt);

  const sortByMissing = (a: Recipe, b: Recipe): number => {
    if (!inventory?.length) return 0;
    const missingA = getMissingIngredientsForRecipe(a, inventory).length;
    const missingB = getMissingIngredientsForRecipe(b, inventory).length;
    return missingA - missingB;
  };

  const sortByLastPrepared = (a: Recipe, b: Recipe): number => {
    const ta = a.lastPreparedAt ?? '';
    const tb = b.lastPreparedAt ?? '';
    return tb.localeCompare(ta);
  };

  cooked.sort((a, b) => {
    const byPrepared = sortByLastPrepared(a, b);
    return byPrepared !== 0 ? byPrepared : sortByMissing(a, b);
  });
  added.sort(sortByMissing);

  return [...liked, ...cooked, ...added];
}
