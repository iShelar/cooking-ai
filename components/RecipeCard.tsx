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
  /** When true, show heart as filled (liked). */
  isLiked?: boolean;
  /** Called when user toggles like; pass (e) => e.stopPropagation() from parent if needed. */
  onToggleLike?: (recipe: Recipe, e: React.MouseEvent) => void;
}

const RecipeCard: React.FC<RecipeCardProps> = ({ recipe, onClick, isLiked, onToggleLike }) => {
  const handleLikeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleLike?.(recipe, e);
  };

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
        {onToggleLike && (
          <button
            type="button"
            onClick={handleLikeClick}
            className="absolute top-2 left-2 p-1.5 rounded-full bg-white/90 backdrop-blur-sm text-stone-600 hover:bg-white shadow-sm z-10"
            aria-label={isLiked ? 'Unlike recipe' : 'Like recipe'}
            title={isLiked ? 'Unlike' : 'Like'}
          >
            <svg className="w-5 h-5" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </button>
        )}
        <span
          className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${DIFFICULTY_STYLES[recipe.difficulty]}`}
        >
          {recipe.difficulty}
        </span>
        {recipe.videoUrl && (
          <span
            className="absolute bottom-2 left-2 px-2 py-1 rounded-lg bg-black/60 text-white text-[10px] font-medium flex items-center gap-1"
            title="Has video"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            Video
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-stone-900 text-sm line-clamp-2 leading-tight">{recipe.title}</h3>
        <p className="text-stone-500 text-xs mt-1 line-clamp-3 leading-snug">{recipe.description}</p>
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
