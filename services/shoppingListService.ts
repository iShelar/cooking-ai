import { Recipe } from '../types';
import type { InventoryItem } from '../types';

/** Extract a core ingredient name for matching (e.g. "200g spaghetti" -> "spaghetti"). */
function coreName(ingredient: string): string {
  const lower = ingredient.trim().toLowerCase();
  const withoutLeadingNumber = lower.replace(/^[\d.,]+\s*(g|kg|ml|l|lb|oz|tbsp|tsp|cup|cups)?\s*/i, '').trim();
  return withoutLeadingNumber || lower;
}

/** Parse "100 ml water" -> { name: "water", quantity: "100 ml" }; "2 eggs" -> { name: "eggs", quantity: "2" }. */
function parseIngredientLine(line: string): { name: string; quantity?: string } {
  const s = line.trim();
  const match = s.match(/^([\d.,]+\s*(?:g|kg|ml|l|lb|oz|tbsp|tsp|cup|cups|clove|cloves)?)\s+(.+)$/i) ||
    s.match(/^(\d+)\s+(.+)$/);
  if (match) {
    return { quantity: match[1].trim(), name: match[2].trim() };
  }
  return { name: s };
}

/** Check if inventory has an item that likely matches this ingredient (by name). */
function isInInventory(ingredient: string, inventory: InventoryItem[]): boolean {
  const core = coreName(ingredient);
  if (!core) return false;
  const invNames = inventory.map((i) => i.name.trim().toLowerCase());
  return invNames.some((inv) => inv.includes(core) || core.includes(inv));
}

/**
 * Returns recipe ingredients that are not in the user's inventory,
 * parsed into name + quantity so the shopping list shows them cleanly (e.g. "water" + "100 ml").
 */
export function getMissingIngredientsForRecipe(
  recipe: Recipe,
  inventory: InventoryItem[]
): { name: string; quantity?: string }[] {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  return ingredients
    .filter((ing) => typeof ing === 'string' && ing.trim() && !isInInventory(ing.trim(), inventory))
    .map((ing) => parseIngredientLine((ing as string).trim()));
}
