
import { Recipe } from './types';

export const MOCK_RECIPES: Recipe[] = [
  {
    id: '1',
    title: 'Creamy Garlic Mushroom Pasta',
    description: 'A rich and comforting pasta dish perfect for a quick weekday dinner.',
    prepTime: '10 min',
    cookTime: '15 min',
    difficulty: 'Easy',
    servings: 2,
    image: 'https://picsum.photos/seed/pasta/800/600',
    ingredients: [
      '200g Pasta of choice',
      '250g Mushrooms, sliced',
      '3 Garlic cloves, minced',
      '200ml Heavy cream',
      '50g Parmesan cheese',
      'Fresh parsley',
      'Olive oil',
      'Salt and Pepper'
    ],
    steps: [
      'Boil a large pot of salted water and cook pasta according to package instructions.',
      'Heat olive oil in a pan and sauté sliced mushrooms until golden brown.',
      'Add minced garlic and cook for 1 minute until fragrant.',
      'Pour in the heavy cream and simmer for 2-3 minutes until slightly thickened.',
      'Stir in the parmesan cheese and half of the chopped parsley.',
      'Drain pasta and toss with the sauce. Season with salt and pepper.',
      'Serve garnished with remaining parsley.'
    ]
  },
  {
    id: '2',
    title: 'Lemon Herb Roast Chicken',
    description: 'Classic succulent roast chicken with crispy skin and fragrant herbs.',
    prepTime: '20 min',
    cookTime: '1h 15 min',
    difficulty: 'Medium',
    servings: 4,
    image: 'https://picsum.photos/seed/chicken/800/600',
    ingredients: [
      '1.5kg Whole chicken',
      '2 Lemons, halved',
      'Fresh rosemary and thyme',
      '50g Butter, softened',
      '4 Garlic cloves, smashed',
      'Salt and black pepper'
    ],
    steps: [
      'Preheat oven to 200°C (400°F).',
      'Pat the chicken dry with paper towels.',
      'Rub butter under the skin and all over the chicken.',
      'Stuff the cavity with lemon halves, garlic, and herbs.',
      'Season generously with salt and pepper.',
      'Roast for 1 hour and 15 minutes, or until juices run clear.',
      'Let rest for 10 minutes before carving.'
    ]
  },
  {
    id: '3',
    title: 'Avocado and Tomato Bruschetta',
    description: 'A fresh and vibrant appetizer or light lunch.',
    prepTime: '15 min',
    cookTime: '5 min',
    difficulty: 'Easy',
    servings: 4,
    image: 'https://picsum.photos/seed/bruschetta/800/600',
    ingredients: [
      '1 Baguette, sliced',
      '2 Ripe avocados',
      '2 Large tomatoes, diced',
      '1/2 Red onion, finely chopped',
      'Balsamic glaze',
      'Fresh basil',
      'Olive oil'
    ],
    steps: [
      'Toast the baguette slices until golden and crisp.',
      'Mash avocado in a bowl with a pinch of salt and lime juice.',
      'In a separate bowl, mix tomatoes, onion, and chopped basil with olive oil.',
      'Spread mashed avocado onto toasted bread.',
      'Top with the tomato mixture.',
      'Drizzle with balsamic glaze before serving.'
    ]
  }
];
