
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Recipe } from '../types';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { decode, encode, decodeAudioData } from '../services/geminiService';
import { updateRecipeInDB } from '../services/dbService';

interface RecipeSetupProps {
  recipe: Recipe;
  onComplete: (scaledRecipe: Recipe) => void;
  onCancel: () => void;
}

const RecipeSetup: React.FC<RecipeSetupProps> = ({ recipe, onComplete, onCancel }) => {
  const [isListening, setIsListening] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [currentServings, setCurrentServings] = useState(recipe.servings);
  const [scaledIngredients, setScaledIngredients] = useState<string[]>(recipe.ingredients);
  const [aiText, setAiText] = useState("Tap to start voice setup...");
  const [inputVolume, setInputVolume] = useState(0);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopAudio = useCallback(() => {
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsAssistantSpeaking(false);
  }, []);

  const triggerUpdateRecipe = useCallback((servings: number, ingredients: string[]) => {
    setCurrentServings(servings);
    setScaledIngredients(ingredients);
  }, []);

  // Manual fallback for performance/reliability
  const manualScale = (newServings: number) => {
    const ratio = newServings / recipe.servings;
    setCurrentServings(newServings);
    const simplifiedScaling = recipe.ingredients.map(ing => {
      // Very basic regex-based scaling for manual UI
      return ing.replace(/(\d+(\.\d+)?)/g, (match) => {
        const val = parseFloat(match);
        return (val * ratio).toFixed(1).replace(/\.0$/, '');
      });
    });
    setScaledIngredients(simplifiedScaling);
  };

  const tools: FunctionDeclaration[] = [
    {
      name: 'updateRecipeQuantities',
      parameters: {
        type: Type.OBJECT,
        description: 'Update the servings and scale ingredients accurately.',
        properties: {
          servings: { type: Type.NUMBER, description: 'The new number of people/servings.' },
          ingredients: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING }, 
            description: 'The updated list of ingredient strings with scaled quantities.' 
          }
        },
        required: ['servings', 'ingredients']
      }
    }
  ];

  const handleLiveMessage = useCallback(async (message: LiveServerMessage) => {
    const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
    if (audioData && audioContextRef.current) {
      setIsAssistantSpeaking(true);
      const ctx = audioContextRef.current;
      nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
      const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.addEventListener('ended', () => { 
        sourcesRef.current.delete(source);
        if (sourcesRef.current.size === 0) setIsAssistantSpeaking(false);
      });
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += buffer.duration;
      sourcesRef.current.add(source);
    }

    if (message.toolCall) {
      for (const fc of message.toolCall.functionCalls) {
        if (fc.name === 'updateRecipeQuantities') {
          triggerUpdateRecipe(fc.args.servings as number, fc.args.ingredients as string[]);
        }
        sessionRef.current?.sendToolResponse({
          functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
        });
      }
    }

    if (message.serverContent?.outputTranscription) {
      setAiText(message.serverContent.outputTranscription.text);
    }
    if (message.serverContent?.interrupted) stopAudio();
  }, [triggerUpdateRecipe, stopAudio]);

  const toggleAssistant = async () => {
    if (isListening || isConnecting) {
      sessionRef.current?.close();
      streamRef.current?.getTracks().forEach(t => t.stop());
      setIsListening(false);
      setIsConnecting(false);
      setInputVolume(0);
      return;
    }

    setIsConnecting(true);
    setAiText("Connecting to Chef AI...");

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      if (!audioContextRef.current) audioContextRef.current = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
      if (!inputAudioContextRef.current) inputAudioContextRef.current = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true,
          channelCount: 1 
        } 
      });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsConnecting(false);
            setIsListening(true);
            
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const processor = inputAudioContextRef.current!.createScriptProcessor(2048, 1, 1);
            
            // Tuned for noisy setup phase
            const NOISE_GATE = 0.006;
            const HYSTERESIS = 12;
            let quietCount = 0;

            processor.onaudioprocess = (e) => {
              const input = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
              const rms = Math.sqrt(sum / input.length);
              setInputVolume(rms);

              if (rms > NOISE_GATE) {
                quietCount = 0;
                const int16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) int16[i] = input[i] * 32768;
                const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
              } else if (quietCount < HYSTERESIS) {
                quietCount++;
                const int16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) int16[i] = input[i] * 32768;
                const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
              }
            };
            source.connect(processor);
            processor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: handleLiveMessage,
          onerror: (e) => {
            console.error(e);
            setIsConnecting(false);
          },
          onclose: () => {
            setIsListening(false);
            setIsConnecting(false);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: tools }],
          systemInstruction: `You are the CookAI Setup Assistant. 
          The recipe is: ${recipe.title}, originally for ${recipe.servings} people.
          
          PHASE 1 (GREETING): Greet fast. Ask how many people.
          PHASE 2 (SCALING): As soon as they give a number, calculate new quantities and call 'updateRecipeQuantities'.
          
          MANDATORY AUDITORY FEEDBACK:
          - YOU MUST VERBALLY ANNOUNCE WHEN YOU SCALE THE RECIPE.
          - Example: "Scaling the ingredients for 4 people now." or "Okay, updating quantities for 6."
          
          Keep responses under 10 words.`,
          outputAudioTranscription: {},
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setIsConnecting(false);
    }
  };

  const handleFinish = async () => {
    setIsSaving(true);
    const updatedRecipe = {
      ...recipe,
      servings: currentServings,
      ingredients: scaledIngredients
    };
    
    try {
      await updateRecipeInDB(updatedRecipe);
      onComplete(updatedRecipe);
    } catch (err) {
      console.error("SQLite update failed", err);
      onComplete(updatedRecipe);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-50 z-[60] flex flex-col overflow-hidden">
      <div className="bg-white px-6 py-6 border-b border-stone-200 flex items-center justify-between">
        <button onClick={onCancel} className="p-2 -ml-2 text-stone-500 active:scale-90 transition-transform">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <h2 className="font-bold text-stone-800 tracking-tight">Setup Assistant</h2>
        <div className="w-6"></div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-stone-100 flex flex-col items-center text-center gap-4">
          <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-colors ${isListening ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-stone-50 text-stone-400 border-stone-100'}`}>
            {isConnecting ? "Connecting..." : (isListening ? "Assistant Live" : "Offline")}
          </div>
          <p className="text-lg font-bold text-stone-800 leading-tight min-h-[50px] transition-all">
            {aiText}
          </p>
        </div>

        <div className="space-y-3">
          <h4 className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] ml-2">Quick Adjust</h4>
          <div className="flex gap-2">
            {[1, 2, 4, 6].map(num => (
              <button 
                key={num}
                onClick={() => manualScale(num)}
                className={`flex-1 py-3 rounded-2xl font-bold text-sm transition-all border ${currentServings === num ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg' : 'bg-white border-stone-200 text-stone-600'}`}
              >
                {num} {num === 1 ? 'Person' : 'People'}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-[2.5rem] p-6 shadow-sm border border-stone-100 space-y-6">
          <div className="flex items-center justify-between border-b border-stone-50 pb-4">
            <h3 className="font-bold text-stone-800">Quantities</h3>
            <div className="flex flex-col items-end">
              <span className="text-emerald-600 font-black text-xl">{currentServings} Servings</span>
            </div>
          </div>
          <ul className="space-y-4">
            {scaledIngredients.map((ing, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-stone-600 animate-in fade-in slide-in-from-left-2" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0"></div>
                <span className="leading-relaxed font-medium">{ing}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="bg-white border-t border-stone-200 p-8 pb-14 space-y-8 shadow-2xl">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            {isListening && (
              <div 
                className="absolute inset-0 bg-emerald-400/20 rounded-full animate-ping"
                style={{ transform: `scale(${2 + inputVolume * 15})` }}
              ></div>
            )}
            <button 
              onClick={toggleAssistant}
              disabled={isConnecting}
              className={`w-20 h-20 rounded-full flex items-center justify-center shadow-xl relative z-10 transition-all active:scale-95 ${isListening ? 'bg-emerald-600 scale-105' : 'bg-emerald-500'} ${isConnecting ? 'opacity-50 animate-pulse' : ''}`}
            >
              {isListening ? (
                <div className="flex gap-1.5 items-center">
                  {[1, 2, 3].map(i => (
                    <div 
                      key={i} 
                      className="w-1.5 bg-white rounded-full" 
                      style={{ 
                        height: isAssistantSpeaking ? '32px' : `${16 + inputVolume * 1000}px`,
                        maxHeight: '32px',
                        animation: isAssistantSpeaking ? 'wave 0.5s infinite ease-in-out' : 'none',
                        animationDelay: `${i * 0.1}s`
                      }}
                    ></div>
                  ))}
                </div>
              ) : (
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              )}
            </button>
          </div>
          <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest transition-opacity duration-300">
            {isConnecting ? "Waking up AI..." : (isListening ? "I'm listening..." : "Tap to Speak")}
          </span>
        </div>

        <button 
          onClick={handleFinish}
          disabled={isSaving || isConnecting}
          className="w-full bg-stone-900 text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all tracking-widest text-xs uppercase flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Saving...
            </>
          ) : "Confirm Recipe & Start"}
        </button>
      </div>
      <style>{`
        @keyframes wave { 0%, 100% { height: 16px; } 50% { height: 32px; } }
      `}</style>
    </div>
  );
};

export default RecipeSetup;
