
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppView, Recipe, AppSettings, DEFAULT_APP_SETTINGS, VOICE_LANGUAGE_OPTIONS, getBrowserVoiceLanguage, hasShownLanguagePrompt, setLanguagePromptShown, hasShownDietarySurvey, setDietarySurveyShown } from './types';
import type { UserPreferences } from './types';
import RecipeCard from './components/RecipeCard';
import CookingMode from './components/CookingMode';
import RecipeSetup from './components/RecipeSetup';
import IngredientScanner from './components/IngredientScanner';
import CreateFromYouTube from './components/CreateFromYouTube';
import CreateFromChat from './components/CreateFromChat';
import Login from './components/Login';
import Profile from './components/Profile';
import Settings from './components/Settings';
import Inventory from './components/Inventory';
import DietarySurvey from './components/DietarySurvey';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DEFAULT_RECIPE_IMAGE } from './constants';
import { getAllRecipes, getAppSettings, saveAppSettings, getPreferences, savePreferences, updateRecipeInDB, getInventory, addShoppingListItems } from './services/dbService';
import { getMissingIngredientsForRecipe } from './services/shoppingListService';
import { subscribeToAuthState } from './services/authService';
import type { User } from 'firebase/auth';

const BOTTOM_NAV_VIEWS: AppView[] = [
  AppView.Home,
  AppView.Inventory,
  AppView.Profile,
  AppView.RecipeDetail,
  AppView.RecipeSetup,
  AppView.CreateFromYouTube,
  AppView.CreateFromChat,
];

