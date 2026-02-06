
import { Recipe } from './types';

/** Default recipe image: balanced, appetizing ingredients. Used when no video thumbnail or custom image. */
export const DEFAULT_RECIPE_IMAGE =
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=80';

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
