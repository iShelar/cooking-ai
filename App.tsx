
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppView, Recipe, AppSettings, DEFAULT_APP_SETTINGS, VOICE_LANGUAGE_OPTIONS, getBrowserVoiceLanguage, hasShownLanguagePrompt, setLanguagePromptShown, hasShownDietarySurvey, setDietarySurveyShown, hasShownRecipeOnboardingTip, setRecipeOnboardingTipShown, hasShownAddRecipeButtonTutorial, setAddRecipeButtonTutorialShown } from './types';
import type { UserPreferences, InventoryItem } from './types';
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
import { DEFAULT_RECIPE_IMAGE, MOCK_RECIPES } from './constants';
import { getAllRecipes, getAppSettings, saveAppSettings, getPreferences, savePreferences, updateRecipeInDB, deleteRecipeInDB, getInventory, addShoppingListItems } from './services/dbService';
import { createShare, getSharedRecipe } from './services/shareService';
import { getMissingIngredientLines, getMissingIngredientsForRecipe } from './services/shoppingListService';
import { normalizeIngredients } from './services/geminiService';
import { getSuggestedRecipes } from './services/suggestionsService';
import { subscribeToAuthState } from './services/authService';
import { checkBackendHealth } from './services/backendHealthService';
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

type HistoryState = { view: AppView; recipeId?: string };

