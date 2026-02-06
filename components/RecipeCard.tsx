import React from 'react';
import { Recipe } from '../types';

const DIFFICULTY_STYLES: Record<Recipe['difficulty'], string> = {
  Easy: 'bg-emerald-600 text-white',
  Medium: 'bg-amber-500 text-white',
  Hard: 'bg-rose-500 text-white',
};

interface RecipeCardProps {
  recipe: Recipe;
  onClick: (recipe: Recipe) => void;
}

const RecipeCard: React.FC<RecipeCardProps> = ({ recipe, onClick }) => {
  return (
    <button
      type="button"
      onClick={() => onClick(recipe)}
      className="w-full text-left bg-white rounded-xl shadow-sm border border-stone-200/80 overflow-hidden cursor-pointer hover:shadow-md hover:border-stone-300/80 active:scale-[0.99] transition-all duration-200 group"
    >
      <div className="relative aspect-[3/2] overflow-hidden bg-stone-100">
        <img
          src={recipe.image}
          alt={recipe.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />
        <span
          className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${DIFFICULTY_STYLES[recipe.difficulty]}`}
        >
          {recipe.difficulty}
        </span>
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-stone-900 text-sm line-clamp-1">{recipe.title}</h3>
        <p className="text-stone-500 text-xs mt-0.5 line-clamp-2">{recipe.description}</p>
        <div className="flex items-center gap-3 mt-2 text-[11px] text-stone-400 font-medium">
          <span className="flex items-center gap-0.5">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {recipe.cookTime}
          </span>
          <span className="flex items-center gap-0.5">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            {recipe.servings} servings
          </span>
        </div>
      </div>
    </button>
  );
};

export default RecipeCard;
