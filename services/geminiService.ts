
import { apiFetch } from './apiClient';

/** Parsed grocery item for inventory (name + optional quantity). */
export interface ParsedGroceryItem {
  name: string;
  quantity?: string;
}

/** Options to adapt the generated recipe to the user's diet. */
export interface RecipeGenerationOptions {
  dietary?: string[];
  allergies?: string[];
  alternatives?: string[];
}

// ── Backend-proxied Gemini calls ────────────────────────────────────────────

export const scanIngredientsFromImage = async (base64Image: string): Promise<string[]> => {
  const res = await apiFetch('/api/scan-ingredients', {
    method: 'POST',
    body: JSON.stringify({ image: base64Image }),
  });
  if (!res.ok) throw new Error('Failed to scan ingredients');
  const data = await res.json();
  return data.ingredients || [];
};

/** Parse free-form text (chat or voice transcript) into a list of grocery items. */
export const parseGroceryListFromText = async (text: string): Promise<ParsedGroceryItem[]> => {
  const res = await apiFetch('/api/parse-grocery-text', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("Couldn't parse that text. Try again?");
  return res.json();
};

/** Parse an image (receipt, pantry, shopping list photo) into grocery items. */
export const parseGroceryListFromImage = async (base64Image: string): Promise<ParsedGroceryItem[]> => {
  const res = await apiFetch('/api/parse-grocery-image', {
    method: 'POST',
    body: JSON.stringify({ image: base64Image }),
  });
  if (!res.ok) throw new Error("We couldn't read that image. Try another?");
  return res.json();
};

export const getRecipeRecommendations = async (ingredients: string[]) => {
  const res = await apiFetch('/api/recipe-recommendations', {
    method: 'POST',
    body: JSON.stringify({ ingredients }),
  });
  if (!res.ok) throw new Error("Couldn't get recipe recommendations. Try again?");
  return res.json();
};

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
  const res = await apiFetch('/api/generate-recipe', {
    method: 'POST',
    body: JSON.stringify({ description, ...options }),
  });
  if (!res.ok) throw new Error("We couldn't create that recipe. Give it another try!");
  return res.json();
};

// ── Audio Encoding/Decoding Utils (for Live API WebSocket) ──────────────────

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