const App: React.FC = () => {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>(AppView.Home);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [scaledRecipe, setScaledRecipe] = useState<Recipe | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showRecipePrepMenu, setShowRecipePrepMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  /** Sort order for recipe list: recent (default), name, difficulty, time. */
  const [recipeSort, setRecipeSort] = useState<'recent' | 'name' | 'difficulty' | 'time'>('recent');
  /** When set, show the "use browser language for voice?" prompt once at start. */
  const [languagePromptOption, setLanguagePromptOption] = useState<{ code: string; label: string } | null>(null);
  const languagePromptCheckedRef = useRef(false);
  /** Toast after adding recipe to shopping list (for "all in inventory" or error). */
  const [shoppingListToast, setShoppingListToast] = useState<string | null>(null);
  /** When true, show "Want to see shopping list? Yes / No" bar after adding items. */
  const [showShoppingListPrompt, setShowShoppingListPrompt] = useState(false);
  const [shoppingListAdding, setShoppingListAdding] = useState(false);
  /** User dietary/allergy preferences (loaded with app data). */
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  /** Show one-time dietary survey (after language prompt if that was shown). */
  const [showDietarySurvey, setShowDietarySurvey] = useState(false);
  const dietarySurveyCheckedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setAuthUser(user);
      setAuthChecked(true);
    });
    return () => unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!authUser) return;
    setLoadError(null);
    setIsLoading(true);
    try {
      const uid = authUser.uid;
      const [dbRecipes, dbSettings, dbPrefs] = await Promise.all([
        getAllRecipes(uid),
        getAppSettings(uid),
        getPreferences(uid),
      ]);
      setRecipes(dbRecipes);
      setAppSettings(dbSettings);
      setUserPreferences(dbPrefs);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load recipes and settings.";
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [authUser]);

  useEffect(() => {
    if (!authUser) {
      setIsLoading(false);
      return;
    }
    loadData();
  }, [authUser, loadData]);

  // One-time prompt at start: ask if user wants to use browser language for voice (based on navigator.language).
  useEffect(() => {
    if (!authChecked || languagePromptCheckedRef.current || hasShownLanguagePrompt()) return;
    if (authUser && isLoading) return;
    languagePromptCheckedRef.current = true;
    const detected = getBrowserVoiceLanguage();
    if (detected) setLanguagePromptOption(detected);
  }, [authChecked, authUser, isLoading]);

  // One-time dietary survey at start (after language prompt is dismissed, or if no language prompt).
  useEffect(() => {
    if (!authUser || isLoading || dietarySurveyCheckedRef.current || hasShownDietarySurvey()) return;
    if (languagePromptOption) return; // Wait until language prompt is gone.
    dietarySurveyCheckedRef.current = true;
    setShowDietarySurvey(true);
  }, [authUser, isLoading, languagePromptOption]);

  const handleUseDetectedLanguage = useCallback(() => {
    if (!languagePromptOption) return;
    const next = { ...appSettings, voiceLanguage: languagePromptOption.code };
    setAppSettings(next);
    if (authUser) {
      saveAppSettings(authUser.uid, next).catch(() => {});
    }
    setLanguagePromptShown();
    setLanguagePromptOption(null);
  }, [languagePromptOption, appSettings, authUser]);

  const handleKeepCurrentLanguage = useCallback(() => {
    setLanguagePromptShown();
    setLanguagePromptOption(null);
  }, []);

  const handleDietarySurveySave = useCallback(
    async (prefs: UserPreferences) => {
      if (authUser) {
        await savePreferences(authUser.uid, prefs);
        setUserPreferences(prefs);
      }
      setDietarySurveyShown();
      setShowDietarySurvey(false);
    },
    [authUser]
  );

  const handleDietarySurveySkip = useCallback(() => {
    setDietarySurveyShown();
    setShowDietarySurvey(false);
  }, []);

  const filteredRecipes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? recipes.filter((r) => {
          const title = (r.title ?? '').toLowerCase();
          const description = (r.description ?? '').toLowerCase();
          const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
          return (
            title.includes(q) ||
            description.includes(q) ||
            ingredients.some((ing) => String(ing).toLowerCase().includes(q))
          );
        })
      : [...recipes];

    const difficultyOrder = { Easy: 0, Medium: 1, Hard: 2 };
    const parseMinutes = (s: string): number => {
      if (!s || typeof s !== 'string') return 0;
      const m = s.match(/(\d+)\s*min/);
      const h = s.match(/(\d+)\s*h(r)?/);
      if (h) return parseInt(h[1], 10) * 60;
      if (m) return parseInt(m[1], 10);
      return 0;
    };
    const totalMinutes = (r: Recipe) => parseMinutes(r.prepTime) + parseMinutes(r.cookTime);

    if (recipeSort === 'recent') {
      list.sort((a, b) => {
        const aPrepared = a.lastPreparedAt ?? '';
        const bPrepared = b.lastPreparedAt ?? '';
        if (aPrepared !== bPrepared) return bPrepared.localeCompare(aPrepared);
        const aViewed = a.lastViewedAt ?? '';
        const bViewed = b.lastViewedAt ?? '';
        return bViewed.localeCompare(aViewed);
      });
    } else if (recipeSort === 'name') {
      list.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' }));
    } else if (recipeSort === 'difficulty') {
      list.sort((a, b) => difficultyOrder[a.difficulty] - difficultyOrder[b.difficulty]);
    } else if (recipeSort === 'time') {
      list.sort((a, b) => totalMinutes(a) - totalMinutes(b));
    }
    return list;
  }, [recipes, searchQuery, recipeSort]);

  const handleRecipeClick = (recipe: Recipe) => {
    const updated = { ...recipe, lastViewedAt: new Date().toISOString() };
    setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? updated : r)));
    setSelectedRecipe(updated);
    setCurrentView(AppView.RecipeDetail);
    if (authUser) {
      updateRecipeInDB(authUser.uid, updated).catch(() => {});
    }
  };

  const goToSetup = () => {
    setCurrentView(AppView.RecipeSetup);
  };

  const onSetupComplete = (newRecipe: Recipe) => {
    const prepared = { ...newRecipe, lastPreparedAt: new Date().toISOString() };
    setRecipes((prev) => prev.map((r) => (r.id === newRecipe.id ? prepared : r)));
    setScaledRecipe(prepared);
    setCurrentView(AppView.CookingMode);
    if (authUser) {
      updateRecipeInDB(authUser.uid, prepared).catch(() => {});
    }
  };

  const handleScannedRecipe = (rec: any) => {
    // For the prototype, we create a temporary recipe object
    // In a real app, this would be fetched from a database or fully generated by AI
    const newRecipe: Recipe = {
      id: rec.id || Math.random().toString(),
      title: rec.title,
      description: rec.description,
      image: DEFAULT_RECIPE_IMAGE,
      difficulty: 'Medium',
      cookTime: '20 min',
      prepTime: '10 min',
      servings: 2,
      ingredients: ['Scanned ingredients used...'],
      steps: ['Step 1: Prep your ingredients', 'Step 2: Cook according to recipe details', 'Step 3: Enjoy!']
    };
    setSelectedRecipe(newRecipe);
    setCurrentView(AppView.RecipeDetail);
  };

  const addRecipeToShoppingList = useCallback(async () => {
    if (!authUser || !selectedRecipe) return;
    setShoppingListAdding(true);
    setShoppingListToast(null);
    setShowShoppingListPrompt(false);
    try {
      const inventory = await getInventory(authUser.uid);
      const missing = getMissingIngredientsForRecipe(selectedRecipe, inventory);
      if (missing.length === 0) {
        setShoppingListToast('You have all ingredients in your inventory.');
        setTimeout(() => setShoppingListToast(null), 4000);
      } else {
        await addShoppingListItems(authUser.uid, missing.map((m) => ({
          name: m.name,
          quantity: m.quantity,
          sourceRecipeId: selectedRecipe.id,
          sourceRecipeTitle: selectedRecipe.title,
        })));
        setShowShoppingListPrompt(true);
      }
    } catch {
      setShoppingListToast('Failed to add to shopping list.');
      setTimeout(() => setShoppingListToast(null), 4000);
    } finally {
      setShoppingListAdding(false);
    }
  }, [authUser, selectedRecipe]);

  const renderLoading = (message: string) => (
    <div className="max-w-md mx-auto h-screen flex items-center justify-center bg-[#fcfcf9]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-stone-400 font-bold text-xs uppercase tracking-widest">{message}</p>
      </div>
    </div>
  );

  if (!authChecked) return renderLoading('Loading...');
  if (!authUser) return (
    <ErrorBoundary>
      <Login onSuccess={() => {}} />
    </ErrorBoundary>
  );
  if (isLoading) return renderLoading('Initializing...');
  if (loadError) {
    return (
      <div className="max-w-md mx-auto min-h-screen bg-[#fcfcf9] flex flex-col items-center justify-center px-6">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-stone-800 text-center mb-2">Couldn't load your data</h2>
        <p className="text-stone-500 text-sm text-center mb-6">{loadError}</p>
        <button
          onClick={() => loadData()}
          className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-2xl hover:bg-emerald-700 active:scale-[0.98] transition-all"
        >
          Try again
        </button>
      </div>
    );
  }

  const renderHome = () => (
    <div className="space-y-8 pb-24">
      <header className="px-6 pt-8 space-y-1">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Hello, Chef!</h1>
        <p className="text-stone-500 text-sm">What are we cooking today?</p>
      </header>

      <div className="px-6">
        <div className="relative">
          <span className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-stone-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search recipes or ingredients..."
            className="w-full bg-white border border-stone-200 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all text-sm placeholder:text-stone-400"
          />
        </div>
      </div>

      <section className="px-6 space-y-5">
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-stone-900 tracking-tight">My Recipes</h2>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 scrollbar-none">
            {(['recent', 'name', 'difficulty', 'time'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRecipeSort(key)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  recipeSort === key
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {key === 'recent' && 'Recent'}
                {key === 'name' && 'Name'}
                {key === 'difficulty' && 'Difficulty'}
                {key === 'time' && 'Time'}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
          {filteredRecipes.map(recipe => (
            <RecipeCard key={recipe.id} recipe={recipe} onClick={handleRecipeClick} />
          ))}
        </div>
        {searchQuery.trim() && filteredRecipes.length === 0 && (
          <p className="text-stone-500 text-sm py-4">No recipes match &quot;{searchQuery.trim()}&quot;.</p>
        )}
      </section>
    </div>
  );

  const renderRecipeDetail = () => {
    if (!selectedRecipe) return null;
    return (
      <div className="bg-white min-h-screen pb-32 animate-in fade-in duration-300">
        <div className="relative h-[40vh]">
          <img
            src={selectedRecipe.image}
            alt={selectedRecipe.title}
            className="w-full h-full object-cover"
          />
          <button
            onClick={() => { setShowShoppingListPrompt(false); setCurrentView(AppView.Home); }}
            className="absolute top-8 left-6 p-2 bg-white/90 backdrop-blur-sm rounded-xl text-stone-800 shadow-md z-10"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          </button>
        </div>

        <div className="px-6 pt-8 space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-stone-800 tracking-tight">{selectedRecipe.title}</h1>
            <p className="text-stone-500 leading-relaxed">{selectedRecipe.description}</p>
          </div>

          <div className="flex justify-between items-center py-4 border-y border-stone-100">
            <div className="text-center">
              <p className="text-xs text-stone-400 font-bold uppercase mb-1">Time</p>
              <p className="font-bold text-stone-800">{selectedRecipe.cookTime}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-stone-400 font-bold uppercase mb-1">Level</p>
              <p className="font-bold text-stone-800">{selectedRecipe.difficulty}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-stone-400 font-bold uppercase mb-1">Serves</p>
              <p className="font-bold text-stone-800">{selectedRecipe.servings}</p>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-bold text-stone-800">Ingredients</h2>
            <ul className="space-y-3">
              {selectedRecipe.ingredients.map((ing, i) => (
                <li key={i} className="flex items-center gap-3 text-stone-600">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                  {ing}
                </li>
              ))}
            </ul>
            {authUser && (
              <button
                type="button"
                onClick={addRecipeToShoppingList}
                disabled={shoppingListAdding}
                className="w-full py-3 rounded-xl border-2 border-dashed border-stone-200 text-stone-600 font-medium text-sm hover:border-emerald-400 hover:text-emerald-700 hover:bg-emerald-50/50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {shoppingListAdding ? (
                  <>
                    <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    Checking inventory…
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                    Add missing to shopping list
                  </>
                )}
              </button>
            )}
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-bold text-stone-800">Instructions</h2>
            <div className="space-y-6">
              {selectedRecipe.steps.map((step, i) => (
                <div key={i} className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-sm font-bold text-stone-500">
                    {i + 1}
                  </span>
                  <p className="text-stone-600 leading-relaxed pt-1">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {shoppingListToast && (
          <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[60] max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-xl bg-stone-800 text-white text-sm font-medium text-center shadow-lg">
            {shoppingListToast}
          </div>
        )}
        {showShoppingListPrompt && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-xl bg-stone-800 text-white shadow-lg flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Want to see shopping list?</span>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowShoppingListPrompt(false);
                  setCurrentView(AppView.Inventory);
                }}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 active:scale-[0.98] transition-all"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setShowShoppingListPrompt(false)}
                className="px-4 py-2 rounded-lg bg-stone-600 text-white text-sm font-medium hover:bg-stone-500 active:scale-[0.98] transition-all"
              >
                No
              </button>
            </div>
          </div>
        )}
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="w-full max-w-md p-6 pt-20 pointer-events-auto bg-gradient-to-t from-white via-white to-white/0">
            <button
              onClick={goToSetup}
              className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-emerald-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              PREPARE RECIPE
            </button>
          </div>
        </div>
      </div>
    );
  };

  const currentVoiceLabel = VOICE_LANGUAGE_OPTIONS.find((o) => o.code === appSettings.voiceLanguage)?.label ?? 'English';

  return (
    <div className="max-w-md mx-auto min-h-screen bg-[#fcfcf9] shadow-2xl relative">
      {languagePromptOption && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-labelledby="language-prompt-title">
          <div className="bg-white rounded-2xl shadow-xl border border-stone-200 max-w-sm w-full p-5 space-y-4">
            <h2 id="language-prompt-title" className="text-base font-bold text-stone-800">
              Voice language
            </h2>
            <p className="text-sm text-stone-600">
              We detected your browser language as <strong>{languagePromptOption.label}</strong>. Use it for voice responses in cooking mode?
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={handleUseDetectedLanguage}
                className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm active:scale-[0.98] transition-transform"
              >
                Use {languagePromptOption.label}
              </button>
              <button
                type="button"
                onClick={handleKeepCurrentLanguage}
                className="w-full py-3 rounded-xl bg-stone-100 text-stone-700 font-medium text-sm hover:bg-stone-200 active:scale-[0.98] transition-transform"
              >
                No, keep {currentVoiceLabel}
              </button>
            </div>
          </div>
        </div>
      )}
      {showDietarySurvey && (
        <DietarySurvey
          initialPreferences={userPreferences}
          onSave={handleDietarySurveySave}
          onSkip={handleDietarySurveySkip}
        />
      )}
      {currentView === AppView.Home && (
        <ErrorBoundary>
          {renderHome()}
        </ErrorBoundary>
      )}
      {currentView === AppView.RecipeDetail && (
        <ErrorBoundary onReset={() => { setShowShoppingListPrompt(false); setCurrentView(AppView.Home); }}>
          {renderRecipeDetail()}
        </ErrorBoundary>
      )}
      {currentView === AppView.RecipeSetup && selectedRecipe && authUser && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.RecipeDetail)}>
          <RecipeSetup
            recipe={selectedRecipe}
            onComplete={onSetupComplete}
            onCancel={() => setCurrentView(AppView.RecipeDetail)}
            appSettings={appSettings}
            userId={authUser.uid}
          />
        </ErrorBoundary>
      )}
      {currentView === AppView.CookingMode && scaledRecipe && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.RecipeDetail)}>
          <CookingMode
            recipe={scaledRecipe}
            onExit={() => setCurrentView(AppView.RecipeDetail)}
            appSettings={appSettings}
            userId={authUser?.uid}
          />
        </ErrorBoundary>
      )}
      {currentView === AppView.Scanner && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Home)}>
          <IngredientScanner
            onClose={() => setCurrentView(AppView.Home)}
            onSelectRecipe={handleScannedRecipe}
          />
        </ErrorBoundary>
      )}
      {currentView === AppView.Inventory && authUser && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Home)}>
          <Inventory userId={authUser.uid} />
        </ErrorBoundary>
      )}
      {currentView === AppView.Profile && authUser && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Home)}>
          <Profile
            user={authUser}
            onBack={() => setCurrentView(AppView.Home)}
            onOpenSettings={() => setCurrentView(AppView.Settings)}
          />
        </ErrorBoundary>
      )}
      {currentView === AppView.Settings && authUser && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Profile)}>
          <Settings
            userId={authUser.uid}
            onBack={() => setCurrentView(AppView.Profile)}
            onSaved={(s) => setAppSettings(s)}
            onPreferencesSaved={setUserPreferences}
          />
        </ErrorBoundary>
      )}
      {currentView === AppView.CreateFromYouTube && authUser && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Home)}>
          <CreateFromYouTube
            userId={authUser.uid}
            savedPreferences={userPreferences}
            onPreferencesUpdated={setUserPreferences}
            onCreated={(recipe) => {
              setRecipes((prev) => [...prev.filter((r) => r.id !== recipe.id), recipe]);
              setSelectedRecipe(recipe);
              setCurrentView(AppView.RecipeDetail);
            }}
            onCancel={() => setCurrentView(AppView.Home)}
          />
        </ErrorBoundary>
      )}
      {currentView === AppView.CreateFromChat && authUser && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Home)}>
          <CreateFromChat
            userId={authUser.uid}
            savedPreferences={userPreferences}
            onPreferencesUpdated={setUserPreferences}
            onCreated={(recipe) => {
              setRecipes((prev) => [...prev.filter((r) => r.id !== recipe.id), recipe]);
              setSelectedRecipe(recipe);
              setCurrentView(AppView.RecipeDetail);
            }}
            onCancel={() => setCurrentView(AppView.Home)}
          />
        </ErrorBoundary>
      )}

      {BOTTOM_NAV_VIEWS.includes(currentView) && (
        <>
          <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/80 backdrop-blur-md border-t border-stone-200 px-4 py-3 flex items-center justify-between gap-1 z-40">
            <button
              onClick={() => setCurrentView(AppView.Home)}
              className={`p-2 rounded-xl transition-colors ${currentView === AppView.Home ? 'text-emerald-600 bg-emerald-50' : 'text-stone-400'}`}
              title="Home"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7-7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            </button>
            <button
              onClick={() => setCurrentView(AppView.Inventory)}
              className={`p-2 rounded-xl transition-colors ${currentView === AppView.Inventory ? 'text-emerald-600 bg-emerald-50' : 'text-stone-400'}`}
              title="Grocery inventory"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            </button>
            <button
              onClick={() => setShowRecipePrepMenu(true)}
              className={`p-2 rounded-xl transition-colors ${showRecipePrepMenu ? 'text-emerald-600 bg-emerald-50' : 'text-stone-400'}`}
              title="Recipe prep"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
            </button>
            <button
              onClick={() => setCurrentView(AppView.Profile)}
              className={`p-2 rounded-xl transition-colors ${currentView === AppView.Profile ? 'text-emerald-600 bg-emerald-50' : 'text-stone-400'}`}
              title="Profile"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </button>
          </nav>

          {showRecipePrepMenu && (
            <>
              <div
                className="fixed inset-0 z-50 bg-black/40"
                onClick={() => setShowRecipePrepMenu(false)}
                aria-hidden="true"
              />
              <div className="fixed bottom-20 left-1/2 -translate-x-1/2 max-w-md w-[calc(100%-2rem)] z-50 bg-white rounded-2xl shadow-xl border border-stone-100 overflow-hidden">
                <div className="p-2">
                  <p className="px-3 py-2 text-xs font-semibold text-stone-400 uppercase tracking-wider">Recipe prep</p>
                  <button
                    onClick={() => {
                      setShowRecipePrepMenu(false);
                      setCurrentView(AppView.CreateFromYouTube);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                      <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-stone-800">Create from YouTube</p>
                      <p className="text-xs text-stone-500">Turn a video into a recipe with timestamps</p>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setShowRecipePrepMenu(false);
                      setCurrentView(AppView.CreateFromChat);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
                      <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-stone-800">Describe a dish</p>
                      <p className="text-xs text-stone-500">Name or describe a recipe to create and prepare</p>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setShowRecipePrepMenu(false);
                      setCurrentView(AppView.Scanner);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-stone-800">Scan ingredients</p>
                      <p className="text-xs text-stone-500">AI suggests recipes from your pantry</p>
                    </div>
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default App;
