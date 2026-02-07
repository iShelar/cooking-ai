
import { GoogleGenAI, Type } from "@google/genai";

// Use process.env.API_KEY directly in the GoogleGenAI constructor.
export const getGeminiInstance = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const scanIngredientsFromImage = async (base64Image: string) => {
  const ai = getGeminiInstance();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
        { text: 'Identify the food ingredients in this image. Return them as a simple comma-separated list.' }
      ]
    }
  });
  // Use response.text property directly.
  return response.text?.split(',').map(s => s.trim()) || [];
};

/** Parsed grocery item for inventory (name + optional quantity). */
export interface ParsedGroceryItem {
  name: string;
  quantity?: string;
}

/** Parse free-form text (chat or voice transcript) into a list of grocery items. */
export const parseGroceryListFromText = async (text: string): Promise<ParsedGroceryItem[]> => {
  const ai = getGeminiInstance();
  const prompt = `The user wrote or spoke their grocery/ingredients list. Extract every item into a JSON array. For each item include "name" (string) and "quantity" (string) when they gave a number or amount.

Infer the unit for quantity when the user gives only a number:
- Liquids (milk, oil, water, juice): use ml or L (e.g. milk 100 → "100ml", milk 1 → "1L").
- Solids/dry goods (flour, sugar, rice): use g or kg (e.g. flour 500 → "500g", rice 2 → "2kg").
- Countable (eggs, apples, onions): number as-is (e.g. eggs 2 → "2").
If the user already wrote a unit (e.g. "500g", "1L"), keep it. Otherwise infer from the item type. Always output quantity with unit where appropriate. User input: "${text.trim()}"`;
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            quantity: { type: Type.STRING },
          },
          required: ['name'],
        },
      },
    },
  });
  const raw = response.text ?? '[]';
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

/** Parse an image (receipt, pantry, shopping list photo) into grocery items. */
export const parseGroceryListFromImage = async (base64Image: string): Promise<ParsedGroceryItem[]> => {
  const ai = getGeminiInstance();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
        {
          text: 'This image may show a receipt, shopping list, groceries, or pantry. Extract every grocery or food item into a JSON array. Each element: {"name": "item name", "quantity": "optional qty"}. Return only the JSON array, e.g. [{"name":"milk","quantity":"2"},{"name":"eggs"}]',
        },
      ],
    },
  });
  const raw = response.text ?? '[]';
  const cleaned = raw.replace(/```json?\s*|\s*```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
};

export const getRecipeRecommendations = async (ingredients: string[]) => {
  const ai = getGeminiInstance();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Based on these ingredients: ${ingredients.join(', ')}, recommend 3 recipes. Provide a JSON array of objects with "title", "description", and "id" (random string).`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            description: { type: Type.STRING }
          },
          required: ['id', 'title', 'description']
        }
      }
    }
  });
  // Use response.text property directly.
  return JSON.parse(response.text || '[]');
};

/** Options to adapt the generated recipe to the user's diet. */
export interface RecipeGenerationOptions {
  dietary?: string[];
  allergies?: string[];
  alternatives?: string[];
}

/** Generate a full recipe from a short description or dish name (e.g. "pasta carbonara", "quick egg breakfast"). */
export const generateRecipeFromDescription = async (
  description: string,
  options?: RecipeGenerationOptions
): Promise<{
  title: string;
  description: string;
  prepTime: string;
  cookTime: string;
  difficulty: string;
  ingredients: string[];
  steps: string[];
}> => {
  const ai = getGeminiInstance();
  let constraints = "";
  if (options?.dietary?.length || options?.allergies?.length || options?.alternatives?.length) {
    const parts: string[] = [];
    if (options.dietary?.length) {
      parts.push(`Dietary: ${options.dietary.join(", ")}. The recipe must respect these.`);
    }
    if (options.allergies?.length) {
      parts.push(`Strictly avoid (allergies): ${options.allergies.join(", ")}. Do not include these ingredients.`);
    }
    if (options.alternatives?.length) {
      parts.push(`Use these substitutions where applicable: ${options.alternatives.join("; ")}.`);
    }
    constraints = `\n\nImportant constraints:\n${parts.join("\n")}`;
  }
  const prompt = `The user wants to cook something. They said: "${description.trim()}"${constraints}

Create a single, practical recipe they can follow. Return a JSON object with:
- title: short recipe title (e.g. "Pasta Carbonara")
- description: 1–2 sentence description of the dish
- prepTime: e.g. "10 min"
- cookTime: e.g. "15 min"
- difficulty: exactly one of "Easy", "Medium", "Hard"
- ingredients: array of strings with quantities (e.g. "200g spaghetti", "2 eggs", "50g pancetta")
- steps: array of strings, each one clear cooking instruction in order

If the description is vague (e.g. "something quick"), pick a popular, simple dish that fits. Keep steps concise and actionable.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          prepTime: { type: Type.STRING },
          cookTime: { type: Type.STRING },
          difficulty: { type: Type.STRING },
          ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
          steps: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["title", "description", "prepTime", "cookTime", "difficulty", "ingredients", "steps"],
      },
    },
  });

  const raw = response.text ?? "{}";
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("We couldn't create that recipe. Give it another try!");
  }
};

// Utils for Audio Encoding/Decoding for Live API
export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