const App: React.FC = () => {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>(AppView.Home);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [scaledRecipe, setScaledRecipe] = useState<Recipe | null>(null);
  const recipesRef = useRef<Recipe[]>([]);
  recipesRef.current = recipes;
  const currentViewRef = useRef<AppView>(AppView.Home);
  currentViewRef.current = currentView;
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showRecipePrepMenu, setShowRecipePrepMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  /** Sort order for recipe list: recent (default), name, difficulty, time, likedVideos. */
  const [recipeSort, setRecipeSort] = useState<'recent' | 'name' | 'difficulty' | 'time' | 'likedVideos'>('recent');
  /** When set, show the "use browser language for voice?" prompt once at start. */
  const [languagePromptOption, setLanguagePromptOption] = useState<{ code: string; label: string } | null>(null);
  const languagePromptCheckedRef = useRef(false);
  /** Toast after adding recipe to shopping list (for "all in inventory" or error). */
  const [shoppingListToast, setShoppingListToast] = useState<string | null>(null);
  /** When true, show "Want to see shopping list? Yes / No" bar after adding items. */
  const [showShoppingListPrompt, setShowShoppingListPrompt] = useState(false);
  /** When set, next time we show Inventory open on this tab (e.g. 'shopping' from the prompt). */
  const [openInventoryOnTab, setOpenInventoryOnTab] = useState<'inventory' | 'shopping' | null>(null);
  const [shoppingListAdding, setShoppingListAdding] = useState(false);
  /** User dietary/allergy preferences (loaded with app data). */
  const [userPreferences, setUserPreferences] = useState<UserPreferences | null>(null);
  /** Inventory (for suggestions by “what you have”). */
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  /** In-app meal reminder message (e.g. "Time for breakfast! Check suggestions."). */
  const [mealReminderToast, setMealReminderToast] = useState<string | null>(null);
  const mealReminderShownRef = useRef<Record<string, boolean>>({});
  /** Suggestion count when user last opened the Suggestions screen; badge clears when they view it and reappears when count exceeds this. */
  const suggestionsCountWhenLastViewedRef = useRef<number>(0);
  /** Show one-time dietary survey (after language prompt if that was shown). */
  const [showDietarySurvey, setShowDietarySurvey] = useState(false);
  const dietarySurveyCheckedRef = useRef(false);
  /** When true, show "Delete recipe?" confirmation dialog. */
  const [showDeleteRecipeConfirm, setShowDeleteRecipeConfirm] = useState(false);
  const [recipeDeleting, setRecipeDeleting] = useState(false);
  /** When true, show onboarding tooltip on empty recipe list (first-time only). */
  const [showRecipeOnboardingTip, setShowRecipeOnboardingTip] = useState(false);
  const recipeOnboardingCheckedRef = useRef(false);
  /** When true, highlight the bottom bar + button and then open recipe prep menu (first-recipe tutorial). */
  const [highlightAddRecipeButton, setHighlightAddRecipeButton] = useState(false);
  const addRecipeTutorialShownRef = useRef(false);
  /** Share link: when opening /share/TOKEN we set these and show SharedRecipe view. */
  const [sharedRecipeToken, setSharedRecipeToken] = useState<string | null>(null);
  const [sharedRecipe, setSharedRecipe] = useState<Recipe | null>(null);
  const [sharedRecipeLoading, setSharedRecipeLoading] = useState(false);
  const [sharedRecipeError, setSharedRecipeError] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [savingSharedRecipe, setSavingSharedRecipe] = useState(false);
  /** When set, show a modal with the share URL and Copy button (fallback when clipboard API is blocked on mobile/PWA). */
  const [shareLinkUrl, setShareLinkUrl] = useState<string | null>(null);
  /** Backend health: null = not checked yet, false = down, true = up. Used to show "Start the backend" banner. */
  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  // On first load, if URL is /share/TOKEN or ?share=TOKEN (Netlify function redirect), show shared recipe view.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const tokenFromPath = path.startsWith('/share/') ? path.slice(7).split('/')[0]?.trim() : null;
    const tokenFromQuery = params.get('share')?.trim() || null;
    const token = tokenFromPath || tokenFromQuery;
    if (token) {
      setSharedRecipeToken(token);
      setCurrentView(AppView.SharedRecipe);
    }
  }, []);

  // When opened from meal reminder notification (?open=suggestions), show Suggestions view once user is logged in.
  useEffect(() => {
    if (typeof window === 'undefined' || !authUser || !authChecked) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('open') !== 'suggestions') return;
    setCurrentView(AppView.Suggestions);
    const cleanUrl = window.location.pathname || '/';
    window.history.replaceState({ view: AppView.Suggestions }, '', cleanUrl);
  }, [authUser, authChecked]);

  // Backend health check: poll periodically and show "Start the backend" banner when down.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const run = async () => {
      const { ok } = await checkBackendHealth();
      if (!cancelled) setBackendUp(ok);
    };
    run();
    const interval = setInterval(run, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAuthState((user) => {
      setAuthUser(user);
      setAuthChecked(true);
      if (!user) {
        const isShareLink =
          typeof window !== 'undefined' &&
          (window.location.pathname.startsWith('/share/') || new URLSearchParams(window.location.search).has('share'));
        setRecipes([]);
        setSelectedRecipe(null);
        setScaledRecipe(null);
        setAppSettings(DEFAULT_APP_SETTINGS);
        setUserPreferences(null);
        setInventory([]);
        setMealReminderToast(null);
        if (!isShareLink) setCurrentView(AppView.Home);
        setLoadError(null);
        setSearchQuery('');
        setRecipeSort('recent');
        setLanguagePromptOption(null);
        setShoppingListToast(null);
        setShowShoppingListPrompt(false);
        setShoppingListAdding(false);
        setShowDietarySurvey(false);
        setShowDeleteRecipeConfirm(false);
        setRecipeDeleting(false);
        setShowRecipeOnboardingTip(false);
        setHighlightAddRecipeButton(false);
        languagePromptCheckedRef.current = false;
        dietarySurveyCheckedRef.current = false;
        recipeOnboardingCheckedRef.current = false;
        addRecipeTutorialShownRef.current = false;
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch shared recipe when viewing a share link.
  useEffect(() => {
    if (currentView !== AppView.SharedRecipe || !sharedRecipeToken) return;
    setSharedRecipeLoading(true);
    setSharedRecipeError(null);
    getSharedRecipe(sharedRecipeToken)
      .then((doc) => {
        if (doc) setSharedRecipe(doc.recipe);
        else setSharedRecipeError("This link doesn't work anymore. It may have been removed or expired.");
      })
      .catch(() => setSharedRecipeError("We couldn't load this recipe. Try again?"))
      .finally(() => setSharedRecipeLoading(false));
  }, [currentView, sharedRecipeToken]);

  const goHomeFromShare = useCallback(() => {
    setCurrentView(AppView.Home);
    setSharedRecipeToken(null);
    setSharedRecipe(null);
    setSharedRecipeError(null);
    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState({ view: AppView.Home } as HistoryState, '', '/');
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!authUser) return;
    setLoadError(null);
    setIsLoading(true);
    try {
      const uid = authUser.uid;
      const [dbRecipes, dbSettings, dbPrefs, dbInventory] = await Promise.all([
        getAllRecipes(uid),
        getAppSettings(uid),
        getPreferences(uid),
        getInventory(uid),
      ]);
      setRecipes(dbRecipes);
      setAppSettings(dbSettings);
      setUserPreferences(dbPrefs);
      setInventory(dbInventory);
    } catch (err) {
      const message = err instanceof Error ? err.message : "We couldn't load your recipes. Give it another try!";
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

  // Sync navigation with browser history so back/forward (and swipe-back on mobile) work.
  // When navigating to Home, replace state instead of push so back from Home doesn't go to previous in-app screens.
  const navigateTo = useCallback((view: AppView, recipe?: Recipe | null) => {
    setCurrentView(view);
    if (recipe) {
      setSelectedRecipe(recipe);
      setScaledRecipe(recipe);
    } else if (view === AppView.Home || view === AppView.Suggestions || view === AppView.Inventory || view === AppView.Profile || view === AppView.Settings || view === AppView.CreateFromYouTube || view === AppView.CreateFromChat || view === AppView.Scanner) {
      setSelectedRecipe(null);
      setScaledRecipe(null);
    }
    const state: HistoryState = { view, recipeId: recipe?.id };
    if (typeof window !== 'undefined' && window.history) {
      if (view === AppView.Home) {
        window.history.replaceState(state, '', window.location.pathname);
      } else {
        window.history.pushState(state, '', window.location.pathname);
      }
    }
  }, []);

  /** Like navigateTo but replaces current history entry (e.g. after creating a recipe so back goes to first screen). */
  const replaceWith = useCallback((view: AppView, recipe?: Recipe | null) => {
    setCurrentView(view);
    if (recipe) {
      setSelectedRecipe(recipe);
      setScaledRecipe(recipe);
    } else {
      setSelectedRecipe(null);
      setScaledRecipe(null);
    }
    const state: HistoryState = { view, recipeId: recipe?.id };
    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState(state, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.history) return;
    if (!window.history.state?.view) {
      window.history.replaceState({ view: AppView.Home } as HistoryState, '', window.location.pathname);
    }
    const onPopState = (e: PopStateEvent) => {
      const state = e.state as HistoryState | null;
      // When we're on Home and user goes back to another Home entry, go back once more to clear in-app history.
      if (currentViewRef.current === AppView.Home && state?.view === AppView.Home) {
        window.history.back();
        return;
      }
      if (state?.view) {
        setCurrentView(state.view);
        if (state.recipeId) {
          const recipe = recipesRef.current.find((r) => r.id === state.recipeId);
          if (recipe) {
            setSelectedRecipe(recipe);
            setScaledRecipe(recipe);
          } else {
            setSelectedRecipe(null);
            setScaledRecipe(null);
          }
        } else {
          setSelectedRecipe(null);
          setScaledRecipe(null);
        }
      } else if (currentViewRef.current === AppView.Home) {
        // Back from Home went past our history (e.g. external); keep user on Home and fix history.
        window.history.replaceState({ view: AppView.Home } as HistoryState, '', window.location.pathname);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Clear "open Inventory on shopping tab" when leaving Inventory so next open uses default tab.
  useEffect(() => {
    if (currentView !== AppView.Inventory) setOpenInventoryOnTab(null);
  }, [currentView]);

  // Meal reminders: show in-app toast when current time is within 15 min of breakfast/lunch/dinner (once per meal per day).
  useEffect(() => {
    if (!authUser || !appSettings) return;
    const check = () => {
      const now = new Date();
      const dateKey = now.toISOString().slice(0, 10);
      const hour = now.getHours();
      const min = now.getMinutes();
      const currentMinutes = hour * 60 + min;

      const parseTime = (t: string): number => {
        const [h, m] = (t || '00:00').split(':').map(Number);
        return (h ?? 0) * 60 + (m ?? 0);
      };

      const win = 15;
      const meals: { key: string; time: string; label: string }[] = [
        { key: 'breakfast', time: appSettings.breakfastReminderTime, label: 'Breakfast' },
        { key: 'lunch', time: appSettings.lunchReminderTime, label: 'Lunch' },
        { key: 'dinner', time: appSettings.dinnerReminderTime, label: 'Dinner' },
      ];

      for (const { key, time, label } of meals) {
        const target = parseTime(time);
        if (currentMinutes >= target && currentMinutes < target + win) {
          const refKey = `${dateKey}-${key}`;
          if (!mealReminderShownRef.current[refKey]) {
            mealReminderShownRef.current[refKey] = true;
            // In-app toast disabled; push notification click opens suggestions page.
            return;
          }
        }
      }
    };
    check();
    const interval = setInterval(check, 60 * 1000);
    const onFocus = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [authUser, appSettings?.breakfastReminderTime, appSettings?.lunchReminderTime, appSettings?.dinnerReminderTime]);

  // One-time prompt at start: let user select voice language (default English or browser-detected).
  const [languagePickerSelectedCode, setLanguagePickerSelectedCode] = useState('en');
  useEffect(() => {
    if (!authChecked || languagePromptCheckedRef.current || hasShownLanguagePrompt()) return;
    if (authUser && isLoading) return;
    languagePromptCheckedRef.current = true;
    const detected = getBrowserVoiceLanguage();
    setLanguagePickerSelectedCode(detected?.code ?? 'en');
    setLanguagePromptOption(detected ?? { code: 'en', label: 'English' });
  }, [authChecked, authUser, isLoading]);

  // One-time dietary survey at start (after language prompt is dismissed, or if no language prompt).
  useEffect(() => {
    if (!authUser || isLoading || dietarySurveyCheckedRef.current || hasShownDietarySurvey()) return;
    if (languagePromptOption) return; // Wait until language prompt is gone.
    dietarySurveyCheckedRef.current = true;
    setShowDietarySurvey(true);
  }, [authUser, isLoading, languagePromptOption]);

  // One-time onboarding tooltip when recipe list is empty (after data has loaded).
  useEffect(() => {
    if (recipeOnboardingCheckedRef.current || isLoading) return;
    recipeOnboardingCheckedRef.current = true;
    if (recipes.length === 0 && !hasShownRecipeOnboardingTip()) setShowRecipeOnboardingTip(true);
  }, [isLoading, recipes.length]);

  // First-recipe tutorial: when user lands on Home with exactly 1 recipe, show tooltip + highlight on + button (no auto-open).
  useEffect(() => {
    if (
      currentView !== AppView.Home ||
      recipes.length !== 1 ||
      hasShownAddRecipeButtonTutorial() ||
      addRecipeTutorialShownRef.current
    )
      return;
    addRecipeTutorialShownRef.current = true;
    const t = window.setTimeout(() => setHighlightAddRecipeButton(true), 2500);
    return () => clearTimeout(t);
  }, [currentView, recipes.length]);

  const handleLanguagePickerContinue = useCallback(() => {
    const code = languagePickerSelectedCode || 'en';
    const next = { ...appSettings, voiceLanguage: code };
    setAppSettings(next);
    if (authUser) {
      saveAppSettings(authUser.uid, next).catch(() => {});
    }
    setLanguagePromptShown();
    setLanguagePromptOption(null);
  }, [languagePickerSelectedCode, appSettings, authUser]);

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
    } else if (recipeSort === 'likedVideos') {
      const likedSet = new Set(userPreferences?.likedRecipeIds ?? []);
      const score = (r: Recipe) => {
        const liked = likedSet.has(r.id);
        const hasVideo = !!(r.videoUrl?.trim());
        if (liked && hasVideo) return 2;
        if (liked) return 1;
        return 0;
      };
      list.sort((a, b) => {
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        const aPrepared = a.lastPreparedAt ?? '';
        const bPrepared = b.lastPreparedAt ?? '';
        if (aPrepared !== bPrepared) return bPrepared.localeCompare(aPrepared);
        const aViewed = a.lastViewedAt ?? '';
        const bViewed = b.lastViewedAt ?? '';
        return bViewed.localeCompare(aViewed);
      });
    }
    return list;
  }, [recipes, searchQuery, recipeSort, userPreferences?.likedRecipeIds]);

  const handleRecipeClick = (recipe: Recipe) => {
    const updated = { ...recipe, lastViewedAt: new Date().toISOString() };
    setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? updated : r)));
    if (authUser) {
      updateRecipeInDB(authUser.uid, updated).catch(() => {});
    }
    navigateTo(AppView.RecipeDetail, updated);
  };

  const handleToggleLike = useCallback(
    (recipe: Recipe) => {
      if (!authUser || !userPreferences) return;
      const current = userPreferences.likedRecipeIds ?? [];
      const isLiked = current.includes(recipe.id);
      const nextIds = isLiked ? current.filter((id) => id !== recipe.id) : [...current, recipe.id];
      const next: UserPreferences = { ...userPreferences, likedRecipeIds: nextIds };
      setUserPreferences(next);
      savePreferences(authUser.uid, next).catch(() => {});
    },
    [authUser, userPreferences]
  );

  const suggestedRecipes = useMemo(
    () => getSuggestedRecipes(recipes, userPreferences?.likedRecipeIds ?? [], inventory),
    [recipes, userPreferences?.likedRecipeIds, inventory]
  );

  // Clear notification badge when user opens the Suggestions screen (mark current count as seen).
  useEffect(() => {
    if (currentView === AppView.Suggestions) {
      suggestionsCountWhenLastViewedRef.current = suggestedRecipes.length;
    }
  }, [currentView, suggestedRecipes.length]);

  const goToSetup = () => {
    if (selectedRecipe) navigateTo(AppView.RecipeSetup, selectedRecipe);
  };

  const onSetupComplete = (newRecipe: Recipe) => {
    const prepared = { ...newRecipe, lastPreparedAt: new Date().toISOString() };
    setRecipes((prev) => prev.map((r) => (r.id === newRecipe.id ? prepared : r)));
    if (authUser) {
      updateRecipeInDB(authUser.uid, prepared).catch(() => {});
    }
    navigateTo(AppView.CookingMode, prepared);
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
    replaceWith(AppView.RecipeDetail, newRecipe);
  };

  const handleDeleteRecipe = useCallback(async () => {
    if (!selectedRecipe) return;
    const recipeId = selectedRecipe.id;
    setRecipeDeleting(true);
    setShowDeleteRecipeConfirm(false);
    let dbOk = false;
    if (authUser) {
      try {
        await deleteRecipeInDB(authUser.uid, recipeId);
        dbOk = true;
      } catch {
        // Still remove locally so the UI updates
      }
    } else {
      dbOk = true;
    }
    setRecipes((prev) => prev.filter((r) => r.id !== recipeId));
    setSelectedRecipe(null);
    setScaledRecipe(null);
    setShowShoppingListPrompt(false);
    setRecipeDeleting(false);
    if (!dbOk) {
      setShoppingListToast('Recipe removed; couldn’t sync to cloud.');
      setTimeout(() => setShoppingListToast(null), 4000);
    }
    setCurrentView(AppView.Home);
    if (typeof window !== 'undefined' && window.history) {
      window.history.replaceState({ view: AppView.Home } as HistoryState, '', window.location.pathname);
    }
  }, [authUser, selectedRecipe]);

  const handleShareRecipe = useCallback(async () => {
    if (!authUser || !selectedRecipe) return;
    try {
      const token = await createShare(selectedRecipe, authUser.uid);
      const url = `${window.location.origin}/share/${token}`;
      setShareLinkUrl(url);
    } catch {
      setShareToast("Couldn't create share link. Try again?");
      setTimeout(() => setShareToast(null), 3000);
    }
  }, [authUser, selectedRecipe]);

  const copyShareLinkFromModal = useCallback(async () => {
    if (!shareLinkUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareLinkUrl);
      } else {
        const ta = document.createElement('textarea');
        ta.value = shareLinkUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setShareLinkUrl(null);
      setShareToast('Link copied!');
      setTimeout(() => setShareToast(null), 3000);
    } catch {
      setShareToast("Couldn't copy. Try again?");
    }
  }, [shareLinkUrl]);

  const shareViaNative = useCallback(async () => {
    if (!shareLinkUrl || !selectedRecipe) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: selectedRecipe.title,
          text: selectedRecipe.title,
          url: shareLinkUrl,
        });
        setShareLinkUrl(null);
        setShareToast('Shared!');
        setTimeout(() => setShareToast(null), 3000);
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setShareToast("Couldn't open share. Use Copy link.");
        setTimeout(() => setShareToast(null), 3000);
      }
    }
  }, [shareLinkUrl, selectedRecipe]);

  const handleSaveSharedRecipe = useCallback(async () => {
    if (!authUser || !sharedRecipe) return;
    setSavingSharedRecipe(true);
    try {
      const userRecipes = await getAllRecipes(authUser.uid);

      const sameContent = (a: Recipe, b: Recipe) =>
        a.title.trim().toLowerCase() === b.title.trim().toLowerCase() &&
        a.ingredients.length === b.ingredients.length &&
        a.steps.length === b.steps.length &&
        JSON.stringify(a.ingredients) === JSON.stringify(b.ingredients) &&
        JSON.stringify(a.steps) === JSON.stringify(b.steps);

      let existing: Recipe | undefined =
        sharedRecipeToken ? userRecipes.find((r) => r.sharedFromToken === sharedRecipeToken) : undefined;
      if (!existing) {
        existing = userRecipes.find((r) => sameContent(r, sharedRecipe));
      }

      if (existing) {
        setShareToast('Already in your recipes');
        setTimeout(() => setShareToast(null), 3000);
        setSharedRecipeToken(null);
        setSharedRecipe(null);
        setSharedRecipeError(null);
        setCurrentView(AppView.Home);
        setSelectedRecipe(existing);
        setScaledRecipe(existing);
        setRecipes((prev) => {
          const has = prev.some((r) => r.id === existing!.id);
          return has ? prev : [...prev, existing!];
        });
        if (typeof window !== 'undefined' && window.history) {
          window.history.replaceState({ view: AppView.Home } as HistoryState, '', '/');
        }
        setTimeout(() => navigateTo(AppView.RecipeDetail, existing!), 100);
        return;
      }

      const copy: Recipe = {
        ...sharedRecipe,
        id: `shared-${Date.now()}`,
        ...(sharedRecipeToken && { sharedFromToken: sharedRecipeToken }),
      };
      await updateRecipeInDB(authUser.uid, copy);
      setRecipes((prev) => [...prev, copy]);
      setSharedRecipeToken(null);
      setSharedRecipe(null);
      setSharedRecipeError(null);
      setCurrentView(AppView.Home);
      setSelectedRecipe(copy);
      setScaledRecipe(copy);
      if (typeof window !== 'undefined' && window.history) {
        window.history.replaceState({ view: AppView.Home } as HistoryState, '', '/');
      }
      setTimeout(() => navigateTo(AppView.RecipeDetail, copy), 100);
    } catch {
      setSharedRecipeError("Couldn't save to your recipes. Try again?");
    } finally {
      setSavingSharedRecipe(false);
    }
  }, [authUser, sharedRecipe, sharedRecipeToken]);

  const addRecipeToShoppingList = useCallback(async () => {
    if (!authUser || !selectedRecipe) return;
    setShoppingListAdding(true);
    setShoppingListToast(null);
    setShowShoppingListPrompt(false);
    try {
      const inventory = await getInventory(authUser.uid);
      const missingLines = getMissingIngredientLines(selectedRecipe, inventory);
      if (missingLines.length === 0) {
        setShoppingListToast('You have all ingredients in your inventory.');
        setTimeout(() => setShoppingListToast(null), 4000);
      } else {
        let items: { name: string; quantity?: string }[];
        try {
          items = await normalizeIngredients(missingLines);
        } catch {
          items = getMissingIngredientsForRecipe(selectedRecipe, inventory);
        }
        if (items.length > 0) {
          await addShoppingListItems(authUser.uid, items.map((m) => ({
            name: m.name,
            quantity: m.quantity,
            sourceRecipeId: selectedRecipe.id,
            sourceRecipeTitle: selectedRecipe.title,
          })));
          setShowShoppingListPrompt(true);
        }
      }
    } catch {
      setShoppingListToast("Couldn't add to your list. Try again?");
      setTimeout(() => setShoppingListToast(null), 4000);
    } finally {
      setShoppingListAdding(false);
    }
  }, [authUser, selectedRecipe]);

  const retryBackendHealth = useCallback(async () => {
    const { ok } = await checkBackendHealth();
    setBackendUp(ok);
  }, []);

  const renderLoading = (message: string) => (
    <div className="max-w-md mx-auto h-screen flex items-center justify-center bg-[#fcfcf9]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-stone-400 font-bold text-xs uppercase tracking-widest">{message}</p>
      </div>
    </div>
  );

  if (!authChecked) return renderLoading('One sec…');
  // When not logged in, always show Login. Share link token is preserved in state; after login we show the shared recipe.
  if (!authUser) return (
    <ErrorBoundary>
      <Login onSuccess={() => {}} />
    </ErrorBoundary>
  );
  // Shared recipe view (after login; token was set from URL on load).
  if (currentView === AppView.SharedRecipe) {
    if (sharedRecipeLoading) return renderLoading('Loading recipe…');
    if (sharedRecipeError) {
      return (
        <div className="max-w-md mx-auto min-h-screen bg-[#fcfcf9] flex flex-col items-center justify-center px-6">
          <p className="text-stone-600 text-center mb-6">{sharedRecipeError}</p>
          <button onClick={goHomeFromShare} className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-2xl hover:bg-emerald-700">
            Go home
          </button>
        </div>
      );
    }
    if (sharedRecipe) {
      return (
        <div className="bg-white min-h-screen pb-24">
          <div className="relative h-[40vh]">
            <img src={sharedRecipe.image} alt={sharedRecipe.title} className="w-full h-full object-cover" />
            <button onClick={goHomeFromShare} className="absolute top-8 left-6 p-2 bg-white/90 backdrop-blur-sm rounded-xl text-stone-800 shadow-md z-10">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
          </div>
          <div className="px-6 pt-8 space-y-6">
            <h1 className="text-3xl font-bold text-stone-800 tracking-tight">{sharedRecipe.title}</h1>
            {sharedRecipe.videoUrl && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-medium">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                From a video
              </span>
            )}
            <p className="text-stone-500 leading-relaxed">{sharedRecipe.description}</p>
            <div className="flex justify-between items-center py-4 border-y border-stone-100">
              <div className="text-center"><p className="text-xs text-stone-400 font-bold uppercase mb-1">Time</p><p className="font-bold text-stone-800">{sharedRecipe.cookTime}</p></div>
              <div className="text-center"><p className="text-xs text-stone-400 font-bold uppercase mb-1">Level</p><p className="font-bold text-stone-800">{sharedRecipe.difficulty}</p></div>
              <div className="text-center"><p className="text-xs text-stone-400 font-bold uppercase mb-1">Serves</p><p className="font-bold text-stone-800">{sharedRecipe.servings}</p></div>
            </div>
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-stone-800">Ingredients</h2>
              <ul className="space-y-3">
                {sharedRecipe.ingredients.map((ing, i) => (
                  <li key={i} className="flex items-center gap-3 text-stone-600">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{ing}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-stone-800">Instructions</h2>
              <div className="space-y-6">
                {sharedRecipe.steps.map((step, i) => (
                  <div key={i} className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-sm font-bold text-stone-500">{i + 1}</span>
                    <p className="text-stone-600 leading-relaxed pt-1">{step}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="pt-6 border-t border-stone-100">
              {authUser ? (
                <button type="button" onClick={handleSaveSharedRecipe} disabled={savingSharedRecipe} className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60 flex items-center justify-center gap-2">
                  {savingSharedRecipe ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</>
                  ) : (
                    <>Save to my recipes</>
                  )}
                </button>
              ) : (
                <p className="text-stone-500 text-sm text-center">Sign in to save this recipe to your collection.</p>
              )}
            </div>
          </div>
        </div>
      );
    }
    return renderLoading('Loading…');
  }

  if (!authUser) return null; // Should not reach here when SharedRecipe was handled above.
  if (isLoading) return renderLoading('Getting things ready…');
  if (loadError) {
    return (
      <div className="max-w-md mx-auto min-h-screen bg-[#fcfcf9] flex flex-col items-center justify-center px-6">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-stone-800 text-center mb-2">Oops! We couldn't load your recipes</h2>
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
      <header className="px-6 pt-8 flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Hello, Chef!</h1>
          <p className="text-stone-500 text-sm">What are we cooking today?</p>
          <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full bg-stone-100 text-stone-500 text-xs font-medium">
            <svg className="w-3.5 h-3.5 text-violet-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
            Powered by Gemini 3
          </span>
        </div>
        {authUser && (
          <button
            type="button"
            onClick={() => navigateTo(AppView.Suggestions)}
            className="flex-shrink-0 p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 transition-colors relative"
            aria-label="Suggestions and notifications"
            title="Suggestions"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {suggestedRecipes.length > suggestionsCountWhenLastViewedRef.current && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                {suggestedRecipes.length > 9 ? '9+' : suggestedRecipes.length}
              </span>
            )}
          </button>
        )}
      </header>

      {recipes.length > 0 && (
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
      )}

      <section className="px-6 space-y-5">
        <h2 className="text-xl font-semibold text-stone-900 tracking-tight">My Recipes</h2>

        {recipes.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-stone-500 text-sm mb-6">Create your first recipe using one of the options below.</p>

            {showRecipeOnboardingTip && (
              <div className="mb-6 mx-auto max-w-sm animate-in fade-in slide-in-from-top-2 duration-300" role="status" aria-live="polite">
                <div className="bg-emerald-600 text-white rounded-2xl px-4 py-4 shadow-lg">
                  <p className="text-sm font-medium text-left mb-3">
                    Start here – paste a cooking video link and we'll turn it into a recipe you can follow step-by-step with the video.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setRecipeOnboardingTipShown();
                      setShowRecipeOnboardingTip(false);
                    }}
                    className="w-full py-2 rounded-xl bg-white/20 hover:bg-white/30 text-sm font-semibold transition-colors"
                  >
                    Got it
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 max-w-sm mx-auto">
              <button
                type="button"
                onClick={() => {
                  if (showRecipeOnboardingTip) {
                    setRecipeOnboardingTipShown();
                    setShowRecipeOnboardingTip(false);
                  }
                  navigateTo(AppView.CreateFromYouTube);
                }}
                className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-stone-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50 transition-all text-left group"
              >
                <span className="flex-shrink-0 w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center group-hover:bg-red-200 transition-colors">
                  <svg className="w-6 h-6 text-red-600" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                </span>
                <div>
                  <span className="font-semibold text-stone-900 block">From YouTube</span>
                  <span className="text-xs text-stone-500">Paste a video link → we'll turn it into a recipe and jump to each step in the video</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (showRecipeOnboardingTip) {
                    setRecipeOnboardingTipShown();
                    setShowRecipeOnboardingTip(false);
                  }
                  navigateTo(AppView.CreateFromChat);
                }}
                className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-stone-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50 transition-all text-left group"
              >
                <span className="flex-shrink-0 w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                </span>
                <div>
                  <span className="font-semibold text-stone-900 block">From chat</span>
                  <span className="text-xs text-stone-500">Describe a dish → AI generates a full recipe</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (showRecipeOnboardingTip) {
                    setRecipeOnboardingTipShown();
                    setShowRecipeOnboardingTip(false);
                  }
                  navigateTo(AppView.Scanner);
                }}
                className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-stone-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50 transition-all text-left group"
              >
                <span className="flex-shrink-0 w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-colors">
                  <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
                </span>
                <div>
                  <span className="font-semibold text-stone-900 block">Scan ingredients</span>
                  <span className="text-xs text-stone-500">Photo or list → quick recipe from what you have</span>
                </div>
              </button>

              <button
                type="button"
                onClick={async () => {
                  if (showRecipeOnboardingTip) {
                    setRecipeOnboardingTipShown();
                    setShowRecipeOnboardingTip(false);
                  }
                  const template = MOCK_RECIPES[0];
                  if (!template) return;
                  const sample: Recipe = {
                    ...template,
                    id: `sample-${Date.now()}`,
                  };
                  if (authUser) {
                    try {
                      await updateRecipeInDB(authUser.uid, sample);
                    } catch {
                      // continue with local state
                    }
                  }
                  setRecipes((prev) => [...prev, sample]);
                  replaceWith(AppView.RecipeDetail, sample);
                }}
                className="max-w-sm mx-auto w-full mt-2 py-3 rounded-xl border border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100 hover:border-stone-300 text-sm font-medium transition-colors"
              >
                Try sample recipe
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 scrollbar-none">
              {(['recent', 'name', 'difficulty', 'time', 'likedVideos'] as const).map((key) => (
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
                  {key === 'likedVideos' && 'Liked videos'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
              {filteredRecipes.map(recipe => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  onClick={handleRecipeClick}
                  isLiked={userPreferences?.likedRecipeIds?.includes(recipe.id)}
                  onToggleLike={authUser ? (r) => handleToggleLike(r) : undefined}
                />
              ))}
            </div>
            {searchQuery.trim() && filteredRecipes.length === 0 && (
              <p className="text-stone-500 text-sm py-4">No recipes match &quot;{searchQuery.trim()}&quot;.</p>
            )}
          </>
        )}
      </section>
    </div>
  );

  const renderSuggestions = () => (
    <div className="bg-white min-h-screen pb-24 animate-in fade-in duration-300">
      <header className="px-6 pt-8 pb-6 flex items-center justify-between border-b border-stone-100">
        <button
          type="button"
          onClick={() => navigateTo(AppView.Home)}
          className="p-2 -ml-2 rounded-xl text-stone-600 hover:bg-stone-100"
          aria-label="Back to home"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-stone-800 tracking-tight">Suggestions</h1>
        <span className="w-10" aria-hidden />
      </header>
      <div className="px-6 py-4">
        <p className="text-stone-500 text-sm mb-6">
          Recipes you can make with ingredients in your inventory. Like ones you enjoy — we’ll suggest more like them.
        </p>
        {suggestedRecipes.length === 0 ? (
          <p className="text-stone-400 text-sm py-8 text-center">
            No suggestions right now. Add ingredients to your inventory and add recipes — we’ll suggest recipes that use what you have. Like recipes to get more tailored suggestions.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {suggestedRecipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onClick={handleRecipeClick}
                isLiked={userPreferences?.likedRecipeIds?.includes(recipe.id)}
                onToggleLike={authUser ? (r) => handleToggleLike(r) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderRecipeDetail = () => {
    if (!selectedRecipe) return null;
    return (
      <div className="bg-white min-h-screen pb-44 animate-in fade-in duration-300">
        <div className="relative h-[40vh]">
          <img
            src={selectedRecipe.image}
            alt={selectedRecipe.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute top-8 left-6 right-6 flex justify-between items-center z-10">
            <button
              onClick={() => { setShowShoppingListPrompt(false); window.history.back(); }}
              className="p-2 bg-white/90 backdrop-blur-sm rounded-xl text-stone-800 shadow-md"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div className="flex items-center gap-2">
              {authUser && (
                <button
                  type="button"
                  onClick={() => handleToggleLike(selectedRecipe)}
                  className="p-2 bg-white/90 backdrop-blur-sm rounded-xl text-stone-800 shadow-md hover:bg-white"
                  aria-label={userPreferences?.likedRecipeIds?.includes(selectedRecipe.id) ? 'Unlike recipe' : 'Like recipe'}
                  title={userPreferences?.likedRecipeIds?.includes(selectedRecipe.id) ? 'Unlike' : 'Like'}
                >
                  <svg className="w-6 h-6" fill={userPreferences?.likedRecipeIds?.includes(selectedRecipe.id) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </button>
              )}
              <button
                onClick={handleShareRecipe}
                className="p-2 bg-white/90 backdrop-blur-sm rounded-xl text-stone-800 shadow-md hover:bg-white"
                title="Share recipe"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 pt-8 space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-stone-800 tracking-tight">{selectedRecipe.title}</h1>
            {selectedRecipe.videoUrl && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-medium" title="YouTube recipe with step-by-step video">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                YouTube recipe · video in cooking mode
              </span>
            )}
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

          <div className="pt-6 pb-10 border-t border-stone-100 flex items-center justify-center">
            <button
              type="button"
              onClick={() => setShowDeleteRecipeConfirm(true)}
              disabled={recipeDeleting}
              className="text-sm text-red-600 hover:text-red-700 disabled:opacity-60 inline-flex items-center justify-center gap-2 min-h-[2rem] py-1"
            >
              <svg className="w-4 h-4 shrink-0 align-middle" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              <span className="align-middle">Delete recipe</span>
            </button>
          </div>
        </div>

        {showDeleteRecipeConfirm && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-labelledby="delete-recipe-title">
            <div className="bg-white rounded-2xl shadow-xl border border-stone-200 max-w-sm w-full p-5 space-y-4">
              <h2 id="delete-recipe-title" className="text-base font-bold text-stone-800">
                Delete recipe?
              </h2>
              <p className="text-sm text-stone-600">
                &quot;{selectedRecipe?.title}&quot; will be removed from your recipes. This can&apos;t be undone.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowDeleteRecipeConfirm(false)}
                  disabled={recipeDeleting}
                  className="flex-1 py-3 rounded-xl bg-stone-100 text-stone-700 font-medium text-sm hover:bg-stone-200 disabled:opacity-60 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteRecipe}
                  disabled={recipeDeleting}
                  className="flex-1 py-3 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
                >
                  {recipeDeleting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Deleting…
                    </>
                  ) : (
                    'Delete'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {shareLinkUrl && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 bg-black/40" role="dialog" aria-modal="true" aria-labelledby="share-link-title">
            <div className="bg-white rounded-xl shadow-xl border border-stone-200 max-w-sm w-full p-3">
              <h2 id="share-link-title" className="text-sm font-bold text-stone-800 mb-1">Share recipe</h2>
              <div className="flex items-center gap-2 bg-stone-100 rounded-lg px-2 py-1.5 overflow-x-auto">
                <p className="text-xs text-stone-700 break-all select-all min-w-0 flex-1">{shareLinkUrl}</p>
                <button
                  type="button"
                  onClick={copyShareLinkFromModal}
                  className="shrink-0 p-1.5 rounded-md text-stone-600 hover:bg-stone-200 hover:text-stone-800"
                  title="Copy link"
                  aria-label="Copy link"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {/* Back rectangle: only the part visible behind the front (L-shape) */}
                    <path d="M2 4v16H8v-14h8v-2H2z" />
                    {/* Front rectangle (full) */}
                    <path d="M8 6h14v16H8V6z" />
                  </svg>
                </button>
              </div>
              {typeof navigator !== 'undefined' && navigator.share && (
                <button
                  type="button"
                  onClick={shareViaNative}
                  className="w-full mt-2 py-2.5 rounded-lg bg-stone-800 text-white font-semibold text-sm hover:bg-stone-700"
                >
                  Share
                </button>
              )}
              <button
                type="button"
                onClick={() => setShareLinkUrl(null)}
                className="w-full mt-1.5 py-1.5 text-stone-500 text-xs hover:text-stone-700"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {shareToast && (
          <div className="fixed left-1/2 -translate-x-1/2 z-[60] max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-xl bg-stone-800 text-white text-sm font-medium text-center shadow-lg" style={{ bottom: 'calc(7rem + env(safe-area-inset-bottom))' }}>
            {shareToast}
          </div>
        )}
        {shoppingListToast && (
          <div className="fixed left-1/2 -translate-x-1/2 z-[60] max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-xl bg-stone-800 text-white text-sm font-medium text-center shadow-lg" style={{ bottom: 'calc(7rem + env(safe-area-inset-bottom))' }}>
            {shoppingListToast}
          </div>
        )}
        {mealReminderToast && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              setMealReminderToast(null);
              navigateTo(AppView.Suggestions);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setMealReminderToast(null);
                navigateTo(AppView.Suggestions);
              }
            }}
            className="fixed left-4 right-4 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[60] flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-emerald-600 text-white text-sm font-medium shadow-lg cursor-pointer hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
          >
            <span>{mealReminderToast}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); setMealReminderToast(null); }} className="p-1 rounded-lg hover:bg-white/20" aria-label="Dismiss">×</button>
          </div>
        )}
        {showShoppingListPrompt && (
          <div className="fixed left-1/2 -translate-x-1/2 z-[60] max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-xl bg-stone-800 text-white shadow-lg flex items-center justify-between gap-3" style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>
            <span className="text-sm font-medium">Want to see shopping list?</span>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowShoppingListPrompt(false);
                  setOpenInventoryOnTab('shopping');
                  replaceWith(AppView.Inventory);
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
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="w-full max-w-md p-6 pt-20 pointer-events-none bg-gradient-to-t from-white via-white to-white/0">
            <button
              type="button"
              onClick={goToSetup}
              className="w-full bg-emerald-600 text-white font-black py-4 rounded-2xl shadow-lg hover:bg-emerald-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 pointer-events-auto"
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
      {backendUp === false && (
        <div
          className="fixed left-4 right-4 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[55] flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-500 text-amber-950 text-sm font-medium shadow-lg"
          role="status"
          aria-live="polite"
        >
          <span className="flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Start the backend
          </span>
          <button
            type="button"
            onClick={retryBackendHealth}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600/80 text-amber-950 font-semibold text-xs hover:bg-amber-600 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
      {languagePromptOption && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true" aria-labelledby="language-prompt-title">
          <div className="bg-white rounded-2xl shadow-xl border border-stone-200 max-w-sm w-full p-5 space-y-4">
            <h2 id="language-prompt-title" className="text-base font-bold text-stone-800">
              Voice language
            </h2>
            <p className="text-sm text-stone-600">
              Choose the language for voice responses in cooking mode. You can change this later in Settings.
            </p>
            <label htmlFor="voice-language-select" className="block text-sm font-medium text-stone-700">
              Language
            </label>
            <select
              id="voice-language-select"
              value={languagePickerSelectedCode}
              onChange={(e) => setLanguagePickerSelectedCode(e.target.value)}
              className="w-full py-3 px-4 rounded-xl bg-stone-100 border border-stone-200 text-stone-800 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {VOICE_LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleLanguagePickerContinue}
              className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm active:scale-[0.98] transition-transform hover:bg-emerald-700"
            >
              Continue
            </button>
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
      {currentView === AppView.Suggestions && authUser && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Home)}>
          {renderSuggestions()}
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
            onCancel={() => window.history.back()}
            appSettings={appSettings}
            userId={authUser.uid}
          />
        </ErrorBoundary>
      )}
      {currentView === AppView.CookingMode && scaledRecipe && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.RecipeDetail)}>
          <CookingMode
            recipe={scaledRecipe}
            onExit={() => window.history.back()}
            appSettings={appSettings}
            userId={authUser?.uid}
          />
        </ErrorBoundary>
      )}
      {currentView === AppView.Scanner && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Home)}>
          <IngredientScanner
            onClose={() => window.history.back()}
            onSelectRecipe={handleScannedRecipe}
          />
        </ErrorBoundary>
      )}
      {currentView === AppView.Inventory && authUser && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Home)}>
          <Inventory userId={authUser.uid} initialTab={openInventoryOnTab ?? undefined} />
        </ErrorBoundary>
      )}
      {currentView === AppView.Profile && authUser && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Home)}>
          <Profile
            user={authUser}
            onBack={() => window.history.back()}
            onOpenSettings={() => navigateTo(AppView.Settings)}
          />
        </ErrorBoundary>
      )}
      {currentView === AppView.Settings && authUser && (
        <ErrorBoundary onReset={() => setCurrentView(AppView.Profile)}>
          <Settings
            userId={authUser.uid}
            onBack={() => window.history.back()}
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
              replaceWith(AppView.RecipeDetail, recipe);
            }}
            onCancel={() => window.history.back()}
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
              replaceWith(AppView.RecipeDetail, recipe);
            }}
            onCancel={() => window.history.back()}
          />
        </ErrorBoundary>
      )}

      {BOTTOM_NAV_VIEWS.includes(currentView) && (
        <>
          <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white/80 backdrop-blur-md border-t border-stone-200 px-4 py-3 flex items-center justify-between gap-1 z-40" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            <button
              onClick={() => navigateTo(AppView.Home)}
              className={`p-2 rounded-xl transition-colors ${currentView === AppView.Home ? 'text-emerald-600 bg-emerald-50' : 'text-stone-400'}`}
              title="Home"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7-7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            </button>
            <button
              onClick={() => navigateTo(AppView.Inventory)}
              className={`p-2 rounded-xl transition-colors ${currentView === AppView.Inventory ? 'text-emerald-600 bg-emerald-50' : 'text-stone-400'}`}
              title="Grocery inventory"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            </button>
            <button
              type="button"
              onClick={() => {
                setHighlightAddRecipeButton(false);
                setAddRecipeButtonTutorialShown();
                setShowRecipePrepMenu(true);
              }}
              className={`flex items-center justify-center p-3 rounded-xl transition-all duration-300 ${showRecipePrepMenu ? 'text-emerald-600 bg-emerald-50' : 'text-stone-400'} ${highlightAddRecipeButton ? 'ring-4 ring-emerald-500 ring-offset-2 ring-offset-white shadow-lg shadow-emerald-500/30 animate-pulse bg-emerald-50/80 text-emerald-600' : ''}`}
              title="Recipe prep"
              aria-label="Create recipe (From YouTube, chat, or scan)"
            >
              <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
            </button>
            <button
              onClick={() => navigateTo(AppView.Profile)}
              className={`p-2 rounded-xl transition-colors ${currentView === AppView.Profile ? 'text-emerald-600 bg-emerald-50' : 'text-stone-400'}`}
              title="Profile"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            </button>
          </nav>

          {/* Tutorial: step UI just above nav, white style to match bar. */}
          {highlightAddRecipeButton && !showRecipePrepMenu && (
            <>
              <div className="fixed left-0 right-0 max-w-md mx-auto px-4 z-[41] flex items-end justify-between gap-1 pointer-events-none animate-in fade-in duration-300" style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
                <span className="flex-1 min-w-0" aria-hidden />
                <span className="flex-1 min-w-0" aria-hidden />
                <div className="flex flex-col items-center gap-0.5 flex-1 min-w-0" role="tooltip" aria-live="polite">
                  <div className="flex items-center gap-2 rounded-full bg-white border border-stone-200 text-stone-800 px-3 py-1.5 shadow-md">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-200 text-stone-700 text-xs font-bold">
                      1
                    </span>
                    <span className="text-xs font-medium whitespace-nowrap">Tap here to create more recipes</span>
                  </div>
                  <svg className="w-4 h-4 text-stone-300 shrink-0" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path d="M7 10l5 6 5-6H7z" />
                  </svg>
                </div>
                <span className="flex-1 min-w-0" aria-hidden />
              </div>
            </>
          )}

          {showRecipePrepMenu && (
            <>
              <div
                className="fixed inset-0 z-50 bg-black/40"
                onClick={() => setShowRecipePrepMenu(false)}
                aria-hidden="true"
              />
              <div className="fixed left-1/2 -translate-x-1/2 max-w-md w-[calc(100%-2rem)] z-50 bg-white rounded-2xl shadow-xl border border-stone-100 overflow-hidden" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
                <div className="p-2">
                  <p className="px-3 py-2 text-xs font-semibold text-stone-400 uppercase tracking-wider">Recipe prep</p>
                  <button
                    onClick={() => {
                      setShowRecipePrepMenu(false);
                      navigateTo(AppView.CreateFromYouTube);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-left hover:bg-stone-50 active:bg-stone-100 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                      <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-stone-800">Create from YouTube</p>
                      <p className="text-xs text-stone-500">Turn a video into a recipe and follow along with the video</p>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setShowRecipePrepMenu(false);
                      navigateTo(AppView.CreateFromChat);
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
                      navigateTo(AppView.Scanner);
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
