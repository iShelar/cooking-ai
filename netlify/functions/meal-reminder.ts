/**
 * Scheduled function: runs every 15 minutes (UTC).
 * For each user with a stored FCM token, checks if current time is within their meal reminder window.
 * If so, computes recipe suggestions (inventory-based) and sends a push notification.
 */
import type { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import * as admin from 'firebase-admin';

const PUSH_SUBSCRIPTIONS = 'pushSubscriptions';
const MIN_INGREDIENTS_IN_INVENTORY = 2;
const REMINDER_WINDOW_MINUTES = 15;

interface RecipeDoc {
  id: string;
  title: string;
  ingredients?: string[];
  lastPreparedAt?: string;
}

interface InventoryDoc {
  id: string;
  name: string;
  quantity?: string;
}

function coreName(ingredient: string): string {
  const lower = ingredient.trim().toLowerCase();
  const without = lower.replace(/^[\d.,]+\s*(g|kg|ml|l|lb|oz|tbsp|tsp|cup|cups)?\s*/i, '').trim();
  return without || lower;
}

function isInInventory(ingredient: string, inventory: InventoryDoc[]): boolean {
  const core = coreName(ingredient);
  if (!core) return false;
  const invNames = inventory.map((i) => (i.name ?? '').trim().toLowerCase());
  return invNames.some((inv) => inv.includes(core) || core.includes(inv));
}

function countInInventory(recipe: RecipeDoc, inventory: InventoryDoc[]): number {
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients.filter((i): i is string => typeof i === 'string' && i.trim()) : [];
  if (ingredients.length === 0) return 0;
  let count = 0;
  for (const ing of ingredients) {
    if (isInInventory(ing.trim(), inventory)) count++;
  }
  return count;
}

function getSuggestedRecipeTitles(
  recipes: RecipeDoc[],
  likedRecipeIds: string[],
  inventory: InventoryDoc[],
  limit: number
): string[] {
  if (!inventory.length) return [];
  const likedSet = new Set(likedRecipeIds);
  const candidate = recipes.filter((r) => countInInventory(r, inventory) >= MIN_INGREDIENTS_IN_INVENTORY);
  const liked: RecipeDoc[] = [];
  for (const id of likedRecipeIds) {
    const r = candidate.find((c) => c.id === id);
    if (r) liked.push(r);
  }
  const cooked = candidate.filter((r) => !likedSet.has(r.id) && r.lastPreparedAt);
  const added = candidate.filter((r) => !likedSet.has(r.id) && !r.lastPreparedAt);
  cooked.sort((a, b) => (b.lastPreparedAt ?? '').localeCompare(a.lastPreparedAt ?? ''));
  const ordered = [...liked, ...cooked, ...added];
  return ordered.slice(0, limit).map((r) => r.title || 'Recipe').filter(Boolean);
}

function parseTime(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function getAdminApp(): admin.app.App {
  if (!admin.apps.length) {
    const credJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!credJson) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON not set');
    const cred = JSON.parse(credJson);
    admin.initializeApp({ credential: admin.credential.cert(cred) });
  }
  return admin.app();
}

export const config = {
  schedule: '*/15 * * * *',
};

export const handler: Handler = async (_event: HandlerEvent, _context: HandlerContext) => {
  const app = getAdminApp();
  const db = app.firestore();
  const messaging = app.messaging();

  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const subsSnap = await db.collection(PUSH_SUBSCRIPTIONS).get();
  let sent = 0;
  let errors = 0;

  for (const docSnap of subsSnap.docs) {
    const data = docSnap.data();
    const fcmToken = typeof data?.fcmToken === 'string' ? data.fcmToken.trim() : '';
    if (!fcmToken) continue;

    const userId = docSnap.id;

    try {
      const appSettingsSnap = await db.doc(`users/${userId}/appSettings/user`).get();
      const appSettings = appSettingsSnap.data() || {};
      const breakfast = parseTime((appSettings.breakfastReminderTime as string) || '08:00');
      const lunch = parseTime((appSettings.lunchReminderTime as string) || '13:00');
      const dinner = parseTime((appSettings.dinnerReminderTime as string) || '19:00');

      let mealLabel: string | null = null;
      if (utcMinutes >= breakfast && utcMinutes < breakfast + REMINDER_WINDOW_MINUTES) mealLabel = 'Breakfast';
      else if (utcMinutes >= lunch && utcMinutes < lunch + REMINDER_WINDOW_MINUTES) mealLabel = 'Lunch';
      else if (utcMinutes >= dinner && utcMinutes < dinner + REMINDER_WINDOW_MINUTES) mealLabel = 'Dinner';

      if (!mealLabel) continue;

      const [recipesSnap, inventorySnap, prefsSnap] = await Promise.all([
        db.collection(`users/${userId}/recipes`).get(),
        db.collection(`users/${userId}/inventory`).get(),
        db.doc(`users/${userId}/preferences/user`).get(),
      ]);

      const recipes: RecipeDoc[] = recipesSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: (data.title as string) || '',
          ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
          lastPreparedAt: typeof data.lastPreparedAt === 'string' ? data.lastPreparedAt : undefined,
        };
      });

      const inventory: InventoryDoc[] = inventorySnap.docs.map((d) => ({
        id: d.id,
        name: (d.data().name as string) || '',
        quantity: d.data().quantity as string | undefined,
      }));

      const prefs = prefsSnap.data() || {};
      const likedRecipeIds: string[] = Array.isArray(prefs.likedRecipeIds) ? prefs.likedRecipeIds : [];

      const titles = getSuggestedRecipeTitles(recipes, likedRecipeIds, inventory, 2);
      const body = titles.length > 0 ? `Suggested: ${titles.join(', ')}` : 'Check your recipe suggestions.';

      await messaging.send({
        token: fcmToken,
        notification: {
          title: `Time for ${mealLabel.toLowerCase()}!`,
          body,
        },
        webpush: {
          fcmOptions: { link: '/' },
        },
        data: { url: '/', meal: mealLabel },
      });
      sent++;
    } catch (err) {
      console.error(`meal-reminder: user ${userId}`, err);
      errors++;
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, sent, errors }),
  };
};
