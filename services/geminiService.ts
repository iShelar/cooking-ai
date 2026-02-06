
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

/** Generate a full recipe from a short description or dish name (e.g. "pasta carbonara", "quick egg breakfast"). */
export const generateRecipeFromDescription = async (description: string): Promise<{
  title: string;
  description: string;
  prepTime: string;
  cookTime: string;
  difficulty: string;
  ingredients: string[];
  steps: string[];
}> => {
  const ai = getGeminiInstance();
  const prompt = `The user wants to cook something. They said: "${description.trim()}"

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
    throw new Error("Could not generate recipe. Please try again.");
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
