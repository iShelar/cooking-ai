
import { Recipe, UserPreferences } from '../types';
import { MOCK_RECIPES } from '../constants';

// Declare sql.js global since we load it via script tag
declare const initSqlJs: any;

let db: any = null;
const DB_NAME = 'cookai_db';
const STORE_NAME = 'sqlite_file';

/**
 * Persists the current SQLite DB state to IndexedDB
 */
const persistToIndexedDB = async () => {
  if (!db) return;
  const binaryArray = db.export();
  const request = indexedDB.open(DB_NAME, 1);
  
  request.onupgradeneeded = (e: any) => {
    const dbInst = e.target.result;
    if (!dbInst.objectStoreNames.contains(STORE_NAME)) {
      dbInst.createObjectStore(STORE_NAME);
    }
  };

  request.onsuccess = (e: any) => {
    const dbInst = e.target.result;
    const transaction = dbInst.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(binaryArray, 'db_file');
  };
};

/**
 * Loads the SQLite DB state from IndexedDB
 */
const loadFromIndexedDB = (): Promise<Uint8Array | null> => {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e: any) => {
      const dbInst = e.target.result;
      if (!dbInst.objectStoreNames.contains(STORE_NAME)) {
        dbInst.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e: any) => {
      const dbInst = e.target.result;
      const transaction = dbInst.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get('db_file');
      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => resolve(null);
    };
    request.onerror = () => resolve(null);
  });
};

export const initDB = async () => {
  if (db) return db;

  const SQL = await initSqlJs({
    locateFile: (file: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/${file}`
  });

  const savedBuffer = await loadFromIndexedDB();
  db = savedBuffer ? new SQL.Database(savedBuffer) : new SQL.Database();

  // Create Tables if they don't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      prepTime TEXT,
      cookTime TEXT,
      difficulty TEXT,
      servings INTEGER,
      image TEXT,
      ingredients TEXT,
      steps TEXT,
      calories INTEGER
    );
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Seed data if empty
  const count = db.exec("SELECT COUNT(*) FROM recipes")[0].values[0][0];
  if (count === 0) {
    for (const r of MOCK_RECIPES) {
      db.run(`INSERT INTO recipes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        r.id, r.title, r.description, r.prepTime, r.cookTime, r.difficulty, 
        r.servings, r.image, JSON.stringify(r.ingredients), JSON.stringify(r.steps), r.calories || 0
      ]);
    }
    await persistToIndexedDB();
  }

  return db;
};

export const getAllRecipes = async (): Promise<Recipe[]> => {
  await initDB();
  const res = db.exec("SELECT * FROM recipes");
  if (res.length === 0) return [];
  
  const columns = res[0].columns;
  return res[0].values.map((row: any[]) => {
    const obj: any = {};
    columns.forEach((col: string, idx: number) => {
      let val = row[idx];
      if (col === 'ingredients' || col === 'steps') val = JSON.parse(val);
      obj[col] = val;
    });
    return obj as Recipe;
  });
};

export const updateRecipeInDB = async (recipe: Recipe) => {
  await initDB();
  db.run(`
    UPDATE recipes SET 
      servings = ?, 
      ingredients = ?, 
      steps = ? 
    WHERE id = ?`, 
    [recipe.servings, JSON.stringify(recipe.ingredients), JSON.stringify(recipe.steps), recipe.id]
  );
  await persistToIndexedDB();
};

export const savePreferences = async (prefs: UserPreferences) => {
  await initDB();
  db.run(`INSERT OR REPLACE INTO preferences VALUES ('user_prefs', ?)`, [JSON.stringify(prefs)]);
  await persistToIndexedDB();
};

export const getPreferences = async (): Promise<UserPreferences | null> => {
  await initDB();
  const res = db.exec("SELECT value FROM preferences WHERE key = 'user_prefs'");
  if (res.length === 0) return null;
  return JSON.parse(res[0].values[0][0]);
};
