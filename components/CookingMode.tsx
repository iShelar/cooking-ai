
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Recipe } from '../types';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { decode, encode, decodeAudioData } from '../services/geminiService';

interface CookingModeProps {
  recipe: Recipe;
  onExit: () => void;
}

const CookingMode: React.FC<CookingModeProps> = ({ recipe, onExit }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const [timerIsPaused, setTimerIsPaused] = useState(false);
  const [activeTemperature, setActiveTemperature] = useState<string>('Off');
  const [suggestedTemp, setSuggestedTemp] = useState<string>('');
  const [toolNotification, setToolNotification] = useState<string | null>(null);
  const [showFinishedOverlay, setShowFinishedOverlay] = useState(false);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [inputVolume, setInputVolume] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerIntervalRef = useRef<number | null>(null);

  const stepsCount = recipe.steps.length;

  const playConfirmationSound = useCallback(() => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }, []);

  const notify = (msg: string, silent = false) => {
    setToolNotification(msg);
    if (!silent) playConfirmationSound();
    setTimeout(() => setToolNotification(null), 2000);
  };

  const triggerNextStep = useCallback(() => {
    setCurrentStep(prev => Math.min(prev + 1, stepsCount - 1));
    notify("Next step");
  }, [stepsCount, playConfirmationSound]);

  const triggerPrevStep = useCallback(() => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
    notify("Previous step");
  }, [playConfirmationSound]);

  const triggerGoToStep = useCallback((index: number) => {
    const safeIndex = Math.max(0, Math.min(index, stepsCount - 1));
    setCurrentStep(safeIndex);
    notify(`Step ${safeIndex + 1}`);
  }, [stepsCount, playConfirmationSound]);

  const triggerStartTimer = useCallback((minutes: number) => {
    setTimerSeconds(minutes * 60);
    setTimerIsPaused(false);
    setShowFinishedOverlay(false);
    notify(`Timer: ${minutes}m`);
  }, [playConfirmationSound]);

  const triggerPauseTimer = useCallback(() => {
    setTimerIsPaused(true);
    notify("Timer paused");
  }, [playConfirmationSound]);

  const triggerResumeTimer = useCallback(() => {
    setTimerIsPaused(false);
    notify("Timer resumed");
  }, [playConfirmationSound]);

  const triggerStopTimer = useCallback(() => {
    setTimerSeconds(null);
    setTimerIsPaused(false);
    setShowFinishedOverlay(false);
    notify("Timer stopped");
  }, [playConfirmationSound]);

  const triggerSetTemperature = useCallback((temp: string) => {
    setActiveTemperature(temp);
    notify(`Heat: ${temp}`);
  }, [playConfirmationSound]);

  useEffect(() => {
    const stepText = recipe.steps[currentStep].toLowerCase();
    let suggestion = 'Low';
    if (stepText.includes('boil') || stepText.includes('high heat') || stepText.includes('rolling')) suggestion = 'High';
    else if (stepText.includes('sauté') || stepText.includes('brown') || stepText.includes('sear')) suggestion = 'Med-High';
    else if (stepText.includes('simmer') || stepText.includes('medium heat') || stepText.includes('cook through')) suggestion = 'Medium';
    else if (stepText.includes('oven') || stepText.includes('roast') || stepText.includes('bake')) {
      const matches = stepText.match(/\d{3}/);
      suggestion = matches ? `${matches[0]}°C` : '200°C';
    }
    setSuggestedTemp(suggestion);
  }, [currentStep, recipe.steps]);

  useEffect(() => {
    if (timerSeconds !== null && timerSeconds > 0 && !timerIsPaused) {
      timerIntervalRef.current = window.setInterval(() => {
        setTimerSeconds(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }

    if (timerSeconds === 0) {
      setShowFinishedOverlay(true);
      if (audioContextRef.current) {
        const ctx = audioContextRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      }
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [timerSeconds, timerIsPaused]);

  const stopAudio = useCallback(() => {
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsAssistantSpeaking(false);
  }, []);

  const tools: FunctionDeclaration[] = [
    {
      name: 'startTimer',
      parameters: {
        type: Type.OBJECT,
        description: 'Start a kitchen timer.',
        properties: { minutes: { type: Type.NUMBER, description: 'Minutes' } },
        required: ['minutes']
      }
    },
    { name: 'pauseTimer', parameters: { type: Type.OBJECT, properties: {} } },
    { name: 'resumeTimer', parameters: { type: Type.OBJECT, properties: {} } },
    { name: 'stopTimer', parameters: { type: Type.OBJECT, properties: {} } },
    {
      name: 'setTemperature',
      parameters: {
        type: Type.OBJECT,
        properties: { level: { type: Type.STRING } },
        required: ['level']
      }
    },
    { name: 'nextStep', parameters: { type: Type.OBJECT, properties: {} } },
    { name: 'previousStep', parameters: { type: Type.OBJECT, properties: {} } },
    {
      name: 'goToStep',
      parameters: {
        type: Type.OBJECT,
        description: 'Jumps the UI to a specific step.',
        properties: { index: { type: Type.NUMBER, description: '0-indexed step number' } },
        required: ['index']
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
        if (fc.name === 'startTimer') triggerStartTimer(fc.args.minutes as number);
        else if (fc.name === 'pauseTimer') triggerPauseTimer();
        else if (fc.name === 'resumeTimer') triggerResumeTimer();
        else if (fc.name === 'stopTimer') triggerStopTimer();
        else if (fc.name === 'setTemperature') triggerSetTemperature(fc.args.level as string);
        else if (fc.name === 'nextStep') triggerNextStep();
        else if (fc.name === 'previousStep') triggerPrevStep();
        else if (fc.name === 'goToStep') triggerGoToStep(fc.args.index as number);

        sessionRef.current?.sendToolResponse({
          functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
        });
      }
    }

    if (message.serverContent?.outputTranscription) {
      setAiResponse(prev => prev + message.serverContent!.outputTranscription!.text);
    }
    if (message.serverContent?.turnComplete) setAiResponse('');
    if (message.serverContent?.interrupted) stopAudio();
  }, [triggerNextStep, triggerPrevStep, triggerGoToStep, triggerStartTimer, triggerPauseTimer, triggerResumeTimer, triggerStopTimer, triggerSetTemperature, stopAudio]);

  const toggleVoiceAssistant = async () => {
    if (isListening) {
      if (sessionRef.current) sessionRef.current.close();
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      setIsListening(false);
      setIsAssistantSpeaking(false);
      setInputVolume(0);
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        notify("Voice not supported");
        return;
      }
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
            setIsListening(true);
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const processor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);

            // Tuned for kitchen environments: frying, fans, clinking.
            const NOISE_GATE_THRESHOLD = 0.007;
            const HYSTERESIS_SAMPLES = 15;
            let quietCounter = 0;

            processor.onaudioprocess = (e) => {
              const input = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
              const rms = Math.sqrt(sum / input.length);
              setInputVolume(rms);

              if (rms > NOISE_GATE_THRESHOLD) {
                quietCounter = 0;
                const int16 = new Int16Array(input.length);
                for (let i = 0; i < input.length; i++) int16[i] = input[i] * 32768;
                const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
                sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
              } else if (quietCounter < HYSTERESIS_SAMPLES) {
                quietCounter++;
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
          onerror: (e) => console.error(e),
          onclose: () => {
            setIsListening(false);
            setIsAssistantSpeaking(false);
            setInputVolume(0);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: tools }],
          systemInstruction: `You are the CookAI Assistant for "${recipe.title}". 
          
          RECIPE STEPS:
          ${recipe.steps.map((s, i) => `Step ${i + 1}: ${s}`).join('\n')}
          
          CRITICAL SYNC & AUDITORY FEEDBACK RULES:
          1. YOU MUST VERBALLY ANNOUNCE EVERY ACTION. Confirmations are required for starting, pausing, stopping timers, setting temperatures, and moving steps.
          2. Examples of mandatory verbal announcements:
             - "Starting timer for 10 minutes."
             - "Timer paused."
             - "Resuming your timer."
             - "Timer stopped."
             - "Setting heat to Medium-High."
             - "Okay, next step."
          3. WHENEVER you refer to a specific step, call goToStep(index) first.
          4. NEVER say technical indices like "Index 0". Say "Step 1".
          5. Respond instantly and concisely.
          6. If noise is high, keep your verbal confirmations short but clear.`,
          outputAudioTranscription: {},
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-stone-50 z-50 flex flex-col overflow-hidden">
      {showFinishedOverlay && (
        <div className="fixed inset-0 z-[100] bg-emerald-600 flex flex-col items-center justify-center p-8 animate-in fade-in zoom-in duration-300">
          <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center mb-8 animate-bounce shadow-2xl">
            <span className="text-6xl text-emerald-600">🔔</span>
          </div>
          <h2 className="text-4xl font-black text-white text-center mb-4">TIMER DONE!</h2>
          <button
            onClick={() => triggerStopTimer()}
            className="bg-white text-emerald-600 px-12 py-4 rounded-2xl font-black text-xl shadow-lg active:scale-95 transition-transform"
          >
            OK
          </button>
        </div>
      )}

      {toolNotification && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="bg-stone-900 text-white px-5 py-2.5 rounded-full shadow-2xl font-bold text-xs flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
            {toolNotification}
          </div>
        </div>
      )}

      <div className="bg-white border-b border-stone-200 px-4 py-4 flex items-center justify-between">
        <button onClick={onExit} className="p-2 -ml-2 text-stone-500">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
        <div className="text-center">
          <h2 className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Step {currentStep + 1} of {stepsCount}</h2>
        </div>
        <div className="w-6 h-6"></div>
      </div>

      <div className="w-full h-1.5 bg-stone-100">
        <div
          className="h-full bg-emerald-500 transition-all duration-700 ease-out"
          style={{ width: `${((currentStep + 1) / stepsCount) * 100}%` }}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-stone-100 min-h-[160px] flex flex-col justify-center text-center relative overflow-hidden">
          <span className="text-emerald-500 font-black text-[10px] mb-4 uppercase tracking-[0.3em]">Kitchen Guidance</span>
          <h1 className="text-xl md:text-2xl font-bold text-stone-800 leading-snug">
            {recipe.steps[currentStep]}
          </h1>
        </div>

        {aiResponse && (
          <div className="bg-stone-900 text-white p-4 rounded-2xl shadow-2xl border border-stone-800 flex items-start gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-emerald-500 p-1.5 rounded-lg flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 100-2 1 1 0 000 2zm7-1a1 1 0 11-2 0 1 1 0 012 0zm-7.535 4h5.07a1 1 0 010 2h-5.07a1 1 0 010-2z" /></svg>
            </div>
            <p className="text-sm font-medium leading-relaxed pt-0.5">{aiResponse}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className={`p-5 rounded-[2rem] border transition-all h-36 flex flex-col justify-between ${timerSeconds !== null ? 'bg-emerald-600 text-white shadow-lg border-emerald-500' : 'bg-white border-stone-100 shadow-sm'}`}>
            <p className="text-[9px] uppercase font-black tracking-widest opacity-60">Step Timer</p>
            <p className="text-2xl font-mono font-black">{timerSeconds !== null ? formatTime(timerSeconds) : '0:00'}</p>
            <button onClick={() => triggerStartTimer(5)} className="w-full h-10 rounded-xl bg-white/20 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm active:scale-95 transition-transform">5m Start</button>
          </div>

          <div className={`p-5 rounded-[2rem] border transition-all h-36 flex flex-col justify-between ${activeTemperature !== 'Off' ? 'bg-orange-500 text-white shadow-lg border-orange-400' : 'bg-white border-stone-100 shadow-sm'}`}>
            <p className="text-[9px] uppercase font-black tracking-widest opacity-60">Heat Level</p>
            <p className="text-2xl font-black">{activeTemperature}</p>
            <button onClick={() => triggerSetTemperature(suggestedTemp)} className="w-full h-10 rounded-xl bg-white/20 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm active:scale-95 transition-transform">{suggestedTemp}</button>
          </div>
        </div>
      </div>

      <div className="bg-white border-t border-stone-200 px-6 py-6 pb-12 space-y-4">
        <div className="flex items-center justify-center gap-8">
          <button onClick={triggerPrevStep} disabled={currentStep === 0} className="w-12 h-12 rounded-2xl bg-stone-50 text-stone-400 disabled:opacity-30 border border-stone-100 active:scale-90 transition-all">
            <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
          </button>

          <div className="relative">
            {isListening && (
              <div
                className="absolute inset-0 bg-emerald-400/20 rounded-full animate-ping transition-transform duration-75 ease-out"
                style={{ transform: `scale(${2 + inputVolume * 10})` }}
              ></div>
            )}
            <button
              onClick={toggleVoiceAssistant}
              className={`w-20 h-20 rounded-full flex items-center justify-center shadow-2xl relative z-10 transition-all active:scale-95 ${isListening ? 'bg-emerald-600 scale-105' : 'bg-emerald-500'}`}
            >
              {isListening ? (
                <div className="flex items-center gap-1 h-8">
                  {[1, 2, 3, 4].map(i => (
                    <div
                      key={i}
                      className="w-1.5 bg-white rounded-full"
                      style={{
                        height: isAssistantSpeaking ? '100%' : `${25 + inputVolume * 1200}%`,
                        maxHeight: '28px',
                        animation: isAssistantSpeaking ? 'wave 0.4s ease-in-out infinite' : 'none',
                        animationDelay: `${i * 0.1}s`
                      }}
                    />
                  ))}
                </div>
              ) : (
                <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              )}
            </button>
          </div>

          <button onClick={triggerNextStep} disabled={currentStep === stepsCount - 1} className="w-12 h-12 rounded-2xl bg-stone-50 text-stone-400 disabled:opacity-30 border border-stone-100 active:scale-90 transition-all">
            <svg className="w-6 h-6 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="text-center text-stone-400 text-[10px] font-black uppercase tracking-widest h-4">
          {isListening ? (isAssistantSpeaking ? "Assistant Speaking" : "Listening...") : "Tap for Hands-Free Mode"}
        </div>
      </div>

      <style>{`
        @keyframes wave { 0%, 100% { height: 40%; } 50% { height: 100%; } }
      `}</style>
    </div>
  );
};

export default CookingMode;
