
import { Recipe } from './types';

/** Default recipe image: balanced, appetizing ingredients. Used when no video thumbnail or custom image. */
export const DEFAULT_RECIPE_IMAGE =
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=80';

/** Escape text for safe use inside SVG. */
function escapeSvgText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns a data URL for an SVG that shows the recipe title as text (for chat-created recipes with no photo).
 * Uses viewBox and font-size in user units so the text scales with the image display size (card vs detail).
 */
export function getRecipeTitleImageDataUrl(title: string): string {
  const text = escapeSvgText((title || 'My recipe').trim());
  const len = text.length;
  // Font size in viewBox units (no px) so it scales when the SVG is displayed at any size
  const fontSize = len > 50 ? 24 : len > 35 ? 32 : len > 20 ? 40 : 52;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice"><rect width="800" height="600" fill="#f5f5f4"/><text x="400" y="300" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="600" fill="#444">${text}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export const MOCK_RECIPES: Recipe[] = [
  {
    id: '1',
    title: 'Tomato Basil Bruschetta',
    description: 'A fresh and vibrant appetizer with ripe tomatoes and basil on toasted bread.',
    prepTime: '15 min',
    cookTime: '5 min',
    difficulty: 'Easy',
    servings: 4,
    image: 'https://images.unsplash.com/photo-1506280754576-f6fa8a873550?w=800&q=80',
    ingredients: [
      '1 Baguette, sliced',
      '4 Large tomatoes, diced',
      '1/2 Red onion, finely chopped',
      'Fresh basil leaves, torn',
      '2 Garlic cloves, halved',
      'Balsamic glaze',
      'Olive oil',
      'Salt and black pepper'
    ],
    steps: [
      'Toast the baguette slices until golden and crisp.',
      'Rub each slice with a cut garlic clove while still warm.',
      'In a bowl, mix diced tomatoes, onion, basil, olive oil, salt and pepper.',
      'Spoon the tomato mixture onto the toasted bread.',
      'Drizzle with balsamic glaze and serve immediately.'
    ]
  }
];
