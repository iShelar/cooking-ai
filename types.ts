
export interface Recipe {
  id: string;
  title: string;
  description: string;
  prepTime: string;
  cookTime: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  servings: number;
  image: string;
  ingredients: string[];
  steps: string[];
  calories?: number;
}

export interface Ingredient {
  id: string;
  name: string;
  quantity: string;
  unit: string;
}

export interface UserPreferences {
  dietary: string[];
  allergies: string[];
  skillLevel: 'Beginner' | 'Intermediate' | 'Advanced';
}

export enum AppView {
  Home = 'home',
  RecipeDetail = 'recipe-detail',
  RecipeSetup = 'recipe-setup',
  CookingMode = 'cooking-mode',
  Scanner = 'scanner',
  Inventory = 'inventory',
  Profile = 'profile'
}
