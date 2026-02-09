import { Recipe } from '../types';
import type { InventoryItem } from '../types';

/** Extract a core ingredient name for matching (e.g. "200g spaghetti" -> "spaghetti"). */
function coreName(ingredient: string): string {
  const lower = ingredient.trim().toLowerCase();
  const withoutLeadingNumber = lower.replace(/^[\d.,]+\s*(g|kg|ml|l|lb|oz|tbsp|tsp|cup|cups)?\s*/i, '').trim();
  return withoutLeadingNumber || lower;
}

/**
 * Reduce a long ingredient name to a short, canonical form for display in shopping list and inventory.
 * e.g. "fresh basil leaves" -> "basil", "cloves garlic, minced" -> "garlic", "extra-virgin olive oil" -> "olive oil"
 */
export function toShortIngredientName(ingredientName: string): string {
  let s = (ingredientName ?? '').trim().toLowerCase();
  if (!s) return '';

  // Take main part before comma (e.g. "garlic, minced" -> "garlic")
  const commaIdx = s.indexOf(',');
  if (commaIdx !== -1) s = s.slice(0, commaIdx).trim();

  // Remove parentheticals
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();

  // Remove common leading modifiers (order matters for multi-word)
  const leadingModifiers = [
    'fresh ', 'dried ', 'frozen ', 'canned ', 'raw ', 'cooked ',
    'extra-virgin ', 'virgin ', 'all-purpose ', 'plain ', 'self-rising ',
    'unsalted ', 'salted ', 'whole ', 'low-fat ', 'full-fat ', 'non-fat ',
    'large ', 'medium ', 'small ', 'minced ', 'chopped ', 'diced ', 'sliced ',
    'grated ', 'crushed ', 'whole ', 'ground ', 'boneless ', 'skinless ',
  ];
  for (const mod of leadingModifiers) {
    if (s.startsWith(mod)) {
      s = s.slice(mod.length).trim();
      break;
    }
  }

  // Remove common trailing words that are descriptors, not the main noun
  const trailingWords = /\s+(leaves?|sprigs?|cloves?|stalks?|pieces?|slices?|cubes?|strips?|fillet|breast|thighs?|wings?|legs?)$/i;
  s = s.replace(trailingWords, '').trim();

  // Remove any remaining trailing comma fragments and trim
  s = s.replace(/,+\s*$/, '').trim();

  // Collapse multiple spaces
  s = s.replace(/\s+/g, ' ').trim();

  return s || (ingredientName ?? '').trim().toLowerCase();
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

/** Parse quantity string to number (e.g. "8" -> 8, "3 eggs" -> 3). Default 1 if missing or unparseable. */
function parseQuantityToNumber(q: string | undefined): number {
  if (!q?.trim()) return 1;
  const m = q.trim().match(/^(\d+(?:\.\d+)?)/);
  return m ? Math.max(0, parseFloat(m[1])) : 1;
}

/** Parse quantity string to { num, unit } for preserving unit when updating (e.g. "8 eggs" -> { num: 8, unit: "eggs" }). */
function parseQuantityWithUnit(q: string | undefined): { num: number; unit: string } {
  if (!q?.trim()) return { num: 1, unit: '' };
  const m = q.trim().match(/^(\d+(?:\.\d+)?)\s*(\S*)$/);
  if (m) return { num: Math.max(0, parseFloat(m[1])), unit: (m[2] ?? '').trim() };
  return { num: 1, unit: '' };
}

/** Check if inventory has an item that likely matches this ingredient (by name). */
function isInInventory(ingredient: string, inventory: InventoryItem[]): boolean {
  const core = coreName(ingredient);
  if (!core) return false;
  const invNames = inventory.map((i) => i.name.trim().toLowerCase());
  return invNames.some((inv) => inv.includes(core) || core.includes(inv));
}

/**
 * Returns raw recipe ingredient lines that are not in the user's inventory.
 * Use with normalizeIngredients (Gemini) for short name + quantity, or parse locally as fallback.
 */
export function getMissingIngredientLines(recipe: Recipe, inventory: InventoryItem[]): string[] {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  return ingredients
    .filter((ing) => typeof ing === 'string' && ing.trim() && !isInInventory(ing.trim(), inventory))
    .map((ing) => (ing as string).trim());
}

/**
 * Returns recipe ingredients that are not in the user's inventory,
 * as short name + quantity (rule-based). Use when Gemini normalize is unavailable.
 */
export function getMissingIngredientsForRecipe(
  recipe: Recipe,
  inventory: InventoryItem[]
): { name: string; quantity?: string }[] {
  const lines = getMissingIngredientLines(recipe, inventory);
  return lines.map((line) => {
    const parsed = parseIngredientLine(line);
    return {
      name: toShortIngredientName(parsed.name),
      quantity: parsed.quantity,
    };
  });
}

function nameMatches(ingCore: string, inv: InventoryItem): boolean {
  const invCore = coreName(inv.name);
  const invShort = toShortIngredientName(inv.name);
  const ingShort = toShortIngredientName(ingCore);
  return (
    invCore === ingCore ||
    invShort === ingShort ||
    inv.name.trim().toLowerCase().includes(ingCore) ||
    ingCore.includes(inv.name.trim().toLowerCase()) ||
    ingShort.includes(invShort) ||
    invShort.includes(ingShort)
  );
}

/**
 * Returns per-item updates when the user has finished the recipe: subtract used amounts by quantity.
 * Each recipe ingredient is matched to one inventory item by name; same ingredient lines subtract from the same item.
 * Returns { itemId, newQuantity } where newQuantity is null (remove item) or the new quantity string.
 */
export function getInventoryUpdatesForRecipe(
  recipe: Recipe,
  inventory: InventoryItem[]
): { itemId: string; newQuantity: string | null }[] {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const coreToInvId: Record<string, string> = {};
  const remaining: Record<string, { current: number; unit: string }> = {};

  for (const line of ingredients) {
    const s = typeof line === 'string' ? line.trim() : '';
    if (!s) continue;
    const parsed = parseIngredientLine(s);
    const ingCore = coreName(parsed.name);
    if (!ingCore) continue;
    const invItem = inventory.find((inv) => nameMatches(ingCore, inv));
    if (!invItem) continue;
    const invId = invItem.id;
    if (!coreToInvId[ingCore]) coreToInvId[ingCore] = invId;
    const assignedId = coreToInvId[ingCore];
    if (remaining[assignedId] === undefined) {
      const { num, unit } = parseQuantityWithUnit(invItem.quantity);
      remaining[assignedId] = { current: num, unit };
    }
    const useAmount = parseQuantityToNumber(parsed.quantity);
    remaining[assignedId].current -= useAmount;
  }

  return Object.entries(remaining).map(([itemId, { current, unit }]) => ({
    itemId,
    newQuantity: current <= 0 ? null : (unit ? `${current} ${unit}`.trim() : String(current)),
  }));
}

/**
 * Returns inventory item IDs to remove when the user has finished the recipe (ingredients used).
 * @deprecated Use getInventoryUpdatesForRecipe for quantity-based subtraction instead.
 */
export function getInventoryIdsToSubtractForRecipe(
  recipe: Recipe,
  inventory: InventoryItem[]
): string[] {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const usedIds = new Set<string>();
  const ids: string[] = [];
  for (const line of ingredients) {
    const s = typeof line === 'string' ? line.trim() : '';
    if (!s) continue;
    const parsed = parseIngredientLine(s);
    const ingCore = coreName(parsed.name);
    if (!ingCore) continue;
    const invItem = inventory.find(
      (inv) => !usedIds.has(inv.id) && nameMatches(ingCore, inv)
    );
    if (invItem) {
      usedIds.add(invItem.id);
      ids.push(invItem.id);
    }
  }
  return ids;
}
